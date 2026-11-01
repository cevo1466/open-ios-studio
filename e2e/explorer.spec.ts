import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fakeTauri';

test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
test.setTimeout(90_000);

async function openWorkspace(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Klasör aç' }).first().click();
  await expect(page.getByRole('tree')).toBeVisible();
}

test.describe('Dosyalar panel', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeTauri(page);
  });

  test('names the open project folder and shows its path', async ({ page }) => {
    await openWorkspace(page);
    const head = page.locator('.files-head');
    await expect(head.getByText('Açık proje klasörü')).toBeVisible();
    await expect(head.locator('.files-project strong')).not.toBeEmpty();
    await expect(head.locator('.files-project-path')).not.toBeEmpty();
  });

  test('explains what the well-known project entries are for', async ({ page }) => {
    await openWorkspace(page);
    const tree = page.getByRole('tree');
    await expect(tree.locator('.tree-row', { hasText: 'Package.swift' }).locator('.tree-note-inline')).toHaveText('paket tanımı');
    await expect(tree.locator('.tree-row', { hasText: 'Sources' }).locator('.tree-note-inline')).toHaveText('kodlarınız');
    await expect(tree.getByRole('button', { name: /^Sources/ })).toHaveAttribute('title', /Kaynak kodlarınız/);
  });

  test('hidden dot-files live in a "Gizli dosyalar" group, collapsed by default', async ({ page }) => {
    await openWorkspace(page);
    const group = page.getByRole('button', { name: /^Gizli dosyalar/ });
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: '.git', exact: true })).toHaveCount(0);
    await group.click();
    await expect(page.getByRole('button', { name: '.git', exact: true })).toBeVisible();
  });

  test('"Tüm klasörleri daralt" closes every open folder', async ({ page }) => {
    await openWorkspace(page);
    const sources = page.getByRole('treeitem', { name: /^Sources/ }).first();
    await sources.getByRole('button', { name: /^Sources/ }).first().click();
    await expect(sources).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Tüm klasörleri daralt' }).click();
    await expect(sources).toHaveAttribute('aria-expanded', 'false');
  });

  test('refresh reloads the listing', async ({ page }) => {
    await openWorkspace(page);
    const before = (await page.evaluate(() => (window as unknown as { __ipcCalls: { cmd: string }[] }).__ipcCalls)).filter((c) => c.cmd === 'list_dir').length;
    await page.getByRole('button', { name: 'Dosya listesini yenile' }).click();
    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as { __ipcCalls: { cmd: string }[] }).__ipcCalls)).filter((c) => c.cmd === 'list_dir').length)
      .toBeGreaterThan(before);
  });
});

test.describe('colour themes', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeTauri(page);
  });

  test('picking a theme applies its colours and survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Ayarlar' });
    await expect(dialog.locator('.theme-card')).toHaveCount(6);
    await dialog.getByRole('button', { name: 'Tema: Monokai' }).click();
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-palette', 'monokai');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(39, 40, 34)');
    await page.reload();
    await expect(html).toHaveAttribute('data-palette', 'monokai');

    await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
    await page.getByRole('dialog', { name: 'Ayarlar' }).getByRole('button', { name: 'Tema: Solarized açık' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(253, 246, 227)');

    // Back to a stylesheet default: no leftover variables from the previous theme.
    await page.getByRole('dialog', { name: 'Ayarlar' }).getByRole('button', { name: 'Tema: Açık' }).click();
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--bg'))).toBe('');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
  });
});
