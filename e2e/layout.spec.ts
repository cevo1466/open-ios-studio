import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri, ipcCalls } from './fakeTauri';

test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
// xterm + Monaco make these tests heavy on slow machines.
test.setTimeout(90_000);

const bottom = (page: Page) => page.locator('.bottom-panel');
const height = async (page: Page) => (await bottom(page).boundingBox())!.height;
const closes = async (page: Page) => (await ipcCalls(page)).filter((c) => c.cmd === 'pty_close').length;
const splitterBottom = (page: Page) => page.getByRole('separator', { name: 'Alt panel yüksekliği' });
const splitterSide = (page: Page) => page.getByRole('separator', { name: 'Kenar paneli genişliği' });

async function openTerminal(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^Terminal/ }).click();
  await expect(bottom(page)).toBeVisible();
  await expect(page.locator('.xterm')).toBeVisible();
}

/** Real pointer drag from the centre of `handle` by (dx, dy). */
async function drag(page: Page, handle: ReturnType<typeof splitterBottom>, dx: number, dy: number) {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  return async () => page.mouse.up();
}

test.describe('resizable IDE layout', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeTauri(page);
  });

  test('dragging the splitter up grows the panel and down shrinks it, live', async ({ page }) => {
    await openTerminal(page);
    const start = await height(page);
    expect(Math.round(start)).toBe(300);

    const up = await drag(page, splitterBottom(page), 0, -120);
    // Live: the size already changed before the button is released.
    expect(await height(page)).toBeGreaterThan(start + 100);
    await up();
    const grown = await height(page);
    expect(grown).toBeGreaterThan(start + 100);

    const down = await drag(page, splitterBottom(page), 0, 200);
    await down();
    expect(await height(page)).toBeLessThan(grown - 150);
  });

  test('size is clamped to 150px and 75% of the work area', async ({ page }) => {
    await openTerminal(page);
    await (await drag(page, splitterBottom(page), 0, 2000))();
    expect(Math.round(await height(page))).toBe(150);

    const main = (await page.locator('main.main').boundingBox())!;
    await (await drag(page, splitterBottom(page), 0, -3000))();
    const h = await height(page);
    expect(h).toBeLessThanOrEqual(Math.floor(main.height * 0.75) + 1);
    expect(h).toBeGreaterThan(main.height * 0.7);
  });

  test('double click resets to the default size', async ({ page }) => {
    await openTerminal(page);
    await (await drag(page, splitterBottom(page), 0, -150))();
    expect(await height(page)).toBeGreaterThan(400);
    await splitterBottom(page).dblclick();
    expect(Math.round(await height(page))).toBe(300);
  });

  test('dragging disables text selection and cleans up afterwards', async ({ page }) => {
    await openTerminal(page);
    const up = await drag(page, splitterBottom(page), 0, -60);
    const during = await page.evaluate(() => ({
      cls: document.documentElement.className,
      select: getComputedStyle(document.body).userSelect,
    }));
    expect(during.cls).toContain('is-resizing');
    expect(during.select).toBe('none');
    await up();
    const after = await page.evaluate(() => document.documentElement.className);
    expect(after).not.toContain('is-resizing');
  });

  test('the editor region fills the remaining space and the terminal is refitted', async ({ page }) => {
    await openTerminal(page);
    const resizeRows = async () =>
      ((await ipcCalls(page)).filter((c) => c.cmd === 'pty_resize').map((c) => Number(c.args?.rows)).pop() ?? 0);
    const rowsBefore = await resizeRows();

    await (await drag(page, splitterBottom(page), 0, -200))();
    await expect.poll(resizeRows).toBeGreaterThan(rowsBefore);

    const main = (await page.locator('main.main').boundingBox())!;
    const editor = (await page.locator('.editor-region').boundingBox())!;
    const panel = (await bottom(page).boundingBox())!;
    expect(editor.height + panel.height).toBeGreaterThan(main.height - 4);
    expect(editor.height + panel.height).toBeLessThanOrEqual(main.height + 1);
  });

  test('sizes survive a reload', async ({ page }) => {
    await openTerminal(page);
    await (await drag(page, splitterBottom(page), 0, -100))();
    await (await drag(page, splitterSide(page), 90, 0))();
    const savedBottom = Math.round(await height(page));
    const savedSide = Math.round((await page.locator('.sidebar').boundingBox())!.width);
    expect(savedBottom).toBe(400);
    expect(savedSide).toBe(350);

    await page.reload();
    await page.getByRole('button', { name: /^Terminal/ }).click();
    await expect(bottom(page)).toBeVisible();
    expect(Math.round(await height(page))).toBe(savedBottom);
    expect(Math.round((await page.locator('.sidebar').boundingBox())!.width)).toBe(savedSide);
  });

  test('sidebar width is resizable within limits', async ({ page }) => {
    await page.goto('/');
    const width = async () => Math.round((await page.locator('.sidebar').boundingBox())!.width);
    expect(await width()).toBe(260);
    await (await drag(page, splitterSide(page), 5000, 0))();
    expect(await width()).toBe(480);
    await (await drag(page, splitterSide(page), -5000, 0))();
    expect(await width()).toBe(180);
    await splitterSide(page).dblclick();
    expect(await width()).toBe(260);
  });

  test('keyboard resizing works on the splitter', async ({ page }) => {
    await openTerminal(page);
    await splitterBottom(page).focus();
    await page.keyboard.press('ArrowUp');
    expect(Math.round(await height(page))).toBe(316);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(Math.round(await height(page))).toBe(284);
  });

  test('hide keeps the terminal alive, Ctrl+J and maximize work', async ({ page }) => {
    await openTerminal(page);
    // React StrictMode (dev) closes a throw-away first session; count from here on.
    const closesBefore = await closes(page);
    await page.getByRole('button', { name: 'Gizle', exact: true }).click();
    await expect(bottom(page)).toBeHidden();
    await expect(page.locator('.xterm')).toHaveCount(1); // still mounted: the session was not killed
    expect(await closes(page)).toBe(closesBefore);

    await page.keyboard.press('Control+j');
    await expect(bottom(page)).toBeVisible();

    await page.getByRole('button', { name: 'Tam ekran', exact: true }).click();
    const main = (await page.locator('main.main').boundingBox())!;
    expect(Math.round((await bottom(page).boundingBox())!.height)).toBe(Math.round(main.height));
    await expect(page.locator('.editor-region')).toBeHidden();
    await page.getByRole('button', { name: 'Küçült', exact: true }).click();
    await expect(page.locator('.editor-region')).toBeVisible();
  });

  test('tabs share one panel and switching does not close the terminal', async ({ page }) => {
    await openTerminal(page);
    const closesBefore = await closes(page);
    // The status bar problem counter opens the Output/Problems tabs next to the terminal.
    await page.getByRole('button', { name: /hata/ }).click();
    await expect(page.getByRole('tab', { name: /Sorunlar/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Çıktı/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Terminal/ })).toBeVisible();
    expect(await closes(page)).toBe(closesBefore);
    await page.getByRole('tab', { name: /Terminal/ }).click();
    await expect(page.locator('.xterm')).toBeVisible();
  });

  test('layout survives a small window', async ({ page }) => {
    await openTerminal(page);
    await (await drag(page, splitterBottom(page), 0, -300))();
    await page.setViewportSize({ width: 800, height: 500 });
    const main = (await page.locator('main.main').boundingBox())!;
    const h = await height(page);
    expect(h).toBeLessThanOrEqual(Math.max(150, Math.floor(main.height * 0.75)) + 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
