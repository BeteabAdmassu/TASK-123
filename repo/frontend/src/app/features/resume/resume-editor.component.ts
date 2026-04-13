import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

interface ResumeVersion {
  id: string;
  candidate_id: string;
  version_number: number;
  content: ResumeContent;
  created_by: string;
  created_by_username: string;
  created_at: string;
}

interface ResumeContent {
  summary?: string;
  experience?: ResumeSection[];
  education?: ResumeSection[];
  skills?: string[];
  certifications?: ResumeSection[];
}

interface ResumeSection {
  title: string;
  organization: string;
  startDate: string;
  endDate: string;
  description: string;
}

@Component({
  selector: 'app-resume-editor',
  templateUrl: './resume-editor.component.html',
  styleUrls: ['./resume-editor.component.scss']
})
export class ResumeEditorComponent implements OnInit, OnDestroy {
  candidateId = '';
  resumeId = '';
  versions: ResumeVersion[] = [];
  selectedVersion: ResumeVersion | null = null;
  comparisonVersion: ResumeVersion | null = null;
  resumeForm!: FormGroup;
  isLoading = true;
  isSaving = false;
  errorMessage = '';
  showDiff = false;

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private api: ApiService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.initForm();

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.candidateId = params['candidateId'];
      this.resumeId = params['resumeId'] || '';
      this.loadVersions();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.saveResume();
    }
  }

  initForm(): void {
    this.resumeForm = this.fb.group({
      summary: [''],
      experience: this.fb.array([]),
      education: this.fb.array([]),
      skills: [''],
      certifications: this.fb.array([])
    });
  }

  get experienceArray(): FormArray {
    return this.resumeForm.get('experience') as FormArray;
  }

  get educationArray(): FormArray {
    return this.resumeForm.get('education') as FormArray;
  }

  get certificationsArray(): FormArray {
    return this.resumeForm.get('certifications') as FormArray;
  }

  createSectionGroup(section?: ResumeSection): FormGroup {
    return this.fb.group({
      title: [section?.title || '', Validators.required],
      organization: [section?.organization || ''],
      startDate: [section?.startDate || ''],
      endDate: [section?.endDate || ''],
      description: [section?.description || '']
    });
  }

  addExperience(): void {
    this.experienceArray.push(this.createSectionGroup());
  }

  removeExperience(index: number): void {
    this.experienceArray.removeAt(index);
  }

  addEducation(): void {
    this.educationArray.push(this.createSectionGroup());
  }

  removeEducation(index: number): void {
    this.educationArray.removeAt(index);
  }

  addCertification(): void {
    this.certificationsArray.push(this.createSectionGroup());
  }

  removeCertification(index: number): void {
    this.certificationsArray.removeAt(index);
  }

  loadVersions(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.api.get<{ data: ResumeVersion[] } | ResumeVersion[]>(`/candidates/${this.candidateId}/resumes`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res) => {
        // Backend returns { data: [...] } envelope
        this.versions = Array.isArray(res) ? res : ((res as { data: ResumeVersion[] }).data || []);
        if (this.resumeId) {
          this.selectedVersion = this.versions.find(v => v.id === this.resumeId) || null;
        } else if (this.versions.length > 0) {
          this.selectedVersion = this.versions[0];
        }
        if (this.selectedVersion) {
          this.populateForm(this.selectedVersion.content);
        }
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load resume versions.';
        this.isLoading = false;
      }
    });
  }

  populateForm(content: ResumeContent): void {
    this.resumeForm.patchValue({
      summary: content.summary || '',
      skills: (content.skills || []).join(', ')
    });

    this.experienceArray.clear();
    (content.experience || []).forEach(exp => {
      this.experienceArray.push(this.createSectionGroup(exp));
    });

    this.educationArray.clear();
    (content.education || []).forEach(edu => {
      this.educationArray.push(this.createSectionGroup(edu));
    });

    this.certificationsArray.clear();
    (content.certifications || []).forEach(cert => {
      this.certificationsArray.push(this.createSectionGroup(cert));
    });
  }

  selectVersion(version: ResumeVersion): void {
    this.selectedVersion = version;
    this.populateForm(version.content);
    this.showDiff = false;
  }

  saveResume(): void {
    if (this.isSaving) return;
    this.isSaving = true;

    const formValue = this.resumeForm.value;
    const content: ResumeContent = {
      summary: formValue.summary,
      experience: formValue.experience,
      education: formValue.education,
      skills: formValue.skills ? formValue.skills.split(',').map((s: string) => s.trim()).filter((s: string) => s) : [],
      certifications: formValue.certifications
    };

    this.api.post<ResumeVersion>(`/candidates/${this.candidateId}/resumes`, {
      content
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (newVersion) => {
        this.versions = [newVersion, ...this.versions];
        this.selectedVersion = newVersion;
        this.isSaving = false;
        this.snackBar.open('Resume saved as new version', 'Close', { duration: 3000 });
      },
      error: () => {
        this.isSaving = false;
        this.snackBar.open('Failed to save resume', 'Close', { duration: 3000 });
      }
    });
  }

  toggleDiff(version: ResumeVersion): void {
    if (this.comparisonVersion?.id === version.id) {
      this.showDiff = false;
      this.comparisonVersion = null;
    } else {
      this.comparisonVersion = version;
      this.showDiff = true;
    }
  }

  getDiffFields(): string[] {
    if (!this.selectedVersion || !this.comparisonVersion) return [];
    const fields: string[] = [];
    const current = this.selectedVersion.content;
    const compare = this.comparisonVersion.content;

    if (current.summary !== compare.summary) fields.push('summary');
    if (JSON.stringify(current.experience) !== JSON.stringify(compare.experience)) fields.push('experience');
    if (JSON.stringify(current.education) !== JSON.stringify(compare.education)) fields.push('education');
    if (JSON.stringify(current.skills) !== JSON.stringify(compare.skills)) fields.push('skills');
    if (JSON.stringify(current.certifications) !== JSON.stringify(compare.certifications)) fields.push('certifications');

    return fields;
  }

  goBack(): void {
    this.router.navigate(['/candidates', this.candidateId]);
  }
}
