import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { ViolationsComponent } from './violations.component';

@NgModule({
  declarations: [ViolationsComponent],
  imports: [SharedModule],
  exports: [ViolationsComponent]
})
export class ViolationsModule {}
