import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService, PaginatedResponse } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';

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

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private api: ApiService,
    private auth: AuthService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.passwordForm = this.fb.group({
      password: ['', Validators.required]
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
      },
      error: (err) => {
        this.errorMessage = err.status === 404
          ? 'Candidate not found.'
          : 'Failed to load candidate details.';
        this.isLoading = false;
      }
    });
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
    this.api.get<ResumeVersion[]>(`/candidates/${this.candidateId}/resumes`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (versions) => { this.resumeVersions = Array.isArray(versions) ? versions : []; this.resumesLoading = false; },
      error: () => { this.resumeVersions = []; this.resumesLoading = false; }
    });
  }

  loadViolations(): void {
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
    this.api.get<Tag[]>('/tags').pipe(takeUntil(this.destroy$)).subscribe({
      next: (tags) => { this.allTags = Array.isArray(tags) ? tags : []; },
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
        this.snackBar.open('Field revealed', 'Close', { duration: 2000 });
      },
      error: (err) => {
        this.revealingField = '';
        const msg = err.status === 401 ? 'Invalid password' : 'Failed to reveal field';
        this.snackBar.open(msg, 'Close', { duration: 3000 });
      }
    });
  }

  cancelReveal(): void {
    this.showPasswordDialog = false;
    this.fieldToReveal = '';
  }

  getSensitiveDisplay(field: string, maskedValue: string | null): string {
    if (this.revealedFields[field]) return this.revealedFields[field];
    return maskedValue || 'Required';
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
        this.snackBar.open('Tag added', 'Close', { duration: 2000 });
      },
      error: () => {
        this.addingTag = false;
        this.snackBar.open('Failed to add tag', 'Close', { duration: 3000 });
      }
    });
  }

  removeTag(tag: Tag): void {
    this.api.delete(`/candidates/${this.candidateId}/tags/${tag.id}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.loadCandidate();
        this.snackBar.open('Tag removed', 'Close', { duration: 2000 });
      },
      error: () => {
        this.snackBar.open('Failed to remove tag', 'Close', { duration: 3000 });
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
