import type { Page } from '@playwright/test';

/**
 * Installs an in-memory fake of `window.__TAURI_INTERNALS__` before the app
 * loads, so the UI can be exercised in a plain browser. Recorded on the page:
 * `window.__fsWrites` (write_file/apply_file) and `window.__ipcCalls`.
 */
export async function installFakeTauri(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Json = unknown;
    type Args = Record<string, unknown> | undefined;
    const files = new Map<string, string>([
      ['Package.swift', '// swift-tools-version: 5.9\nimport PackageDescription\nlet package = Package(name: "Demo")\n'],
      ['xtool.yml', 'version: 1\nbundleID: com.example.Demo\n'],
      ['Sources/Demo/ContentView.swift', 'import SwiftUI\n\nstruct ContentView: View {\n  var body: some View { Text("Hi") }\n}\n'],
      ['.build/debug/Demo', 'ELF'],
      ['.build/debug/Demo.build/main.o', 'obj'],
      ['xtool/Demo.app/Info.plist', 'bplist'],
      ['xtool/Demo.app/Demo', 'bin'],
      ['.git/config', '[core]'],
      ['Sources/Demo/DemoApp.swift', 'import SwiftUI\n\n@main struct DemoApp: App {\n  var body: some Scene { WindowGroup { ContentView() } }\n}\n'],
    ]);
    const w = window as unknown as Record<string, unknown>;
    const writes: { path: string; content: string }[] = [];
    const calls: { cmd: string; args: Args }[] = [];
    w.__fsWrites = writes;
    w.__ipcCalls = calls;

    const listDir = (dir: string) => {
      const prefix = dir === '' ? '' : `${dir}/`;
      const seen = new Map<string, boolean>();
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash === -1) seen.set(rest, false);
        else seen.set(rest.slice(0, slash), true);
      }
      return [...seen.entries()]
        .map(([name, isDir]) => ({ name, path: prefix + name, isDir }))
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    };

    const callbacks = new Map<number, (v: unknown) => void>();
    let nextId = 1;

    const handlers: Record<string, (a: Record<string, unknown>) => Json> = {
      pick_workspace: () => '/work/demo',
      list_dir: (a) => listDir(String(a.path ?? '')),
      read_file: (a) => {
        const p = String(a.path);
        const c = files.get(p);
        if (c === undefined) throw new Error(`no such file: ${p}`);
        return c;
      },
      read_file_if_exists: (a) => files.get(String(a.path)) ?? null,
      write_file: (a) => {
        files.set(String(a.path), String(a.content));
        writes.push({ path: String(a.path), content: String(a.content) });
        return null;
      },
      apply_file: (a) => {
        files.set(String(a.path), String(a.content));
        writes.push({ path: String(a.path), content: String(a.content) });
        return null;
      },
      create_file: (a) => {
        const p = String(a.path);
        if (files.has(p)) throw new Error(`already exists: ${p}`);
        files.set(p, '');
        return null;
      },
      scan_workspace: () => ({
        files: [...files.entries()].map(([path, content]) => ({ path, content })),
        truncated: false,
        skipped: 0,
      }),
      xtool_detect: () => ({ found: false, path: null, versionOutput: null, swiftVersionOutput: null, error: null }),
      // Build and test runs succeed instantly; the channel is the `onEvent` argument itself.
      xtool_run: (a) => {
        const ch = a.onEvent as { onmessage: (e: unknown) => void };
        const op = String(a.op);
        const lines = op === 'build' ? ['Building Demo…', 'Build complete'] : op === 'swift-test' ? ['Test Suite passed'] : [];
        for (const text of lines) ch.onmessage({ kind: 'line', stream: 'stdout', text });
        ch.onmessage({ kind: 'exit', code: 0, cancelled: false, timedOut: false, droppedLines: 0 });
        return null;
      },
      read_png_header: (a) => (String(a.path).endsWith('icon.png') ? { width: 1024, height: 1024, colorType: 2 } : null),
      'plugin:event|listen': (a) => {
        if (a.event === 'tauri://close-requested') w.__closeHandler = a.handler;
        return nextId++;
      },
      'plugin:event|unlisten': () => null,
      'plugin:window|destroy': () => {
        w.__destroyed = true;
        return null;
      },
      xtool_cancel: () => null,
      reveal_path: () => null,
      secret_status: () => false,
      ai_list_models: () => [],
      ai_cancel: () => null,
      cli_status: () => ({ installed: true, loggedIn: false, detail: 'Not logged in' }),
      cli_login_terminal: () => 'xterm',
      env_doctor: () => [
        { id: 'swift', status: 'PASS', detail: 'Swift version 6.1' },
        { id: 'darwin-sdk', status: 'FAIL', detail: "no 'darwin' SDK installed" },
        { id: 'xtool', status: 'PASS', detail: '1.24.0 (tested)' },
        { id: 'xtool-sdk', status: 'FAIL', detail: 'Not installed' },
        { id: 'apple-account', status: 'WARN', detail: 'Logged out' },
        { id: 'device', status: 'WARN', detail: 'no iPhone connected' },
        { id: 'usbmuxd', status: 'PASS', detail: 'installed' },
        { id: 'git', status: 'PASS', detail: 'installed' },
      ],
      update_check: () => ({
        current: '0.1.9',
        latest: '0.2.0',
        newer: true,
        prerelease: true,
        publishedAt: '2026-11-02T10:00:00Z',
        htmlUrl: 'https://github.com/cevo1466/open-ios-studio/releases/tag/v0.2.0',
        assets: [
          { name: 'Open-iOS-Studio_0.2.0_amd64.deb', size: 12_000_000, kind: 'deb' },
          { name: 'Open-iOS-Studio_0.2.0_amd64.AppImage', size: 90_000_000, kind: 'app-image' },
          { name: 'SHA256SUMS.txt', size: 200, kind: 'checksums' },
        ],
        installKind: 'deb',
      }),
      update_download: (a: Args) => {
        const deb = a?.kind === 'deb';
        const name = `Open-iOS-Studio_0.2.0_amd64.${deb ? 'deb' : 'AppImage'}`;
        return {
          path: `/home/demo/Downloads/${name}`,
          name,
          sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
          installCommand: deb ? `cd "/home/demo/Downloads" && sudo apt install ./${name}` : null,
          canReplaceRunningAppimage: false,
        };
      },
      update_apply_appimage: () => '/home/demo/Open.AppImage',
      update_reveal: () => null,
      skills_install_bundled: () => ({ installed: ['.claude/skills/ios-app-xtool/SKILL.md'], unchanged: [], kept: [] }),
      pty_open: () => 1,
      pty_write: () => null,
      pty_resize: () => null,
      pty_close: () => null,
    };

    w.__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args?: Args) => {
        calls.push({ cmd, args });
        const h = handlers[cmd];
        if (!h) return Promise.reject(new Error(`unmocked command: ${cmd}`));
        try {
          return Promise.resolve(h(args ?? {}));
        } catch (e) {
          return Promise.reject(String(e instanceof Error ? e.message : e));
        }
      },
      transformCallback: (cb: (v: unknown) => void, once?: boolean) => {
        const id = nextId++;
        callbacks.set(id, (v) => {
          if (once) callbacks.delete(id);
          cb(v);
        });
        return id;
      },
      unregisterCallback: (id: number) => {
        callbacks.delete(id);
      },
      convertFileSrc: (p: string) => p,
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' },
      },
    };
    w.__requestClose = () => {
      const id = w.__closeHandler as number;
      callbacks.get(id)?.({ event: 'tauri://close-requested', id: 1, payload: null });
    };
  });
}

export const fsWrites = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fsWrites: { path: string; content: string }[] }).__fsWrites);

export const ipcCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ipcCalls: { cmd: string; args?: Record<string, unknown> }[] }).__ipcCalls);
