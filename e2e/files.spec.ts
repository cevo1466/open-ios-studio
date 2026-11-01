import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri, ipcCalls } from './fakeTauri';

test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
test.setTimeout(90_000);

async function openWorkspace(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Klasör aç' }).first().click();
  await expect(page.getByRole('tree')).toBeVisible();
}

test.describe('file tree and binary files', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeTauri(page);
  });

  test('build artifacts and hidden folders are not in the default tree', async ({ page }) => {
    await openWorkspace(page);
    const tree = page.getByRole('tree');
    await expect(tree.getByRole('button', { name: 'Sources', exact: true })).toBeVisible();
    await expect(tree.getByRole('button', { name: 'Package.swift', exact: true })).toBeVisible();
    await expect(tree.getByRole('button', { name: 'xtool.yml', exact: true })).toBeVisible();
    await expect(tree.getByRole('button', { name: '.build', exact: true })).toHaveCount(0);
    await expect(tree.getByRole('button', { name: 'xtool', exact: true })).toHaveCount(0);
    await expect(tree.getByRole('button', { name: '.git', exact: true })).toHaveCount(0);
    await expect(tree.getByRole('button', { name: /^Build çıktıları/ })).toHaveAttribute('aria-expanded', 'false');
  });

  test('project files come first and the artifacts group expands on demand', async ({ page }) => {
    await openWorkspace(page);
    const rows = await page.locator('.tree > li > button.tree-row').allInnerTexts();
    expect(rows[0]).toContain('Package.swift');
    await page.getByRole('button', { name: /^Build çıktıları/ }).click();
    await expect(page.getByRole('button', { name: '.build', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'xtool', exact: true })).toBeVisible();
  });

  test('a .app package never opens in the text editor: an info card is shown', async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole('button', { name: /^Build çıktıları/ }).click();
    await page.getByRole('button', { name: 'xtool', exact: true }).click();
    // The package is one item: it has no expand arrow and is not expandable.
    const app = page.getByRole('button', { name: /Demo\.app/ });
    await app.click();
    await expect(page.getByRole('region', { name: 'Dosya bilgisi' })).toBeVisible();
    await expect(page.getByText('Uygulama paketi', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.monaco-editor')).toHaveCount(0);
    expect((await ipcCalls(page)).some((c) => c.cmd === 'read_file' && String(c.args?.path).includes('.app'))).toBe(false);
  });

  test('card actions call the file manager and expand the artifacts group', async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole('button', { name: /^Build çıktıları/ }).click();
    await page.getByRole('button', { name: 'xtool', exact: true }).click();
    await page.getByRole('button', { name: /Demo\.app/ }).click();
    await page.getByRole('button', { name: 'Dosya yöneticisinde aç' }).click();
    await page.getByRole('button', { name: 'Bulunduğu klasörü göster' }).click();
    const reveals = (await ipcCalls(page)).filter((c) => c.cmd === 'reveal_path');
    expect(reveals.map((c) => c.args?.parent)).toEqual([false, true]);
    expect(reveals[0].args?.path).toBe('xtool/Demo.app');
    await page.getByRole('button', { name: 'Kapat', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Dosya bilgisi' })).toHaveCount(0);
  });

  test('source files still open in the editor', async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole('button', { name: 'Package.swift', exact: true }).click();
    await expect(page.getByRole('tab', { name: /Package\.swift/ })).toBeVisible();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
  });
});
