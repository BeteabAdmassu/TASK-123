import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService, PaginatedResponse } from '../../core/services/api.service';

interface Posting {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  requirements: Record<string, unknown> | null;
  field_rules: Record<string, unknown> | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Candidate {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  status: string;
  created_at: string;
}

@Component({
  selector: 'app-posting-detail',
  templateUrl: './posting-detail.component.html',
  styleUrls: ['./posting-detail.component.scss']
})
export class PostingDetailComponent implements OnInit, OnDestroy {
  posting: Posting | null = null;
  candidates: Candidate[] = [];
  editForm!: FormGroup;
  candidateForm!: FormGroup;
  postingId = '';
  isLoading = true;
  isSaving = false;
  isEditing = false;
  errorMessage = '';
  candidatesLoading = false;
  showCandidateForm = false;
  isAddingCandidate = false;
  statusOptions = ['draft', 'open', 'closed'];

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private api: ApiService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.editForm = this.fb.group({
      title: ['', [Validators.required, Validators.maxLength(255)]],
      description: ['', Validators.maxLength(5000)],
      status: ['draft']
    });

    this.candidateForm = this.fb.group({
      first_name: ['', Validators.required],
      last_name: ['', Validators.required],
      email: ['', Validators.email],
      phone: ['']
    });

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.postingId = params['id'];
      this.loadPosting();
      this.loadCandidates();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPosting(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.api.get<Posting>(`/postings/${this.postingId}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (posting) => {
        this.posting = posting;
        this.editForm.patchValue({
          title: posting.title,
          description: posting.description || '',
          status: posting.status
        });
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = err.status === 404
          ? 'Posting not found.'
          : 'Failed to load posting.';
        this.isLoading = false;
      }
    });
  }

  loadCandidates(): void {
    this.candidatesLoading = true;
    this.api.get<PaginatedResponse<Candidate>>(`/postings/${this.postingId}/candidates`, {
      page: 1, pageSize: 100
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.candidates = res.data || [];
        this.candidatesLoading = false;
      },
      error: () => {
        this.candidates = [];
        this.candidatesLoading = false;
      }
    });
  }

  toggleEdit(): void {
    this.isEditing = !this.isEditing;
    if (!this.isEditing && this.posting) {
      this.editForm.patchValue({
        title: this.posting.title,
        description: this.posting.description || '',
        status: this.posting.status
      });
    }
  }

  savePosting(): void {
    if (this.editForm.invalid) return;
    this.isSaving = true;

    this.api.put<Posting>(`/postings/${this.postingId}`, this.editForm.value).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (updated) => {
        this.posting = updated;
        this.isEditing = false;
        this.isSaving = false;
        this.snackBar.open('Posting updated', 'Close', { duration: 3000 });
      },
      error: () => {
        this.isSaving = false;
        this.snackBar.open('Failed to update posting', 'Close', { duration: 3000 });
      }
    });
  }

  addCandidate(): void {
    if (this.candidateForm.invalid) return;
    this.isAddingCandidate = true;

    this.api.post<Candidate>(`/postings/${this.postingId}/candidates`, this.candidateForm.value).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (candidate) => {
        this.candidates = [candidate, ...this.candidates];
        this.candidateForm.reset();
        this.showCandidateForm = false;
        this.isAddingCandidate = false;
        this.snackBar.open('Candidate added', 'Close', { duration: 3000 });
      },
      error: () => {
        this.isAddingCandidate = false;
        this.snackBar.open('Failed to add candidate', 'Close', { duration: 3000 });
      }
    });
  }

  openCandidate(candidate: Candidate): void {
    this.router.navigate(['/candidates', candidate.id]);
  }

  goBack(): void {
    if (this.posting?.project_id) {
      this.router.navigate(['/recruiting/project', this.posting.project_id]);
    } else {
      this.router.navigate(['/recruiting']);
    }
  }
}
