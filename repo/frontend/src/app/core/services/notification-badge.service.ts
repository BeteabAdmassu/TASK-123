import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, interval, Subscription } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class NotificationBadgeService implements OnDestroy {
  pendingCount$ = new BehaviorSubject<number>(0);
  private pollSub: Subscription | null = null;

  constructor(private api: ApiService, private auth: AuthService) {
    this.startPolling();
  }

  startPolling(): void {
    this.stopPolling();
    this.pollSub = interval(30000).pipe(
      switchMap(() => {
        if (!this.auth.isLoggedIn()) {
          return of({ total: 0 });
        }
        return this.api.get<{ total: number }>('/notifications', { page: 1, pageSize: 1 }).pipe(
          catchError(() => of({ total: 0 }))
        );
      })
    ).subscribe(res => {
      this.pendingCount$.next(res.total || 0);
    });
  }

  stopPolling(): void {
    if (this.pollSub) {
      this.pollSub.unsubscribe();
      this.pollSub = null;
    }
  }

  refresh(): void {
    if (!this.auth.isLoggedIn()) return;
    this.api.get<{ total: number }>('/notifications', { page: 1, pageSize: 1 }).pipe(
      catchError(() => of({ total: 0 }))
    ).subscribe(res => {
      this.pendingCount$.next(res.total || 0);
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }
}
