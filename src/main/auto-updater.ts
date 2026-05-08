/**
 * Auto-update wiring. The installed app polls the publish feed configured in
 * electron-builder.yml on launch; if a newer version is available the
 * installer is downloaded in the background and applied on next quit.
 *
 * Disabled in dev (no packaged app to update) and disabled when the publish
 * URL still points at the placeholder host so a fresh clone doesn't spam
 * network errors.
 *
 * Also exposes `manualCheckForUpdates()` for the renderer's
 * "Check for updates" button — same underlying check, but returns a
 * structured result the UI can render inline.
 */

import { app, dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

import type { UpdateCheckResult } from '@shared/types';

const PLACEHOLDER_HOST = 'abonmarche-updates.example.com';

/**
 * Returns `true` if the publish feed is real (not the placeholder) and we're
 * running a packaged build. Used both for the initial check on launch and
 * for the manual-check IPC handler.
 */
function isUpdaterEnabled(): { enabled: boolean; reason?: string } {
  if (!app.isPackaged) {
    return { enabled: false, reason: 'Updates are disabled in dev mode.' };
  }
  const feed = autoUpdater.getFeedURL();
  if (!feed || feed.includes(PLACEHOLDER_HOST)) {
    return { enabled: false, reason: 'Update feed not configured.' };
  }
  return { enabled: true };
}

export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  const gate = isUpdaterEnabled();
  if (!gate.enabled) {
    console.log(`[auto-updater] ${gate.reason} skipping initial check`);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.warn('[auto-updater] error:', err?.message ?? err);
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[auto-updater] update available:', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[auto-updater] no update available');
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const win = getWindow();
    const result = await dialog.showMessageBox(win ?? undefined!, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Cost Estimator ${info.version} is ready to install.`,
      detail:
        'The update will be applied the next time you quit the app. Restart now to apply immediately.',
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[auto-updater] initial check failed:', err?.message ?? err);
  });
}

/**
 * Trigger an update check on demand and return a structured result the
 * renderer can render inline. The actual install is still handled by the
 * `update-downloaded` event handler set up in `initAutoUpdater`.
 */
export async function manualCheckForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  const gate = isUpdaterEnabled();
  if (!gate.enabled) {
    return { status: 'disabled', currentVersion, message: gate.reason ?? 'Updates disabled.' };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) {
      return {
        status: 'check-running',
        currentVersion,
        message: 'A check is already in progress.',
      };
    }
    const latestVersion = result.updateInfo.version;
    if (latestVersion === currentVersion) {
      return { status: 'up-to-date', currentVersion, latestVersion };
    }
    // autoDownload is true, so an update being available means a download is
    // either already underway or will start imminently. The existing
    // `update-downloaded` handler will surface the restart prompt.
    return { status: 'downloading', currentVersion, latestVersion };
  } catch (e) {
    return {
      status: 'error',
      currentVersion,
      message: (e as Error).message ?? 'Check failed.',
    };
  }
}
