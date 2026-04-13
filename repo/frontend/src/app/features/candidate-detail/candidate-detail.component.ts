import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { ApiService, PaginatedResponse } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { APPROVAL_TEMPLATES, APPROVALS } from '@contracts';
import { extractPath } from '@contract-utils';

interface Candidate {
  id: string;
  job_posting_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  ssn_masked: string | null;
  dob_masked: string | null;
  compensation_masked: string | null;
  eeoc_disposition: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
}

interface Tag {
  id: string;
  name: string;
  color: string | null;
}

interface Attachment {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  quality_status: string;
  created_at: string;
}

interface ResumeVersion {
  id: string;
  version_number: number;
  created_by_username: string;
  created_at: string;
}

interface Violation {
  id: string;
  rule_id: string;
  details: Record<string, unknown>;
  status: string;
  created_at: string;
}

@Component({
  selector: 'app-candidate-detail',
  templateUrl: './candidate-detail.component.html',
  styleUrls: ['./candidate-detail.component.scss']
})
export class CandidateDetailComponent implements OnInit, OnDestroy {
  candidate: Candidate | null = null;
  attachments: Attachment[] = [];
  resumeVersions: ResumeVersion[] = [];
  violations: Violation[] = [];
  allTags: Tag[] = [];
  candidateId = '';
  isLoading = true;
  errorMessage = '';
  attachmentsLoading = false;
  resumesLoading = false;
  violationsLoading = false;

  revealedFields: Record<string, string> = {};
  revealingField = '';
  passwordForm!: FormGroup;
  showPasswordDialog = false;
  fieldToReveal = '';

  showTagMenu = false;
  addingTag = false;

  contextMenuX = 0;
  contextMenuY = 0;
  showContextMenu = false;

  get contextMenuItems() {
    return [
      { label: this.translate.instant('CANDIDATE.CONTEXT_TAG'), action: () => this.onTagCandidate() },
      { label: this.translate.instant('CANDIDATE.CONTEXT_REQUEST_MATERIALS'), action: () => this.onRequestMissingMaterials() },
      { label: this.translate.instant('CANDIDATE.CONTEXT_CREATE_APPROVAL'), action: () => this.onCreateApprovalTask() },
      { label: this.translate.instant('CANDIDATE.CONTEXT_COPY_FIELDS'), action: () => this.copyStructuredFields() }
    ];
  }

  /** Queued action from Electron context-menu query param (executed once candidate loads). */
  private pendingAction: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private api: ApiService,
    private auth: AuthService,
    private snackBar: MatSnackBar,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.passwordForm = this.fb.group({
      password: ['', Validators.required]
    });

    // Capture Electron context-menu action from query params (e.g. ?action=tag)
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(qp => {
      const action = qp['action'];
      if (action) {
        this.pendingAction = action;
        // Clear the query param immediately to prevent replay on refresh
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { action: null },
          queryParamsHandling: 'merge',
          replaceUrl: true
        });
      }
    });

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.candidateId = params['id'];
      this.loadCandidate();
      this.loadAttachments();
      this.loadResumes();
      this.loadViolations();
      this.loadTags();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCandidate(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.api.get<Candidate>(`/candidates/${this.candidateId}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (candidate) => {
        this.candidate = candidate;
        this.isLoading = false;
        this.executePendingAction();
      },
      error: (err) => {
        this.errorMessage = err.status === 404
          ? this.translate.instant('CANDIDATE.NOT_FOUND')
          : this.translate.instant('CANDIDATE.LOAD_FAILED');
        this.isLoading = false;
      }
    });
  }

  /** Execute a queued action from Electron context-menu query params, then clear it. */
  private executePendingAction(): void {
    if (!this.pendingAction || !this.candidate) return;
    const action = this.pendingAction;
    this.pendingAction = null; // consume once — prevent re-execution

    switch (action) {
      case 'tag':
        this.onTagCandidate();
        break;
      case 'request-materials':
        this.onRequestMissingMaterials();
        break;
      case 'create-approval':
        this.onCreateApprovalTask();
        break;
      default:
        break;
    }
  }

  loadAttachments(): void {
    this.attachmentsLoading = true;
    this.api.get<PaginatedResponse<Attachment>>(`/candidates/${this.candidateId}/attachments`, {
      page: 1, pageSize: 100
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => { this.attachments = res.data || []; this.attachmentsLoading = false; },
      error: () => { this.attachments = []; this.attachmentsLoading = false; }
    });
  }

  loadResumes(): void {
    this.resumesLoading = true;
    this.api.get<{ data: ResumeVersion[] } | ResumeVersion[]>(`/candidates/${this.candidateId}/resumes`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res) => {
        // Backend returns { data: [...] } envelope
        this.resumeVersions = Array.isArray(res) ? res : ((res as { data: ResumeVersion[] }).data || []);
        this.resumesLoading = false;
      },
      error: () => { this.resumeVersions = []; this.resumesLoading = false; }
    });
  }

  loadViolations(): void {
    // /violations is reviewer/admin-only — skip for ineligible roles
    const user = this.auth.getCurrentUserValue();
    const canViewViolations = user?.role === 'admin' || user?.role === 'reviewer';
    if (!canViewViolations) {
      this.violations = [];
      this.violationsLoading = false;
      return;
    }

    this.violationsLoading = true;
    this.api.get<PaginatedResponse<Violation>>('/violations', {
      page: 1, pageSize: 100
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.violations = (res.data || []).filter(v =>
          (v.details as Record<string, unknown>)?.['candidate_id'] === this.candidateId
        );
        this.violationsLoading = false;
      },
      error: () => { this.violations = []; this.violationsLoading = false; }
    });
  }

  loadTags(): void {
    this.api.get<Tag[] | { data: Tag[] }>('/tags').pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        // Backend returns { data: Tag[] }; handle both shapes defensively
        const tags = Array.isArray(res) ? res : ((res as { data: Tag[] })?.data || []);
        this.allTags = tags;
      },
      error: () => { this.allTags = []; }
    });
  }

  requestReveal(field: string): void {
    this.fieldToReveal = field;
    this.showPasswordDialog = true;
    this.passwordForm.reset();
  }

  confirmReveal(): void {
    if (this.passwordForm.invalid) return;
    this.revealingField = this.fieldToReveal;

    this.api.post<{ value: string }>(`/candidates/${this.candidateId}/reveal`, {
      password: this.passwordForm.value.password,
      field: this.fieldToReveal
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.revealedFields[this.fieldToReveal] = res.value;
        this.showPasswordDialog = false;
        this.revealingField = '';
        this.snackBar.open(this.translate.instant('CANDIDATE.FIELD_REVEALED'), this.translate.instant('COMMON.CANCEL'), { duration: 2000 });
      },
      error: (err) => {
        this.revealingField = '';
        const msg = err.status === 401
          ? this.translate.instant('CANDIDATE.INVALID_PASSWORD')
          : this.translate.instant('CANDIDATE.REVEAL_FAILED');
        this.snackBar.open(msg, this.translate.instant('COMMON.CANCEL'), { duration: 3000 });
      }
    });
  }

  cancelReveal(): void {
    this.showPasswordDialog = false;
    this.fieldToReveal = '';
  }

  getSensitiveDisplay(field: string, maskedValue: string | null): string {
    if (this.revealedFields[field]) return this.revealedFields[field];
    return maskedValue || this.translate.instant('COMMON.REQUIRED');
  }

  isFieldRevealed(field: string): boolean {
    return !!this.revealedFields[field];
  }

  isMissing(value: unknown): boolean {
    return value === null || value === undefined || value === '';
  }

  addTag(tag: Tag): void {
    this.addingTag = true;
    this.api.post(`/candidates/${this.candidateId}/tags`, { tagId: tag.id }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.loadCandidate();
        this.addingTag = false;
        this.showTagMenu = false;
        this.snackBar.open(this.translate.instant('CANDIDATE.TAG_ADDED'), this.translate.instant('COMMON.CANCEL'), { duration: 2000 });
      },
      error: () => {
        this.addingTag = false;
        this.snackBar.open(this.translate.instant('CANDIDATE.TAG_ADD_FAILED'), this.translate.instant('COMMON.CANCEL'), { duration: 3000 });
      }
    });
  }

  removeTag(tag: Tag): void {
    this.api.delete(`/candidates/${this.candidateId}/tags/${tag.id}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.loadCandidate();
        this.snackBar.open(this.translate.instant('CANDIDATE.TAG_REMOVED'), this.translate.instant('COMMON.CANCEL'), { duration: 2000 });
      },
      error: () => {
        this.snackBar.open(this.translate.instant('CANDIDATE.TAG_REMOVE_FAILED'), this.translate.instant('COMMON.CANCEL'), { duration: 3000 });
      }
    });
  }

  getAvailableTags(): Tag[] {
    const candidateTagIds = (this.candidate?.tags || []).map(t => t.id);
    return this.allTags.filter(t => !candidateTagIds.includes(t.id));
  }

  openResume(version: ResumeVersion): void {
    this.router.navigate(['/candidates', this.candidateId, 'resume', version.id]);
  }

  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    this.contextMenuX = event.clientX;
    this.contextMenuY = event.clientY;
    this.showContextMenu = true;
  }

  closeContextMenu(): void {
    this.showContextMenu = false;
  }

  onTagCandidate(): void {
    this.closeContextMenu();
    this.showTagMenu = true;
  }

  onRequestMissingMaterials(): void {
    this.closeContextMenu();
    if (!this.candidate) return;

    const missingFields: string[] = [];
    if (this.isMissing(this.candidate.email)) missingFields.push(this.translate.instant('CANDIDATE.FIELD_EMAIL_ADDRESS'));
    if (this.isMissing(this.candidate.phone)) missingFields.push(this.translate.instant('CANDIDATE.FIELD_PHONE_NUMBER'));
    if (this.attachments.length === 0) missingFields.push(this.translate.instant('CANDIDATE.FIELD_RESUME_ATTACHMENTS'));

    const candidateName = `${this.candidate.first_name} ${this.candidate.last_name}`;
    const message = missingFields.length > 0
      ? this.translate.instant('CANDIDATE.MATERIALS_REQUEST_MSG', { name: candidateName, fields: missingFields.join(', ') })
      : this.translate.instant('CANDIDATE.MATERIALS_REVIEW_MSG', { name: candidateName });

    this.api.post(`/candidates/${this.candidateId}/request-materials`, {
      message
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.snackBar.open(this.translate.instant('CANDIDATE.MATERIAL_REQUEST_SENT'), this.translate.instant('COMMON.CANCEL'), { duration: 3000 });
      },
      error: () => {
        this.snackBar.open(this.translate.instant('CANDIDATE.MATERIAL_REQUEST_FAILED'), this.translate.instant('COMMON.CANCEL'), { duration: 3000 });
      }
    });
  }

  onCreateApprovalTask(): void {
    this.closeContextMenu();
    if (!this.candidate) return;

    // Fetch active templates via recruiter-accessible endpoint (not admin-only /approval-templates)
    const templatesPath = extractPath(APPROVAL_TEMPLATES.ACTIVE);
    this.api.get<{ data: Array<{ id: string; name: string; approval_mode: string }> }>(templatesPath).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res) => {
        const templates = res?.data || (Array.isArray(res) ? res : []);
        if (templates.length === 0) {
          this.snackBar.open(this.translate.instant('CANDIDATE.NO_TEMPLATES'), this.translate.instant('COMMON.CANCEL'), { duration: 5000 });
          return;
        }

        const template = templates[0];
        this.api.post(extractPath(APPROVALS.CREATE), {
          template_id: template.id,
          entity_type: 'candidate',
          entity_id: this.candidateId,
          final_write_back: { status: 'approved' }
        }).pipe(takeUntil(this.destroy$)).subscribe({
          next: () => {
            this.snackBar.open(this.translate.instant('CANDIDATE.APPROVAL_CREATED'), this.translate.instant('COMMON.CANCEL'), { duration: 3000 });
          },
          error: () => {
            this.snackBar.open(this.translate.instant('CANDIDATE.APPROVAL_CREATE_FAILED'), this.translate.instant('COMMON.CANCEL'), { duration: 3000 });
          }
        });
      },
      error: () => {
        this.snackBar.open(this.translate.instant('CANDIDATE.TEMPLATES_LOAD_FAILED'), this.translate.instant('COMMON.CANCEL'), { duration: 3000 });
      }
    });
  }

  async copyStructuredFields(): Promise<void> {
    this.closeContextMenu();
    if (!this.candidate) return;

    const na = this.translate.instant('COMMON.NA');
    const lines = [
      `${this.translate.instant('CANDIDATE.CLIPBOARD_NAME')}: ${this.candidate.first_name} ${this.candidate.last_name}`,
      `${this.translate.instant('CANDIDATE.CLIPBOARD_EMAIL')}: ${this.candidate.email || na}`,
      `${this.translate.instant('CANDIDATE.CLIPBOARD_PHONE')}: ${this.candidate.phone || na}`,
      `${this.translate.instant('CANDIDATE.CLIPBOARD_STATUS')}: ${this.candidate.status}`
    ];
    const text = lines.join('\n');

    try {
      await navigator.clipboard.writeText(text);
      this.snackBar.open(this.translate.instant('CANDIDATE.COPIED_TO_CLIPBOARD'), this.translate.instant('COMMON.CANCEL'), { duration: 2000 });
    } catch {
      this.snackBar.open(this.translate.instant('CANDIDATE.COPY_FAILED'), this.translate.instant('COMMON.CANCEL'), { duration: 3000 });
    }
  }

  statusChanging = false;
  statusError = '';
  candidateStatuses = ['intake', 'screening', 'review', 'approved', 'rejected'];

  changeStatus(newStatus: string): void {
    if (!this.candidate || this.statusChanging) return;
    this.statusChanging = true;
    this.statusError = '';

    this.api.patch<Candidate>(`/candidates/${this.candidateId}/status`, { status: newStatus }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (updated) => {
        this.candidate = updated;
        this.statusChanging = false;
        const msg = this.translate.instant('CANDIDATE.STATUS_CHANGED', { status: newStatus });
        this.snackBar.open(msg, this.translate.instant('COMMON.CANCEL'), { duration: 2000 });
      },
      error: (err) => {
        this.statusChanging = false;
        if (err.status === 400 && err.error?.missing_fields) {
          this.statusError = this.translate.instant('CANDIDATE.STATUS_ERROR_MISSING', {
            fields: err.error.missing_fields.join(', ')
          });
        } else if (err.status === 403) {
          this.statusError = this.translate.instant('CANDIDATE.STATUS_ERROR_FORBIDDEN');
        } else {
          this.statusError = this.translate.instant('CANDIDATE.STATUS_ERROR_GENERIC');
        }
        this.snackBar.open(this.statusError, this.translate.instant('COMMON.CANCEL'), { duration: 5000 });
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/recruiting']);
  }

  getViolationSeverityIcon(status: string): string {
    return status === 'pending' ? 'warning' : status === 'reviewed' ? 'check_circle' : 'info';
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
}
