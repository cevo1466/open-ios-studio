import { describe, expect, it } from "vitest";
import { SwiftLsp } from "./client";

function setup() {
  const sent: {
    method?: string;
    id?: number;
    params?: Record<string, unknown>;
  }[] = [];
  const timers: (() => void)[] = [];
  const lsp = new SwiftLsp(
    { send: (json) => sent.push(JSON.parse(json)) },
    {
      setTimeout: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeout: (handle) => {
        timers[(handle as number) - 1] = () => undefined;
      },
    },
  );
  const fire = () => {
    const due = timers.splice(0);
    for (const t of due) t();
  };
  return { sent, lsp, fire };
}

const respond = (lsp: SwiftLsp, id: number, result: unknown) =>
  lsp.handle(JSON.stringify({ jsonrpc: "2.0", id, result }));

describe("SwiftLsp", () => {
  it("change is debounced to one didChange with an increasing version", () => {
    const { sent, lsp, fire } = setup();
    lsp.open("/ws/A.swift", "a");
    expect(sent[0]).toMatchObject({
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: "file:///ws/A.swift",
          languageId: "swift",
          version: 1,
          text: "a",
        },
      },
    });
    lsp.change("/ws/A.swift", "ab");
    lsp.change("/ws/A.swift", "abc");
    expect(sent).toHaveLength(1);
    fire();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: "file:///ws/A.swift", version: 2 },
        contentChanges: [{ text: "abc" }],
      },
    });
    lsp.change("/ws/A.swift", "abcd");
    fire();
    expect(sent[2]).toMatchObject({
      method: "textDocument/didChange",
      params: {
        textDocument: { version: 3 },
        contentChanges: [{ text: "abcd" }],
      },
    });
    lsp.close("/ws/A.swift");
    expect(sent[3]).toMatchObject({
      method: "textDocument/didClose",
      params: { textDocument: { uri: "file:///ws/A.swift" } },
    });
  });

  it("non-swift paths are ignored", () => {
    const { sent, lsp, fire } = setup();
    lsp.open("/ws/xtool.yml", "version: 1");
    lsp.change("/ws/xtool.yml", "version: 2");
    fire();
    lsp.close("/ws/xtool.yml");
    expect(sent).toHaveLength(0);
  });

  it("initialize sends the root and then initialized", async () => {
    const { sent, lsp } = setup();
    const p = lsp.initialize("/ws");
    expect(sent[0]).toMatchObject({
      method: "initialize",
      params: { rootUri: "file:///ws", capabilities: {} },
    });
    respond(lsp, sent[0].id as number, { capabilities: {} });
    await p;
    expect(sent[1]).toMatchObject({ method: "initialized", params: {} });
  });

  it("completion results map to items", async () => {
    const { sent, lsp } = setup();
    const p = lsp.completion("/ws/A.swift", 3, 7);
    expect(sent[0]).toMatchObject({
      method: "textDocument/completion",
      params: {
        textDocument: { uri: "file:///ws/A.swift" },
        position: { line: 3, character: 7 },
      },
    });
    respond(lsp, sent[0].id as number, {
      isIncomplete: false,
      items: [
        {
          label: "append(_:)",
          kind: 2,
          detail: "Void",
          insertText: "append(${1:newElement})",
          insertTextFormat: 2,
        },
      ],
    });
    await expect(p).resolves.toEqual([
      {
        label: "append(_:)",
        kind: 2,
        detail: "Void",
        insertText: "append(${1:newElement})",
        insertTextFormat: 2,
      },
    ]);
    const q = lsp.completion("/ws/A.swift", 0, 0);
    respond(lsp, sent[1].id as number, [{ label: "x" }]);
    await expect(q).resolves.toEqual([{ label: "x" }]);
  });

  it("a completion answered after a newer request resolves empty", async () => {
    const { sent, lsp } = setup();
    const first = lsp.completion("/ws/A.swift", 0, 0);
    const second = lsp.completion("/ws/A.swift", 0, 1);
    respond(lsp, sent[0].id as number, [{ label: "old" }]);
    respond(lsp, sent[1].id as number, [{ label: "new" }]);
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([{ label: "new" }]);
  });

  it("hover flattens the server contents to markdown", async () => {
    const { sent, lsp } = setup();
    const a = lsp.hover("/ws/A.swift", 1, 1);
    respond(lsp, sent[0].id as number, {
      contents: { kind: "markdown", value: "```swift\nvar x: Int\n```" },
    });
    await expect(a).resolves.toBe("```swift\nvar x: Int\n```");
    const b = lsp.hover("/ws/A.swift", 1, 1);
    respond(lsp, sent[1].id as number, {
      contents: ["plain", { language: "swift", value: "let y" }],
    });
    await expect(b).resolves.toBe("plain\n\n```swift\nlet y\n```");
    const c = lsp.hover("/ws/A.swift", 1, 1);
    respond(lsp, sent[2].id as number, null);
    await expect(c).resolves.toBeNull();
  });

  it("publishDiagnostics reaches the callback as a path with mapped rows", () => {
    const { lsp } = setup();
    const seen: unknown[] = [];
    lsp.onDiagnostics((path, diags, raw) => seen.push({ path, diags, raw }));
    lsp.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: {
          uri: "file:///ws/Sources/A%20B.swift",
          diagnostics: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 3 },
              },
              severity: 2,
              message: "unused",
            },
          ],
        },
      }),
    );
    expect(seen).toEqual([
      {
        path: "/ws/Sources/A B.swift",
        diags: [
          {
            file: "/ws/Sources/A B.swift",
            line: 1,
            column: 1,
            severity: "warning",
            message: "unused (sourcekit-lsp)",
            raw: "/ws/Sources/A B.swift:1:1: warning: unused (sourcekit-lsp)",
          },
        ],
        raw: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 3 },
            },
            severity: 2,
            message: "unused",
          },
        ],
      },
    ]);
  });

  it("dispose cancels pending timers and fails outstanding requests", async () => {
    const { sent, lsp, fire } = setup();
    lsp.open("/ws/A.swift", "a");
    lsp.change("/ws/A.swift", "ab");
    const p = lsp.hover("/ws/A.swift", 0, 0);
    lsp.dispose("server exited");
    fire();
    await expect(p).rejects.toThrow("server exited");
    expect(
      sent.filter((m) => m.method === "textDocument/didChange"),
    ).toHaveLength(0);
  });
});
