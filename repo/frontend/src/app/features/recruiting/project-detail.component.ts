import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService, PaginatedResponse } from '../../core/services/api.service';

interface Project {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface Posting {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
}

@Component({
  selector: 'app-project-detail',
  templateUrl: './project-detail.component.html',
  styleUrls: ['./project-detail.component.scss']
})
export class ProjectDetailComponent implements OnInit, OnDestroy {
  project: Project | null = null;
  postings: Posting[] = [];
  editForm!: FormGroup;
  isLoading = true;
  isSaving = false;
  isEditing = false;
  errorMessage = '';
  postingsLoading = false;
  projectId = '';
  statusOptions = ['draft', 'active', 'completed', 'archived'];

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
      description: ['', Validators.maxLength(2000)],
      status: ['draft']
    });

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.projectId = params['id'];
      this.loadProject();
      this.loadPostings();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadProject(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.api.get<Project>(`/projects/${this.projectId}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (project) => {
        this.project = project;
        this.editForm.patchValue({
          title: project.title,
          description: project.description || '',
          status: project.status
        });
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = err.status === 404
          ? 'Project not found.'
          : 'Failed to load project.';
        this.isLoading = false;
      }
    });
  }

  loadPostings(): void {
    this.postingsLoading = true;
    this.api.get<PaginatedResponse<Posting>>(`/projects/${this.projectId}/postings`, {
      page: 1, pageSize: 100
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.postings = res.data || [];
        this.postingsLoading = false;
      },
      error: () => {
        this.postings = [];
        this.postingsLoading = false;
      }
    });
  }

  toggleEdit(): void {
    this.isEditing = !this.isEditing;
    if (!this.isEditing && this.project) {
      this.editForm.patchValue({
        title: this.project.title,
        description: this.project.description || '',
        status: this.project.status
      });
    }
  }

  saveProject(): void {
    if (this.editForm.invalid) return;
    this.isSaving = true;

    this.api.put<Project>(`/projects/${this.projectId}`, this.editForm.value).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (updated) => {
        this.project = updated;
        this.isEditing = false;
        this.isSaving = false;
        this.snackBar.open('Project updated successfully', 'Close', { duration: 3000 });
      },
      error: () => {
        this.isSaving = false;
        this.snackBar.open('Failed to update project', 'Close', { duration: 3000 });
      }
    });
  }

  createPosting(): void {
    this.api.post<Posting>(`/projects/${this.projectId}/postings`, {
      title: 'New Job Posting',
      status: 'draft'
    }).subscribe({
      next: (posting) => {
        this.snackBar.open('Posting created', 'Close', { duration: 3000 });
        this.router.navigate(['/recruiting/posting', posting.id]);
      },
      error: () => {
        this.snackBar.open('Failed to create posting', 'Close', { duration: 3000 });
      }
    });
  }

  openPosting(posting: Posting): void {
    this.router.navigate(['/recruiting/posting', posting.id]);
  }

  goBack(): void {
    this.router.navigate(['/recruiting']);
  }
}
