import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { GeospatialComponent } from './geospatial.component';

@NgModule({
  declarations: [GeospatialComponent],
  imports: [SharedModule],
  exports: [GeospatialComponent]
})
export class GeospatialModule {}
