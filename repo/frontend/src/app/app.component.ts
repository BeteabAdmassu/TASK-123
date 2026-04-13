import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Subject, takeUntil } from 'rxjs';

import { AuthService } from './core/auth/auth.service';
import { ApiService } from './core/services/api.service';
import { CheckpointService } from './core/services/checkpoint.service';
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

  /** Emits when Alt+N is pressed; feature components subscribe to navigate to the next record */
  nextRecord$ = new BehaviorSubject<number>(0);

  /** Quick search state (Ctrl+K) */
  showSearchDialog = false;
  searchQuery = '';
  searchResults: { candidates: any[]; projects: any[]; postings: any[]; services: any[] } | null = null;
  searchLoading = false;

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
    private api: ApiService,
    private checkpointService: CheckpointService,
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
        if (user) {
          this.checkpointService.startAutoSave();
        } else {
          this.checkpointService.stopAutoSave();
        }
      });

    if (this.authService.isLoggedIn()) {
      this.checkpointService.tryRestore();
    }

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

    this.keyboardService.nextRecordTriggered$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.nextRecord$.next(this.nextRecord$.value + 1);
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
    this.showSearchDialog = true;
    this.searchQuery = '';
    this.searchResults = null;
  }

  onSearchClose(): void {
    this.showSearchDialog = false;
    this.searchQuery = '';
    this.searchResults = null;
  }

  onSearchSubmit(): void {
    if (!this.searchQuery.trim()) return;
    this.searchLoading = true;
    this.api.get<{ results: typeof this.searchResults }>('/search', { q: this.searchQuery.trim() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => { this.searchResults = res.results || null; this.searchLoading = false; },
        error: () => { this.searchResults = null; this.searchLoading = false; }
      });
  }

  navigateFromSearch(type: string, id: string): void {
    this.onSearchClose();
    switch (type) {
      case 'candidate': this.router.navigate(['/candidates', id]); break;
      case 'project': this.router.navigate(['/recruiting/project', id]); break;
      case 'posting': this.router.navigate(['/recruiting/posting', id]); break;
      case 'service': this.router.navigate(['/service-catalog']); break;
    }
  }

  logout(): void {
    this.checkpointService.stopAutoSave();
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }
}
