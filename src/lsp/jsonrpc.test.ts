import { describe, expect, it } from "vitest";
import { JsonRpcClient } from "./jsonrpc";

function setup() {
  const sent: string[] = [];
  const client = new JsonRpcClient((json) => sent.push(json));
  return { sent, client };
}

describe("JsonRpcClient", () => {
  it("request resolves with the matching id", async () => {
    const { sent, client } = setup();
    const p = client.request<{ ok: boolean }>("initialize", { rootUri: null });
    const msg = JSON.parse(sent[0]);
    expect(msg).toMatchObject({
      jsonrpc: "2.0",
      method: "initialize",
      params: { rootUri: null },
    });
    expect(client.pending).toBe(1);
    client.handle(
      JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }),
    );
    await expect(p).resolves.toEqual({ ok: true });
    expect(client.pending).toBe(0);
  });

  it("error responses reject with the server message", async () => {
    const { sent, client } = setup();
    const p = client.request("textDocument/hover", {});
    const { id } = JSON.parse(sent[0]);
    client.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: "boom" },
      }),
    );
    await expect(p).rejects.toThrow("boom");
  });

  it("stale response is ignored", () => {
    const { client } = setup();
    expect(() =>
      client.handle(JSON.stringify({ jsonrpc: "2.0", id: 999, result: 1 })),
    ).not.toThrow();
    expect(client.pending).toBe(0);
  });

  it("notification routes to its handler", () => {
    const { sent, client } = setup();
    const seen: unknown[] = [];
    client.onNotification("textDocument/publishDiagnostics", (params) =>
      seen.push(params),
    );
    client.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri: "file:///a.swift" },
      }),
    );
    expect(seen).toEqual([{ uri: "file:///a.swift" }]);
    client.notify("initialized", {});
    expect(JSON.parse(sent[0])).toEqual({
      jsonrpc: "2.0",
      method: "initialized",
      params: {},
    });
  });

  it("unknown server request is answered with MethodNotFound", () => {
    const { sent, client } = setup();
    client.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "workspace/configuration",
        params: {},
      }),
    );
    expect(JSON.parse(sent[0])).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32601, message: "method not found" },
    });
    client.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "client/registerCapability",
        params: {},
      }),
    );
    expect(JSON.parse(sent[1])).toEqual({
      jsonrpc: "2.0",
      id: 8,
      result: null,
    });
    client.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "window/workDoneProgress/create",
        params: {},
      }),
    );
    expect(JSON.parse(sent[2])).toEqual({
      jsonrpc: "2.0",
      id: 9,
      result: null,
    });
  });

  it("malformed JSON is ignored", () => {
    const { client } = setup();
    expect(() => client.handle("{not json")).not.toThrow();
  });

  it("rejectAll fails every pending request", async () => {
    const { client } = setup();
    const a = client.request("a", {});
    const b = client.request("b", {});
    client.rejectAll("server exited");
    await expect(a).rejects.toThrow("server exited");
    await expect(b).rejects.toThrow("server exited");
    expect(client.pending).toBe(0);
  });
});
