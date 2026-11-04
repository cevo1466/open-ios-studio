/**
 * Minimal JSON-RPC 2.0 client over a string transport (one JSON document per call). Request ids
 * are numbers; responses with an unknown id (stale completion after a cancel, or after `rejectAll`)
 * are dropped silently. Server-to-client requests get MethodNotFound, except the two housekeeping
 * ones sourcekit-lsp sends, which are acknowledged with `null`.
 */

export const METHOD_NOT_FOUND = -32601;

const ACKNOWLEDGED_SERVER_REQUESTS = new Set([
  "window/workDoneProgress/create",
  "client/registerCapability",
]);

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface Incoming {
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export class JsonRpcClient {
  private nextId = 1;
  private readonly inflight = new Map<number, Pending>();
  private readonly handlers = new Map<string, (params: unknown) => void>();

  constructor(private readonly send: (json: string) => void) {}

  get pending(): number {
    return this.inflight.size;
  }

  request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.inflight.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  notify(method: string, params: unknown): void {
    this.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.handlers.set(method, handler);
  }

  /** Feed one JSON document from the server. Never throws. */
  handle(json: string): void {
    let msg: Incoming;
    try {
      msg = JSON.parse(json) as Incoming;
    } catch {
      return;
    }
    if (msg === null || typeof msg !== "object") return;
    if (typeof msg.method === "string") {
      if (msg.id === undefined || msg.id === null) {
        this.handlers.get(msg.method)?.(msg.params);
        return;
      }
      if (ACKNOWLEDGED_SERVER_REQUESTS.has(msg.method)) {
        this.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: null }));
      } else {
        this.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: METHOD_NOT_FOUND, message: "method not found" },
          }),
        );
      }
      return;
    }
    if (typeof msg.id !== "number") return;
    const pending = this.inflight.get(msg.id);
    if (!pending) return;
    this.inflight.delete(msg.id);
    if (msg.error)
      pending.reject(
        new Error(
          msg.error.message ?? `JSON-RPC error ${msg.error.code ?? ""}`.trim(),
        ),
      );
    else pending.resolve(msg.result);
  }

  /** Fail every outstanding request (server exited or was restarted). */
  rejectAll(reason: string): void {
    const all = [...this.inflight.values()];
    this.inflight.clear();
    for (const p of all) p.reject(new Error(reason));
  }
}
