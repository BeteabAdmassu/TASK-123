import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ResumeEditorComponent } from './resume-editor.component';

const routes: Routes = [
  { path: ':candidateId', component: ResumeEditorComponent },
  { path: ':candidateId/:resumeId', component: ResumeEditorComponent }
];

@NgModule({
  declarations: [ResumeEditorComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
  exports: [ResumeEditorComponent]
})
export class ResumeModule {}
