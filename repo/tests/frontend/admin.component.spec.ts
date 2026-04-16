/**
 * AdminComponent – Unit Tests
 *
 * Tests focus on the Electron updater bridge integration:
 *   • update availability checks (checkForUpdate)
 *   • graceful fallback when electronAPI is absent (web mode)
 *   • rollback availability detection (checkRollbackAvailability)
 *   • error state flags on bridge failures
 */
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { FormBuilder } from '@angular/forms';
import { of, Subject } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { SharedModule } from '../../frontend/src/app/shared/shared.module';
import { ApiService } from '../../frontend/src/app/core/services/api.service';
import { AuthService } from '../../frontend/src/app/core/auth/auth.service';
import { AdminComponent } from '../../frontend/src/app/features/admin/admin.component';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeElectronUpdater(overrides: Partial<{
  checkResult: object;
  applyResult: object;
  rollbackResult: object;
  hasRollbackResult: object;
  checkRejects: boolean;
  applyRejects: boolean;
  rollbackRejects: boolean;
}> = {}) {
  return {
    check: jasmine.createSpy('check').and.callFake(() =>
      overrides.checkRejects
        ? Promise.reject(new Error('check failed'))
        : Promise.resolve(overrides.checkResult ?? { available: false, currentVersion: '1.0.0' })
    ),
    apply: jasmine.createSpy('apply').and.callFake(() =>
      overrides.applyRejects
        ? Promise.reject(new Error('apply failed'))
        : Promise.resolve(overrides.applyResult ?? { success: true })
    ),
    rollback: jasmine.createSpy('rollback').and.callFake(() =>
      overrides.rollbackRejects
        ? Promise.reject(new Error('rollback failed'))
        : Promise.resolve(overrides.rollbackResult ?? { success: true })
    ),
    hasRollback: jasmine.createSpy('hasRollback').and.returnValue(
      Promise.resolve(overrides.hasRollbackResult ?? { available: false })
    ),
  };
}

function setElectronAPI(updater: object | null) {
  if (updater === null) {
    delete (window as unknown as Record<string, unknown>)['electronAPI'];
  } else {
    (window as unknown as Record<string, unknown>)['electronAPI'] = { updater };
  }
}

// ── test setup ────────────────────────────────────────────────────────────────

let savedElectronAPI: unknown;

const fakeUser = { id: 'u1', username: 'admin', role: 'admin', name: 'Admin', email: 'admin@test.com' };
const emptyPage = { data: [], total: 0, page: 1, pageSize: 25 };

describe('AdminComponent', () => {
  let component: AdminComponent;
  let fixture: ComponentFixture<AdminComponent>;
  let apiService: jasmine.SpyObj<ApiService>;
  let authService: jasmine.SpyObj<AuthService>;

  beforeAll(() => {
    savedElectronAPI = (window as unknown as Record<string, unknown>)['electronAPI'];
  });

  afterAll(() => {
    if (savedElectronAPI === undefined) {
      delete (window as unknown as Record<string, unknown>)['electronAPI'];
    } else {
      (window as unknown as Record<string, unknown>)['electronAPI'] = savedElectronAPI;
    }
  });

  beforeEach(async () => {
    apiService  = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'put', 'delete']);
    authService = jasmine.createSpyObj<AuthService>('AuthService', [
      'getUser', 'getCurrentUserValue', 'isLoggedIn', 'login', 'logout', 'getToken',
    ]);

    apiService.get.and.returnValue(of(emptyPage as any));
    apiService.post.and.returnValue(of({} as any));
    apiService.put.and.returnValue(of({} as any));
    apiService.delete.and.returnValue(of({} as any));
    authService.getUser.and.returnValue(of(fakeUser as any));
    authService.getCurrentUserValue.and.returnValue(fakeUser as any);

    await TestBed.configureTestingModule({
      imports: [
        SharedModule,
        NoopAnimationsModule,
        RouterTestingModule,
        HttpClientTestingModule,
        TranslateModule.forRoot(),
      ],
      declarations: [AdminComponent],
      providers: [
        { provide: ApiService,  useValue: apiService  },
        { provide: AuthService, useValue: authService },
        FormBuilder,
      ],
    }).compileComponents();

    fixture   = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    setElectronAPI(null);
  });

  // ── basic rendering ─────────────────────────────────────────────────────────

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should initialise updaterChecking as false', () => {
    expect(component.updaterChecking).toBe(false);
  });

  it('should initialise updateAvailable as false', () => {
    expect(component.updateAvailable).toBe(false);
  });

  it('should initialise rollbackAvailable as false', () => {
    expect(component.rollbackAvailable).toBe(false);
  });

  it('should not throw on detectChanges when no electronAPI present', () => {
    setElectronAPI(null);
    expect(() => fixture.detectChanges()).not.toThrow();
  });

  // ── Electron absent (web mode) ───────────────────────────────────────────

  describe('when electronAPI is absent (web mode)', () => {
    beforeEach(() => setElectronAPI(null));

    it('isElectron should be false after init', () => {
      fixture.detectChanges();
      expect(component.isElectron).toBe(false);
    });

    it('checkForUpdate() returns early without throwing', fakeAsync(() => {
      fixture.detectChanges();
      expect(async () => {
        await component.checkForUpdate();
        tick();
      }).not.toThrow();
    }));

    it('updaterChecking remains false after checkForUpdate() with no bridge', fakeAsync(() => {
      fixture.detectChanges();
      component.checkForUpdate();
      tick();
      expect(component.updaterChecking).toBe(false);
    }));
  });

  // ── update not available ─────────────────────────────────────────────────

  describe('when electronAPI is present and no update is available', () => {
    let mockUpdater: ReturnType<typeof makeElectronUpdater>;

    beforeEach(() => {
      mockUpdater = makeElectronUpdater({ checkResult: { available: false, currentVersion: '1.0.0' } });
      setElectronAPI(mockUpdater);
    });

    it('isElectron should be true after init', () => {
      fixture.detectChanges();
      expect(component.isElectron).toBe(true);
    });

    it('checkForUpdate() calls updater.check()', fakeAsync(() => {
      fixture.detectChanges();
      component.checkForUpdate();
      tick();
      expect(mockUpdater.check).toHaveBeenCalled();
    }));

    it('updaterChecking is false after checkForUpdate() completes', fakeAsync(() => {
      fixture.detectChanges();
      component.checkForUpdate();
      tick();
      expect(component.updaterChecking).toBe(false);
    }));

    it('updateAvailable is false when check returns available:false', fakeAsync(() => {
      fixture.detectChanges();
      component.checkForUpdate();
      tick();
      expect(component.updateAvailable).toBe(false);
    }));

    it('updaterError is empty after successful check with no update', fakeAsync(() => {
      fixture.detectChanges();
      component.checkForUpdate();
      tick();
      expect(component.updaterError).toBe('');
    }));
  });

  // ── update available ─────────────────────────────────────────────────────

  describe('when electronAPI is present and an update is available', () => {
    let mockUpdater: ReturnType<typeof makeElectronUpdater>;

    beforeEach(() => {
      mockUpdater = makeElectronUpdater({
        checkResult: { available: true, currentVersion: '1.0.0', availableVersion: '2.0.0' },
      });
      setElectronAPI(mockUpdater);
    });

    it('updateAvailable becomes true after checkForUpdate()', fakeAsync(() => {
      fixture.detectChanges();
      component.checkForUpdate();
      tick();
      expect(component.updateAvailable).toBe(true);
    }));

    it('availableVersion is populated after checkForUpdate()', fakeAsync(() => {
      fixture.detectChanges();
      component.checkForUpdate();
      tick();
      expect(component.availableVersion).toBe('2.0.0');
    }));

    it('applyUpdate() calls updater.apply()', fakeAsync(() => {
      fixture.detectChanges();
      component.checkForUpdate();
      tick();
      component.applyUpdate();
      tick();
      expect(mockUpdater.apply).toHaveBeenCalled();
    }));

    it('updaterApplying is true immediately after applyUpdate() is called', fakeAsync(() => {
      fixture.detectChanges();
      // Slow apply — does not resolve immediately
      const applySubject = new Subject<{ success: boolean }>();
      mockUpdater.apply.and.returnValue(applySubject.toPromise());
      component.applyUpdate();
      expect(component.updaterApplying).toBe(true);
      applySubject.complete();
      tick();
    }));
  });

  // ── rollback ─────────────────────────────────────────────────────────────

  describe('rollback availability', () => {
    it('rollbackAvailable is false when bridge reports no rollback', fakeAsync(() => {
      const mockUpdater = makeElectronUpdater({ hasRollbackResult: { available: false } });
      setElectronAPI(mockUpdater);
      fixture.detectChanges();
      component.checkRollbackAvailability();
      tick();
      expect(component.rollbackAvailable).toBe(false);
    }));

    it('rollbackAvailable is true when bridge reports a rollback exists', fakeAsync(() => {
      const mockUpdater = makeElectronUpdater({ hasRollbackResult: { available: true } });
      setElectronAPI(mockUpdater);
      fixture.detectChanges();
      component.checkRollbackAvailability();
      tick();
      expect(component.rollbackAvailable).toBe(true);
    }));

    it('rollbackUpdate() calls updater.rollback()', fakeAsync(() => {
      const mockUpdater = makeElectronUpdater({
        hasRollbackResult: { available: true },
        rollbackResult: { success: true },
      });
      setElectronAPI(mockUpdater);
      fixture.detectChanges();
      component.checkRollbackAvailability();
      tick();
      component.rollbackUpdate();
      tick();
      expect(mockUpdater.rollback).toHaveBeenCalled();
    }));
  });

  // ── error handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it('updaterError is set and updaterChecking is false when check() rejects', fakeAsync(() => {
      const mockUpdater = makeElectronUpdater({ checkRejects: true });
      setElectronAPI(mockUpdater);
      fixture.detectChanges();
      component.checkForUpdate();
      tick();
      expect(component.updaterError).not.toBe('');
      expect(component.updaterChecking).toBe(false);
    }));

    it('updaterError is set and updaterApplying is false when apply() rejects', fakeAsync(() => {
      const mockUpdater = makeElectronUpdater({
        checkResult: { available: true, currentVersion: '1.0.0', availableVersion: '2.0.0' },
        applyRejects: true,
      });
      setElectronAPI(mockUpdater);
      fixture.detectChanges();
      component.checkForUpdate();
      tick();
      component.applyUpdate();
      tick();
      expect(component.updaterError).not.toBe('');
      expect(component.updaterApplying).toBe(false);
    }));

    it('rollbackAvailable stays false when hasRollback() rejects', fakeAsync(() => {
      const mockUpdater = makeElectronUpdater();
      mockUpdater.hasRollback.and.returnValue(Promise.reject(new Error('hasRollback failed')));
      setElectronAPI(mockUpdater);
      fixture.detectChanges();
      component.checkRollbackAvailability();
      tick();
      expect(component.rollbackAvailable).toBe(false);
    }));
  });
});
