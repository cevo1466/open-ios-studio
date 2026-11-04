/**
 * The Swift language client: document sync (full text, debounced), completion, hover and the
 * diagnostics notification, on top of `JsonRpcClient`. Paths are absolute; only `.swift` files are
 * sent to the server. Timer functions are injectable so the debounce is unit-tested.
 */
import { JsonRpcClient } from "./jsonrpc";
import {
  lspToDiagnostics,
  pathToUri,
  uriToPath,
  type LspDiagnostic,
  type LspPosition,
} from "./diagnostics";
import type { Diagnostic } from "../xtool/types";

export interface LspTransport {
  send(json: string): void;
}

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
  /** 1 = plain text, 2 = snippet. */
  insertTextFormat?: number;
  textEdit?: {
    range: { start: LspPosition; end: LspPosition };
    newText: string;
  };
  filterText?: string;
  sortText?: string;
}

type MarkedString = string | { language: string; value: string };
interface HoverResult {
  contents: MarkedString | MarkedString[] | { kind: string; value: string };
}

export interface LspTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type DiagnosticsListener = (
  path: string,
  diags: Diagnostic[],
  raw: LspDiagnostic[],
) => void;

export const CHANGE_DEBOUNCE_MS = 300;

export const isSwiftPath = (path: string): boolean =>
  path.toLowerCase().endsWith(".swift");

function hoverToMarkdown(contents: HoverResult["contents"]): string | null {
  const one = (m: MarkedString | { kind: string; value: string }): string => {
    if (typeof m === "string") return m;
    if ("language" in m) return `\`\`\`${m.language}\n${m.value}\n\`\`\``;
    return m.value;
  };
  const parts = (Array.isArray(contents) ? contents : [contents])
    .map(one)
    .filter((s) => s.trim() !== "");
  return parts.length === 0 ? null : parts.join("\n\n");
}

export class SwiftLsp {
  private readonly rpc: JsonRpcClient;
  private readonly timers: LspTimers;
  private readonly versions = new Map<string, number>();
  private readonly pendingChange = new Map<string, unknown>();
  private completionSeq = 0;
  private disposed = false;

  constructor(
    transport: LspTransport,
    timers: LspTimers = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as number),
    },
  ) {
    this.rpc = new JsonRpcClient((json) => transport.send(json));
    this.timers = timers;
  }

  async initialize(rootPath: string): Promise<void> {
    await this.rpc.request("initialize", {
      processId: null,
      rootUri: pathToUri(rootPath),
      capabilities: {},
      workspaceFolders: [
        {
          uri: pathToUri(rootPath),
          name: rootPath.split("/").filter(Boolean).pop() ?? rootPath,
        },
      ],
    });
    this.rpc.notify("initialized", {});
  }

  open(path: string, text: string): void {
    if (!isSwiftPath(path) || this.disposed) return;
    this.versions.set(path, 1);
    this.rpc.notify("textDocument/didOpen", {
      textDocument: {
        uri: pathToUri(path),
        languageId: "swift",
        version: 1,
        text,
      },
    });
  }

  /** Full-text sync, coalesced: one `didChange` per debounce window with an increasing version. */
  change(path: string, text: string): void {
    if (!isSwiftPath(path) || this.disposed || !this.versions.has(path)) return;
    const previous = this.pendingChange.get(path);
    if (previous !== undefined) this.timers.clearTimeout(previous);
    const handle = this.timers.setTimeout(() => {
      this.pendingChange.delete(path);
      if (this.disposed) return;
      const version = (this.versions.get(path) ?? 1) + 1;
      this.versions.set(path, version);
      this.rpc.notify("textDocument/didChange", {
        textDocument: { uri: pathToUri(path), version },
        contentChanges: [{ text }],
      });
    }, CHANGE_DEBOUNCE_MS);
    this.pendingChange.set(path, handle);
  }

  close(path: string): void {
    if (!isSwiftPath(path) || !this.versions.has(path)) return;
    this.cancelChange(path);
    this.versions.delete(path);
    if (this.disposed) return;
    this.rpc.notify("textDocument/didClose", {
      textDocument: { uri: pathToUri(path) },
    });
  }

  /** The open Swift documents, so a restarted server can be told about them again. */
  openPaths(): string[] {
    return [...this.versions.keys()];
  }

  /** Resolves to `[]` when a newer completion request was started before this one was answered. */
  async completion(
    path: string,
    line: number,
    character: number,
  ): Promise<CompletionItem[]> {
    const seq = ++this.completionSeq;
    const result = await this.rpc.request<
      CompletionItem[] | { items: CompletionItem[] } | null
    >("textDocument/completion", {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
    });
    if (seq !== this.completionSeq || result === null) return [];
    return Array.isArray(result) ? result : result.items;
  }

  async hover(
    path: string,
    line: number,
    character: number,
  ): Promise<string | null> {
    const result = await this.rpc.request<HoverResult | null>(
      "textDocument/hover",
      { textDocument: { uri: pathToUri(path) }, position: { line, character } },
    );
    return result === null ? null : hoverToMarkdown(result.contents);
  }

  onDiagnostics(cb: DiagnosticsListener): void {
    this.rpc.onNotification("textDocument/publishDiagnostics", (params) => {
      const p = params as
        | { uri?: string; diagnostics?: LspDiagnostic[] }
        | undefined;
      if (!p || typeof p.uri !== "string") return;
      const path = uriToPath(p.uri);
      const raw = Array.isArray(p.diagnostics) ? p.diagnostics : [];
      cb(path, lspToDiagnostics(path, raw), raw);
    });
  }

  handle(json: string): void {
    this.rpc.handle(json);
  }

  dispose(reason: string): void {
    this.disposed = true;
    for (const path of [...this.pendingChange.keys()]) this.cancelChange(path);
    this.rpc.rejectAll(reason);
  }

  private cancelChange(path: string): void {
    const handle = this.pendingChange.get(path);
    if (handle !== undefined) this.timers.clearTimeout(handle);
    this.pendingChange.delete(path);
  }
}
