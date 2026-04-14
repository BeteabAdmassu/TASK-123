import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { AdminComponent } from './admin.component';

@NgModule({
  declarations: [AdminComponent],
  imports: [SharedModule],
  exports: [AdminComponent]
})
export class AdminModule {}
