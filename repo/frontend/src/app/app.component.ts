import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';

import { AuthService } from './core/auth/auth.service';
import { KeyboardService } from './core/services/keyboard.service';
import { NotificationBadgeService } from './core/services/notification-badge.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'TalentOps';
  pendingCount = 0;
  currentLang = 'en';
  userName = '';
  isSidenavOpen = true;

  navItems = [
    { label: 'NAV.DASHBOARD', route: '/dashboard', icon: 'dashboard' },
    { label: 'NAV.RECRUITING', route: '/recruiting', icon: 'work' },
    { label: 'NAV.SERVICE_CATALOG', route: '/service-catalog', icon: 'category' },
    { label: 'NAV.APPROVALS', route: '/approvals', icon: 'thumb_up' },
    { label: 'NAV.VIOLATIONS', route: '/violations', icon: 'gavel' },
    { label: 'NAV.NOTIFICATIONS', route: '/notifications', icon: 'notifications' },
    { label: 'NAV.ADMIN', route: '/admin', icon: 'admin_panel_settings' }
  ];

  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private keyboardService: KeyboardService,
    private notificationBadgeService: NotificationBadgeService,
    private translate: TranslateService,
    private router: Router
  ) {
    this.translate.setDefaultLang('en');
    this.translate.use('en');
  }

  ngOnInit(): void {
    this.notificationBadgeService.pendingCount$
      .pipe(takeUntil(this.destroy$))
      .subscribe(count => {
        this.pendingCount = count;
      });

    this.authService.getUser()
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.userName = user ? user.name || user.username : '';
      });

    this.keyboardService.searchTriggered$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.onSearchOpen();
      });

    this.keyboardService.saveTriggered$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        // Save event propagated through keyboard service
      });

    this.keyboardService.notificationTriggered$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.router.navigate(['/notifications']);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    this.keyboardService.handleKeydown(event);
  }

  toggleSidenav(): void {
    this.isSidenavOpen = !this.isSidenavOpen;
  }

  toggleLanguage(): void {
    this.currentLang = this.currentLang === 'en' ? 'es' : 'en';
    this.translate.use(this.currentLang);
  }

  onSearchOpen(): void {
    // Search dialog would be opened here by a search component
  }

  logout(): void {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }
}
