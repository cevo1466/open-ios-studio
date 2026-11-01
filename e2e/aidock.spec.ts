import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fakeTauri';

test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
test.setTimeout(90_000);

const activity = (page: Page, name: RegExp | string) => page.locator('.activity').getByRole('button', { name });

type IpcCall = { cmd: string; args: Record<string, unknown> };
const ipcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __ipcCalls: IpcCall[] }).__ipcCalls);

async function useClaude(page: Page) {
  await activity(page, /^Yapay zekâ/).click();
  await page.getByLabel('Sağlayıcı').selectOption('claude-cli');
}

test.describe('AI chat column, model and effort', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeTauri(page);
  });

  test('the chat column keeps its width and leaves room for the editor area', async ({ page }) => {
    await page.goto('/');
    await activity(page, /^Yapay zekâ/).click();
    await expect(page.locator('.ai-dock')).toBeVisible();
    const dock = await page.locator('.ai-dock').boundingBox();
    const main = await page.locator('.main').boundingBox();
    expect(Math.round(dock!.width)).toBe(380);
    expect(main!.width).toBeGreaterThan(400);

    // A saved wide column never swallows the editor area.
    await page.evaluate(() => localStorage.setItem('open-ios-studio.layout.v1', JSON.stringify({ sidebarWidth: 260, bottomHeight: 300, aiWidth: 640 })));
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.reload();
    await activity(page, /^Yapay zekâ/).click();
    const main2 = await page.locator('.main').boundingBox();
    expect(main2!.width).toBeGreaterThanOrEqual(320);
  });

  test('Claude offers Sonnet, Opus, Haiku and effort levels in the chat column', async ({ page }) => {
    await page.goto('/');
    await useClaude(page);
    const chat = page.getByRole('complementary', { name: 'Yapay zekâ asistanı' });
    const model = chat.getByLabel('Model', { exact: true });
    await expect(model.locator('option')).toHaveText(['Varsayılan', 'Sonnet', 'Opus', 'Haiku', 'Özel…']);
    const effort = chat.getByLabel('Efor', { exact: true });
    await expect(effort.locator('option')).toHaveText(['Varsayılan', 'Düşük', 'Orta', 'Yüksek', 'Çok yüksek', 'Maksimum']);
    await model.selectOption('opus');
    await effort.selectOption('high');
    await expect(chat.locator('.ai-chip')).toContainText('Opus · Yüksek');
    const saved = await page.evaluate(() => localStorage.getItem('open-ios-studio.ai.v1'));
    expect(JSON.parse(saved!).models['claude-cli']).toBe('opus');
    expect(JSON.parse(saved!).efforts['claude-cli']).toBe('high');
  });

  test('the same choice is shown in the left AI panel', async ({ page }) => {
    await page.goto('/');
    await useClaude(page);
    await page.locator('.ais').getByLabel('Model', { exact: true }).selectOption('sonnet');
    await expect(page.getByRole('complementary', { name: 'Yapay zekâ asistanı' }).getByLabel('Model', { exact: true })).toHaveValue('sonnet');
  });

  test('the composer says where to type and what each button does', async ({ page }) => {
    await page.goto('/');
    await activity(page, /^Yapay zekâ/).click();
    const chat = page.getByRole('complementary', { name: 'Yapay zekâ asistanı' });
    await expect(chat.getByText('Yapay zekâya ne yaptırmak istiyorsunuz?')).toBeVisible();
    await expect(chat.getByRole('textbox', { name: 'Mesaj' })).toBeVisible();
    await expect(chat.getByText(/Dosya üret: kodu yazar/)).toBeVisible();
  });

  test('Claude Code starts in the terminal with the chosen model and effort', async ({ page }) => {
    await page.goto('/');
    await useClaude(page);
    await page.locator('.ais').getByLabel('Model', { exact: true }).selectOption('opus');
    await page.locator('.ais').getByLabel('Efor', { exact: true }).selectOption('high');
    await page.getByRole('button', { name: "Claude Code'u bu projede aç" }).click();
    await expect.poll(async () => (await ipcCalls(page)).filter((c) => c.cmd === 'pty_open').length).toBeGreaterThan(0);
    const open = (await ipcCalls(page)).filter((c) => c.cmd === 'pty_open').at(-1)!;
    expect(open.args.kind).toBe('claude-code');
    expect(open.args.options).toEqual({ model: 'opus', effort: 'high', skipPermissions: true });
  });

  test('a plain terminal offers to start Claude Code with the project context', async ({ page }) => {
    await page.goto('/');
    await useClaude(page);
    await activity(page, /^Terminal/).click();
    const start = page.getByRole('button', { name: /Claude Code'u projeyle aç/ });
    await expect(start).toBeVisible();
    await start.click();
    await expect.poll(async () => (await ipcCalls(page)).some((c) => c.cmd === 'pty_open' && c.args.kind === 'claude-code')).toBe(true);
  });

  test('a remote site is handed to the Claude Code session, not shown or stored', async ({ page }) => {
    await page.goto('/');
    await useClaude(page);
    const form = page.locator('details.remote-site');
    await form.locator('summary').click();
    await form.getByLabel('Uzak sunucu').fill('ftp.zetapilates.com');
    await form.getByLabel('Uzak kullanıcı adı').fill('melih');
    await form.getByLabel('Uzak şifre').fill('s3cret-pass');
    await expect(page.getByRole('button', { name: "Claude Code'u bu projede ve uzak siteyle aç" })).toBeVisible();
    await page.getByRole('button', { name: "Claude Code'u bu projede ve uzak siteyle aç" }).click();
    await expect.poll(async () => (await ipcCalls(page)).some((c) => c.cmd === 'pty_open' && c.args.kind === 'claude-code')).toBe(true);
    const open = (await ipcCalls(page)).filter((c) => c.cmd === 'pty_open').at(-1)!;
    expect(open.args.options).toMatchObject({ remote: { protocol: 'sftp', host: 'ftp.zetapilates.com', port: 0, user: 'melih', password: 's3cret-pass' } });
    // The form forgets the password; nothing is written to browser storage.
    await expect(form.getByLabel('Uzak şifre')).toHaveValue('');
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(stored).not.toContain('s3cret-pass');
  });

  test('plain FTP shows a warning and an empty form opens a plain Claude Code session', async ({ page }) => {
    await page.goto('/');
    await useClaude(page);
    const form = page.locator('details.remote-site');
    await form.locator('summary').click();
    await form.getByRole('combobox').selectOption('ftp');
    await expect(form.getByText(/Düz FTP şifrenizi şifrelemeden gönderir/)).toBeVisible();
    await page.getByRole('button', { name: "Claude Code'u bu projede aç" }).click();
    await expect.poll(async () => (await ipcCalls(page)).some((c) => c.cmd === 'pty_open' && c.args.kind === 'claude-code')).toBe(true);
    const open = (await ipcCalls(page)).filter((c) => c.cmd === 'pty_open').at(-1)!;
    expect((open.args.options as { remote?: unknown }).remote).toBeUndefined();
  });

  test('the chat says what it is and points to Claude Code for the full agent', async ({ page }) => {
    await page.goto('/');
    await useClaude(page);
    const chat = page.getByRole('complementary', { name: 'Yapay zekâ asistanı' });
    await expect(chat.getByRole('heading', { name: 'Hızlı sohbet' })).toBeVisible();
    await expect(chat.getByText(/Komut çalıştırmaz/)).toBeVisible();
    await chat.getByRole('button', { name: "Claude Code'u kullanın" }).click();
    await expect.poll(async () => (await ipcCalls(page)).some((c) => c.cmd === 'pty_open' && c.args.kind === 'claude-code')).toBe(true);
  });

  test('the Claude Code terminal says it is the full agent and warns when the settings changed', async ({ page }) => {
    await page.goto('/');
    await useClaude(page);
    await page.locator('.ais').getByLabel('Model', { exact: true }).selectOption('sonnet');
    await page.locator('.ais').getByLabel('Efor', { exact: true }).selectOption('high');
    await page.getByRole('button', { name: "Claude Code'u bu projede aç" }).click();
    const panel = page.getByRole('region', { name: 'Claude Code' });
    await expect(panel.locator('.term-role')).toContainText('tam ajan');
    await expect(panel.locator('.term-role')).toContainText('istenen: Sonnet · Yüksek');
    await expect(panel.locator('.term-stale')).toHaveCount(0);
    await page.locator('.ais').getByLabel('Efor', { exact: true }).selectOption('max');
    await expect(panel.locator('.term-stale')).toContainText('yeniden başlatın');
    await panel.getByRole('button', { name: 'Yeni ayarla yeniden başlat' }).click();
    await expect(panel.locator('.term-stale')).toHaveCount(0);
    await expect(panel.locator('.term-role')).toContainText('Sonnet · Maksimum');
  });

  test('Claude Code starts without permission prompts by default and the choice can be turned off', async ({ page }) => {
    await page.goto('/');
    await useClaude(page);
    const toggle = page.getByRole('checkbox', { name: /İzin sormadan çalış/ });
    await expect(toggle).toBeChecked();
    await expect(page.getByText(/onay istemez/)).toBeVisible();
    await page.getByRole('button', { name: "Claude Code'u bu projede aç" }).click();
    const panel = page.getByRole('region', { name: 'Claude Code' });
    await expect(panel.locator('.term-bypass')).toHaveText('izin sormadan çalışıyor');
    let open = (await ipcCalls(page)).filter((c) => c.cmd === 'pty_open').at(-1)!;
    expect((open.args.options as { skipPermissions: boolean }).skipPermissions).toBe(true);

    // Turning it off warns that the running session is out of date; a restart honours it.
    await toggle.uncheck();
    await expect(panel.locator('.term-stale')).toBeVisible();
    await panel.getByRole('button', { name: 'Yeni ayarla yeniden başlat' }).click();
    await expect(panel.locator('.term-bypass')).toHaveCount(0);
    await expect(panel.locator('.term-role')).toContainText('her adımda izin sorar');
    open = (await ipcCalls(page)).filter((c) => c.cmd === 'pty_open').at(-1)!;
    expect((open.args.options as { skipPermissions: boolean }).skipPermissions).toBe(false);
  });
});
