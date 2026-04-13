/**
 * AdminComponent – Updater Behavior Tests
 *
 * Tests the update/rollback UI logic without a full Angular TestBed,
 * by exercising the same patterns used in AdminComponent methods
 * against mock Electron APIs.
 */

/** Mirror of the helper from admin.component.ts */
interface ElectronUpdaterApi {
  check(): Promise<{ available: boolean; currentVersion?: string; availableVersion?: string }>;
  apply(): Promise<{ success: boolean }>;
  rollback(): Promise<{ success: boolean; error?: string }>;
  hasRollback(): Promise<{ available: boolean }>;
}

function getElectronUpdater(win: Record<string, unknown>): ElectronUpdaterApi | null {
  try {
    const api = win['electronAPI'] as { updater?: ElectronUpdaterApi } | undefined;
    return api?.updater ?? null;
  } catch {
    return null;
  }
}

describe('AdminComponent updater behavior', () => {
  describe('Uses Electron updater bridge when present', () => {
    let mockUpdater: {
      check: jest.Mock;
      apply: jest.Mock;
      rollback: jest.Mock;
      hasRollback: jest.Mock;
    };

    beforeEach(() => {
      mockUpdater = {
        check: jest.fn(),
        apply: jest.fn(),
        rollback: jest.fn(),
        hasRollback: jest.fn(),
      };
    });

    it('checkForUpdate sets updateAvailable, currentVersion, availableVersion from bridge', async () => {
      mockUpdater.check.mockResolvedValue({
        available: true,
        currentVersion: '1.0.0',
        availableVersion: '1.2.0',
      });

      const updater = getElectronUpdater({ electronAPI: { updater: mockUpdater } });
      expect(updater).not.toBeNull();

      // Simulate what checkForUpdate() does
      let updateAvailable = false;
      let currentVersion = '';
      let availableVersion = '';
      let updaterError = '';

      try {
        const result = await updater!.check();
        updateAvailable = result.available;
        currentVersion = result.currentVersion || '';
        availableVersion = result.availableVersion || '';
      } catch {
        updaterError = 'Failed to check for updates.';
      }

      expect(updateAvailable).toBe(true);
      expect(currentVersion).toBe('1.0.0');
      expect(availableVersion).toBe('1.2.0');
      expect(updaterError).toBe('');
      expect(mockUpdater.check).toHaveBeenCalledTimes(1);
    });

    it('checkForUpdate sets no error when application is up to date', async () => {
      mockUpdater.check.mockResolvedValue({ available: false });

      const updater = getElectronUpdater({ electronAPI: { updater: mockUpdater } })!;
      const result = await updater.check();

      expect(result.available).toBe(false);
    });

    it('applyUpdate calls updater.apply', async () => {
      mockUpdater.apply.mockResolvedValue({ success: true });

      const updater = getElectronUpdater({ electronAPI: { updater: mockUpdater } })!;
      const result = await updater.apply();

      expect(result.success).toBe(true);
      expect(mockUpdater.apply).toHaveBeenCalledTimes(1);
    });

    it('rollbackUpdate calls updater.rollback and returns result', async () => {
      mockUpdater.rollback.mockResolvedValue({ success: true });

      const updater = getElectronUpdater({ electronAPI: { updater: mockUpdater } })!;
      const result = await updater.rollback();

      expect(result.success).toBe(true);
      expect(mockUpdater.rollback).toHaveBeenCalledTimes(1);
    });

    it('rollbackUpdate surfaces error string on failure', async () => {
      mockUpdater.rollback.mockResolvedValue({
        success: false,
        error: 'No previous version available for rollback',
      });

      const updater = getElectronUpdater({ electronAPI: { updater: mockUpdater } })!;
      const result = await updater.rollback();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No previous version available for rollback');
    });
  });

  describe('Handles missing Electron API gracefully', () => {
    it('returns null when window has no electronAPI', () => {
      expect(getElectronUpdater({})).toBeNull();
    });

    it('returns null when electronAPI exists but updater is undefined', () => {
      expect(getElectronUpdater({ electronAPI: {} })).toBeNull();
    });

    it('returns null when electronAPI is a non-object primitive', () => {
      expect(getElectronUpdater({ electronAPI: 42 })).toBeNull();
    });

    it('component-level isElectron would be false, preventing button rendering', () => {
      // Mirrors: this.isElectron = !!getElectronUpdater(window);
      const isElectron = !!getElectronUpdater({});
      expect(isElectron).toBe(false);
    });

    it('checkForUpdate is a no-op when updater is null', async () => {
      const updater = getElectronUpdater({});
      // Mirrors: if (!updater) return;
      let called = false;
      if (updater) {
        await updater.check();
        called = true;
      }
      expect(called).toBe(false);
    });
  });

  describe('Rollback state follows hasRollback result', () => {
    it('rollbackAvailable = true when hasRollback returns available', async () => {
      const mockUpdater = {
        check: jest.fn(),
        apply: jest.fn(),
        rollback: jest.fn(),
        hasRollback: jest.fn().mockResolvedValue({ available: true }),
      };

      const updater = getElectronUpdater({ electronAPI: { updater: mockUpdater } })!;
      const result = await updater.hasRollback();

      // Mirrors: this.rollbackAvailable = result.available;
      const rollbackAvailable = result.available;
      expect(rollbackAvailable).toBe(true);
    });

    it('rollbackAvailable = false when hasRollback returns unavailable', async () => {
      const mockUpdater = {
        check: jest.fn(),
        apply: jest.fn(),
        rollback: jest.fn(),
        hasRollback: jest.fn().mockResolvedValue({ available: false }),
      };

      const updater = getElectronUpdater({ electronAPI: { updater: mockUpdater } })!;
      const result = await updater.hasRollback();
      expect(result.available).toBe(false);
    });

    it('rollbackAvailable = false when hasRollback throws', async () => {
      const mockUpdater = {
        check: jest.fn(),
        apply: jest.fn(),
        rollback: jest.fn(),
        hasRollback: jest.fn().mockRejectedValue(new Error('IPC dead')),
      };

      const updater = getElectronUpdater({ electronAPI: { updater: mockUpdater } })!;
      let rollbackAvailable = false;
      try {
        const result = await updater.hasRollback();
        rollbackAvailable = result.available;
      } catch {
        rollbackAvailable = false;
      }
      expect(rollbackAvailable).toBe(false);
    });
  });
});
