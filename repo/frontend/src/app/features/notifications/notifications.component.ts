import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService, PaginatedResponse } from '../../core/services/api.service';
import { NotificationBadgeService } from '../../core/services/notification-badge.service';

interface NotificationTask {
  id: string;
  recipient_id: string;
  type: string;
  template_key: string;
  template_vars: Record<string, unknown>;
  rendered_content: string | null;
  status: string;
  retry_count: number;
  max_retries: number;
  export_path: string | null;
  created_at: string;
  updated_at: string;
}

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss']
})
export class NotificationsComponent implements OnInit, OnDestroy {
  notifications: NotificationTask[] = [];
  displayedColumns = ['type', 'template_key', 'status', 'created_at', 'actions'];
  totalItems = 0;
  pageSize = 25;
  currentPage = 1;
  isLoading = true;
  errorMessage = '';
  isExporting = false;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  private destroy$ = new Subject<void>();

  constructor(
    private api: ApiService,
    private badgeService: NotificationBadgeService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadNotifications();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadNotifications(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.api.get<PaginatedResponse<NotificationTask>>('/notifications', {
      page: this.currentPage,
      pageSize: this.pageSize
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.notifications = res.data || [];
        this.totalItems = res.total || 0;
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load notifications.';
        this.isLoading = false;
      }
    });
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.loadNotifications();
  }

  markAsRead(notification: NotificationTask): void {
    this.api.put(`/notifications/${notification.id}/read`, {}).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        notification.status = 'opened';
        this.badgeService.refresh();
        this.snackBar.open('Marked as read', 'Close', { duration: 2000 });
      },
      error: () => {
        this.snackBar.open('Failed to update status', 'Close', { duration: 3000 });
      }
    });
  }

  markAsAcknowledged(notification: NotificationTask): void {
    this.api.put(`/notifications/${notification.id}/acknowledge`, {}).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        notification.status = 'acknowledged';
        this.badgeService.refresh();
        this.snackBar.open('Acknowledged', 'Close', { duration: 2000 });
      },
      error: () => {
        this.snackBar.open('Failed to update status', 'Close', { duration: 3000 });
      }
    });
  }

  exportNotification(notification: NotificationTask): void {
    this.isExporting = true;
    this.api.post<{ path: string }>(`/notifications/export/${notification.id}`, {}).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res) => {
        this.isExporting = false;
        notification.export_path = res.path;
        this.snackBar.open('Export generated successfully', 'Close', { duration: 3000 });
      },
      error: () => {
        this.isExporting = false;
        this.snackBar.open('Failed to export notification', 'Close', { duration: 3000 });
      }
    });
  }

  getStatusIcon(status: string): string {
    const icons: Record<string, string> = {
      pending: 'schedule',
      generated: 'description',
      opened: 'mark_email_read',
      acknowledged: 'done_all',
      failed: 'error'
    };
    return icons[status] || 'notifications';
  }

  getTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      in_app: 'notifications',
      email_export: 'email',
      sms_export: 'sms'
    };
    return icons[type] || 'notifications';
  }

  canExport(notification: NotificationTask): boolean {
    return notification.type === 'email_export' || notification.type === 'sms_export';
  }
}
