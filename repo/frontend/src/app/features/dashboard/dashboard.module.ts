import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { DashboardComponent } from './dashboard.component';

@NgModule({
  declarations: [DashboardComponent],
  imports: [SharedModule],
  exports: [DashboardComponent]
})
export class DashboardModule {}
