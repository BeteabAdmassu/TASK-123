import { Component, OnInit, OnDestroy, ViewChild, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormControl } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
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

@Component({
  selector: 'app-recruiting',
  templateUrl: './recruiting.component.html',
  styleUrls: ['./recruiting.component.scss']
})
export class RecruitingComponent implements OnInit, OnDestroy, AfterViewInit {
  displayedColumns = ['title', 'status', 'created_at', 'actions'];
  dataSource = new MatTableDataSource<Project>([]);
  searchControl = new FormControl('');
  totalItems = 0;
  pageSize = 25;
  currentPage = 1;
  isLoading = true;
  errorMessage = '';

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  private destroy$ = new Subject<void>();

  constructor(
    private api: ApiService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadProjects();
    this.searchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.currentPage = 1;
      this.loadProjects();
    });
  }

  ngAfterViewInit(): void {
    if (this.paginator) {
      this.dataSource.paginator = this.paginator;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadProjects(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.api.get<PaginatedResponse<Project>>('/projects', {
      page: this.currentPage,
      pageSize: this.pageSize
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        let projects = response.data || [];
        const searchTerm = this.searchControl.value?.toLowerCase() || '';
        if (searchTerm) {
          projects = projects.filter(p =>
            p.title.toLowerCase().includes(searchTerm) ||
            (p.description || '').toLowerCase().includes(searchTerm)
          );
        }
        this.dataSource.data = projects;
        this.totalItems = response.total || 0;
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load projects. Please try again.';
        this.isLoading = false;
      }
    });
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.loadProjects();
  }

  openProject(project: Project): void {
    this.router.navigate(['/recruiting/project', project.id]);
  }

  createProject(): void {
    this.api.post<Project>('/projects', {
      title: 'New Recruiting Project',
      status: 'draft'
    }).subscribe({
      next: (project) => {
        this.snackBar.open('Project created successfully', 'Close', { duration: 3000 });
        this.router.navigate(['/recruiting/project', project.id]);
      },
      error: () => {
        this.snackBar.open('Failed to create project', 'Close', { duration: 3000 });
      }
    });
  }

  getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      draft: 'default',
      active: 'primary',
      completed: 'accent',
      archived: 'warn'
    };
    return colors[status] || 'default';
  }
}
