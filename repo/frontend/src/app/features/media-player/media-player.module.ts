import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { MediaPlayerComponent } from './media-player.component';

@NgModule({
  declarations: [MediaPlayerComponent],
  imports: [SharedModule],
  exports: [MediaPlayerComponent]
})
export class MediaPlayerModule {}
