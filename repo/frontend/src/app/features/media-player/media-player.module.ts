import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { MediaPlayerComponent } from './media-player.component';

const routes: Routes = [
  { path: '', component: MediaPlayerComponent },
  { path: ':id', component: MediaPlayerComponent }
];

@NgModule({
  declarations: [MediaPlayerComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
  exports: [MediaPlayerComponent]
})
export class MediaPlayerModule {}
