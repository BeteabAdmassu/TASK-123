import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ViolationsComponent } from './violations.component';

const routes: Routes = [
  { path: '', component: ViolationsComponent }
];

@NgModule({
  declarations: [ViolationsComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
  exports: [ViolationsComponent]
})
export class ViolationsModule {}
