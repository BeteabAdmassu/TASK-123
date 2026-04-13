import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ApprovalsComponent } from './approvals.component';

const routes: Routes = [
  { path: '', component: ApprovalsComponent }
];

@NgModule({
  declarations: [ApprovalsComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
  exports: [ApprovalsComponent]
})
export class ApprovalsModule {}
