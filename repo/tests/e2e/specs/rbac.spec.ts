/**
 * E2E: Role-based access control via the Angular UI
 *
 * Verifies that each role can reach the pages they should,
 * and are blocked (redirected or shown an error) for pages they should not.
 */
import { test, expect, Page } from '@playwright/test';

async function loginAs(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.removeItem('talentops_token');
    localStorage.removeItem('talentops_user');
  });
  await page.goto('/login');
  await page.fill('input[formcontrolname="username"]', username);
  await page.fill('input[formcontrolname="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
}

test.describe('Admin role', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', 'admin');
  });

  test('admin can access the dashboard', async ({ page }) => {
    expect(page.url()).toContain('/dashboard');
    await expect(page.locator('mat-toolbar')).toBeVisible();
  });

  test('admin can navigate to /admin page', async ({ page }) => {
    await page.goto('/admin');
    expect(page.url()).toContain('/admin');
    await expect(page.locator('mat-toolbar')).toBeVisible();
  });

  test('admin can navigate to /recruiting page', async ({ page }) => {
    await page.goto('/recruiting');
    expect(page.url()).toContain('/recruiting');
  });

  test('admin sees user menu with their name', async ({ page }) => {
    await expect(page.locator('.user-menu-btn')).toBeVisible();
    const userMenuText = await page.locator('.user-menu-btn').textContent();
    expect(userMenuText?.trim().length).toBeGreaterThan(0);
  });
});

test.describe('Recruiter role', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'recruiter', 'recruiter');
  });

  test('recruiter can access the dashboard', async ({ page }) => {
    expect(page.url()).toContain('/dashboard');
    await expect(page.locator('mat-toolbar')).toBeVisible();
  });

  test('recruiter can navigate to /recruiting page', async ({ page }) => {
    await page.goto('/recruiting');
    expect(page.url()).toContain('/recruiting');
    await expect(page.locator('mat-toolbar')).toBeVisible();
  });

  test('recruiter can navigate to /service-catalog page', async ({ page }) => {
    await page.goto('/service-catalog');
    expect(page.url()).toContain('/service-catalog');
  });

  test('sidenav shows recruiting nav item', async ({ page }) => {
    // Nav items are always present in the sidenav for authenticated users
    await expect(page.locator('.nav-item, a[routerlink="/recruiting"]').first()).toBeVisible();
  });
});

test.describe('Approver role', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'approver', 'approver');
  });

  test('approver can access the dashboard', async ({ page }) => {
    expect(page.url()).toContain('/dashboard');
    await expect(page.locator('mat-toolbar')).toBeVisible();
  });

  test('approver can access the approvals page', async ({ page }) => {
    await page.goto('/approvals');
    expect(page.url()).toContain('/approvals');
    await expect(page.locator('mat-toolbar')).toBeVisible();
  });

  test('approver cannot create a project (API returns 403)', async ({ page }) => {
    // Role enforcement is backend-only for this component; the create button is
    // always rendered. The backend must reject the POST /api/projects with 403.
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/projects') && resp.request().method() === 'POST',
      { timeout: 15_000 }
    );

    await page.goto('/recruiting');
    await page.waitForSelector('.loading-container', { state: 'hidden', timeout: 15_000 }).catch(() => {});

    // Create button must be visible (no frontend role hiding for this action)
    await expect(page.locator('.page-header button')).toBeVisible();
    await page.locator('.page-header button').click();

    // Backend must reject with 403 — not a 201 or silent ignore
    const resp = await responsePromise;
    expect(resp.status()).toBe(403);
  });
});

test.describe('Reviewer role', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'reviewer', 'reviewer');
  });

  test('reviewer can access the dashboard', async ({ page }) => {
    expect(page.url()).toContain('/dashboard');
    await expect(page.locator('mat-toolbar')).toBeVisible();
  });

  test('reviewer can access violations page', async ({ page }) => {
    await page.goto('/violations');
    expect(page.url()).toContain('/violations');
    await expect(page.locator('mat-toolbar')).toBeVisible();
  });
});

test.describe('Cross-role navigation', () => {
  test('sidenav navigation links are present for authenticated users', async ({ page }) => {
    await loginAs(page, 'recruiter', 'recruiter');
    // Check that at least the dashboard nav item is present
    const navItems = page.locator('.nav-item, a[routerlink]').filter({ hasText: /dashboard/i });
    await expect(navItems.first()).toBeVisible();
  });

  test('app toolbar is visible after login for all roles', async ({ page }) => {
    for (const [user, pass] of [['admin', 'admin'], ['recruiter', 'recruiter'], ['approver', 'approver']]) {
      await loginAs(page, user, pass);
      await expect(page.locator('mat-toolbar')).toBeVisible();
    }
  });
});
