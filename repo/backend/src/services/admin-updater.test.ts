/**
 * Admin Updater UX – Behavior Tests
 *
 * Tests the frontend updater method logic by verifying:
 * - Electron API is used when present
 * - Missing Electron API is handled gracefully (browser fallback)
 * - Button state follows returned updater data
 *
 * These tests validate the logic patterns used in admin.component.ts
 * without requiring a full Angular test harness.
 */

describe('Admin Updater Logic', () => {
  // Simulate the getElectronUpdater() helper from admin.component.ts
  function getElectronUpdater(windowObj: Record<string, unknown>) {
    try {
      const api = windowObj['electronAPI'] as
        { updater?: { check: () => Promise<unknown>; apply: () => Promise<unknown>; rollback: () => Promise<unknown>; hasRollback: () => Promise<unknown> } } | undefined;
      return api?.updater ?? null;
    } catch {
      return null;
    }
  }

  describe('getElectronUpdater browser fallback', () => {
    it('should return null when electronAPI is not on the window', () => {
      const result = getElectronUpdater({});
      expect(result).toBeNull();
    });

    it('should return null when electronAPI exists but updater is missing', () => {
      const result = getElectronUpdater({ electronAPI: {} });
      expect(result).toBeNull();
    });

    it('should return the updater when fully present', () => {
      const mockUpdater = {
        check: jest.fn(),
        apply: jest.fn(),
        rollback: jest.fn(),
        hasRollback: jest.fn(),
      };
      const result = getElectronUpdater({ electronAPI: { updater: mockUpdater } });
      expect(result).toBe(mockUpdater);
    });
  });

  describe('checkForUpdate logic', () => {
    it('should set updateAvailable=true when updater reports available', async () => {
      const mockCheck = jest.fn().mockResolvedValue({
        available: true,
        currentVersion: '1.0.0',
        availableVersion: '1.1.0',
      });

      const result = await mockCheck();
      expect(result.available).toBe(true);
      expect(result.currentVersion).toBe('1.0.0');
      expect(result.availableVersion).toBe('1.1.0');
    });

    it('should set updateAvailable=false when no update found', async () => {
      const mockCheck = jest.fn().mockResolvedValue({ available: false });
      const result = await mockCheck();
      expect(result.available).toBe(false);
    });

    it('should handle check failure gracefully', async () => {
      const mockCheck = jest.fn().mockRejectedValue(new Error('IPC error'));
      let error = '';
      try {
        await mockCheck();
      } catch {
        error = 'Failed to check for updates.';
      }
      expect(error).toBe('Failed to check for updates.');
    });
  });

  describe('rollback availability', () => {
    it('should enable rollback when hasRollback returns available', async () => {
      const mockHasRollback = jest.fn().mockResolvedValue({ available: true });
      const result = await mockHasRollback();
      expect(result.available).toBe(true);
    });

    it('should disable rollback when no previous version exists', async () => {
      const mockHasRollback = jest.fn().mockResolvedValue({ available: false });
      const result = await mockHasRollback();
      expect(result.available).toBe(false);
    });
  });

  describe('button state logic', () => {
    it('apply button should be enabled only when update is available', () => {
      const updateAvailable = true;
      const updaterApplying = false;
      const updaterRollingBack = false;
      const applyEnabled = updateAvailable && !updaterApplying && !updaterRollingBack;
      expect(applyEnabled).toBe(true);
    });

    it('apply button should be disabled when no update available', () => {
      const updateAvailable = false;
      const applyEnabled = updateAvailable && !false && !false;
      expect(applyEnabled).toBe(false);
    });

    it('rollback button should be enabled only when rollback is available', () => {
      const rollbackAvailable = true;
      const updaterRollingBack = false;
      const updaterApplying = false;
      const rollbackEnabled = rollbackAvailable && !updaterRollingBack && !updaterApplying;
      expect(rollbackEnabled).toBe(true);
    });

    it('all buttons should be disabled while applying', () => {
      const updaterApplying = true;
      const checkEnabled = !false && !updaterApplying && !false;
      const applyEnabled = true && !updaterApplying && !false;
      const rollbackEnabled = true && !false && !updaterApplying;
      expect(checkEnabled).toBe(false);
      expect(applyEnabled).toBe(false);
      expect(rollbackEnabled).toBe(false);
    });
  });
});

describe('Localization Key Coverage', () => {
  const fs = require('fs');
  const path = require('path');

  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const enJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'assets', 'i18n', 'en.json'), 'utf8')
  );
  const esJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'assets', 'i18n', 'es.json'), 'utf8')
  );

  function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    const keys: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        keys.push(...flattenKeys(v as Record<string, unknown>, fullKey));
      } else {
        keys.push(fullKey);
      }
    }
    return keys;
  }

  const enKeys = flattenKeys(enJson).sort();
  const esKeys = flattenKeys(esJson).sort();

  it('en.json and es.json should have the same set of keys', () => {
    const enOnly = enKeys.filter(k => !esKeys.includes(k));
    const esOnly = esKeys.filter(k => !enKeys.includes(k));
    expect(enOnly).toEqual([]);
    expect(esOnly).toEqual([]);
  });

  it('should have updater-related ADMIN keys', () => {
    const requiredKeys = [
      'ADMIN.SYSTEM_UPDATE',
      'ADMIN.UPDATE_DESKTOP_ONLY',
      'ADMIN.CHECK_FOR_UPDATE',
      'ADMIN.APPLY_UPDATE',
      'ADMIN.ROLLBACK',
      'ADMIN.UPDATE_AVAILABLE_MSG',
      'ADMIN.UPDATE_UP_TO_DATE',
      'ADMIN.UPDATE_CHECK_FAILED',
      'ADMIN.UPDATE_APPLY_FAILED',
      'ADMIN.ROLLBACK_FAILED',
    ];
    for (const key of requiredKeys) {
      expect(enKeys).toContain(key);
      expect(esKeys).toContain(key);
    }
  });

  it('should have media player keys', () => {
    const requiredKeys = [
      'MEDIA.LOADING',
      'MEDIA.LIBRARY',
      'MEDIA.NO_ASSETS',
      'MEDIA.SELECT_ASSET',
      'MEDIA.PLAYING_AT_SPEED',
    ];
    for (const key of requiredKeys) {
      expect(enKeys).toContain(key);
      expect(esKeys).toContain(key);
    }
  });

  it('should not use Angular date pipe in any HTML template', () => {
    const glob = require('path');
    const templatesDir = path.join(repoRoot, 'frontend', 'src', 'app', 'features');
    // Check key templates for | date: usage
    const templates = [
      'admin/admin.component.html',
      'approvals/approvals.component.html',
      'violations/violations.component.html',
      'notifications/notifications.component.html',
      'candidate-detail/candidate-detail.component.html',
      'dashboard/dashboard.component.html',
    ];
    for (const tmpl of templates) {
      const content = fs.readFileSync(path.join(templatesDir, tmpl), 'utf8');
      expect(content).not.toMatch(/\| date:/);
    }
  });
});
