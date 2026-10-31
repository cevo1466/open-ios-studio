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
      xtool_cancel: () => null,
      secret_status: () => false,
      ai_list_models: () => [],
      ai_cancel: () => null,
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
    };
  });
}

export const fsWrites = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fsWrites: { path: string; content: string }[] }).__fsWrites);

export const ipcCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ipcCalls: { cmd: string; args?: Record<string, unknown> }[] }).__ipcCalls);
