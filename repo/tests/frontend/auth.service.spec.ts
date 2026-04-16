/**
 * AuthService – Unit Tests
 * Covers token storage/retrieval, login/logout HTTP interactions,
 * session clearing, and the token-expiry guard.
 */

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { AuthService, User } from '../../frontend/src/app/core/auth/auth.service';

const TOKEN_KEY  = 'talentops_token';
const USER_KEY   = 'talentops_user';

/** Build a non-expired JWT-shaped string (real HS256 sig not required for unit tests). */
function fakeJwt(expOffsetSeconds = 3600): string {
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const payload = btoa(JSON.stringify({
    id: 'u1', username: 'admin', role: 'admin',
    exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
  })).replace(/=/g, '');
  return `${header}.${payload}.fakesignature`;
}

function fakeExpiredJwt(): string {
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const payload = btoa(JSON.stringify({
    id: 'u1', username: 'admin', role: 'admin',
    exp: Math.floor(Date.now() / 1000) - 100, // 100 s ago
  })).replace(/=/g, '');
  return `${header}.${payload}.fakesignature`;
}

const MOCK_USER: User = { id: 'u1', username: 'admin', name: 'Admin', email: 'admin@test.com', role: 'admin' };

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, RouterTestingModule],
      providers: [AuthService],
    });
    service  = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  // ── Creation ─────────────────────────────────────────────────────────────
  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ── isLoggedIn ────────────────────────────────────────────────────────────
  it('isLoggedIn() returns false when localStorage has no token', () => {
    expect(service.isLoggedIn()).toBeFalse();
  });

  it('isLoggedIn() returns true when a valid non-expired token is present', () => {
    localStorage.setItem(TOKEN_KEY, fakeJwt());
    expect(service.isLoggedIn()).toBeTrue();
  });

  it('isLoggedIn() returns false for an expired token', () => {
    localStorage.setItem(TOKEN_KEY, fakeExpiredJwt());
    expect(service.isLoggedIn()).toBeFalse();
  });

  it('isLoggedIn() returns false for a malformed token', () => {
    localStorage.setItem(TOKEN_KEY, 'not.a.real.jwt.at.all');
    expect(service.isLoggedIn()).toBeFalse();
  });

  // ── getToken ──────────────────────────────────────────────────────────────
  it('getToken() returns null when no token stored', () => {
    expect(service.getToken()).toBeNull();
  });

  it('getToken() returns the stored token string', () => {
    const token = fakeJwt();
    localStorage.setItem(TOKEN_KEY, token);
    expect(service.getToken()).toBe(token);
  });

  // ── login ─────────────────────────────────────────────────────────────────
  it('login() sends POST to /api/auth/login with credentials', () => {
    service.login('admin', 'admin').subscribe();

    const req = httpMock.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'admin', password: 'admin' });

    req.flush({ token: fakeJwt(), user: MOCK_USER });
  });

  it('login() stores token in localStorage on success', () => {
    const token = fakeJwt();
    service.login('admin', 'admin').subscribe();

    const req = httpMock.expectOne('/api/auth/login');
    req.flush({ token, user: MOCK_USER });

    expect(localStorage.getItem(TOKEN_KEY)).toBe(token);
  });

  it('login() stores user in localStorage on success', () => {
    service.login('admin', 'admin').subscribe();

    const req = httpMock.expectOne('/api/auth/login');
    req.flush({ token: fakeJwt(), user: MOCK_USER });

    const stored = JSON.parse(localStorage.getItem(USER_KEY)!);
    expect(stored.username).toBe('admin');
    expect(stored.role).toBe('admin');
  });

  it('login() updates the currentUser$ observable', (done) => {
    service.login('admin', 'admin').subscribe(() => {
      service.getUser().subscribe(user => {
        expect(user?.username).toBe('admin');
        done();
      });
    });

    const req = httpMock.expectOne('/api/auth/login');
    req.flush({ token: fakeJwt(), user: MOCK_USER });
  });

  // ── logout ────────────────────────────────────────────────────────────────
  it('logout() sends POST to /api/auth/logout', () => {
    service.logout().subscribe();
    const req = httpMock.expectOne('/api/auth/logout');
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('logout() removes token from localStorage', () => {
    localStorage.setItem(TOKEN_KEY, fakeJwt());
    service.logout().subscribe();
    const req = httpMock.expectOne('/api/auth/logout');
    req.flush({});
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('logout() clears currentUser$ to null', (done) => {
    localStorage.setItem(TOKEN_KEY, fakeJwt());
    service.logout().subscribe(() => {
      service.getUser().subscribe(user => {
        expect(user).toBeNull();
        done();
      });
    });
    const req = httpMock.expectOne('/api/auth/logout');
    req.flush({});
  });

  // ── getCurrentUserValue ───────────────────────────────────────────────────
  it('getCurrentUserValue() returns null initially', () => {
    expect(service.getCurrentUserValue()).toBeNull();
  });

  it('getCurrentUserValue() returns user after login', () => {
    service.login('admin', 'admin').subscribe();
    const req = httpMock.expectOne('/api/auth/login');
    req.flush({ token: fakeJwt(), user: MOCK_USER });
    expect(service.getCurrentUserValue()?.username).toBe('admin');
  });
});
