import { test, expect } from '@playwright/test';

/**
 * E2E tests for the server-side directory picker (issue #1518).
 *
 * All tests mock the backend at the network level so they don't
 * require a live gitnexus server. The /api/fs/list endpoint is
 * intercepted to return controlled directory structures.
 */

const BACKEND_URL = 'http://localhost:4747';

/** Standard backend mocks needed to reach the analyze form. */
async function mockBackendForAnalyzeForm(page: import('@playwright/test').Page) {
  await page.route(`${BACKEND_URL}/api/repos`, (route) => route.fulfill({ json: [] }));
  await page.route(`${BACKEND_URL}/api/info`, (route) =>
    route.fulfill({ json: { version: '1.0.0', launchContext: 'npx', nodeVersion: 'v22.0.0' } }),
  );
  await page.route(`${BACKEND_URL}/api/heartbeat`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: ':ok\n\n',
    }),
  );
}

/** Navigate to the Local Folder tab in the analyze form. */
async function openLocalFolderTab(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Local Folder' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: 'Local Folder' }).click();
}

// ── Directory picker: open and display ────────────────────────────────────

test.describe('Directory picker — open and display', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackendForAnalyzeForm(page);

    await page.route(`${BACKEND_URL}/api/fs/list*`, (route) => {
      const url = new URL(route.request().url());
      const dir = url.searchParams.get('dir') ?? '/';

      if (dir === '/') {
        return route.fulfill({
          json: { entries: [{ name: 'workspace' }, { name: 'data' }, { name: 'home' }] },
        });
      }
      if (dir === '/workspace') {
        return route.fulfill({
          json: { entries: [{ name: 'my-project' }, { name: 'another-repo' }] },
        });
      }
      if (dir === '/workspace/my-project') {
        return route.fulfill({ json: { entries: [] } });
      }
      return route.fulfill({ json: { entries: [] } });
    });
  });

  test('clicking Browse opens the directory picker modal', async ({ page }, testInfo) => {
    await openLocalFolderTab(page);

    await page.locator('[data-testid="browse-server-dirs"]').click();

    await expect(page.locator('[data-testid="directory-picker-modal"]')).toBeVisible({
      timeout: 5_000,
    });
    await page.screenshot({ path: testInfo.outputPath('picker-open.png') });
  });

  test('picker shows root directories from /api/fs/list', async ({ page }) => {
    await openLocalFolderTab(page);
    await page.locator('[data-testid="browse-server-dirs"]').click();

    await expect(page.locator('[data-testid="dir-entry-workspace"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="dir-entry-data"]')).toBeVisible();
    await expect(page.locator('[data-testid="dir-entry-home"]')).toBeVisible();
  });

  test('current path shows / at root', async ({ page }) => {
    await openLocalFolderTab(page);
    await page.locator('[data-testid="browse-server-dirs"]').click();

    await expect(page.locator('[data-testid="directory-picker-path"]')).toHaveText('/');
  });
});

// ── Directory picker: navigation ──────────────────────────────────────────

test.describe('Directory picker — navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackendForAnalyzeForm(page);

    await page.route(`${BACKEND_URL}/api/fs/list*`, (route) => {
      const url = new URL(route.request().url());
      const dir = url.searchParams.get('dir') ?? '/';

      if (dir === '/') {
        return route.fulfill({
          json: { entries: [{ name: 'workspace' }, { name: 'data' }] },
        });
      }
      if (dir === '/workspace') {
        return route.fulfill({
          json: { entries: [{ name: 'my-project' }, { name: 'another-repo' }] },
        });
      }
      if (dir === '/workspace/my-project') {
        return route.fulfill({ json: { entries: [{ name: 'src' }] } });
      }
      return route.fulfill({ json: { entries: [] } });
    });
  });

  test('clicking a directory navigates into it', async ({ page }) => {
    await openLocalFolderTab(page);
    await page.locator('[data-testid="browse-server-dirs"]').click();

    await page.locator('[data-testid="dir-entry-workspace"]').click();

    await expect(page.locator('[data-testid="dir-entry-my-project"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="dir-entry-another-repo"]')).toBeVisible();
    await expect(page.locator('[data-testid="directory-picker-path"]')).toHaveText('/workspace');
  });

  test('breadcrumb shows path segments after navigation', async ({ page }) => {
    await openLocalFolderTab(page);
    await page.locator('[data-testid="browse-server-dirs"]').click();

    await page.locator('[data-testid="dir-entry-workspace"]').click();
    await expect(page.locator('[data-testid="dir-entry-my-project"]')).toBeVisible({
      timeout: 5_000,
    });

    // Breadcrumb should show "workspace" segment as a clickable button
    const modal = page.locator('[data-testid="directory-picker-modal"]');
    await expect(modal.getByRole('button', { name: 'workspace', exact: true })).toBeVisible();
  });

  test('clicking breadcrumb segment navigates back', async ({ page }) => {
    await openLocalFolderTab(page);
    await page.locator('[data-testid="browse-server-dirs"]').click();

    // Navigate: / → /workspace → /workspace/my-project
    await page.locator('[data-testid="dir-entry-workspace"]').click();
    await expect(page.locator('[data-testid="dir-entry-my-project"]')).toBeVisible({
      timeout: 5_000,
    });
    await page.locator('[data-testid="dir-entry-my-project"]').click();
    await expect(page.locator('[data-testid="directory-picker-path"]')).toHaveText(
      '/workspace/my-project',
      { timeout: 5_000 },
    );

    // Click breadcrumb "workspace" to go back to /workspace
    const modal = page.locator('[data-testid="directory-picker-modal"]');
    const breadcrumbSegments = modal.locator('button').filter({ hasText: 'workspace' });
    await breadcrumbSegments.first().click();

    await expect(page.locator('[data-testid="directory-picker-path"]')).toHaveText('/workspace', {
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="dir-entry-my-project"]')).toBeVisible();
  });

  test('home button navigates to root', async ({ page }) => {
    await openLocalFolderTab(page);
    await page.locator('[data-testid="browse-server-dirs"]').click();

    // Navigate into /workspace
    await page.locator('[data-testid="dir-entry-workspace"]').click();
    await expect(page.locator('[data-testid="directory-picker-path"]')).toHaveText('/workspace', {
      timeout: 5_000,
    });

    // Click home icon
    await page.locator('[data-testid="directory-picker-home"]').click();

    await expect(page.locator('[data-testid="directory-picker-path"]')).toHaveText('/', {
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="dir-entry-workspace"]')).toBeVisible();
  });
});

// ── Directory picker: selection ───────────────────────────────────────────

test.describe('Directory picker — selection', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackendForAnalyzeForm(page);

    await page.route(`${BACKEND_URL}/api/fs/list*`, (route) => {
      const url = new URL(route.request().url());
      const dir = url.searchParams.get('dir') ?? '/';

      if (dir === '/') {
        return route.fulfill({ json: { entries: [{ name: 'workspace' }] } });
      }
      if (dir === '/workspace') {
        return route.fulfill({ json: { entries: [{ name: 'my-project' }] } });
      }
      return route.fulfill({ json: { entries: [] } });
    });
  });

  test('selecting a folder populates the local path input', async ({ page }, testInfo) => {
    await openLocalFolderTab(page);
    await page.locator('[data-testid="browse-server-dirs"]').click();

    // Navigate to /workspace
    await page.locator('[data-testid="dir-entry-workspace"]').click();
    await expect(page.locator('[data-testid="directory-picker-path"]')).toHaveText('/workspace', {
      timeout: 5_000,
    });

    // Click "Select this folder"
    await page.locator('[data-testid="directory-picker-select"]').click();

    // Modal should close
    await expect(page.locator('[data-testid="directory-picker-modal"]')).not.toBeVisible();

    // The local path input should contain the selected path
    const pathInput = page.locator('input[type="text"]');
    await expect(pathInput).toHaveValue('/workspace');
    await page.screenshot({ path: testInfo.outputPath('path-populated.png') });
  });

  test('selected path is an absolute path', async ({ page }) => {
    await openLocalFolderTab(page);
    await page.locator('[data-testid="browse-server-dirs"]').click();

    await page.locator('[data-testid="dir-entry-workspace"]').click();
    await expect(page.locator('[data-testid="dir-entry-my-project"]')).toBeVisible({
      timeout: 5_000,
    });
    await page.locator('[data-testid="dir-entry-my-project"]').click();
    await expect(page.locator('[data-testid="directory-picker-path"]')).toHaveText(
      '/workspace/my-project',
      { timeout: 5_000 },
    );

    await page.locator('[data-testid="directory-picker-select"]').click();

    const pathInput = page.locator('input[type="text"]');
    await expect(pathInput).toHaveValue('/workspace/my-project');
  });

  test('closing the modal does not change the path input', async ({ page }) => {
    await openLocalFolderTab(page);

    // Type a path manually first
    const pathInput = page.locator('input[type="text"]');
    await pathInput.fill('/my/custom/path');

    // Open and close the picker without selecting
    await page.locator('[data-testid="browse-server-dirs"]').click();
    await expect(page.locator('[data-testid="directory-picker-modal"]')).toBeVisible({
      timeout: 5_000,
    });

    // Click the backdrop to close
    await page
      .locator('[data-testid="directory-picker-modal"]')
      .locator('..')
      .locator('div')
      .first()
      .click({ position: { x: 5, y: 5 }, force: true });

    // Path input should keep the original value
    await expect(pathInput).toHaveValue('/my/custom/path');
  });
});

// ── Directory picker: edge cases ──────────────────────────────────────────

test.describe('Directory picker — edge cases', () => {
  test('shows empty state for a directory with no subdirectories', async ({ page }) => {
    await mockBackendForAnalyzeForm(page);
    await page.route(`${BACKEND_URL}/api/fs/list*`, (route) =>
      route.fulfill({ json: { entries: [] } }),
    );

    await openLocalFolderTab(page);
    await page.locator('[data-testid="browse-server-dirs"]').click();

    const modal = page.locator('[data-testid="directory-picker-modal"]');
    await expect(modal.getByText('This directory is empty.')).toBeVisible({ timeout: 5_000 });
  });

  test('shows error when /api/fs/list fails', async ({ page }) => {
    await mockBackendForAnalyzeForm(page);
    await page.route(`${BACKEND_URL}/api/fs/list*`, (route) =>
      route.fulfill({ status: 500, json: { error: 'Internal server error' } }),
    );

    await openLocalFolderTab(page);
    await page.locator('[data-testid="browse-server-dirs"]').click();

    const modal = page.locator('[data-testid="directory-picker-modal"]');
    await expect(modal.locator('text=Go back')).toBeVisible({ timeout: 5_000 });
  });

  test('manual path typing still works without opening picker', async ({ page }) => {
    await mockBackendForAnalyzeForm(page);

    await openLocalFolderTab(page);

    // Type a path manually
    const pathInput = page.locator('input[type="text"]');
    await pathInput.fill('/workspace/my-repo');

    // The input should have the typed path
    await expect(pathInput).toHaveValue('/workspace/my-repo');

    // The Analyze button should be enabled
    const analyzeBtn = page.getByRole('button', { name: /Analyze Repository/ });
    await expect(analyzeBtn).toBeEnabled();
  });
});
