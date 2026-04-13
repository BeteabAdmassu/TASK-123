import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subject, Subscription, interval, EMPTY } from 'rxjs';
import { takeUntil, catchError } from 'rxjs/operators';

import { AuthService } from '../auth/auth.service';

interface CheckpointData {
  route: string;
  timestamp: string;
  formState: Record<string, unknown> | null;
}

interface CheckpointResponse {
  id: number;
  user_id: number;
  checkpoint_data: CheckpointData;
  created_at: string;
}

@Injectable()
export class CheckpointService implements OnDestroy {
  private readonly API_URL = '/api/checkpoint';
  private readonly INTERVAL_MS = 30000;

  private autoSaveSubscription: Subscription | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnDestroy(): void {
    this.stopAutoSave();
    this.destroy$.next();
    this.destroy$.complete();
  }

  startAutoSave(): void {
    this.stopAutoSave();

    if (!this.authService.isLoggedIn()) {
      return;
    }

    this.autoSaveSubscription = interval(this.INTERVAL_MS)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.saveCheckpoint();
      });
  }

  stopAutoSave(): void {
    if (this.autoSaveSubscription) {
      this.autoSaveSubscription.unsubscribe();
      this.autoSaveSubscription = null;
    }
  }

  tryRestore(): void {
    if (!this.authService.isLoggedIn()) {
      return;
    }

    this.http.get<CheckpointResponse>(`${this.API_URL}/latest`)
      .pipe(
        takeUntil(this.destroy$),
        catchError(() => EMPTY)
      )
      .subscribe(checkpoint => {
        if (checkpoint && checkpoint.checkpoint_data && checkpoint.checkpoint_data.route) {
          const savedRoute = checkpoint.checkpoint_data.route;
          const currentRoute = this.router.url;

          if (savedRoute !== currentRoute && savedRoute !== '/login') {
            const shouldRestore = confirm(
              `You have a saved session from ${new Date(checkpoint.checkpoint_data.timestamp).toLocaleString()}. ` +
              `Would you like to restore it and navigate to ${savedRoute}?`
            );

            if (shouldRestore) {
              this.router.navigateByUrl(savedRoute);
            }
          }
        }
      });
  }

  private saveCheckpoint(): void {
    if (!this.authService.isLoggedIn()) {
      this.stopAutoSave();
      return;
    }

    const currentRoute = this.router.url;

    if (currentRoute === '/login') {
      return;
    }

    const checkpointData: CheckpointData = {
      route: currentRoute,
      timestamp: new Date().toISOString(),
      formState: this.collectFormState()
    };

    this.http.post(`${this.API_URL}`, { checkpoint_data: checkpointData })
      .pipe(
        catchError(() => EMPTY)
      )
      .subscribe();
  }

  private collectFormState(): Record<string, unknown> | null {
    const activeElement = document.activeElement;
    if (!activeElement) {
      return null;
    }

    const formElements = document.querySelectorAll('input, textarea, select');
    if (formElements.length === 0) {
      return null;
    }

    const formState: Record<string, unknown> = {};
    let hasValues = false;

    formElements.forEach((element, index) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const key = input.name || input.id || `field_${index}`;
      const type = input.getAttribute('type') || 'text';

      if (type === 'password' || type === 'hidden') {
        return;
      }

      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        formState[key] = input.checked;
        hasValues = true;
      } else if (input.value && input.value.trim() !== '') {
        formState[key] = input.value;
        hasValues = true;
      }
    });

    return hasValues ? formState : null;
  }
}
