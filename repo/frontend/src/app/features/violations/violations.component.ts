import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService, PaginatedResponse } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';

interface Violation {
  id: string;
  candidate_id: string;
  rule_id: string;
  details: Record<string, unknown>;
  status: string;
  reviewed_by: string | null;
  decision: string | null;
  review_comment: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  actor_id: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

@Component({
  selector: 'app-violations',
  templateUrl: './violations.component.html',
  styleUrls: ['./violations.component.scss']
})
export class ViolationsComponent implements OnInit, OnDestroy {
  violations: Violation[] = [];
  displayedColumns = ['status', 'candidate_id', 'details', 'created_at', 'actions'];
  totalItems = 0;
  pageSize = 25;
  currentPage = 1;
  isLoading = true;
  errorMessage = '';
  statusFilter = '';
  statusOptions = ['', 'pending', 'reviewed', 'dismissed', 'escalated'];

  selectedViolation: Violation | null = null;
  reviewForm!: FormGroup;
  isReviewing = false;
  auditTrail: AuditEntry[] = [];
  auditLoading = false;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  private destroy$ = new Subject<void>();

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private fb: FormBuilder,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.reviewForm = this.fb.group({
      decision: ['reviewed', Validators.required],
      review_comment: ['', Validators.required]
    });

    this.loadViolations();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadViolations(): void {
    this.isLoading = true;
    this.errorMessage = '';

    const params: Record<string, string | number> = {
      page: this.currentPage,
      pageSize: this.pageSize
    };
    if (this.statusFilter) {
      params['status'] = this.statusFilter;
    }

    this.api.get<PaginatedResponse<Violation>>('/violations', params).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res) => {
        this.violations = res.data || [];
        this.totalItems = res.total || 0;
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load violations.';
        this.isLoading = false;
      }
    });
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.loadViolations();
  }

  onStatusFilterChange(): void {
    this.currentPage = 1;
    this.loadViolations();
  }

  selectViolation(violation: Violation): void {
    this.selectedViolation = violation;
    this.reviewForm.patchValue({
      decision: 'reviewed',
      review_comment: ''
    });
    this.loadAuditTrail(violation.id);
  }

  loadAuditTrail(violationId: string): void {
    // /audit is admin-only — skip for non-admin roles to avoid 403
    const user = this.auth.getCurrentUserValue();
    if (user?.role !== 'admin') {
      this.auditTrail = [];
      this.auditLoading = false;
      return;
    }

    this.auditLoading = true;
    this.api.get<{ data: AuditEntry[] }>('/audit', {
      entity_type: 'violation_instance',
      entity_id: violationId,
      page: 1,
      pageSize: 50
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.auditTrail = res.data || [];
        this.auditLoading = false;
      },
      error: () => {
        this.auditTrail = [];
        this.auditLoading = false;
      }
    });
  }

  submitReview(): void {
    if (!this.selectedViolation || this.reviewForm.invalid) return;
    this.isReviewing = true;

    this.api.put(`/violations/${this.selectedViolation.id}/review`, this.reviewForm.value).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.isReviewing = false;
        this.snackBar.open('Violation reviewed successfully', 'Close', { duration: 3000 });
        this.selectedViolation = null;
        this.loadViolations();
      },
      error: () => {
        this.isReviewing = false;
        this.snackBar.open('Failed to submit review', 'Close', { duration: 3000 });
      }
    });
  }

  closeReview(): void {
    this.selectedViolation = null;
  }

  getSeverityColor(status: string): string {
    const colors: Record<string, string> = {
      pending: 'warn',
      reviewed: 'primary',
      dismissed: 'accent',
      escalated: 'warn'
    };
    return colors[status] || '';
  }

  getDetailsPreview(details: Record<string, unknown>): string {
    const ruleType = details['rule_type'] as string || '';
    const message = details['message'] as string || '';
    return message || ruleType || JSON.stringify(details).substring(0, 80);
  }
}
