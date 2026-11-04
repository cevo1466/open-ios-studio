import { expect, test, type Page } from '@playwright/test';
import { fsWrites, installFakeTauri } from './fakeTauri';

test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });

type IpcCall = { cmd: string; args: Record<string, unknown> };
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __ipcCalls: IpcCall[] }).__ipcCalls);
const activity = (page: Page, name: RegExp) => page.locator('.activity').getByRole('button', { name });

async function openWorkspace(page: Page) {
  await installFakeTauri(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Klasör aç' }).first().click();
  await expect(page.getByRole('tree')).toBeVisible();
}

test('the Files side panel has a single section title', async ({ page }) => {
  await openWorkspace(page);
  await expect(page.locator('.sidebar').getByText('Dosyalar', { exact: true })).toHaveCount(1);
});

test('environment check lists every prerequisite with a Turkish fix hint', async ({ page }) => {
  await openWorkspace(page);
  await activity(page, /^Derle/).click();
  const section = page.getByRole('region', { name: 'Ortam denetimi' });
  await expect(section.getByText('Hiçbir şey kurmaz, giriş yapmaz.')).toBeVisible();
  await section.getByRole('button', { name: 'Ortamı denetle' }).click();

  await expect(section.getByRole('status')).toContainText('2 eksik');
  const items = section.locator('.bs-doctor-item');
  await expect(items).toHaveCount(8);
  await expect(section.getByText('Darwin SDK (swift sdk list)')).toBeVisible();
  await expect(section.getByText(/xtool setup/).first()).toBeVisible();
  await expect(section.getByText('Geliştirici Modu', { exact: false })).toBeVisible();
  // PASS rows carry no hint.
  await expect(items.filter({ hasText: 'Swift araç zinciri' }).locator('.bs-doctor-hint')).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Yeniden denetle' })).toBeVisible();
  expect((await calls(page)).filter((c) => c.cmd === 'env_doctor')).toHaveLength(1);
});

test('App Store readiness opens in the editor area, not as a modal, and the side panel stays usable', async ({ page }) => {
  await openWorkspace(page);
  await activity(page, /^App Store hazırlığı/).click();
  const view = page.getByRole('region', { name: 'App Store Hazırlığı' });
  await expect(view).toBeVisible();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  await expect(activity(page, /^App Store hazırlığı/)).toHaveAttribute('aria-current', 'page');

  // The explorer is still interactive while the view is open.
  await page.getByRole('tree').getByRole('button', { name: 'Sources', exact: true }).click();
  await expect(page.getByRole('tree').getByRole('button', { name: 'Demo', exact: true })).toBeVisible();

  // Switching to the Security view swaps the content; Kapat returns to the welcome screen.
  await activity(page, /^Güvenlik merkezi/).click();
  await expect(page.getByRole('region', { name: 'Güvenlik Merkezi' })).toBeVisible();
  await expect(view).toHaveCount(0);
  // Kapat closes the Security tab; the App Store tab underneath comes back, then closing it shows the welcome screen.
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await expect(page.getByRole('region', { name: 'App Store Hazırlığı' })).toBeVisible();
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Open iOS Studio' })).toBeVisible();
});

test('opening Claude Code installs the bundled skills first', async ({ page }) => {
  await openWorkspace(page);
  await activity(page, /^Yapay zekâ/).click();
  const panel = page.locator('.sidebar');
  await page.getByLabel('Sağlayıcı').selectOption('claude-cli');
  const open = panel.getByRole('button', { name: /^Claude Code'u bu projede aç/ });
  await expect(panel.getByText('mobile-ios-design')).toBeVisible();
  await open.click();
  await expect.poll(async () => (await calls(page)).map((c) => c.cmd)).toContain('skills_install_bundled');
  const names = (await calls(page)).map((c) => c.cmd);
  expect(names.indexOf('skills_install_bundled')).toBeLessThan(names.indexOf('pty_open'));
});

test('settings offer a verified update download and the install command', async ({ page }) => {
  await openWorkspace(page);
  await activity(page, /^Ayarlar/).click();
  const dialog = page.getByRole('dialog', { name: 'Ayarlar' });
  await dialog.getByRole('button', { name: 'Güncellemeleri denetle' }).click();
  await expect(dialog.getByText('Yeni sürüm var: 0.2.0')).toBeVisible();
  await expect(dialog.getByText('Kurulu: 0.1.9 · Son sürüm: 0.2.0 (ön sürüm)')).toBeVisible();
  await dialog.getByRole('button', { name: /^DEB indir/ }).click();
  await expect(dialog.getByText('İndirildi ve doğrulandı:')).toBeVisible();
  await expect(dialog.locator('.upd-cmd')).toHaveText('cd "/home/demo/Downloads" && sudo apt install ./Open-iOS-Studio_0.2.0_amd64.deb');
  // Not an AppImage install: no in-place replace button is offered.
  await expect(dialog.getByRole('button', { name: /yerine koy/ })).toHaveCount(0);
  const cmds = (await calls(page)).map((c) => c.cmd);
  expect(cmds).toContain('update_check');
  expect(cmds.filter((c) => c === 'update_download')).toHaveLength(1);
});

test('pre-submission check runs, gates install and hands the report to Claude Code', async ({ page }) => {
  test.setTimeout(60_000);
  await openWorkspace(page);
  await activity(page, /^Derle/).click();
  const section = page.getByRole('region', { name: 'Yayın öncesi denetim özeti' });
  await expect(section.getByRole('status')).toHaveText('Yayın öncesi denetim çalıştırılmadı.');

  await section.getByRole('button', { name: 'Denetimi çalıştır' }).click();
  const view = page.getByRole('region', { name: 'Yayın öncesi denetim', exact: true });
  await expect(view).toBeVisible();
  const steps = view.locator('.pf-step');
  await expect(steps).toHaveCount(6);
  await expect(view.getByText('Testler').first()).toBeVisible();
  // No Tests/ in the fixture and no Info.plist: both are NOT_VERIFIED, never red.
  await expect(steps.filter({ hasText: 'Testler' })).toContainText('Doğrulanamadı');
  await expect(steps.filter({ hasText: 'Manifest' })).toContainText('Doğrulanamadı');
  await expect(steps.filter({ hasText: 'Simge' })).toContainText('Geçti');
  await expect(steps.filter({ hasText: 'Derleme' })).toContainText('Geçti');
  await expect(view.getByText(/App Store onayı anlamına gelmez/)).toBeVisible();

  const writes = await fsWrites(page);
  expect(writes.map((w) => w.path)).toEqual(expect.arrayContaining(['.open-ios-studio/preflight/latest.json', '.open-ios-studio/preflight/latest.md']));
  const verdictText = await view.getByRole('status').first().innerText();
  const green = verdictText.startsWith('Sonuç yeşil');

  // The sidebar summary follows the verdict; the gate re-closes when a file changes.
  await expect(section.getByRole('status')).toContainText(green ? 'Yeşil' : 'kırmızı');
  await activity(page, /^Dosyalar/).click();
  await page.getByRole('tree').getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('tree').getByRole('button', { name: 'Demo', exact: true }).click();
  await page.getByRole('tree').getByRole('button', { name: 'ContentView.swift', exact: true }).click();
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('// edit');
  await expect(page.locator('.view-lines').first()).toContainText(/\/\/\s*edit/);
  await expect(page.getByRole('tab', { name: /ContentView\.swift/ }).getByTitle('Kaydedilmemiş değişiklikler')).toBeVisible();
  await page.keyboard.press('Control+S');
  await expect(page.getByTitle('Kaydedilmemiş değişiklikler')).toHaveCount(0);
  await expect.poll(async () => (await fsWrites(page)).some((w) => w.path === 'Sources/Demo/ContentView.swift')).toBe(true);
  await activity(page, /^Derle/).click();
  await expect(section.getByRole('status')).toContainText(green ? 'Dosyalar değişti' : 'kırmızı');
  await page.getByRole('button', { name: 'Raporu aç' }).click();

  // Hand-off starts Claude Code with the report path in the extra context.
  await view.getByRole('button', { name: "Raporu Claude Code'a ver" }).click();
  await expect.poll(async () => (await calls(page)).some((c) => c.cmd === 'pty_open')).toBe(true);
  const open = (await calls(page)).find((c) => c.cmd === 'pty_open');
  expect(String((open?.args.options as { extraContext?: string })?.extraContext)).toContain('.open-ios-studio/preflight/latest.md');
});

test('views open as editor tabs next to files', async ({ page }) => {
  await openWorkspace(page);
  await activity(page, /^App Store hazırlığı/).click();
  const viewTab = page.getByRole('tab', { name: 'App Store Hazırlığı' });
  await expect(viewTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'App Store Hazırlığı' })).toBeVisible();

  // A file opened from the explorer comes to the front; the view tab stays in the strip.
  await page.getByRole('tree').getByRole('button', { name: 'Package.swift', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Package\.swift/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await expect(viewTab).toHaveAttribute('aria-selected', 'false');

  // Clicking the view tab brings the view back; Ctrl+W closes it and the file shows again.
  await viewTab.click();
  await expect(page.getByRole('region', { name: 'App Store Hazırlığı' })).toBeVisible();
  await page.keyboard.press('Control+W');
  await expect(viewTab).toHaveCount(0);
  await expect(page.locator('.monaco-editor').first()).toBeVisible();

  // Closing the last file brings the welcome screen back.
  await page.getByRole('button', { name: 'Package.swift sekmesini kapat' }).click();
  await expect(page.getByRole('heading', { name: 'Open iOS Studio' })).toBeVisible();
});

test('Swift language support starts for the workspace and lists server diagnostics', async ({ page }) => {
  await openWorkspace(page);
  await expect(page.locator('.status').getByText('Swift LSP: çalışıyor')).toBeVisible();
  expect((await calls(page)).filter((c) => c.cmd === 'lsp_start')).toHaveLength(1);

  // A Swift file is announced to the server; the fake answers with one diagnostic for it.
  await page.getByRole('tree').getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('tree').getByRole('button', { name: 'Demo', exact: true }).click();
  await page.getByRole('tree').getByRole('button', { name: 'ContentView.swift', exact: true }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  const didOpens = async () => (await calls(page)).filter((c) => c.cmd === 'lsp_send' && String(c.args.json).includes('textDocument/didOpen'));
  await expect.poll(async () => (await didOpens()).length).toBe(1);
  expect(String((await didOpens())[0].args.json)).toContain('file:///work/demo/Sources/Demo/ContentView.swift');
  await page.getByRole('tab', { name: /Sorunlar/ }).click();
  await expect(page.getByRole('list', { name: 'Sorunlar' })).toContainText('unused variable (sourcekit-lsp)');
  // The same diagnostic is painted as an inline marker on the Monaco model.
  await expect(page.locator('.monaco-editor .squiggly-warning').first()).toBeVisible();

  // A non-Swift file is never sent to the server.
  await page.getByRole('tree').getByRole('button', { name: 'xtool.yml', exact: true }).click();
  await expect(page.getByRole('tab', { name: /xtool\.yml/ })).toHaveAttribute('aria-selected', 'true');
  expect(await didOpens()).toHaveLength(1);
});

test('the Terminal button brings a running Claude Code session forward instead of killing it', async ({ page }) => {
  await openWorkspace(page);
  await activity(page, /^Yapay zekâ/).click();
  await page.getByLabel('Sağlayıcı').selectOption('claude-cli');
  await page.locator('.sidebar').getByRole('button', { name: /^Claude Code'u bu projede aç/ }).click();
  const claude = page.getByRole('region', { name: 'Claude Code' });
  await expect(claude).toBeVisible();
  const ptyCalls = async () => (await calls(page)).filter((c) => c.cmd === 'pty_open' || c.cmd === 'pty_close').map((c) => c.cmd);
  await expect.poll(ptyCalls).toContain('pty_open');
  const before = await ptyCalls();

  // Hide the panel, then press Terminal: the same session comes back; no new pty_open, no pty_close.
  await page.locator('.status').getByRole('button', { name: 'Paneli gizle' }).click();
  await expect(claude).toBeHidden();
  await activity(page, /^Terminal/).click();
  await expect(claude).toBeVisible();
  await expect(page.getByRole('tab', { name: /Terminal|Claude Code/ }).first()).toBeVisible();
  expect(await ptyCalls()).toEqual(before);
});
