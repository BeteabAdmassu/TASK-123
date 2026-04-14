import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SharedModule } from '../../shared/shared.module';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { AdminComponent } from './admin.component';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockApiService(): Partial<ApiService> {
  const empty = { data: [], total: 0, page: 1, pageSize: 25 };
  return {
    get: jasmine.createSpy('get').and.returnValue(of(empty)),
    post: jasmine.createSpy('post').and.returnValue(of({})),
    put: jasmine.createSpy('put').and.returnValue(of({})),
    delete: jasmine.createSpy('delete').and.returnValue(of({})),
  };
}

function mockAuthService(): Partial<AuthService> {
  return {
    getUser: jasmine.createSpy('getUser').and.returnValue(
      of({ id: 'u1', username: 'admin', role: 'admin', name: '', email: '' })
    ),
    getCurrentUserValue: jasmine.createSpy('getCurrentUserValue').and.returnValue(
      { id: 'u1', username: 'admin', role: 'admin', name: '', email: '' }
    ),
  };
}

function buildMockUpdater() {
  return {
    check: jasmine.createSpy('check'),
    apply: jasmine.createSpy('apply'),
    rollback: jasmine.createSpy('rollback'),
    hasRollback: jasmine.createSpy('hasRollback').and.resolveTo({ available: false }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminComponent (TestBed)', () => {
  let fixture: ComponentFixture<AdminComponent>;
  let component: AdminComponent;
  let savedElectronAPI: unknown;

  beforeEach(async () => {
    // Preserve any real electronAPI so we can restore it
    savedElectronAPI = (window as Record<string, unknown>)['electronAPI'];

    await TestBed.configureTestingModule({
      imports: [
        SharedModule,
        ReactiveFormsModule,
        RouterTestingModule,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      declarations: [AdminComponent],
      providers: [
        { provide: ApiService, useFactory: mockApiService },
        { provide: AuthService, useFactory: mockAuthService },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy('open') } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    // Restore window state
    if (savedElectronAPI !== undefined) {
      (window as Record<string, unknown>)['electronAPI'] = savedElectronAPI;
    } else {
      delete (window as Record<string, unknown>)['electronAPI'];
    }
  });

  function createComponent(): void {
    fixture = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // triggers ngOnInit
  }

  // ----- Suite 1: Uses Electron updater bridge when present -----

  describe('Uses Electron updater bridge when present', () => {
    let mockUpdater: ReturnType<typeof buildMockUpdater>;

    beforeEach(() => {
      mockUpdater = buildMockUpdater();
      (window as Record<string, unknown>)['electronAPI'] = { updater: mockUpdater };
      createComponent();
    });

    it('should detect Electron environment on init', () => {
      expect(component.isElectron).toBeTrue();
    });

    it('checkForUpdate should set updateAvailable, currentVersion, availableVersion', async () => {
      mockUpdater.check.and.resolveTo({
        available: true,
        currentVersion: '1.0.0',
        availableVersion: '1.2.0',
      });

      await component.checkForUpdate();

      expect(component.updateAvailable).toBeTrue();
      expect(component.currentVersion).toBe('1.0.0');
      expect(component.availableVersion).toBe('1.2.0');
      expect(component.updaterError).toBe('');
      expect(mockUpdater.check).toHaveBeenCalledTimes(1);
    });

    it('checkForUpdate should set success message when up to date', async () => {
      mockUpdater.check.and.resolveTo({ available: false });

      await component.checkForUpdate();

      expect(component.updateAvailable).toBeFalse();
      expect(component.updaterSuccess).toBeTruthy(); // translated key resolved
    });

    it('checkForUpdate should set updaterError on rejection', async () => {
      mockUpdater.check.and.rejectWith(new Error('IPC fail'));

      await component.checkForUpdate();

      expect(component.updaterError).toBeTruthy();
      expect(component.updaterChecking).toBeFalse();
    });
  });

  // ----- Suite 2: Graceful fallback when Electron API missing -----

  describe('Graceful fallback when Electron API missing', () => {
    beforeEach(() => {
      delete (window as Record<string, unknown>)['electronAPI'];
      createComponent();
    });

    it('should set isElectron to false', () => {
      expect(component.isElectron).toBeFalse();
    });

    it('checkForUpdate should be a no-op without throwing', async () => {
      await expectAsync(component.checkForUpdate()).toBeResolved();
      expect(component.updaterChecking).toBeFalse();
    });

    it('applyUpdate should be a no-op without throwing', async () => {
      await expectAsync(component.applyUpdate()).toBeResolved();
      expect(component.updaterApplying).toBeFalse();
    });

    it('rollbackUpdate should be a no-op without throwing', async () => {
      await expectAsync(component.rollbackUpdate()).toBeResolved();
      expect(component.updaterRollingBack).toBeFalse();
    });
  });

  // ----- Suite 3: Rollback availability state -----

  describe('Rollback availability state', () => {
    let mockUpdater: ReturnType<typeof buildMockUpdater>;

    beforeEach(() => {
      mockUpdater = buildMockUpdater();
      (window as Record<string, unknown>)['electronAPI'] = { updater: mockUpdater };
    });

    it('should set rollbackAvailable=true when hasRollback returns available', async () => {
      mockUpdater.hasRollback.and.resolveTo({ available: true });
      createComponent(); // ngOnInit calls initUpdater -> checkRollbackAvailability

      // Wait for the async hasRollback call to settle
      await fixture.whenStable();

      expect(component.rollbackAvailable).toBeTrue();
    });

    it('should set rollbackAvailable=false when hasRollback returns unavailable', async () => {
      mockUpdater.hasRollback.and.resolveTo({ available: false });
      createComponent();
      await fixture.whenStable();

      expect(component.rollbackAvailable).toBeFalse();
    });

    it('should set rollbackAvailable=false when hasRollback throws', async () => {
      mockUpdater.hasRollback.and.rejectWith(new Error('IPC dead'));
      createComponent();
      await fixture.whenStable();

      expect(component.rollbackAvailable).toBeFalse();
    });
  });
});
