/**
 * LSP diagnostics → the Problems-list shape used for xtool build output. Lines and columns become
 * 1-based; the source is appended to the text so a user can tell server rows from build rows.
 */
import type { Diagnostic } from "../xtool/types";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspDiagnostic {
  range: { start: LspPosition; end?: LspPosition };
  severity?: number;
  message: string;
}

export const LSP_SOURCE = "sourcekit-lsp";

function severityOf(code: number | undefined): Diagnostic["severity"] {
  if (code === 2) return "warning";
  if (code === 3 || code === 4) return "note";
  return "error";
}

export function lspToDiagnostics(
  path: string,
  diags: LspDiagnostic[],
): Diagnostic[] {
  return diags.map((d) => {
    const line = d.range.start.line + 1;
    const column = d.range.start.character + 1;
    const severity = severityOf(d.severity);
    const message = `${d.message} (${LSP_SOURCE})`;
    return {
      file: path,
      line,
      column,
      severity,
      message,
      raw: `${path}:${line}:${column}: ${severity}: ${message}`,
    };
  });
}

export function pathToUri(path: string): string {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function uriToPath(uri: string): string {
  const withoutScheme = uri.startsWith("file://")
    ? uri.slice("file://".length)
    : uri;
  return withoutScheme.split("/").map(decodeURIComponent).join("/");
}
