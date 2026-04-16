/**
 * LoginComponent – Unit Tests
 * Covers form validation, auth flow, loading state, error display,
 * and the already-logged-in redirect guard.
 */

import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

@Component({ template: '' })
class StubComponent {}

import { SharedModule } from '../../frontend/src/app/shared/shared.module';
import { AuthService } from '../../frontend/src/app/core/auth/auth.service';
import { LoginComponent } from '../../frontend/src/app/core/auth/login.component';

function mockAuthService() {
  return {
    login: jasmine.createSpy('login'),
    isLoggedIn: jasmine.createSpy('isLoggedIn').and.returnValue(false),
    logout: jasmine.createSpy('logout').and.returnValue(of(void 0)),
    getToken: jasmine.createSpy('getToken').and.returnValue(null),
  };
}

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let authService: ReturnType<typeof mockAuthService>;
  let router: Router;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;

  beforeEach(async () => {
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    await TestBed.configureTestingModule({
      imports: [SharedModule, ReactiveFormsModule, RouterTestingModule.withRoutes([{ path: '**', component: StubComponent }]), NoopAnimationsModule, TranslateModule.forRoot()],
      declarations: [LoginComponent, StubComponent],
      providers: [
        { provide: AuthService, useFactory: mockAuthService },
        { provide: MatSnackBar, useValue: snackBarSpy },
      ],
    }).compileComponents();

    fixture   = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    authService = TestBed.inject(AuthService) as unknown as ReturnType<typeof mockAuthService>;
    router    = TestBed.inject(Router);
    fixture.detectChanges();
  });

  // ── Creation ────────────────────────────────────────────────────────────
  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with an invalid (empty) form', () => {
    expect(component.loginForm.invalid).toBeTrue();
  });

  it('should initialize isLoading as false', () => {
    expect(component.isLoading).toBeFalse();
  });

  it('should initialize errorMessage as empty string', () => {
    expect(component.errorMessage).toBe('');
  });

  // ── Form validation ──────────────────────────────────────────────────────
  it('should mark username control invalid when empty', () => {
    const ctrl = component.loginForm.get('username')!;
    expect(ctrl.hasError('required')).toBeTrue();
  });

  it('should mark password control invalid when empty', () => {
    const ctrl = component.loginForm.get('password')!;
    expect(ctrl.hasError('required')).toBeTrue();
  });

  it('should mark form valid when both fields are filled', () => {
    component.loginForm.setValue({ username: 'admin', password: 'admin' });
    expect(component.loginForm.valid).toBeTrue();
  });

  // ── onSubmit – blocked when invalid ─────────────────────────────────────
  it('should not call authService.login when form is invalid', () => {
    component.onSubmit();
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('should not set isLoading when form is invalid', () => {
    component.onSubmit();
    expect(component.isLoading).toBeFalse();
  });

  // ── onSubmit – happy path ────────────────────────────────────────────────
  it('should call authService.login with form values on valid submit', fakeAsync(() => {
    authService.login.and.returnValue(of({ token: 'jwt', user: { id: '1', username: 'admin', role: 'admin', name: '', email: '' } }));
    component.loginForm.setValue({ username: 'admin', password: 'admin' });
    component.onSubmit();
    tick();
    expect(authService.login).toHaveBeenCalledWith('admin', 'admin');
  }));

  it('should set isLoading to true during async login call', () => {
    // Return an observable that does not emit immediately to capture mid-flight state
    authService.login.and.returnValue(new Subject());
    component.loginForm.setValue({ username: 'admin', password: 'admin' });
    component.onSubmit();
    expect(component.isLoading).toBeTrue();
  });

  it('should set isLoading to false after successful login', fakeAsync(() => {
    authService.login.and.returnValue(of({ token: 'jwt', user: { id: '1', username: 'admin', role: 'admin', name: '', email: '' } }));
    component.loginForm.setValue({ username: 'admin', password: 'admin' });
    component.onSubmit();
    tick();
    expect(component.isLoading).toBeFalse();
  }));

  it('should navigate to /dashboard after successful login', fakeAsync(() => {
    const spy = spyOn(router, 'navigate');
    authService.login.and.returnValue(of({ token: 'jwt', user: { id: '1', username: 'admin', role: 'admin', name: '', email: '' } }));
    component.loginForm.setValue({ username: 'admin', password: 'admin' });
    component.onSubmit();
    tick();
    expect(spy).toHaveBeenCalledWith(['/dashboard']);
  }));

  it('should show snack bar on successful login', fakeAsync(() => {
    authService.login.and.returnValue(of({ token: 'jwt', user: { id: '1', username: 'admin', role: 'admin', name: '', email: '' } }));
    component.loginForm.setValue({ username: 'admin', password: 'admin' });
    component.onSubmit();
    tick();
    expect(snackBarSpy.open).toHaveBeenCalled();
  }));

  // ── onSubmit – error path ────────────────────────────────────────────────
  it('should set errorMessage on API error with message', fakeAsync(() => {
    authService.login.and.returnValue(throwError(() => ({ error: { message: 'Invalid credentials' } })));
    component.loginForm.setValue({ username: 'admin', password: 'wrong' });
    component.onSubmit();
    tick();
    expect(component.errorMessage).toBe('Invalid credentials');
  }));

  it('should fall back to generic error message when API provides no message', fakeAsync(() => {
    authService.login.and.returnValue(throwError(() => ({})));
    component.loginForm.setValue({ username: 'admin', password: 'wrong' });
    component.onSubmit();
    tick();
    expect(component.errorMessage).toBeTruthy();
  }));

  it('should set isLoading to false after login error', fakeAsync(() => {
    authService.login.and.returnValue(throwError(() => ({ error: { message: 'Bad creds' } })));
    component.loginForm.setValue({ username: 'x', password: 'y' });
    component.onSubmit();
    tick();
    expect(component.isLoading).toBeFalse();
  }));

  // ── Already-logged-in guard ──────────────────────────────────────────────
  it('should redirect to /dashboard when user is already logged in', () => {
    const spy = spyOn(router, 'navigate');
    authService.isLoggedIn.and.returnValue(true);
    component.ngOnInit();
    expect(spy).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should NOT redirect when user is NOT logged in', () => {
    const spy = spyOn(router, 'navigate');
    authService.isLoggedIn.and.returnValue(false);
    component.ngOnInit();
    expect(spy).not.toHaveBeenCalled();
  });
});
