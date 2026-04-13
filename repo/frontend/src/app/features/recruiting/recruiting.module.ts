import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { RecruitingComponent } from './recruiting.component';
import { ProjectDetailComponent } from './project-detail.component';
import { PostingDetailComponent } from './posting-detail.component';

const routes: Routes = [
  { path: '', component: RecruitingComponent },
  { path: 'project/:id', component: ProjectDetailComponent },
  { path: 'posting/:id', component: PostingDetailComponent }
];

@NgModule({
  declarations: [
    RecruitingComponent,
    ProjectDetailComponent,
    PostingDetailComponent
  ],
  imports: [SharedModule, RouterModule.forChild(routes)],
  exports: [RecruitingComponent, ProjectDetailComponent, PostingDetailComponent]
})
export class RecruitingModule {}
