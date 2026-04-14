import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { ApprovalsComponent } from './approvals.component';

@NgModule({
  declarations: [ApprovalsComponent],
  imports: [SharedModule],
  exports: [ApprovalsComponent]
})
export class ApprovalsModule {}
