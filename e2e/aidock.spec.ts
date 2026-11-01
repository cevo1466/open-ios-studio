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
    expect(open.args.options).toEqual({ model: 'opus', effort: 'high' });
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
});
