import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { ResumeEditorComponent } from './resume-editor.component';

@NgModule({
  declarations: [ResumeEditorComponent],
  imports: [SharedModule],
  exports: [ResumeEditorComponent]
})
export class ResumeModule {}
