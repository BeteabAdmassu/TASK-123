import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ServiceCatalogComponent } from './service-catalog.component';

const routes: Routes = [
  { path: '', component: ServiceCatalogComponent }
];

@NgModule({
  declarations: [ServiceCatalogComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
  exports: [ServiceCatalogComponent]
})
export class ServiceCatalogModule {}
