import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { CandidateDetailComponent } from './candidate-detail.component';

const routes: Routes = [
  { path: '', component: CandidateDetailComponent }
];

@NgModule({
  declarations: [CandidateDetailComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
  exports: [CandidateDetailComponent]
})
export class CandidateDetailModule {}
