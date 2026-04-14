import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { RecruitingComponent } from './recruiting.component';
import { ProjectDetailComponent } from './project-detail.component';
import { PostingDetailComponent } from './posting-detail.component';

@NgModule({
  declarations: [
    RecruitingComponent,
    ProjectDetailComponent,
    PostingDetailComponent
  ],
  imports: [SharedModule],
  exports: [RecruitingComponent, ProjectDetailComponent, PostingDetailComponent]
})
export class RecruitingModule {}
