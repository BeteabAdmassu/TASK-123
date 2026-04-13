import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  session,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createTray, destroyTray } from './tray';
import { buildAppMenu, registerGlobalShortcuts } from './menus';
import { startCheckpointLoop, restoreCheckpoint, stopCheckpointLoop } from './checkpoint';
import { checkForOfflineUpdate } from './updater';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IS_DEV = process.env.NODE_ENV === 'development';

/** In development the Angular dev-server runs here */
const DEV_URL = 'http://localhost:4200';

/** In production the built Angular app is served from disk */
const PROD_INDEX = path.join(__dirname, '..', 'frontend', 'dist', 'talentops', 'index.html');

/** Fastify backend URL used for API calls in Electron context */
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

/** Path where window-state JSON is persisted between sessions */
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

// ---------------------------------------------------------------------------
// Window-state persistence helpers
// ---------------------------------------------------------------------------

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

interface MultiWindowState {
  main: WindowState;
  children: Array<{ route: string; state: WindowState }>;
}

function loadWindowState(): MultiWindowState | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(raw) as MultiWindowState;
    }
  } catch {
    // Corrupted state file — ignore and use defaults
  }
  return null;
}

function saveWindowState(state: MultiWindowState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Non-critical — log but do not crash
  }
}

function captureWindowState(win: BrowserWindow): WindowState {
  const bounds = win.getBounds();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized(),
  };
}

// ---------------------------------------------------------------------------
// Window registry — tracks all open windows by route
// ---------------------------------------------------------------------------

const windowRegistry = new Map<string, BrowserWindow>();

function mainWindowDefaults(): WindowState {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { x: 0, y: 0, width: Math.min(1400, width), height: Math.min(900, height), isMaximized: false };
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function resolveUrl(route: string): string {
  if (IS_DEV) {
    return `${DEV_URL}/#/${route}`;
  }
  return `file://${PROD_INDEX}#/${route}`;
}

function createWindow(
  route: string,
  stateOverride?: WindowState,
  options?: Partial<Electron.BrowserWindowConstructorOptions>,
): BrowserWindow {
  const existing = windowRegistry.get(route);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const defaults = mainWindowDefaults();
  const state = stateOverride || defaults;

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 800,
    minHeight: 600,
    title: 'TalentOps',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...options,
  });

  if (state.isMaximized) {
    win.maximize();
  }

  win.loadURL(resolveUrl(route));

  if (IS_DEV) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  windowRegistry.set(route, win);

  win.on('closed', () => {
    windowRegistry.delete(route);
  });

  return win;
}

function createMainWindow(): BrowserWindow {
  const savedState = loadWindowState();
  const mainState = savedState?.main || mainWindowDefaults();
  return createWindow('dashboard', mainState);
}

// ---------------------------------------------------------------------------
// Multi-window IPC handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  ipcMain.handle('window:open', (_event, route: string) => {
    createWindow(route);
    return { success: true };
  });

  ipcMain.handle('window:close', (_event, route: string) => {
    const win = windowRegistry.get(route);
    if (win && !win.isDestroyed()) {
      win.close();
    }
    return { success: true };
  });

  ipcMain.handle('window:list', () => {
    const routes: string[] = [];
    windowRegistry.forEach((_win, route) => {
      routes.push(route);
    });
    return routes;
  });

  ipcMain.handle('window:focus', (_event, route: string) => {
    const win = windowRegistry.get(route);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    return { success: true };
  });

  // Forward context-menu action from renderer to appropriate handler
  ipcMain.handle('context-menu:action', (_event, action: string, payload: unknown) => {
    BrowserWindow.getFocusedWindow()?.webContents.send('context-menu:execute', action, payload);
    return { success: true };
  });

  // Expose backend URL to renderer so it can build API requests
  ipcMain.handle('config:backend-url', () => {
    return BACKEND_URL;
  });

  // Receive JWT token from renderer after login — shared with tray and checkpoint
  ipcMain.on('auth:set-token', (_event, token: string | null) => {
    const { setSessionToken } = require('./tray');
    setSessionToken(token);
  });
}

// ---------------------------------------------------------------------------
// State persistence on quit
// ---------------------------------------------------------------------------

function persistAllWindowStates(): void {
  const mainWin = windowRegistry.get('dashboard');
  const mainState = mainWin && !mainWin.isDestroyed()
    ? captureWindowState(mainWin)
    : mainWindowDefaults();

  const children: MultiWindowState['children'] = [];
  windowRegistry.forEach((win, route) => {
    if (route !== 'dashboard' && !win.isDestroyed()) {
      children.push({ route, state: captureWindowState(win) });
    }
  });

  saveWindowState({ main: mainState, children });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

/** Prevent multiple instances — focus existing window instead */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  const mainWin = windowRegistry.get('dashboard');
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

app.whenReady().then(async () => {
  // Set Content-Security-Policy header for all requests
  session.defaultSession.webRequest.onHeadersReceived((_details, callback) => {
    callback({
      responseHeaders: {
        ..._details.responseHeaders,
        'Content-Security-Policy': [
          IS_DEV
            ? "default-src 'self' http://localhost:* ws://localhost:*; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        ],
      },
    });
  });

  // IPC bridge
  registerIpcHandlers();

  // Build application menu
  buildAppMenu();

  // Create the primary window
  const mainWindow = createMainWindow();

  // System tray
  createTray(mainWindow, BACKEND_URL);

  // Register Ctrl+K, Ctrl+Enter, Alt+N global shortcuts
  registerGlobalShortcuts();

  // Crash-recovery checkpoint loop (every 30 s)
  startCheckpointLoop(windowRegistry, BACKEND_URL);

  // Attempt to restore previous checkpoint if the last session did not shut down cleanly
  await restoreCheckpoint(BACKEND_URL, (route: string, state?: WindowState) => {
    createWindow(route, state);
  });

  // Check for offline update package on startup
  checkForOfflineUpdate();

  // Restore child windows from persisted state
  const savedState = loadWindowState();
  if (savedState?.children) {
    for (const child of savedState.children) {
      createWindow(child.route, child.state);
    }
  }
});

app.on('window-all-closed', () => {
  // On macOS apps typically stay open until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // Re-create main window when dock icon is clicked (macOS)
  if (windowRegistry.size === 0) {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  persistAllWindowStates();
  stopCheckpointLoop();
  destroyTray();
  globalShortcut.unregisterAll();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

export { createWindow, windowRegistry, BACKEND_URL };
