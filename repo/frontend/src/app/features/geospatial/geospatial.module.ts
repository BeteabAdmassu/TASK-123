import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { GeospatialComponent } from './geospatial.component';

const routes: Routes = [
  { path: '', component: GeospatialComponent }
];

@NgModule({
  declarations: [GeospatialComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
  exports: [GeospatialComponent]
})
export class GeospatialModule {}
