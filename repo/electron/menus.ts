import {
  Menu,
  MenuItem,
  BrowserWindow,
  globalShortcut,
  shell,
  app,
  MenuItemConstructorOptions,
} from 'electron';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send an IPC message to the focused renderer window.
 * The Angular KeyboardService listens on these channels to trigger UI actions.
 */
function sendToFocusedRenderer(channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getFocusedWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

// ---------------------------------------------------------------------------
// Application menu (menu bar)
// ---------------------------------------------------------------------------

export function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),

    // File
    {
      label: 'File',
      submenu: [
        {
          label: 'New Recruiting Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToFocusedRenderer('menu:new-project'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    // Edit
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    // View
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Navigate
    {
      label: 'Navigate',
      submenu: [
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendToFocusedRenderer('navigate:route', '/dashboard'),
        },
        {
          label: 'Recruiting',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendToFocusedRenderer('navigate:route', '/recruiting'),
        },
        {
          label: 'Approvals',
          accelerator: 'CmdOrCtrl+3',
          click: () => sendToFocusedRenderer('navigate:route', '/approvals'),
        },
        {
          label: 'Notifications',
          accelerator: 'CmdOrCtrl+4',
          click: () => sendToFocusedRenderer('navigate:route', '/notifications'),
        },
        {
          label: 'Geospatial Map',
          accelerator: 'CmdOrCtrl+5',
          click: () => sendToFocusedRenderer('navigate:route', '/geospatial'),
        },
        { type: 'separator' },
        {
          label: 'Search (Ctrl+K)',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendToFocusedRenderer('shortcut:search'),
        },
      ],
    },

    // Actions
    {
      label: 'Actions',
      submenu: [
        {
          label: 'Tag Candidate',
          click: () => sendToFocusedRenderer('context-menu:execute', 'tag-candidate'),
        },
        {
          label: 'Request Missing Materials',
          click: () => sendToFocusedRenderer('context-menu:execute', 'request-materials'),
        },
        {
          label: 'Create Approval Task',
          click: () => sendToFocusedRenderer('context-menu:execute', 'create-approval'),
        },
        { type: 'separator' },
        {
          label: 'Submit / Save',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => sendToFocusedRenderer('shortcut:save'),
        },
        {
          label: 'Next Record',
          accelerator: 'Alt+N',
          click: () => sendToFocusedRenderer('shortcut:next-record'),
        },
      ],
    },

    // Window
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
      ],
    },

    // Help
    {
      label: 'Help',
      submenu: [
        {
          label: 'TalentOps Documentation',
          click: () => shell.openExternal('https://docs.talentops.example.com'),
        },
        {
          label: 'About TalentOps',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              sendToFocusedRenderer('navigate:route', '/admin');
            }
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ---------------------------------------------------------------------------
// Context menus (right-click)
// ---------------------------------------------------------------------------

/**
 * Show a context menu for candidate-related actions.
 * Called from the renderer via IPC when the user right-clicks a candidate row.
 */
export function showCandidateContextMenu(
  window: BrowserWindow,
  candidateId: string,
): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Tag Candidate',
      click: () => {
        window.webContents.send('context-menu:execute', 'tag-candidate', { candidateId });
      },
    },
    {
      label: 'Request Missing Materials',
      click: () => {
        window.webContents.send('context-menu:execute', 'request-materials', { candidateId });
      },
    },
    { type: 'separator' },
    {
      label: 'Create Approval Task',
      click: () => {
        window.webContents.send('context-menu:execute', 'create-approval', { candidateId });
      },
    },
    { type: 'separator' },
    {
      label: 'Open in New Window',
      click: () => {
        window.webContents.send('context-menu:execute', 'open-window', {
          route: `candidates/${candidateId}`,
        });
      },
    },
  ]);

  menu.popup({ window });
}

/**
 * Show a context menu for approval-related actions.
 */
export function showApprovalContextMenu(
  window: BrowserWindow,
  approvalId: string,
): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Approve',
      click: () => {
        window.webContents.send('context-menu:execute', 'approve', { approvalId });
      },
    },
    {
      label: 'Reject',
      click: () => {
        window.webContents.send('context-menu:execute', 'reject', { approvalId });
      },
    },
    {
      label: 'Request More Info',
      click: () => {
        window.webContents.send('context-menu:execute', 'request-info', { approvalId });
      },
    },
    { type: 'separator' },
    {
      label: 'Open in New Window',
      click: () => {
        window.webContents.send('context-menu:execute', 'open-window', {
          route: `approvals`,
        });
      },
    },
  ]);

  menu.popup({ window });
}

// ---------------------------------------------------------------------------
// Global shortcuts
// ---------------------------------------------------------------------------

/**
 * Register global shortcuts that are forwarded to the focused renderer.
 * These mirror the keyboard shortcuts in the Angular KeyboardService:
 *   Ctrl+K  — Open search dialog
 *   Ctrl+Enter — Save / Submit current form
 *   Alt+N   — Next record (navigate to next item in current list context)
 *
 * Called once from main.ts after app.whenReady().
 */
export function registerGlobalShortcuts(): void {
  globalShortcut.register('CommandOrControl+K', () => {
    sendToFocusedRenderer('shortcut:search');
  });

  globalShortcut.register('CommandOrControl+Enter', () => {
    sendToFocusedRenderer('shortcut:save');
  });

  globalShortcut.register('Alt+N', () => {
    sendToFocusedRenderer('shortcut:next-record');
  });
}

// ---------------------------------------------------------------------------
// IPC handler for renderer-triggered context menus
// ---------------------------------------------------------------------------

import { ipcMain } from 'electron';

ipcMain.handle(
  'context-menu:show',
  (_event, menuType: string, payload: Record<string, string>) => {
    const win = BrowserWindow.fromWebContents(_event.sender);
    if (!win) return;

    switch (menuType) {
      case 'candidate':
        showCandidateContextMenu(win, payload.candidateId);
        break;
      case 'approval':
        showApprovalContextMenu(win, payload.approvalId);
        break;
      default:
        break;
    }
  },
);
