import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, forkJoin, of } from 'rxjs';
import { takeUntil, catchError } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';

interface DashboardStats {
  pendingApprovals: number;
  activeProjects: number;
  violationsToReview: number;
  pendingNotifications: number;
}

interface RecentActivity {
  id: string;
  entity_type: string;
  action: string;
  actor_id: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {
  stats: DashboardStats = {
    pendingApprovals: 0,
    activeProjects: 0,
    violationsToReview: 0,
    pendingNotifications: 0
  };

  recentActivity: RecentActivity[] = [];
  isLoading = true;
  errorMessage = '';
  userRole = '';

  private destroy$ = new Subject<void>();

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.auth.getUser().pipe(takeUntil(this.destroy$)).subscribe(user => {
      this.userRole = user?.role || '';
    });
    this.loadDashboard();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDashboard(): void {
    this.isLoading = true;
    this.errorMessage = '';

    forkJoin({
      approvals: this.api.get<{ total: number }>('/approvals', { page: 1, pageSize: 1, status: 'pending' }).pipe(
        catchError(() => of({ total: 0 }))
      ),
      projects: this.api.get<{ total: number }>('/projects', { page: 1, pageSize: 1, status: 'active' }).pipe(
        catchError(() => of({ total: 0 }))
      ),
      violations: this.api.get<{ total: number }>('/violations', { page: 1, pageSize: 1, status: 'pending' }).pipe(
        catchError(() => of({ total: 0 }))
      ),
      notifications: this.api.get<{ total: number }>('/notifications', { page: 1, pageSize: 1 }).pipe(
        catchError(() => of({ total: 0 }))
      ),
      activity: this.api.get<{ data: RecentActivity[] }>('/audit', { page: 1, pageSize: 10 }).pipe(
        catchError(() => of({ data: [] }))
      )
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (results) => {
        this.stats = {
          pendingApprovals: results.approvals.total || 0,
          activeProjects: results.projects.total || 0,
          violationsToReview: results.violations.total || 0,
          pendingNotifications: results.notifications.total || 0
        };
        this.recentActivity = results.activity.data || [];
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = 'Failed to load dashboard data. Please try again.';
        this.isLoading = false;
      }
    });
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  getActivityIcon(entityType: string): string {
    const icons: Record<string, string> = {
      candidate: 'person',
      project: 'work',
      posting: 'description',
      approval: 'thumb_up',
      violation: 'gavel',
      notification: 'notifications',
      service: 'category'
    };
    return icons[entityType] || 'info';
  }

  getActivityLabel(activity: RecentActivity): string {
    return `${activity.action} on ${activity.entity_type}`;
  }
}
