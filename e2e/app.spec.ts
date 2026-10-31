import { expect, test, type Page } from '@playwright/test';
import { fsWrites, installFakeTauri, ipcCalls } from './fakeTauri';

test.use({ colorScheme: 'light' });

async function openWorkspace(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open folder' }).click();
  await expect(page.getByRole('tree')).toBeVisible();
}

async function openContentView(page: Page) {
  const tree = page.getByRole('tree');
  await tree.getByRole('button', { name: 'Sources', exact: true }).click();
  await tree.getByRole('button', { name: 'Demo', exact: true }).click();
  await tree.getByRole('button', { name: 'ContentView.swift', exact: true }).click();
  await expect(page.getByRole('tab', { name: /ContentView\.swift/ })).toBeVisible();
}

test('plain browser shows banner and disables Open folder', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'Running in a plain browser' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open folder' })).toBeDisabled();
});

test.describe('with fake desktop backend', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeTauri(page);
  });

  test('open folder, browse tree, open a file', async ({ page }) => {
    await openWorkspace(page);
    const tree = page.getByRole('tree');
    await expect(tree.getByRole('button', { name: 'Sources', exact: true })).toBeVisible();
    await expect(tree.getByRole('button', { name: 'Package.swift', exact: true })).toBeVisible();
    await openContentView(page);
  });

  test('edit marks tab dirty and Ctrl+S saves', async ({ page }) => {
    await openWorkspace(page);
    await openContentView(page);

    const editor = page.locator('.monaco-editor').first();
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('let edited = 1');
    // Wait until Monaco has rendered the whole input; pressing Ctrl+S earlier would save a stale snapshot.
    await expect(page.locator('.view-lines').first()).toContainText(/let\s+edited\s*=\s*1/);

    const dirty = page.getByRole('tab', { name: /ContentView\.swift/ }).getByTitle('Unsaved changes');
    await expect(dirty).toBeVisible();

    await page.keyboard.press('Control+S');
    await expect(page.getByTitle('Unsaved changes')).toHaveCount(0);
    await expect
      .poll(async () => (await fsWrites(page)).some((w) => w.path === 'Sources/Demo/ContentView.swift' && w.content.includes('let edited = 1')))
      .toBe(true);
  });

  test('New file creates and opens the file', async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole('button', { name: 'New file' }).click();
    await page.getByLabel('New file path').fill('Sources/Demo/Extra.swift');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('tab', { name: /Extra\.swift/ })).toBeVisible();
    await expect
      .poll(async () => (await ipcCalls(page)).some((c) => c.cmd === 'create_file' && c.args?.path === 'Sources/Demo/Extra.swift'))
      .toBe(true);
  });

  test('command palette toggles the theme', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.keyboard.press('Control+Shift+P');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Type a command…').fill('theme');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });

  test('settings dialog switches to dark theme', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByLabel('Theme').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('App Store Readiness reports unverified rules without a score', async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole('button', { name: /^App Store Readiness/ }).click();
    const dialog = page.getByRole('dialog', { name: 'App Store Readiness' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Only Apple decides')).toBeVisible();

    await dialog.getByRole('button', { name: 'Run analysis' }).first().click();
    await expect(dialog.locator('.pp-status-NOT_VERIFIED').first()).toBeVisible();
    await expect(dialog.getByText('Unverified:', { exact: false }).first()).toBeVisible();

    const text = (await dialog.innerText()).replace(/Generated .*/, '');
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/\bscore\b/i);
  });
});

test('unavailable features are visibly disabled', async ({ page }) => {
  await installFakeTauri(page);
  await page.goto('/');
  for (const name of [/^Search/, /^Source Control/]) {
    const button = page.getByRole('button', { name });
    await expect(button).toBeDisabled();
    await expect(button).toContainText(/planned|M\d/);
  }
});
