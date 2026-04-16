/**
 * RecruitingComponent – Unit Tests
 * Covers loading state, error state, empty state, data display,
 * search triggering, and the createProject dialog call.
 */

import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';

@Component({ template: '' })
class StubComponent {}

import { SharedModule } from '../../frontend/src/app/shared/shared.module';
import { ApiService } from '../../frontend/src/app/core/services/api.service';
import { RecruitingComponent } from '../../frontend/src/app/features/recruiting/recruiting.component';

interface Project {
  id: string; title: string; description: string | null;
  status: string; created_by: string; created_at: string; updated_at: string;
}

function makeProject(n: number): Project {
  return {
    id: `proj-${n}`,
    title: `Project ${n}`,
    description: null,
    status: 'active',
    created_by: 'user-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function mockApiService(projects: Project[] = []) {
  return {
    get: jasmine.createSpy('get').and.returnValue(
      of({ data: projects, total: projects.length, page: 1, pageSize: 25 })
    ),
    post: jasmine.createSpy('post').and.returnValue(of(makeProject(99))),
    put:  jasmine.createSpy('put').and.returnValue(of({})),
    delete: jasmine.createSpy('delete').and.returnValue(of({})),
  };
}

describe('RecruitingComponent', () => {
  let fixture: ComponentFixture<RecruitingComponent>;
  let component: RecruitingComponent;
  let apiService: ReturnType<typeof mockApiService>;
  let dialogSpy: jasmine.SpyObj<MatDialog>;

  async function setup(projects: Project[] = []) {
    apiService = mockApiService(projects);
    dialogSpy  = jasmine.createSpyObj('MatDialog', ['open']);
    dialogSpy.open.and.returnValue({ afterClosed: () => of(null) } as any);

    await TestBed.configureTestingModule({
      imports: [SharedModule, ReactiveFormsModule, RouterTestingModule.withRoutes([{ path: '**', component: StubComponent }]), NoopAnimationsModule, TranslateModule.forRoot()],
      declarations: [RecruitingComponent, StubComponent],
      providers: [
        { provide: ApiService, useValue: apiService },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy('open') } },
        { provide: MatDialog, useValue: dialogSpy },
      ],
    }).compileComponents();

    fixture   = TestBed.createComponent(RecruitingComponent);
    component = fixture.componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  // ── Loading state ─────────────────────────────────────────────────────────
  it('should set isLoading=true before data arrives', async () => {
    await setup();
    // Before detectChanges, ngOnInit hasn't fired
    expect(component.isLoading).toBeTrue();
  });

  it('should set isLoading=false after data arrives', fakeAsync(async () => {
    await setup([makeProject(1)]);
    fixture.detectChanges();
    tick(500); // debounce + async
    expect(component.isLoading).toBeFalse();
  }));

  // ── Error state ───────────────────────────────────────────────────────────
  it('should set errorMessage when API returns an error', fakeAsync(async () => {
    await setup();
    apiService.get.and.returnValue(throwError(() => new Error('Server error')));
    fixture.detectChanges();
    tick(500);
    expect(component.errorMessage).toBeTruthy();
  }));

  it('should show error element in DOM when errorMessage is set', fakeAsync(async () => {
    await setup();
    apiService.get.and.returnValue(throwError(() => new Error('Server error')));
    fixture.detectChanges();
    tick(500);
    fixture.detectChanges();
    const errorEl = fixture.debugElement.query(By.css('.error-container'));
    expect(errorEl).toBeTruthy();
  }));

  // ── Empty state ───────────────────────────────────────────────────────────
  it('should show empty-state element when no projects returned', fakeAsync(async () => {
    await setup([]);
    fixture.detectChanges();
    tick(500);
    fixture.detectChanges();
    const emptyEl = fixture.debugElement.query(By.css('.empty-state'));
    expect(emptyEl).toBeTruthy();
  }));

  // ── Data display ──────────────────────────────────────────────────────────
  it('should populate dataSource when projects are returned', fakeAsync(async () => {
    const projects = [makeProject(1), makeProject(2)];
    await setup(projects);
    fixture.detectChanges();
    tick(500);
    expect(component.dataSource.data.length).toBe(2);
  }));

  it('should call ApiService.get on init', fakeAsync(async () => {
    await setup([makeProject(1)]);
    fixture.detectChanges();
    tick(500);
    expect(apiService.get).toHaveBeenCalled();
  }));

  it('should call ApiService.get with recruiting/projects endpoint', fakeAsync(async () => {
    await setup();
    fixture.detectChanges();
    tick(500);
    const firstCall = (apiService.get as jasmine.Spy).calls.first();
    expect(firstCall.args[0]).toContain('projects');
  }));

  // ── Search ────────────────────────────────────────────────────────────────
  it('should trigger a new API call after search input with debounce', fakeAsync(async () => {
    await setup([makeProject(1)]);
    fixture.detectChanges();
    tick(500);
    const callsBefore = (apiService.get as jasmine.Spy).calls.count();
    component.searchControl.setValue('alpha');
    tick(400); // debounce is 300ms
    expect((apiService.get as jasmine.Spy).calls.count()).toBeGreaterThan(callsBefore);
  }));

  // ── createProject ─────────────────────────────────────────────────────────
  it('should call ApiService.post when createProject() is called', fakeAsync(async () => {
    await setup();
    fixture.detectChanges();
    tick(500);
    component.createProject();
    tick();
    expect(apiService.post).toHaveBeenCalled();
  }));
});
