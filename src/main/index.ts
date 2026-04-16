/**
 * Electron main entry point.
 *
 * Boots the single renderer window, wires up IPC, and initialises the
 * AutoCAD + CostEstDB tool plumbing. We don't touch COM here — everything
 * deferred until the first tool call so the app launches cleanly even if
 * AutoCAD isn't running yet.
 */

import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

import { registerIpcHandlers } from './ipc-handlers';

const isDev = !app.isPackaged;

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

app.whenReady().then(() => {
  loadEnvFile();
  registerIpcHandlers({ getMainWindow });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep macOS convention even though we target Windows — harmless.
  if (process.platform !== 'darwin') app.quit();
});
