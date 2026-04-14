import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { ServiceCatalogComponent } from './service-catalog.component';

@NgModule({
  declarations: [ServiceCatalogComponent],
  imports: [SharedModule],
  exports: [ServiceCatalogComponent]
})
export class ServiceCatalogModule {}
