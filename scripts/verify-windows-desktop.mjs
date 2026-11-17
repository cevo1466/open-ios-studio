// Actual installed Tauri/WebView2 window. No mocked IPC or renderer-only test backend.
import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'win32') throw new Error('This check requires native Windows');
const work = mkdtempSync(join(tmpdir(), 'ois-desktop-check-'));
const source = readFileSync('examples/LocalSimulator/Counter.swift', 'utf8');
writeFileSync(join(work, 'Counter.swift'), source);
const binary = join(process.env.OIS_INSTALLED_DIR, 'open-ios-studio.exe');
const app = spawn(binary, [], { env: { ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1',
  WEBVIEW2_USER_DATA_FOLDER: join(work, 'webview-profile'),
}, stdio: 'ignore' });
let browser;
const observations = { platform: process.platform, nativeApp: binary, mockedIPC: false, steps: [] };
try {
  await expect.poll(async () => {
    try { return (await fetch('http://127.0.0.1:9222/json/version')).ok; } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(30_000);
  await expect(page.getByRole('heading', { name: 'Open iOS Studio', exact: true })).toBeVisible();
  observations.steps.push('installed Tauri window and WebView2 loaded');
  // Start native picker handling before clicking: the Rust command awaits the real dialog.
  const chooser = spawn('powershell.exe', ['-NoProfile', '-STA', '-File', resolve('scripts/select-windows-test-folder.ps1'), '-AppPid', String(app.pid), '-Folder', work], { stdio: 'pipe' });
  const chooserResult = new Promise((resolveResult, reject) => {
    let output = '';
    chooser.stdout.on('data', (chunk) => { output += chunk; });
    chooser.stderr.on('data', (chunk) => { output += chunk; });
    chooser.on('error', reject);
    chooser.on('exit', (code) => code === 0 ? resolveResult() : reject(new Error(output)));
  });
  await page.getByRole('button', { name: 'Klasör aç', exact: true }).first().click();
  await chooserResult;
  await page.getByRole('tree').getByRole('button', { name: /Counter.swift/ }).click();
  await page.getByRole('button', { name: 'Simülatör', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Paketle birlikte kurulu' })).toContainText('derleyicisi hazır');
  await page.getByRole('button', { name: 'Simülatörü başlat', exact: true }).click();
  await expect(page.locator('.sim-header')).toContainText('Çalışıyor', { timeout: 120_000 });
  const hideBottom = page.getByRole('button', { name: 'Gizle', exact: true });
  if (await hideBottom.isVisible()) await hideBottom.click();
  const device = page.locator('.sim-viewport');
  await expect(device.getByText('Count: 0', { exact: true })).toBeVisible({ timeout: 120_000 });
  await device.getByRole('button', { name: 'Increase', exact: true }).click();
  await expect(device.getByText('Count: 1', { exact: true })).toBeVisible();
  observations.steps.push('real compiled Swift callback 0 -> 1 in installed WebView2');
  await device.getByRole('textbox', { name: 'Your name', exact: true }).fill('İpek şğü');
  await expect(device.getByText('Hello, İpek şğü!', { exact: true })).toBeVisible();
  observations.steps.push('Unicode input propagated to native Swift');
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.focus();
  await page.keyboard.press('Control+g');
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('40');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFileSync(join(work, 'Counter.swift'), 'utf8')).toContain('count = 40');
  await page.getByRole('button', { name: 'Yeniden derle / başlat', exact: true }).click();
  await expect(device.getByText('Count: 40', { exact: true })).toBeVisible({ timeout: 120_000 });
  await device.getByRole('button', { name: 'Increase', exact: true }).click();
  await expect(device.getByText('Count: 41', { exact: true })).toBeVisible();
  observations.steps.push('Monaco edit/save -> native recompile -> 40 -> 41');
  await page.getByRole('button', { name: 'Durdur', exact: true }).click();
  observations.passed = true;
} catch (error) {
  observations.passed = false;
  observations.error = String(error);
  throw error;
} finally {
  mkdirSync('windows-verification', { recursive: true });
  writeFileSync('windows-verification/desktop.json', JSON.stringify(observations, null, 2) + '\n');
  await browser?.close().catch(() => {});
  if (app.pid) spawnSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
