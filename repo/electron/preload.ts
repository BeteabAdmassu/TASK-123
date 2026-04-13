import { contextBridge, ipcRenderer } from 'electron';

// ---------------------------------------------------------------------------
// Type definitions for the exposed API
// ---------------------------------------------------------------------------

interface WindowManagementApi {
  /** Open a new window for the given Angular route (e.g. 'candidates/42') */
  openWindow(route: string): Promise<{ success: boolean }>;
  /** Close the window associated with the given route */
  closeWindow(route: string): Promise<{ success: boolean }>;
  /** List all currently-open window routes */
  listWindows(): Promise<string[]>;
  /** Bring the window for the given route to the front */
  focusWindow(route: string): Promise<{ success: boolean }>;
}

interface TrayApi {
  /** Subscribe to badge count updates from the system tray poller */
  onBadgeUpdate(callback: (count: number) => void): void;
  /** Remove the badge update listener */
  offBadgeUpdate(callback: (count: number) => void): void;
}

interface CheckpointApi {
  /** Trigger an immediate checkpoint save */
  saveNow(): Promise<{ success: boolean; error?: string }>;
  /** Fetch the latest checkpoint data */
  restore(): Promise<{ success: boolean; data?: unknown; error?: string }>;
  /** Register a handler that the main process calls to collect form state */
  onCollectState(callback: (responseChannel: string) => void): void;
  /** Register a handler for restoring previously-saved form state */
  onRestoreState(callback: (formState: Record<string, unknown>) => void): void;
  /** Send form state back to the main process during checkpoint collection */
  sendState(responseChannel: string, data: Record<string, unknown> | null): void;
}

interface UpdaterApi {
  /** Check if an offline update is available */
  check(): Promise<{
    available: boolean;
    currentVersion?: string;
    availableVersion?: string;
  }>;
  /** Apply the discovered offline update (will restart the app) */
  apply(): Promise<{ success: boolean }>;
  /** Rollback to the previous version (will restart the app) */
  rollback(): Promise<{ success: boolean; error?: string }>;
  /** Check whether a previous version exists for rollback */
  hasRollback(): Promise<{ available: boolean }>;
}

interface ContextMenuApi {
  /** Request the main process to show a native context menu */
  show(menuType: string, payload: Record<string, string>): Promise<void>;
  /** Subscribe to context-menu action results dispatched by the main process */
  onAction(callback: (action: string, payload: unknown) => void): void;
  /** Remove a context-menu action listener */
  offAction(callback: (action: string, payload: unknown) => void): void;
}

interface NavigationApi {
  /** Subscribe to navigation commands from global shortcuts or menu items */
  onNavigate(callback: (route: string) => void): void;
  /** Remove a navigation listener */
  offNavigate(callback: (route: string) => void): void;
}

interface ShortcutApi {
  /** Subscribe to the Ctrl+K (search) shortcut from the main process */
  onSearch(callback: () => void): void;
  /** Subscribe to the Ctrl+Enter (save/submit) shortcut */
  onSave(callback: () => void): void;
  /** Subscribe to the Alt+N (notifications) shortcut */
  onNotifications(callback: () => void): void;
}

interface ConfigApi {
  /** Get the backend base URL configured in the Electron app */
  getBackendUrl(): Promise<string>;
}

interface AuthBridgeApi {
  /** Pass JWT token to main process for tray/checkpoint backend calls */
  setToken(token: string | null): void;
}

/** The full API exposed to the renderer under `window.electronAPI` */
interface ElectronBridgeApi {
  window: WindowManagementApi;
  tray: TrayApi;
  checkpoint: CheckpointApi;
  updater: UpdaterApi;
  contextMenu: ContextMenuApi;
  navigation: NavigationApi;
  shortcuts: ShortcutApi;
  config: ConfigApi;
  auth: AuthBridgeApi;
}

// ---------------------------------------------------------------------------
// Listener registries
// ---------------------------------------------------------------------------

// We wrap ipcRenderer.on callbacks so we can map the caller's callback to the
// actual IPC handler for proper removal with offXxx().

const badgeListeners = new Map<(count: number) => void, (...args: unknown[]) => void>();
const contextMenuListeners = new Map<
  (action: string, payload: unknown) => void,
  (...args: unknown[]) => void
>();
const navigationListeners = new Map<(route: string) => void, (...args: unknown[]) => void>();

// ---------------------------------------------------------------------------
// Bridge implementation
// ---------------------------------------------------------------------------

const electronBridge: ElectronBridgeApi = {
  // ----- Window management -----
  window: {
    openWindow(route: string) {
      return ipcRenderer.invoke('window:open', route);
    },
    closeWindow(route: string) {
      return ipcRenderer.invoke('window:close', route);
    },
    listWindows() {
      return ipcRenderer.invoke('window:list');
    },
    focusWindow(route: string) {
      return ipcRenderer.invoke('window:focus', route);
    },
  },

  // ----- Tray / badge -----
  tray: {
    onBadgeUpdate(callback: (count: number) => void) {
      const handler = (_event: unknown, count: number) => callback(count);
      badgeListeners.set(callback, handler);
      ipcRenderer.on('tray:badge-update', handler);
    },
    offBadgeUpdate(callback: (count: number) => void) {
      const handler = badgeListeners.get(callback);
      if (handler) {
        ipcRenderer.removeListener('tray:badge-update', handler);
        badgeListeners.delete(callback);
      }
    },
  },

  // ----- Checkpoint (crash recovery) -----
  checkpoint: {
    saveNow() {
      return ipcRenderer.invoke('checkpoint:save-now');
    },
    restore() {
      return ipcRenderer.invoke('checkpoint:restore');
    },
    onCollectState(callback: (responseChannel: string) => void) {
      ipcRenderer.on('checkpoint:collect-state', (_event, responseChannel: string) => {
        callback(responseChannel);
      });
    },
    onRestoreState(callback: (formState: Record<string, unknown>) => void) {
      ipcRenderer.on('checkpoint:restore-state', (_event, formState: Record<string, unknown>) => {
        callback(formState);
      });
    },
    sendState(responseChannel: string, data: Record<string, unknown> | null) {
      ipcRenderer.send(responseChannel, data);
    },
  },

  // ----- Offline updater -----
  updater: {
    check() {
      return ipcRenderer.invoke('updater:check');
    },
    apply() {
      return ipcRenderer.invoke('updater:apply');
    },
    rollback() {
      return ipcRenderer.invoke('updater:rollback');
    },
    hasRollback() {
      return ipcRenderer.invoke('updater:has-rollback');
    },
  },

  // ----- Context menus -----
  contextMenu: {
    show(menuType: string, payload: Record<string, string>) {
      return ipcRenderer.invoke('context-menu:show', menuType, payload);
    },
    onAction(callback: (action: string, payload: unknown) => void) {
      const handler = (_event: unknown, action: string, payload: unknown) =>
        callback(action, payload);
      contextMenuListeners.set(callback, handler);
      ipcRenderer.on('context-menu:execute', handler);
    },
    offAction(callback: (action: string, payload: unknown) => void) {
      const handler = contextMenuListeners.get(callback);
      if (handler) {
        ipcRenderer.removeListener('context-menu:execute', handler);
        contextMenuListeners.delete(callback);
      }
    },
  },

  // ----- Navigation from menu / shortcuts -----
  navigation: {
    onNavigate(callback: (route: string) => void) {
      const handler = (_event: unknown, route: string) => callback(route);
      navigationListeners.set(callback, handler);
      ipcRenderer.on('navigate:route', handler);
    },
    offNavigate(callback: (route: string) => void) {
      const handler = navigationListeners.get(callback);
      if (handler) {
        ipcRenderer.removeListener('navigate:route', handler);
        navigationListeners.delete(callback);
      }
    },
  },

  // ----- Global keyboard shortcuts -----
  shortcuts: {
    onSearch(callback: () => void) {
      ipcRenderer.on('shortcut:search', () => callback());
    },
    onSave(callback: () => void) {
      ipcRenderer.on('shortcut:save', () => callback());
    },
    onNotifications(callback: () => void) {
      ipcRenderer.on('shortcut:notifications', () => callback());
    },
  },

  // ----- Config -----
  config: {
    getBackendUrl() {
      return ipcRenderer.invoke('config:backend-url');
    },
  },

  // ----- Auth (renderer → main process session sharing) -----
  auth: {
    /** Pass JWT token to main process for tray/checkpoint backend calls */
    setToken(token: string | null) {
      ipcRenderer.send('auth:set-token', token);
    },
  },
};

// ---------------------------------------------------------------------------
// Expose to renderer
// ---------------------------------------------------------------------------

contextBridge.exposeInMainWorld('electronAPI', electronBridge);
