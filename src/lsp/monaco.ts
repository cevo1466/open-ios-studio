/**
 * Monaco glue for the Swift client: completion + hover providers for the `swift` language and the
 * marker conversion for inline diagnostics. The pure mapping functions take Monaco's enums as
 * arguments so they are unit-tested without loading the editor.
 */
import type * as Monaco from "monaco-editor";
import type { CompletionItem, SwiftLsp } from "./client";
import { LSP_SOURCE, type LspDiagnostic } from "./diagnostics";

type KindEnum = Record<string, number>;

/** LSP `CompletionItemKind` (1–25) → the name of Monaco's `CompletionItemKind` member. */
const LSP_KIND_NAMES: Record<number, string> = {
  1: "Text",
  2: "Method",
  3: "Function",
  4: "Constructor",
  5: "Field",
  6: "Variable",
  7: "Class",
  8: "Interface",
  9: "Module",
  10: "Property",
  11: "Unit",
  12: "Value",
  13: "Enum",
  14: "Keyword",
  15: "Snippet",
  16: "Color",
  17: "File",
  18: "Reference",
  19: "Folder",
  20: "EnumMember",
  21: "Constant",
  22: "Struct",
  23: "Event",
  24: "Operator",
  25: "TypeParameter",
};

export function completionKind(
  kinds: KindEnum,
  lspKind: number | undefined,
): number {
  const name = lspKind === undefined ? undefined : LSP_KIND_NAMES[lspKind];
  const value = name === undefined ? undefined : kinds[name];
  return value ?? kinds.Text ?? 0;
}

export interface MonacoRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** `snippetRule` is `CompletionItemInsertTextRule.InsertAsSnippet` (4). */
export function toMonacoCompletion(
  kinds: KindEnum,
  snippetRule: number,
  item: CompletionItem,
  fallbackRange: MonacoRange,
) {
  const edit = item.textEdit;
  const range: MonacoRange = edit
    ? {
        startLineNumber: edit.range.start.line + 1,
        startColumn: edit.range.start.character + 1,
        endLineNumber: edit.range.end.line + 1,
        endColumn: edit.range.end.character + 1,
      }
    : fallbackRange;
  const doc = item.documentation;
  return {
    label: item.label,
    kind: completionKind(kinds, item.kind),
    detail: item.detail,
    documentation:
      doc === undefined
        ? undefined
        : typeof doc === "string"
          ? doc
          : { value: doc.value },
    insertText: edit?.newText ?? item.insertText ?? item.label,
    insertTextRules: item.insertTextFormat === 2 ? snippetRule : undefined,
    range,
    filterText: item.filterText,
    sortText: item.sortText,
  };
}

/** `severities` is Monaco's `MarkerSeverity` enum. LSP 1/2/3/4 → Error/Warning/Info/Hint. */
export function toMonacoMarkers(severities: KindEnum, diags: LspDiagnostic[]) {
  const sev = (code: number | undefined) =>
    code === 2
      ? severities.Warning
      : code === 3
        ? severities.Info
        : code === 4
          ? severities.Hint
          : severities.Error;
  return diags.map((d) => ({
    startLineNumber: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    endLineNumber: (d.range.end ?? d.range.start).line + 1,
    endColumn: (d.range.end ?? d.range.start).character + 1,
    severity: sev(d.severity),
    message: d.message,
    source: LSP_SOURCE,
  }));
}

export interface SwiftProviderDeps {
  /** The live client, or null while the server is not running. */
  current(): SwiftLsp | null;
  /** Absolute path for a model URI, or null when the model is not a workspace Swift file. */
  resolvePath(uri: Monaco.Uri): string | null;
}

/** Registers completion and hover for `swift`. Returns a disposable; register once per Monaco instance. */
export function registerSwiftProviders(
  monaco: typeof Monaco,
  deps: SwiftProviderDeps,
): Monaco.IDisposable {
  const kinds = monaco.languages.CompletionItemKind as unknown as KindEnum;
  const snippetRule =
    monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const completion = monaco.languages.registerCompletionItemProvider("swift", {
    triggerCharacters: [".", "(", ":"],
    provideCompletionItems: async (model, position) => {
      const lsp = deps.current();
      const path = deps.resolvePath(model.uri);
      if (!lsp || path === null) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const fallback: MonacoRange = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      };
      try {
        const items = await lsp.completion(
          path,
          position.lineNumber - 1,
          position.column - 1,
        );
        return {
          suggestions: items.map((i) =>
            toMonacoCompletion(kinds, snippetRule, i, fallback),
          ),
        };
      } catch {
        return { suggestions: [] };
      }
    },
  });
  const hover = monaco.languages.registerHoverProvider("swift", {
    provideHover: async (model, position) => {
      const lsp = deps.current();
      const path = deps.resolvePath(model.uri);
      if (!lsp || path === null) return null;
      try {
        const text = await lsp.hover(
          path,
          position.lineNumber - 1,
          position.column - 1,
        );
        return text === null ? null : { contents: [{ value: text }] };
      } catch {
        return null;
      }
    },
  });
  return {
    dispose: () => {
      completion.dispose();
      hover.dispose();
    },
  };
}

/** Replaces the server's markers on the model of `path`, if that model is open. */
export function setSwiftMarkers(
  monaco: typeof Monaco,
  resolvePath: (uri: Monaco.Uri) => string | null,
  path: string,
  diags: LspDiagnostic[],
): void {
  const severities = monaco.MarkerSeverity as unknown as KindEnum;
  for (const model of monaco.editor.getModels()) {
    if (resolvePath(model.uri) === path)
      monaco.editor.setModelMarkers(
        model,
        LSP_SOURCE,
        toMonacoMarkers(severities, diags),
      );
  }
}
