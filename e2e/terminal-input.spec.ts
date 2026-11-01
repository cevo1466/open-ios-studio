import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fakeTauri';

test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
test.setTimeout(90_000);

type IpcCall = { cmd: string; args: Record<string, unknown> };
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __ipcCalls: IpcCall[] }).__ipcCalls);

test('Turkish characters typed in the terminal reach the PTY unchanged', async ({ page }) => {
  await installFakeTauri(page);
  await page.goto('/');
  await page.locator('.activity').getByRole('button', { name: /^Terminal/ }).click();
  const input = page.locator('.xterm-helper-textarea');
  await input.focus();
  const text = 'çğıöşü ÇĞİÖŞÜ merhaba dünya';
  await page.keyboard.insertText(text);
  await expect
    .poll(async () => (await calls(page)).filter((c) => c.cmd === 'pty_write').map((c) => String(c.args.data)).join(''))
    .toBe(text);
});
