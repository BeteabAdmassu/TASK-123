import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, map, of } from 'rxjs';

export interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
}

interface LoginResponse {
  token: string;
  user: User;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly TOKEN_KEY = 'talentops_token';
  private readonly API_URL = '/api/auth';

  private currentUserSubject = new BehaviorSubject<User | null>(this.loadStoredUser());
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient) {}

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.API_URL}/login`, { username, password }).pipe(
      tap(response => {
        localStorage.setItem(this.TOKEN_KEY, response.token);
        localStorage.setItem('talentops_user', JSON.stringify(response.user));
        this.currentUserSubject.next(response.user);
        // Propagate token to Electron main process for tray/checkpoint auth
        this.syncTokenToElectron(response.token);
      })
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.API_URL}/logout`, {}).pipe(
      tap(() => {
        this.clearSession();
      })
    );
  }

  getMe(): Observable<User> {
    return this.http.get<User>(`${this.API_URL}/me`).pipe(
      tap(user => {
        localStorage.setItem('talentops_user', JSON.stringify(user));
        this.currentUserSubject.next(user);
      })
    );
  }

  verifyPassword(password: string): Observable<{ valid: boolean }> {
    return this.http.post<{ valid: boolean }>(`${this.API_URL}/verify-password`, { password });
  }

  isLoggedIn(): boolean {
    const token = this.getToken();
    if (!token) {
      return false;
    }
    return !this.isTokenExpired(token);
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  getUser(): Observable<User | null> {
    return this.currentUser$;
  }

  getCurrentUserValue(): User | null {
    return this.currentUserSubject.value;
  }

  private clearSession(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem('talentops_user');
    this.currentUserSubject.next(null);
    // Clear token from Electron main process
    this.syncTokenToElectron(null);
  }

  /** Send JWT to Electron main process (no-op in browser-only mode). */
  private syncTokenToElectron(token: string | null): void {
    try {
      const electronAPI = (window as Record<string, unknown>)['electronAPI'] as
        { auth?: { setToken: (t: string | null) => void } } | undefined;
      if (electronAPI?.auth?.setToken) {
        electronAPI.auth.setToken(token);
      }
    } catch {
      // Not running in Electron — ignore
    }
  }

  private loadStoredUser(): User | null {
    try {
      const stored = localStorage.getItem('talentops_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  private isTokenExpired(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiry = payload.exp;
      if (!expiry) {
        return false;
      }
      return Math.floor(Date.now() / 1000) >= expiry;
    } catch {
      return true;
    }
  }
}
