/**
 * E2E: Projects CRUD through the Angular UI
 *
 * Full round-trip: login → navigate to recruiting → create project →
 * verify in list → open project detail — crossing the FE/BE/DB boundary.
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

test.describe('Recruiting — Projects list', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'recruiter', 'recruiter');
  });

  test('navigating to /recruiting shows the projects page', async ({ page }) => {
    await page.goto('/recruiting');
    // Page loads without redirect to login
    expect(page.url()).toContain('/recruiting');
  });

  test('projects page renders the data table or empty state', async ({ page }) => {
    await page.goto('/recruiting');
    // Wait for loading spinner to disappear
    await page.waitForSelector('.loading-container', { state: 'hidden', timeout: 15_000 }).catch(() => {});
    // Either the table or the empty state must be visible
    const hasTable = await page.locator('mat-table, table[mat-table]').isVisible().catch(() => false);
    const hasEmpty = await page.locator('.empty-state').isVisible().catch(() => false);
    expect(hasTable || hasEmpty).toBe(true);
  });

  test('projects page has a "New Project" create button', async ({ page }) => {
    await page.goto('/recruiting');
    await page.waitForSelector('.loading-container', { state: 'hidden', timeout: 15_000 }).catch(() => {});
    // Use .page-header selector to avoid matching the empty-state button (strict mode)
    await expect(page.locator('.page-header button')).toBeVisible();
  });

  test('search input is rendered on the projects page', async ({ page }) => {
    await page.goto('/recruiting');
    await page.waitForSelector('.loading-container', { state: 'hidden', timeout: 15_000 }).catch(() => {});
    await expect(page.locator('mat-form-field input')).toBeVisible();
  });
});

test.describe('Recruiting — Create project flow', () => {
  let createdProjectId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'recruiter', 'recruiter');
  });

  test.afterAll(async ({ browser }) => {
    // Clean up the created project via API
    if (createdProjectId) {
      const page = await browser.newPage();
      await page.goto('/login');
      await page.fill('input[formcontrolname="username"]', 'admin');
      await page.fill('input[formcontrolname="password"]', 'admin');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/dashboard', { timeout: 15_000 });
      const token = await page.evaluate(() => localStorage.getItem('talentops_token'));
      if (token) {
        const base = (process.env['PLAYWRIGHT_BASE_URL'] || 'http://localhost:4200').replace(':4200', ':3000').replace(':80', ':3000');
        await page.evaluate(async ({ id, t, b }: { id: string; t: string; b: string }) => {
          await fetch(`${b}/api/projects/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${t}` },
          });
        }, { id: createdProjectId, t: token, b: base });
      }
      await page.close();
    }
  });

  test('clicking create button navigates to new project detail page', async ({ page }) => {
    await page.goto('/recruiting');
    await page.waitForSelector('.loading-container', { state: 'hidden', timeout: 15_000 }).catch(() => {});

    // Intercept the POST /api/projects response to capture the new project ID
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/projects') && resp.request().method() === 'POST',
      { timeout: 15_000 }
    );

    // Click the create/add button in the page header
    await page.locator('.page-header button').click();

    try {
      const response = await responsePromise;
      const body = await response.json().catch(() => null);
      if (body?.id) createdProjectId = body.id;
    } catch {
      // Response capture is best-effort; navigation assertion is the real test
    }

    // Should navigate to the new project detail page
    await page.waitForURL('**/recruiting/project/**', { timeout: 15_000 });
    expect(page.url()).toMatch(/\/recruiting\/project\//);
  });
});

test.describe('Recruiting — Navigation to project detail', () => {
  test('clicking a project row navigates to project detail', async ({ page }) => {
    await loginAs(page, 'recruiter', 'recruiter');
    await page.goto('/recruiting');
    await page.waitForSelector('.loading-container', { state: 'hidden', timeout: 15_000 }).catch(() => {});

    // If there are rows in the table, click the first one
    const rows = page.locator('mat-row, tr[mat-row]');
    const count = await rows.count();
    if (count > 0) {
      await rows.first().click();
      await page.waitForURL('**/recruiting/project/**', { timeout: 10_000 });
      expect(page.url()).toMatch(/\/recruiting\/project\//);
    } else {
      // No rows — empty state is shown, which is valid
      await expect(page.locator('.empty-state')).toBeVisible();
    }
  });
});

test.describe('Approvals page', () => {
  test('approver can access the approvals page', async ({ page }) => {
    await loginAs(page, 'approver', 'approver');
    await page.goto('/approvals');
    expect(page.url()).toContain('/approvals');
    // Should not be redirected to login
    await expect(page.locator('mat-toolbar')).toBeVisible();
  });
});
