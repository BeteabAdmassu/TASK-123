import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { ApiService, PaginatedResponse } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';

/** Shape of window.electronAPI.updater (from preload.ts) */
interface ElectronUpdaterApi {
  check(): Promise<{ available: boolean; currentVersion?: string; availableVersion?: string }>;
  apply(): Promise<{ success: boolean }>;
  rollback(): Promise<{ success: boolean; error?: string }>;
  hasRollback(): Promise<{ available: boolean }>;
}

function getElectronUpdater(): ElectronUpdaterApi | null {
  try {
    const api = (window as Record<string, unknown>)['electronAPI'] as
      { updater?: ElectronUpdaterApi } | undefined;
    return api?.updater ?? null;
  } catch {
    return null;
  }
}

interface User {
  id: string;
  username: string;
  role: string;
  locale: string;
  force_password_change: boolean;
  created_at: string;
  updated_at: string;
}

interface ViolationRule {
  id: string;
  rule_type: string;
  rule_config: Record<string, unknown>;
  severity: string;
  is_active: boolean;
  created_at: string;
}

interface ApprovalTemplate {
  id: string;
  name: string;
  description: string | null;
  approval_mode: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
}

interface NotificationTemplate {
  id: string;
  template_key: string;
  subject: string;
  body: string;
  channel: string;
  is_active: boolean;
  created_at: string;
}

@Component({
  selector: 'app-admin',
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss']
})
export class AdminComponent implements OnInit, OnDestroy {
  activeTab = 0;
  isAdmin = false;

  // Users
  users: User[] = [];
  usersLoading = false;
  usersError = '';
  userForm!: FormGroup;
  showUserForm = false;
  editingUser: User | null = null;
  isSavingUser = false;
  roleOptions = ['admin', 'recruiter', 'reviewer', 'approver'];

  // Violation Rules
  violationRules: ViolationRule[] = [];
  rulesLoading = false;
  ruleForm!: FormGroup;
  showRuleForm = false;
  editingRule: ViolationRule | null = null;
  isSavingRule = false;
  ruleTypes = ['prohibited_phrase', 'missing_field', 'duplicate_pattern', 'custom'];
  severityOptions = ['warning', 'error', 'critical'];

  // Approval Templates
  approvalTemplates: ApprovalTemplate[] = [];
  templatesLoading = false;
  templateForm!: FormGroup;
  showTemplateForm = false;
  isSavingTemplate = false;
  approverUsers: Array<{ id: string; username: string }> = [];

  // Notification Templates
  notifTemplates: NotificationTemplate[] = [];
  notifLoading = false;
  notifForm!: FormGroup;
  showNotifForm = false;
  isSavingNotif = false;
  channelOptions = ['in_app', 'email_export', 'sms_export'];

  // System Updater
  isElectron = false;
  updaterChecking = false;
  updaterApplying = false;
  updaterRollingBack = false;
  updateAvailable = false;
  rollbackAvailable = false;
  currentVersion = '';
  availableVersion = '';
  updaterError = '';
  updaterSuccess = '';

  private destroy$ = new Subject<void>();

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private router: Router,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.auth.getUser().pipe(takeUntil(this.destroy$)).subscribe(user => {
      this.isAdmin = user?.role === 'admin';
      if (!this.isAdmin) {
        this.snackBar.open('Admin access required', 'Close', { duration: 3000 });
        this.router.navigate(['/dashboard']);
      }
    });

    this.userForm = this.fb.group({
      username: ['', [Validators.required, Validators.maxLength(255)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      role: ['recruiter', Validators.required],
      locale: ['en']
    });

    this.ruleForm = this.fb.group({
      rule_type: ['prohibited_phrase', Validators.required],
      rule_config: ['{}'],
      severity: ['warning', Validators.required],
      is_active: [true]
    });

    this.templateForm = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      approval_mode: ['joint', Validators.required],
      step_approver_id: ['', Validators.required]
    });

    this.notifForm = this.fb.group({
      template_key: ['', Validators.required],
      subject: ['', Validators.required],
      body: ['', Validators.required],
      channel: ['in_app', Validators.required],
      is_active: [true]
    });

    this.loadUsers();
    this.loadViolationRules();
    this.loadApprovalTemplates();
    this.loadApproverUsers();
    this.loadNotificationTemplates();
    this.initUpdater();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onTabChange(index: number): void {
    this.activeTab = index;
  }

  // ===== Users =====
  loadUsers(): void {
    this.usersLoading = true;
    this.usersError = '';

    this.api.get<PaginatedResponse<User>>('/users', { page: 1, pageSize: 100 }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res) => {
        this.users = res.data || [];
        this.usersLoading = false;
      },
      error: () => {
        this.usersError = 'Failed to load users.';
        this.usersLoading = false;
      }
    });
  }

  openUserForm(user?: User): void {
    this.editingUser = user || null;
    this.showUserForm = true;

    if (user) {
      this.userForm.patchValue({
        username: user.username,
        role: user.role,
        locale: user.locale
      });
      this.userForm.get('password')!.clearValidators();
      this.userForm.get('password')!.updateValueAndValidity();
    } else {
      this.userForm.reset({ role: 'recruiter', locale: 'en' });
      this.userForm.get('password')!.setValidators([Validators.required, Validators.minLength(6)]);
      this.userForm.get('password')!.updateValueAndValidity();
    }
  }

  saveUser(): void {
    if (this.userForm.invalid) return;
    this.isSavingUser = true;

    if (this.editingUser) {
      const body: Record<string, unknown> = {
        role: this.userForm.value.role,
        locale: this.userForm.value.locale
      };

      this.api.put(`/users/${this.editingUser.id}`, body).pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: () => {
          this.isSavingUser = false;
          this.showUserForm = false;
          this.editingUser = null;
          this.snackBar.open('User updated', 'Close', { duration: 3000 });
          this.loadUsers();
        },
        error: () => {
          this.isSavingUser = false;
          this.snackBar.open('Failed to update user', 'Close', { duration: 3000 });
        }
      });
    } else {
      this.api.post('/users', this.userForm.value).pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: () => {
          this.isSavingUser = false;
          this.showUserForm = false;
          this.snackBar.open('User created', 'Close', { duration: 3000 });
          this.loadUsers();
        },
        error: (err) => {
          this.isSavingUser = false;
          const msg = err.error?.message || 'Failed to create user';
          this.snackBar.open(msg, 'Close', { duration: 3000 });
        }
      });
    }
  }

  deleteUser(user: User): void {
    if (!confirm(`Delete user "${user.username}"?`)) return;

    this.api.delete(`/users/${user.id}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.snackBar.open('User deleted', 'Close', { duration: 3000 });
        this.loadUsers();
      },
      error: () => {
        this.snackBar.open('Failed to delete user', 'Close', { duration: 3000 });
      }
    });
  }

  // ===== Violation Rules =====
  loadViolationRules(): void {
    this.rulesLoading = true;
    this.api.get<{ data: ViolationRule[] } | ViolationRule[]>('/violations/rules').pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (rules: any) => {
        const arr = rules?.data || rules;
        this.violationRules = Array.isArray(arr) ? arr : [];
        this.rulesLoading = false;
      },
      error: () => {
        this.violationRules = [];
        this.rulesLoading = false;
      }
    });
  }

  openRuleForm(rule?: ViolationRule): void {
    this.editingRule = rule || null;
    this.showRuleForm = true;

    if (rule) {
      this.ruleForm.patchValue({
        rule_type: rule.rule_type,
        rule_config: JSON.stringify(rule.rule_config),
        severity: rule.severity,
        is_active: rule.is_active
      });
    } else {
      this.ruleForm.reset({
        rule_type: 'prohibited_phrase',
        rule_config: '{}',
        severity: 'warning',
        is_active: true
      });
    }
  }

  saveRule(): void {
    if (this.ruleForm.invalid) return;
    this.isSavingRule = true;

    let ruleConfig: Record<string, unknown> = {};
    try {
      ruleConfig = JSON.parse(this.ruleForm.value.rule_config);
    } catch {
      this.snackBar.open('Invalid JSON in rule config', 'Close', { duration: 3000 });
      this.isSavingRule = false;
      return;
    }

    const body = {
      ...this.ruleForm.value,
      rule_config: ruleConfig
    };

    const request = this.editingRule
      ? this.api.put(`/violations/rules/${this.editingRule.id}`, body)
      : this.api.post('/violations/rules', body);

    request.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.isSavingRule = false;
        this.showRuleForm = false;
        this.editingRule = null;
        this.snackBar.open('Rule saved', 'Close', { duration: 3000 });
        this.loadViolationRules();
      },
      error: () => {
        this.isSavingRule = false;
        this.snackBar.open('Failed to save rule', 'Close', { duration: 3000 });
      }
    });
  }

  deleteRule(rule: ViolationRule): void {
    if (!confirm('Delete this violation rule?')) return;
    this.api.delete(`/violations/rules/${rule.id}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.snackBar.open('Rule deleted', 'Close', { duration: 3000 });
        this.loadViolationRules();
      },
      error: () => {
        this.snackBar.open('Failed to delete rule', 'Close', { duration: 3000 });
      }
    });
  }

  // ===== Approval Templates =====
  loadApprovalTemplates(): void {
    this.templatesLoading = true;
    this.api.get<PaginatedResponse<ApprovalTemplate>>('/approval-templates', {
      page: 1, pageSize: 100
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.approvalTemplates = res.data || [];
        this.templatesLoading = false;
      },
      error: () => {
        this.approvalTemplates = [];
        this.templatesLoading = false;
      }
    });
  }

  saveApprovalTemplate(): void {
    if (this.templateForm.invalid) return;
    this.isSavingTemplate = true;

    const formVal = this.templateForm.value;
    // Build backend-compliant payload with required `steps` array
    const payload = {
      name: formVal.name,
      description: formVal.description || undefined,
      approval_mode: formVal.approval_mode,
      steps: [
        { step_order: 1, approver_id: formVal.step_approver_id }
      ]
    };

    this.api.post('/approval-templates', payload).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.isSavingTemplate = false;
        this.showTemplateForm = false;
        this.templateForm.reset({ approval_mode: 'joint', step_approver_id: '' });
        this.snackBar.open('Template created', 'Close', { duration: 3000 });
        this.loadApprovalTemplates();
      },
      error: () => {
        this.isSavingTemplate = false;
        this.snackBar.open('Failed to create template', 'Close', { duration: 3000 });
      }
    });
  }

  loadApproverUsers(): void {
    this.api.get<{ data: Array<{ id: string; username: string; role: string }> }>('/users').pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res) => {
        const users = res?.data || (Array.isArray(res) ? res : []);
        this.approverUsers = users.filter((u: { role: string }) => u.role === 'approver' || u.role === 'admin');
      },
      error: () => { this.approverUsers = []; }
    });
  }

  deleteApprovalTemplate(template: ApprovalTemplate): void {
    if (!confirm(`Delete template "${template.name}"?`)) return;
    this.api.delete(`/approval-templates/${template.id}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.snackBar.open('Template deleted', 'Close', { duration: 3000 });
        this.loadApprovalTemplates();
      },
      error: () => {
        this.snackBar.open('Failed to delete template', 'Close', { duration: 3000 });
      }
    });
  }

  // ===== Notification Templates =====
  loadNotificationTemplates(): void {
    this.notifLoading = true;
    this.api.get<PaginatedResponse<NotificationTemplate>>('/notification-templates', {
      page: 1, pageSize: 100
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.notifTemplates = res.data || [];
        this.notifLoading = false;
      },
      error: () => {
        this.notifTemplates = [];
        this.notifLoading = false;
      }
    });
  }

  saveNotifTemplate(): void {
    if (this.notifForm.invalid) return;
    this.isSavingNotif = true;

    this.api.post('/notification-templates', this.notifForm.value).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.isSavingNotif = false;
        this.showNotifForm = false;
        this.notifForm.reset({ channel: 'in_app', is_active: true });
        this.snackBar.open('Template created', 'Close', { duration: 3000 });
        this.loadNotificationTemplates();
      },
      error: () => {
        this.isSavingNotif = false;
        this.snackBar.open('Failed to create template', 'Close', { duration: 3000 });
      }
    });
  }

  deleteNotifTemplate(tmpl: NotificationTemplate): void {
    if (!confirm(`Delete notification template "${tmpl.template_key}"?`)) return;
    this.api.delete(`/notification-templates/${tmpl.id}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.snackBar.open('Template deleted', 'Close', { duration: 3000 });
        this.loadNotificationTemplates();
      },
      error: () => {
        this.snackBar.open('Failed to delete template', 'Close', { duration: 3000 });
      }
    });
  }

  // ===== System Updater =====

  private initUpdater(): void {
    this.isElectron = !!getElectronUpdater();
    if (this.isElectron) {
      this.checkRollbackAvailability();
    }
  }

  async checkForUpdate(): Promise<void> {
    const updater = getElectronUpdater();
    if (!updater) return;

    this.updaterChecking = true;
    this.updaterError = '';
    this.updaterSuccess = '';

    try {
      const result = await updater.check();
      this.updateAvailable = result.available;
      this.currentVersion = result.currentVersion || '';
      this.availableVersion = result.availableVersion || '';
      if (!result.available) {
        this.updaterSuccess = this.translate.instant('ADMIN.UPDATE_UP_TO_DATE');
      }
    } catch {
      this.updaterError = this.translate.instant('ADMIN.UPDATE_CHECK_FAILED');
    } finally {
      this.updaterChecking = false;
    }
  }

  async applyUpdate(): Promise<void> {
    const updater = getElectronUpdater();
    if (!updater) return;

    this.updaterApplying = true;
    this.updaterError = '';

    try {
      await updater.apply();
      // App will restart — this line may not execute
    } catch {
      this.updaterError = this.translate.instant('ADMIN.UPDATE_APPLY_FAILED');
      this.updaterApplying = false;
    }
  }

  async rollbackUpdate(): Promise<void> {
    const updater = getElectronUpdater();
    if (!updater) return;

    this.updaterRollingBack = true;
    this.updaterError = '';

    try {
      const result = await updater.rollback();
      if (!result.success) {
        this.updaterError = result.error || this.translate.instant('ADMIN.ROLLBACK_FAILED');
        this.updaterRollingBack = false;
      }
      // On success the app restarts
    } catch {
      this.updaterError = this.translate.instant('ADMIN.ROLLBACK_FAILED');
      this.updaterRollingBack = false;
    }
  }

  async checkRollbackAvailability(): Promise<void> {
    const updater = getElectronUpdater();
    if (!updater) return;

    try {
      const result = await updater.hasRollback();
      this.rollbackAvailable = result.available;
    } catch {
      this.rollbackAvailable = false;
    }
  }
}
