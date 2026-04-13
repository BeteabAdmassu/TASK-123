import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';

import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';

import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { CoreModule } from './core/core.module';
import { SharedModule } from './shared/shared.module';

import { DashboardModule } from './features/dashboard/dashboard.module';
import { RecruitingModule } from './features/recruiting/recruiting.module';
import { CandidateDetailModule } from './features/candidate-detail/candidate-detail.module';
import { ResumeModule } from './features/resume/resume.module';
import { ViolationsModule } from './features/violations/violations.module';
import { ServiceCatalogModule } from './features/service-catalog/service-catalog.module';
import { ApprovalsModule } from './features/approvals/approvals.module';
import { NotificationsModule } from './features/notifications/notifications.module';
import { GeospatialModule } from './features/geospatial/geospatial.module';
import { MediaPlayerModule } from './features/media-player/media-player.module';
import { AdminModule } from './features/admin/admin.module';

export function HttpLoaderFactory(http: HttpClient): TranslateHttpLoader {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    ReactiveFormsModule,
    FormsModule,
    TranslateModule.forRoot({
      defaultLanguage: 'en',
      loader: {
        provide: TranslateLoader,
        useFactory: HttpLoaderFactory,
        deps: [HttpClient]
      }
    }),
    MatToolbarModule,
    MatSidenavModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatBadgeModule,
    MatSnackBarModule,
    CoreModule,
    SharedModule,
    DashboardModule,
    RecruitingModule,
    CandidateDetailModule,
    ResumeModule,
    ViolationsModule,
    ServiceCatalogModule,
    ApprovalsModule,
    NotificationsModule,
    GeospatialModule,
    MediaPlayerModule,
    AdminModule,
    AppRoutingModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule {}
