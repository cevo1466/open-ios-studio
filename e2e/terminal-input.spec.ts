import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fakeTauri';

test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
test.setTimeout(90_000);

type IpcCall = { cmd: string; args: Record<string, unknown> };
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __ipcCalls: IpcCall[] }).__ipcCalls);

test('a cursor reply arriving before ptyOpen completes is delivered once the session id exists', async ({ page }) => {
  await installFakeTauri(page);
  await page.goto('/');
  await page.evaluate(() => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      const result = await invoke(cmd, args);
      if (cmd === 'pty_open') {
        const channel = args?.onEvent as { onmessage(event: unknown): void };
        channel.onmessage({ kind: 'data', text: '\x1b[6n' });
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return result;
    };
  });
  await page.locator('.activity').getByRole('button', { name: /^Terminal/ }).click();
  await expect.poll(async () => (await calls(page)).filter((call) => call.cmd === 'pty_write').map((call) => String(call.args.data)).join('')).toContain('\x1b[1;1R');
});

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
