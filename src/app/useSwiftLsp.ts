/**
 * One sourcekit-lsp session per open workspace. Starts the server through the Rust backend,
 * drives `initialize`, forwards document events from the editor, keeps the server's diagnostics
 * for the Problems tab and paints them as Monaco markers. Everything degrades to "off": a missing
 * server only changes the status-bar label.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { ipc } from "../ipc";
import { SwiftLsp, isSwiftPath } from "../lsp/client";
import type { LspDiagnostic } from "../lsp/diagnostics";
import { registerSwiftProviders, setSwiftMarkers } from "../lsp/monaco";
import { lspStatus, type LspPhase, type LspStatusLabel } from "../lsp/status";
import type { Tab } from "../state/store";
import type { Diagnostic } from "../xtool/types";

export interface SwiftLspOptions {
  workspace: string | null;
  desktop: boolean;
  /** Open file tabs; a server that finishes starting is told about the Swift ones. */
  tabs: Tab[];
}

export interface SwiftLspHandle {
  status: LspStatusLabel;
  /** Server diagnostics with workspace-relative file paths, for the Problems tab. */
  diagnostics: Diagnostic[];
  restart(): void;
  attach(
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco,
  ): void;
  notifyOpen(path: string, text: string): void;
  notifyChange(path: string, text: string): void;
  notifyClose(path: string): void;
}

const MISSING = "sourcekit-lsp was not found";
const EMPTY: Map<string, Diagnostic[]> = new Map();

interface SessionState {
  key: string;
  phase: LspPhase;
  bsp: boolean;
  byPath: Map<string, Diagnostic[]>;
}

export function useSwiftLsp({
  workspace,
  desktop,
  tabs,
}: SwiftLspOptions): SwiftLspHandle {
  const [generation, setGeneration] = useState(0);
  /** Session state is keyed by workspace + restart count: a stale key reads as a fresh start. */
  const key = `${workspace ?? ""}#${generation}`;
  const [session, setSession] = useState<SessionState>({
    key: "",
    phase: "starting",
    bsp: true,
    byPath: new Map(),
  });
  const live = session.key === key ? session : null;
  const phase: LspPhase =
    !desktop || workspace === null ? "off" : (live?.phase ?? "starting");
  const bsp = live?.bsp ?? true;
  const byPath = live?.byPath ?? EMPTY;
  const update = useCallback(
    (k: string, patch: (prev: SessionState) => Partial<SessionState>) =>
      setSession((prev) => {
        const base =
          prev.key === k
            ? prev
            : {
                key: k,
                phase: "starting" as LspPhase,
                bsp: true,
                byPath: EMPTY,
              };
        return { ...base, ...patch(base) };
      }),
    [],
  );
  const clientRef = useRef<SwiftLsp | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const providersRef = useRef<Monaco.IDisposable | null>(null);
  const rawRef = useRef(new Map<string, LspDiagnostic[]>());
  const tabsRef = useRef(tabs);
  const workspaceRef = useRef(workspace);
  useEffect(() => {
    tabsRef.current = tabs;
    workspaceRef.current = workspace;
  }, [tabs, workspace]);

  const abs = useCallback(
    (rel: string) => `${workspaceRef.current ?? ""}/${rel}`,
    [],
  );
  const rel = useCallback((path: string) => {
    const root = `${workspaceRef.current ?? ""}/`;
    return path.startsWith(root) ? path.slice(root.length) : path;
  }, []);
  /** Monaco model URIs are `file:///<workspace-relative path>` (the editor's `path` prop). */
  const resolvePath = useCallback(
    (uri: Monaco.Uri): string | null => {
      const r = uri.path.replace(/^\/+/, "");
      return workspaceRef.current !== null && isSwiftPath(r) ? abs(r) : null;
    },
    [abs],
  );

  useEffect(() => {
    if (!desktop || workspace === null) return;
    const k = key;
    let cancelled = false;
    let sessionId: number | null = null;
    const client = new SwiftLsp({
      send: (json) => {
        if (sessionId !== null)
          void ipc.lspSend(sessionId, json).catch(() => undefined);
      },
    });
    clientRef.current = client;
    rawRef.current = new Map();
    client.onDiagnostics((path, diags, raw) => {
      if (cancelled) return;
      rawRef.current.set(path, raw);
      const r = rel(path);
      update(k, (prev) => {
        const next = new Map(prev.byPath);
        if (diags.length === 0) next.delete(r);
        else
          next.set(
            r,
            diags.map((d) => ({ ...d, file: r })),
          );
        return { byPath: next };
      });
      if (monacoRef.current)
        setSwiftMarkers(monacoRef.current, resolvePath, path, raw);
    });
    ipc
      .lspStart((event) => {
        if (cancelled) return;
        if (event.kind === "message") client.handle(event.json);
        else {
          client.dispose(
            event.kind === "exit"
              ? "the language server exited"
              : event.message,
          );
          update(k, () => ({ phase: "stopped" }));
        }
      })
      .then(async (started) => {
        if (cancelled) return;
        sessionId = started.id;
        update(k, () => ({ bsp: started.bsp }));
        await client.initialize(workspace);
        if (cancelled) return;
        update(k, () => ({ phase: "running" }));
        for (const t of tabsRef.current) client.open(abs(t.path), t.content);
      })
      .catch((e) => {
        if (cancelled) return;
        update(k, () => ({
          phase: String(e).includes(MISSING) ? "missing" : "stopped",
        }));
      });
    return () => {
      cancelled = true;
      client.dispose("the language server was stopped");
      if (clientRef.current === client) clientRef.current = null;
      void ipc.lspStop().catch(() => undefined);
    };
  }, [desktop, workspace, key, abs, rel, resolvePath, update]);

  const attach = useCallback(
    (_editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      if (monacoRef.current === monaco) return;
      providersRef.current?.dispose();
      monacoRef.current = monaco;
      providersRef.current = registerSwiftProviders(monaco, {
        current: () => clientRef.current,
        resolvePath,
      });
    },
    [resolvePath],
  );

  const diagnostics = useMemo(() => [...byPath.values()].flat(), [byPath]);
  const status = useMemo(() => lspStatus({ phase, bsp }), [phase, bsp]);

  return {
    status,
    diagnostics,
    restart: useCallback(() => setGeneration((g) => g + 1), []),
    attach,
    notifyOpen: useCallback(
      (path: string, text: string) => clientRef.current?.open(abs(path), text),
      [abs],
    ),
    notifyChange: useCallback(
      (path: string, text: string) =>
        clientRef.current?.change(abs(path), text),
      [abs],
    ),
    notifyClose: useCallback(
      (path: string) => clientRef.current?.close(abs(path)),
      [abs],
    ),
  };
}
