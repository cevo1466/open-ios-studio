import { expect, test, type Page } from '@playwright/test';
import { fsWrites, installFakeTauri, ipcCalls } from './fakeTauri';

test.use({ colorScheme: 'light' });
// Monaco and the fake backend are slow on small machines.
test.setTimeout(90_000);

async function openWorkspace(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Klasör aç' }).first().click();
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
  await expect(page.getByRole('alert').filter({ hasText: 'Tarayıcıda çalışıyor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Klasör aç' }).first()).toBeDisabled();
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

    const dirty = page.getByRole('tab', { name: /ContentView\.swift/ }).getByTitle('Kaydedilmemiş değişiklikler');
    await expect(dirty).toBeVisible();

    await page.keyboard.press('Control+S');
    await expect(page.getByTitle('Kaydedilmemiş değişiklikler')).toHaveCount(0);
    await expect
      .poll(async () => (await fsWrites(page)).some((w) => w.path === 'Sources/Demo/ContentView.swift' && w.content.includes('let edited = 1')))
      .toBe(true);
  });

  test('New file creates and opens the file', async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole('button', { name: 'Yeni dosya' }).first().click();
    await page.getByLabel('Yeni dosya yolu').fill('Sources/Demo/Extra.swift');
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
    const dialog = page.getByRole('dialog', { name: 'Komut paleti' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Komut ara…').fill('tema');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });

  test('settings dialog switches to dark theme', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Ayarlar' });
    await dialog.getByLabel('Tema').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('App Store Readiness reports unverified rules without a score', async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole('button', { name: /^App Store hazırlığı/ }).click();
    const dialog = page.getByRole('dialog', { name: 'App Store Hazırlığı' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('yalnızca Apple karar verir')).toBeVisible();

    await dialog.getByRole('button', { name: 'Analizi çalıştır' }).first().click();
    await expect(dialog.locator('.pp-status-NOT_VERIFIED').first()).toBeVisible();
    await expect(dialog.locator('.pp-unverified').first()).toBeVisible();

    const text = (await dialog.innerText()).replace(/Oluşturulma: .*/, '');
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/\bscore\b/i);
  });
});

test('welcome guide is shown and has no disabled placeholder sections', async ({ page }) => {
  await installFakeTauri(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Open iOS Studio', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Search|^Source Control/ })).toHaveCount(0);
});

test('closing a dirty window asks first and can be cancelled', async ({ page }) => {
  await installFakeTauri(page);
  await openWorkspace(page);
  await openContentView(page);
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('let z = 1');
  await expect(page.locator('.view-lines').first()).toContainText(/let\s+z\s*=\s*1/);
  await expect(page.getByTitle('Kaydedilmemiş değişiklikler').first()).toBeVisible();
  await page.evaluate(() => (window as unknown as { __requestClose: () => void }).__requestClose());
  const dialog = page.getByRole('alertdialog', { name: 'Kaydedilmemiş değişiklikler' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(dialog).toHaveCount(0);
});
