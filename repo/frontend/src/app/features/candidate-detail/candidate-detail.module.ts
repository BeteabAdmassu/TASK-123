import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { CandidateDetailComponent } from './candidate-detail.component';

@NgModule({
  declarations: [CandidateDetailComponent],
  imports: [SharedModule],
  exports: [CandidateDetailComponent]
})
export class CandidateDetailModule {}
