import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AuthGuard } from './core/guards/auth.guard';

import { DashboardComponent } from './features/dashboard/dashboard.component';
import { RecruitingComponent } from './features/recruiting/recruiting.component';
import { CandidateDetailComponent } from './features/candidate-detail/candidate-detail.component';
import { ServiceCatalogComponent } from './features/service-catalog/service-catalog.component';
import { ApprovalsComponent } from './features/approvals/approvals.component';
import { ViolationsComponent } from './features/violations/violations.component';
import { NotificationsComponent } from './features/notifications/notifications.component';
import { GeospatialComponent } from './features/geospatial/geospatial.component';
import { MediaPlayerComponent } from './features/media-player/media-player.component';
import { AdminComponent } from './features/admin/admin.component';
import { LoginComponent } from './core/auth/login.component';
import { ResumeEditorComponent } from './features/resume/resume-editor.component';

const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [AuthGuard]
  },
  {
    path: 'recruiting',
    component: RecruitingComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', redirectTo: 'projects', pathMatch: 'full' },
      { path: 'projects', component: RecruitingComponent },
      { path: 'project/:id', component: RecruitingComponent },
      { path: 'postings', component: RecruitingComponent }
    ]
  },
  {
    path: 'candidates/:id',
    component: CandidateDetailComponent,
    canActivate: [AuthGuard]
  },
  {
    path: 'candidates/:id/resume/:resumeId',
    component: ResumeEditorComponent,
    canActivate: [AuthGuard]
  },
  {
    path: 'service-catalog',
    component: ServiceCatalogComponent,
    canActivate: [AuthGuard]
  },
  {
    path: 'approvals',
    component: ApprovalsComponent,
    canActivate: [AuthGuard]
  },
  {
    path: 'violations',
    component: ViolationsComponent,
    canActivate: [AuthGuard]
  },
  {
    path: 'notifications',
    component: NotificationsComponent,
    canActivate: [AuthGuard]
  },
  {
    path: 'geospatial',
    component: GeospatialComponent,
    canActivate: [AuthGuard]
  },
  {
    path: 'media',
    component: MediaPlayerComponent,
    canActivate: [AuthGuard]
  },
  {
    path: 'admin',
    component: AdminComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', redirectTo: 'users', pathMatch: 'full' },
      { path: 'users', component: AdminComponent },
      { path: 'rules', component: AdminComponent },
      { path: 'templates', component: AdminComponent }
    ]
  },
  {
    path: 'login',
    component: LoginComponent
  },
  { path: '**', redirectTo: 'dashboard' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
