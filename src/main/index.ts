/**
 * Electron main entry point.
 *
 * Boots the single renderer window, wires up IPC, boots MSAL auth, and
 * handles the custom protocol callback for the MSAL sign-in flow. We
 * don't touch COM here — everything deferred until the first tool call
 * so the app launches cleanly even if AutoCAD isn't running yet.
 */

import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

import { injectBakedEnv } from './baked-env';
import { registerIpcHandlers } from './ipc-handlers';
import { initAutoUpdater } from './auto-updater';
import { handleAuthCallback } from './auth/flow';
import { bootAuthState } from './auth/state';

// Run BEFORE anything else touches process.env or imports an SDK that
// reads from it. ES module imports hoist, so this still runs after the
// imports above — but the imports above don't trigger SDK env reads
// (those happen lazily inside ipc-handlers).
injectBakedEnv();

const isDev = !app.isPackaged;

// MSAL redirect protocol. Must match the public-client redirect URI on
// the cost-estimator-desktop app registration in Entra.
const MSAL_PROTOCOL = 'msal-cost-estimator';

// Preserve a handle so we can address the window from IPC handlers (for
// streaming measurement updates).
let mainWindow: BrowserWindow | null = null;

function loadEnvFile(): void {
  // Very small .env loader — avoids adding a dotenv dependency.
  if (!isDev) return;
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (e) {
    console.warn('Failed to parse .env:', (e as Error).message);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 720,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Cost Estimator',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open external links in the system browser rather than in the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * Find any msal-cost-estimator:// URL in a list of command-line args (the
 * launching shell appends the URL as a positional arg on Windows).
 */
function findAuthCallback(argv: string[]): string | null {
  return argv.find((a) => a.startsWith(`${MSAL_PROTOCOL}://`)) ?? null;
}

// ─── Single-instance + protocol registration ────────────────────────────────

// Acquire the lock first. A second instance launched by the OS to handle
// a protocol URL will fail this lock, fire `second-instance` on the
// primary, and exit. Without this, the protocol callback opens a new app
// window every time — and the original sign-in flow's pending promise
// stays unresolved.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Register the custom protocol. Dev/packaged differ — when running
  // unpackaged, electron.exe is the launcher and needs the full path +
  // the script's path as an arg so the OS knows which renderer to spawn.
  if (process.platform === 'win32' && process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(MSAL_PROTOCOL, process.execPath, [
        join(__dirname, '..', '..'),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(MSAL_PROTOCOL);
  }

  // Windows/Linux: protocol callback arrives as a second-instance event.
  app.on('second-instance', (_event, argv) => {
    const url = findAuthCallback(argv);
    if (url) {
      void handleAuthCallback(url);
    }
    // Focus the existing window so the user sees the result.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS: protocol callback arrives as an open-url event. Harmless on
  // other platforms — registration just never fires.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url.startsWith(`${MSAL_PROTOCOL}://`)) {
      void handleAuthCallback(url);
    }
  });

  app.whenReady().then(() => {
    loadEnvFile();
    registerIpcHandlers({ getMainWindow });
    createWindow();
    initAutoUpdater(getMainWindow);

    // Boot MSAL: inspects the persistent cache and broadcasts the initial
    // auth state to the renderer once the window has a webContents.
    // Errors don't block boot — the renderer's SignInScreen handles
    // signedOut state.
    void bootAuthState();

    // If the app was launched by a protocol click (Windows passes the URL
    // as a positional arg), process it now. Common only when the app is
    // not already running.
    const launchUrl = findAuthCallback(process.argv);
    if (launchUrl) {
      void handleAuthCallback(launchUrl);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  // Keep macOS convention even though we target Windows — harmless.
  if (process.platform !== 'darwin') app.quit();
});
