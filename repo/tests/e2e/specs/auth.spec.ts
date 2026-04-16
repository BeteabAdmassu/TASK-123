/**
 * E2E: Authentication flows
 *
 * Tests login, logout, invalid credentials, form validation,
 * and redirect guards — all through the real Angular → nginx → Fastify → PostgreSQL path.
 */
import { test, expect } from '@playwright/test';

const VALID_ADMIN = { username: 'admin', password: 'admin' };
const VALID_RECRUITER = { username: 'recruiter', password: 'recruiter' };

async function fillLoginForm(page: any, username: string, password: string) {
  await page.fill('input[formcontrolname="username"]', username);
  await page.fill('input[formcontrolname="password"]', password);
}

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing session
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.removeItem('talentops_token');
      localStorage.removeItem('talentops_user');
    });
    await page.goto('/login');
  });

  test('renders the login form with username and password fields', async ({ page }) => {
    await expect(page.locator('input[formcontrolname="username"]')).toBeVisible();
    await expect(page.locator('input[formcontrolname="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('submit button is disabled when form is empty', async ({ page }) => {
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });

  test('submit button is disabled when only username is filled', async ({ page }) => {
    await page.fill('input[formcontrolname="username"]', 'admin');
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });

  test('submit button is disabled when only password is filled', async ({ page }) => {
    await page.fill('input[formcontrolname="password"]', 'admin');
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });

  test('submit button becomes enabled when both fields are filled', async ({ page }) => {
    await fillLoginForm(page, 'admin', 'admin');
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
  });

  test('shows error message for invalid credentials', async ({ page }) => {
    await fillLoginForm(page, 'admin', 'wrongpassword');
    await page.click('button[type="submit"]');
    await expect(page.locator('.error-message')).toBeVisible({ timeout: 10_000 });
    const errorText = await page.locator('.error-message').textContent();
    expect(errorText?.trim().length).toBeGreaterThan(0);
  });

  test('shows error for non-existent user', async ({ page }) => {
    await fillLoginForm(page, 'no-such-user', 'password');
    await page.click('button[type="submit"]');
    await expect(page.locator('.error-message')).toBeVisible({ timeout: 10_000 });
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    await fillLoginForm(page, VALID_ADMIN.username, VALID_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('dashboard shows app toolbar after login', async ({ page }) => {
    await fillLoginForm(page, VALID_ADMIN.username, VALID_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await expect(page.locator('mat-toolbar')).toBeVisible();
  });

  test('dashboard shows user menu button after login', async ({ page }) => {
    await fillLoginForm(page, VALID_ADMIN.username, VALID_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await expect(page.locator('.user-menu-btn')).toBeVisible();
  });
});

test.describe('Logout flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await fillLoginForm(page, VALID_ADMIN.username, VALID_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
  });

  test('logout clears session and redirects to login', async ({ page }) => {
    // Open user menu
    await page.click('.user-menu-btn');
    // Find and click logout button
    await page.getByRole('menuitem').filter({ hasText: /logout|sign out/i }).click();
    await page.waitForURL('**/login', { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  });

  test('after logout, token is removed from localStorage', async ({ page }) => {
    await page.click('.user-menu-btn');
    await page.getByRole('menuitem').filter({ hasText: /logout|sign out/i }).click();
    await page.waitForURL('**/login', { timeout: 10_000 });
    const token = await page.evaluate(() => localStorage.getItem('talentops_token'));
    expect(token).toBeNull();
  });

  test('accessing protected route after logout redirects to login', async ({ page }) => {
    await page.click('.user-menu-btn');
    await page.getByRole('menuitem').filter({ hasText: /logout|sign out/i }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    // Navigate directly to a protected route — auth guard must redirect to /login
    await page.goto('/dashboard');
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    expect(page.url()).toContain('/login');
  });
});

test.describe('Auth guards', () => {
  test('unauthenticated user accessing /dashboard is redirected to /login', async ({ page }) => {
    // Navigate to app first to get a valid origin, then wipe the session
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('talentops_token');
      localStorage.removeItem('talentops_user');
    });
    await page.goto('/dashboard');
    // Auth guard redirects to /login?returnUrl=... — use regex to match any /login URL
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    expect(page.url()).toContain('/login');
  });

  test('unauthenticated user accessing /recruiting is redirected to /login', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('talentops_token');
      localStorage.removeItem('talentops_user');
    });
    await page.goto('/recruiting');
    // Auth guard redirects to /login?returnUrl=... — use regex to match any /login URL
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    expect(page.url()).toContain('/login');
  });

  test('already-authenticated user visiting /login is redirected to /dashboard', async ({ page }) => {
    // First log in
    await page.goto('/login');
    await fillLoginForm(page, VALID_RECRUITER.username, VALID_RECRUITER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    // Now visit login again
    await page.goto('/login');
    await page.waitForURL('**/dashboard', { timeout: 10_000 });
    expect(page.url()).toContain('/dashboard');
  });
});
