import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { NotificationsComponent } from './notifications.component';

@NgModule({
  declarations: [NotificationsComponent],
  imports: [SharedModule],
  exports: [NotificationsComponent]
})
export class NotificationsModule {}
