/**
 * Auto-update wiring. The installed app polls the publish feed configured in
 * electron-builder.yml on launch; if a newer version is available the
 * installer is downloaded in the background and applied on next quit.
 *
 * Disabled in dev (no packaged app to update) and disabled when the publish
 * URL still points at the placeholder host so a fresh clone doesn't spam
 * network errors.
 */

import { app, dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

const PLACEHOLDER_HOST = 'abonmarche-updates.example.com';

export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return;

  const feed = autoUpdater.getFeedURL();
  if (!feed || feed.includes(PLACEHOLDER_HOST)) {
    console.log('[auto-updater] publish feed not configured; skipping check');
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
      detail: 'The update will be applied the next time you quit the app. Restart now to apply immediately.',
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[auto-updater] initial check failed:', err?.message ?? err);
  });
}
