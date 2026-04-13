import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService, PaginatedResponse } from '../../core/services/api.service';

interface ApprovalRequest {
  id: string;
  template_id: string;
  entity_type: string;
  entity_id: string;
  requested_by: string;
  approval_mode: string;
  status: string;
  created_at: string;
  updated_at: string;
  steps?: ApprovalStep[];
}

interface ApprovalStep {
  id: string;
  request_id: string;
  step_order: number;
  approver_id: string;
  status: string;
  comment: string | null;
  decided_at: string | null;
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
  selector: 'app-approvals',
  templateUrl: './approvals.component.html',
  styleUrls: ['./approvals.component.scss']
})
export class ApprovalsComponent implements OnInit, OnDestroy {
  approvals: ApprovalRequest[] = [];
  displayedColumns = ['entity_type', 'status', 'approval_mode', 'created_at', 'actions'];
  totalItems = 0;
  pageSize = 25;
  currentPage = 1;
  isLoading = true;
  errorMessage = '';
  statusFilter = '';

  selectedApproval: ApprovalRequest | null = null;
  decisionForm!: FormGroup;
  isDeciding = false;
  selectedStep: ApprovalStep | null = null;
  auditTrail: AuditEntry[] = [];
  auditLoading = false;
  stepsLoading = false;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  private destroy$ = new Subject<void>();

  constructor(
    private api: ApiService,
    private fb: FormBuilder,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.decisionForm = this.fb.group({
      decision: ['approved', Validators.required],
      comment: ['']
    });

    this.decisionForm.get('decision')!.valueChanges.pipe(
      takeUntil(this.destroy$)
    ).subscribe(value => {
      const commentControl = this.decisionForm.get('comment')!;
      if (value === 'rejected') {
        commentControl.setValidators(Validators.required);
      } else {
        commentControl.clearValidators();
      }
      commentControl.updateValueAndValidity();
    });

    this.loadApprovals();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadApprovals(): void {
    this.isLoading = true;
    this.errorMessage = '';

    const params: Record<string, string | number> = {
      page: this.currentPage,
      pageSize: this.pageSize
    };
    if (this.statusFilter) {
      params['status'] = this.statusFilter;
    }

    this.api.get<PaginatedResponse<ApprovalRequest>>('/approvals', params).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res) => {
        this.approvals = res.data || [];
        this.totalItems = res.total || 0;
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load approvals.';
        this.isLoading = false;
      }
    });
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.loadApprovals();
  }

  onStatusFilterChange(): void {
    this.currentPage = 1;
    this.loadApprovals();
  }

  selectApproval(approval: ApprovalRequest): void {
    this.selectedApproval = approval;
    this.decisionForm.reset({ decision: 'approved', comment: '' });
    this.loadSteps(approval.id);
    this.loadAuditTrail(approval.id);
  }

  loadSteps(approvalId: string): void {
    this.stepsLoading = true;
    this.api.get<ApprovalRequest>(`/approvals/${approvalId}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (approval) => {
        if (this.selectedApproval) {
          this.selectedApproval.steps = approval.steps || [];
        }
        this.stepsLoading = false;
      },
      error: () => {
        this.stepsLoading = false;
      }
    });
  }

  loadAuditTrail(approvalId: string): void {
    this.auditLoading = true;
    this.api.get<{ data: AuditEntry[] }>('/audit', {
      page: 1, pageSize: 50
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.auditTrail = (res.data || []).filter(a =>
          a.metadata?.['entity_id'] === approvalId || a.metadata?.['approval_id'] === approvalId
        );
        this.auditLoading = false;
      },
      error: () => {
        this.auditTrail = [];
        this.auditLoading = false;
      }
    });
  }

  selectStep(step: ApprovalStep): void {
    this.selectedStep = step;
  }

  submitDecision(): void {
    if (!this.selectedApproval || !this.selectedStep || this.decisionForm.invalid) return;
    this.isDeciding = true;

    this.api.put(
      `/approvals/${this.selectedApproval.id}/steps/${this.selectedStep.id}`,
      this.decisionForm.value
    ).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.isDeciding = false;
        this.snackBar.open('Decision submitted successfully', 'Close', { duration: 3000 });
        this.selectedApproval = null;
        this.selectedStep = null;
        this.loadApprovals();
      },
      error: () => {
        this.isDeciding = false;
        this.snackBar.open('Failed to submit decision', 'Close', { duration: 3000 });
      }
    });
  }

  closeDetail(): void {
    this.selectedApproval = null;
    this.selectedStep = null;
  }

  getStepStatusIcon(status: string): string {
    if (status === 'approved') return 'check_circle';
    if (status === 'rejected') return 'cancel';
    return 'hourglass_empty';
  }

  getProgressPercentage(approval: ApprovalRequest): number {
    if (!approval.steps || approval.steps.length === 0) return 0;
    const decided = approval.steps.filter(s => s.status !== 'pending').length;
    return Math.round((decided / approval.steps.length) * 100);
  }
}
