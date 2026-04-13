import { BrowserWindow, ipcMain } from 'electron';
import * as http from 'http';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Interval between automatic checkpoint saves (ms) */
const CHECKPOINT_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let checkpointTimerId: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WindowCheckpointData {
  route: string;
  bounds: { x: number; y: number; width: number; height: number };
  isMaximized: boolean;
  formState: Record<string, unknown> | null;
}

interface CheckpointPayload {
  checkpoint_data: {
    timestamp: string;
    windows: WindowCheckpointData[];
  };
}

interface CheckpointResponse {
  id: string;
  user_id: string;
  checkpoint_data: CheckpointPayload['checkpoint_data'];
  created_at: string;
}

// ---------------------------------------------------------------------------
// IPC state collection from renderer
// ---------------------------------------------------------------------------

/**
 * Ask a single renderer window for its current form / component state.
 * The preload script exposes a listener on 'checkpoint:collect-state' that
 * the Angular app responds to with serialised form data.
 *
 * Returns null if the window does not respond within 2 seconds.
 */
function collectWindowState(win: BrowserWindow): Promise<WindowCheckpointData | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 2000);

    const responseChannel = `checkpoint:state-response-${win.id}`;

    ipcMain.once(responseChannel, (_event, data: Record<string, unknown> | null) => {
      clearTimeout(timeout);
      const bounds = win.getBounds();
      // Derive route from the window URL hash
      const url = win.webContents.getURL();
      const hashIndex = url.indexOf('#/');
      const route = hashIndex >= 0 ? url.substring(hashIndex + 2) : 'dashboard';

      resolve({
        route,
        bounds,
        isMaximized: win.isMaximized(),
        formState: data,
      });
    });

    // Ask renderer to collect its state
    if (!win.isDestroyed()) {
      win.webContents.send('checkpoint:collect-state', responseChannel);
    } else {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

/**
 * Collect state from ALL open windows and build the checkpoint payload.
 */
async function collectAllWindowStates(
  windowRegistry: Map<string, BrowserWindow>,
): Promise<CheckpointPayload> {
  const windowDataPromises: Promise<WindowCheckpointData | null>[] = [];

  windowRegistry.forEach((win) => {
    if (!win.isDestroyed()) {
      windowDataPromises.push(collectWindowState(win));
    }
  });

  const results = await Promise.all(windowDataPromises);
  const windows = results.filter((w): w is WindowCheckpointData => w !== null);

  return {
    checkpoint_data: {
      timestamp: new Date().toISOString(),
      windows,
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers (main process → Fastify backend)
// ---------------------------------------------------------------------------

/**
 * POST checkpoint data to /api/checkpoint.
 * Uses raw http.request to avoid external dependencies in the main process.
 */
function saveCheckpoint(backendUrl: string, payload: CheckpointPayload): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const url = new URL('/api/checkpoint', backendUrl);
    const body = JSON.stringify(payload);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 5000,
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk: Buffer) => {
          responseBody += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Checkpoint save failed (${res.statusCode}): ${responseBody}`));
          }
        });
      },
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Checkpoint save timed out'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * GET /api/checkpoint/latest — fetch the most recent checkpoint for the user.
 */
function fetchLatestCheckpoint(backendUrl: string): Promise<CheckpointResponse | null> {
  return new Promise((resolve) => {
    const url = new URL('/api/checkpoint/latest', backendUrl);

    const req = http.get(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(body) as CheckpointResponse);
            } catch {
              resolve(null);
            }
          } else {
            // 404 means no checkpoint exists yet — not an error
            resolve(null);
          }
        });
      },
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the periodic checkpoint loop. Every 30 seconds:
 * 1. Collect state from all open BrowserWindows via IPC.
 * 2. POST the aggregated state to /api/checkpoint.
 *
 * Called from main.ts after app.whenReady().
 */
export function startCheckpointLoop(
  windowRegistry: Map<string, BrowserWindow>,
  backendUrl: string,
): void {
  stopCheckpointLoop();

  checkpointTimerId = setInterval(async () => {
    try {
      const payload = await collectAllWindowStates(windowRegistry);
      if (payload.checkpoint_data.windows.length > 0) {
        await saveCheckpoint(backendUrl, payload);
      }
    } catch {
      // Checkpoint failures are non-critical — silently continue
    }
  }, CHECKPOINT_INTERVAL_MS);
}

/**
 * Stop the periodic checkpoint loop. Called on app quit.
 */
export function stopCheckpointLoop(): void {
  if (checkpointTimerId !== null) {
    clearInterval(checkpointTimerId);
    checkpointTimerId = null;
  }
}

/**
 * On app start, fetch the latest checkpoint and restore windows/form state.
 *
 * @param backendUrl  Base URL of the Fastify backend.
 * @param openWindow  Callback that creates a BrowserWindow for a given route
 *                    and optional bounds state.
 */
export async function restoreCheckpoint(
  backendUrl: string,
  openWindow: (
    route: string,
    state?: { x: number; y: number; width: number; height: number; isMaximized: boolean },
  ) => void,
): Promise<void> {
  const checkpoint = await fetchLatestCheckpoint(backendUrl);
  if (!checkpoint?.checkpoint_data?.windows) return;

  const { windows } = checkpoint.checkpoint_data;

  for (const win of windows) {
    // The main dashboard window is already created by main.ts, so skip it
    if (win.route === 'dashboard') continue;

    const state = win.bounds
      ? { ...win.bounds, isMaximized: win.isMaximized }
      : undefined;

    openWindow(win.route, state);
  }

  // After windows are created, send saved form state to each renderer
  // We defer this slightly so the Angular app has time to initialise
  setTimeout(() => {
    for (const winData of windows) {
      const allWindows = BrowserWindow.getAllWindows();
      for (const bw of allWindows) {
        const url = bw.webContents.getURL();
        const hashIndex = url.indexOf('#/');
        const route = hashIndex >= 0 ? url.substring(hashIndex + 2) : 'dashboard';
        if (route === winData.route && winData.formState) {
          bw.webContents.send('checkpoint:restore-state', winData.formState);
        }
      }
    }
  }, 3000);
}

// ---------------------------------------------------------------------------
// IPC handlers for manual checkpoint operations from the renderer
// ---------------------------------------------------------------------------

ipcMain.handle('checkpoint:save-now', async (_event) => {
  // This is a manual save triggered from the renderer
  // We need access to the window registry — import it from main
  const { windowRegistry, BACKEND_URL } = require('./main');
  try {
    const payload = await collectAllWindowStates(windowRegistry as Map<string, BrowserWindow>);
    await saveCheckpoint(BACKEND_URL as string, payload);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('checkpoint:restore', async () => {
  const { BACKEND_URL } = require('./main');
  const checkpoint = await fetchLatestCheckpoint(BACKEND_URL as string);
  if (!checkpoint) {
    return { success: false, error: 'No checkpoint found' };
  }
  return { success: true, data: checkpoint.checkpoint_data };
});
