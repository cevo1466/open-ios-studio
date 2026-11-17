/// <reference types="node" />
import { expect, test } from '@playwright/test';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { installFakeTauri } from './fakeTauri';

test.setTimeout(90_000);
test.use({ viewport: { width: 1500, height: 1000 } });

test('real Swift callbacks render in the IDE and source errors retain the live session', async ({ page }, testInfo) => {
  const build = spawnSync('cargo', ['build', '--locked', '--manifest-path', 'tools/simulator-harness/Cargo.toml'], { encoding: 'utf8' });
  expect(build.status, build.stderr).toBe(0);
  const root = mkdtempSync(join(tmpdir(), 'ois-browser-runtime-'));
  const child: ChildProcessWithoutNullStreams = spawn('tools/simulator-harness/target/debug/ois-simulator-harness', [root]);
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(reason: unknown): void }>();
  const lines = createInterface({ input: child.stdout });
  const evidence: unknown[] = [];
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    evidence.push(message);
    if (message.reply) {
      const promise = pending.get(message.reply);
      pending.delete(message.reply);
      if (message.error) promise?.reject(message.error); else promise?.resolve(message.result);
    } else if (message.event) {
      void page.evaluate(({ stream, event }) => {
        const w = window as unknown as { __simChannels: Record<number, { onmessage(event: unknown): void }> };
        w.__simChannels?.[stream]?.onmessage(event);
      }, message).catch(() => {});
    }
  });
  const request = (body: Record<string, unknown>, stream?: number) => new Promise((resolve, reject) => {
    const id = stream ?? ++sequence;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ ...body, id }) + '\n');
  });
  try {
    await installFakeTauri(page);
    await page.exposeFunction('__nativeSimulator', async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'simulator_info') return request({ op: 'info' });
      if (cmd === 'simulator_start') return request({ op: 'start', path: args.path }, Number(args.stream));
      if (cmd === 'simulator_input') return request({ op: 'input', event: args.event });
      if (cmd === 'simulator_stop') return request({ op: 'stop' });
      if ((cmd === 'apply_file' || cmd === 'write_file') && String(args.path).startsWith('SimulatorExample/')) {
        const path = join(root, String(args.path));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, String(args.content));
      }
      return null;
    });
    await page.addInitScript(({ workspaceRoot }) => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> };
        __nativeSimulator(cmd: string, args: Record<string, unknown>): Promise<unknown>;
        __simChannels: Record<number, { onmessage(event: unknown): void }>;
      };
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__simChannels = {};
      let stream = 1_000_000;
      w.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
        if (cmd === 'pick_workspace') return workspaceRoot;
        if (cmd === 'simulator_start') {
          const id = ++stream;
          w.__simChannels[id] = args.onEvent as { onmessage(event: unknown): void };
          return w.__nativeSimulator(cmd, { path: args.path, stream: id });
        }
        if (cmd.startsWith('simulator_')) return w.__nativeSimulator(cmd, args);
        const result = await original(cmd, args);
        if (cmd === 'apply_file' || cmd === 'write_file') await w.__nativeSimulator(cmd, args);
        return result;
      };
    }, { workspaceRoot: root });
    await page.goto('/');
    await page.getByRole('button', { name: 'Klasör aç', exact: true }).first().click();
    await page.getByRole('button', { name: 'Simülatör', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Yerel Swift simülatörü' });
    await expect(panel.getByText('Paketle birlikte kurulu · Swift derleyicisi hazır', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Örneği aç' }).click();
    await panel.getByRole('button', { name: 'Simülatörü başlat' }).click();
    await expect(panel.getByText('Count: 0', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Increase', exact: true }).click();
    await expect(panel.getByText('Count: 1', { exact: true })).toBeVisible();
    await panel.getByRole('textbox', { name: 'Your name' }).fill('Çağrı');
    await panel.getByRole('textbox', { name: 'Your name' }).pressSequentially(' typed quickly');
    await expect(panel.getByText('Hello, Çağrı typed quickly!', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Open details' }).click();
    await expect(panel.getByText('Navigation executed by Swift')).toBeVisible();
    await panel.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(panel.getByText('Count: 1', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Show sheet' }).click();
    await expect(panel.getByRole('dialog')).toBeVisible();
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel.getByRole('dialog')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Koyu görünüm' }).click();
    await expect(panel.locator('.sim-device')).toHaveClass(/sim-dark/);
    await panel.getByRole('button', { name: 'Döndür' }).click();
    await expect(panel.locator('.sim-device')).toHaveCSS('width', '864px');
    await panel.getByRole('button', { name: 'Döndür' }).click();
    const downloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'SVG görüntüsü' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('local-simulator.svg');
    await download.saveAs(testInfo.outputPath('local-simulator.svg'));
    await page.screenshot({ path: testInfo.outputPath('simulator-running.png') });
    // Change the actual source on disk, then prove the old process still responds.
    writeFileSync(join(root, 'SimulatorExample/Counter.swift'), 'import SwiftUI\ninvalid application source');
    await panel.getByRole('button', { name: 'Yeniden derle / başlat' }).click();
    await expect(panel.getByRole('alert')).toContainText('Derleme başarısız');
    await expect(page.locator('.squiggly-error').first()).toBeVisible();
    await expect(page.locator('.status .sb-err')).toContainText('hata');
    await page.getByTitle('Sorunları göster', { exact: true }).click();
    await expect(page.getByRole('list', { name: 'Sorunlar', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Increase', exact: true }).click();
    await expect(panel.getByText('Count: 2', { exact: true })).toBeVisible();
    writeFileSync(join(root, 'SimulatorExample/Counter.swift'), readFileSync('examples/LocalSimulator/Counter.swift'));
    await panel.getByRole('button', { name: 'Yeniden derle / başlat' }).click();
    await expect(panel.getByText('Count: 0', { exact: true })).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'Your name' })).toHaveValue('Ada');
    await panel.getByRole('button', { name: 'Durdur', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Simülatörü başlat' })).toBeEnabled();
    mkdirSync(join(root, 'BindingDemo'));
    writeFileSync(join(root, 'BindingDemo/Demo.swift'), readFileSync('examples/BindingAndTabs/Demo.swift'));
    await panel.getByRole('textbox', { name: 'Simülatör kaynak dosyası' }).fill('BindingDemo/Demo.swift');
    await panel.getByRole('button', { name: 'Simülatörü başlat' }).click();
    await expect(panel.getByText('Selected: 10, count: 5', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Child add two' }).click();
    await expect(panel.getByText('Selected: 10, count: 7', { exact: true })).toBeVisible();
    await panel.getByRole('tab', { name: 'Second', exact: true }).click();
    await expect(panel.getByText('Selected: 20, count: 7', { exact: true })).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'Second', exact: true })).toHaveAttribute('aria-selected', 'true');
    await panel.getByRole('button', { name: 'Döndür' }).click();
    const list = panel.locator('.sim-list');
    expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await list.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await panel.getByRole('button', { name: 'Simülatörü kapat' }).click();
    await expect(panel).toHaveCount(0);
    const transcript = testInfo.outputPath('native-runtime-transcript.json');
    writeFileSync(transcript, JSON.stringify(evidence, null, 2));
    await testInfo.attach('native-runtime-transcript', { path: transcript, contentType: 'application/json' });
  } finally {
    await request({ op: 'stop' }).catch(() => {});
    child.stdin.end();
    lines.close();
    rmSync(root, { recursive: true, force: true });
  }
});
