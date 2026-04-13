import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as http from 'http';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tray: Tray | null = null;
let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let lastPendingCount = 0;

/** How often to poll the backend for pending notification count (ms) */
const POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Badge / overlay helpers
// ---------------------------------------------------------------------------

/**
 * Build a NativeImage that shows the badge count on top of the tray icon.
 * Falls back to a plain icon when count is zero.
 */
function buildTrayIcon(count: number): Electron.NativeImage {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  // If the icon file is missing (dev environment), create a minimal 16x16 empty image
  if (icon.isEmpty()) {
    return nativeImage.createEmpty();
  }

  // Electron does not natively composite text onto NativeImage in the main
  // process without a canvas. Instead we use the OS-level overlay approach:
  //   - Windows: app.setBadgeCount() + overlay icon on taskbar
  //   - macOS: app.dock.setBadge()
  // The tray tooltip is always updated with the count.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge(count > 0 ? String(count) : '');
  } else if (process.platform === 'win32') {
    // On Windows we update the overlay on the main window (handled by caller).
    // For the tray itself, the tooltip carries the count.
  }

  return icon;
}

// ---------------------------------------------------------------------------
// Notification polling
// ---------------------------------------------------------------------------

/**
 * Fetch /api/notifications/pending-count from the Fastify backend.
 * Uses raw http to avoid requiring node-fetch in the main process.
 * Returns the count number or 0 on any error.
 */
function fetchPendingCount(backendUrl: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const url = `${backendUrl}/api/notifications/pending-count`;

    const req = http.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { count?: number };
          resolve(typeof parsed.count === 'number' ? parsed.count : 0);
        } catch {
          resolve(0);
        }
      });
    });

    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
  });
}

function updateTrayState(count: number, mainWindow: BrowserWindow | null): void {
  if (!tray || tray.isDestroyed()) return;

  lastPendingCount = count;

  // Update tooltip
  const tooltipText = count > 0
    ? `TalentOps — ${count} pending notification${count !== 1 ? 's' : ''}`
    : 'TalentOps — No pending notifications';
  tray.setToolTip(tooltipText);

  // Refresh icon (triggers OS badge on macOS)
  tray.setImage(buildTrayIcon(count));

  // On Windows, update taskbar overlay on the main window
  if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    if (count > 0) {
      mainWindow.setOverlayIcon(
        buildTrayIcon(count),
        `${count} pending notification${count !== 1 ? 's' : ''}`,
      );
    } else {
      mainWindow.setOverlayIcon(null, '');
    }
  }

  // Notify all renderer processes so the Angular badge service can update
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('tray:badge-update', count);
    }
  }
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function buildTrayContextMenu(mainWindow: BrowserWindow | null): Menu {
  return Menu.buildFromTemplate([
    {
      label: `Pending: ${lastPendingCount}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit TalentOps',
      click: () => {
        app.quit();
      },
    },
  ]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the system tray icon, badge polling, and context menu.
 * Call once from main.ts after `app.whenReady()`.
 */
export function createTray(mainWindow: BrowserWindow, backendUrl: string): Tray {
  const icon = buildTrayIcon(0);
  tray = new Tray(icon);
  tray.setToolTip('TalentOps');
  tray.setContextMenu(buildTrayContextMenu(mainWindow));

  // Left-click on tray icon shows / focuses the main window
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  // Start polling
  const poll = async () => {
    const count = await fetchPendingCount(backendUrl);
    updateTrayState(count, mainWindow);
    // Rebuild context menu so count label refreshes
    if (tray && !tray.isDestroyed()) {
      tray.setContextMenu(buildTrayContextMenu(mainWindow));
    }
  };

  // Initial fetch
  poll();

  // Recurring poll every POLL_INTERVAL_MS
  pollIntervalId = setInterval(poll, POLL_INTERVAL_MS);

  return tray;
}

/**
 * Clean up tray resources. Call from `app.on('before-quit')`.
 */
export function destroyTray(): void {
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}

export { lastPendingCount };
