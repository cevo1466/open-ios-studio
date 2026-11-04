import { describe, expect, it } from "vitest";
import { completionKind, toMonacoCompletion, toMonacoMarkers } from "./monaco";

const KINDS = {
  Text: 18,
  Method: 0,
  Function: 1,
  Constructor: 2,
  Field: 3,
  Variable: 4,
  Class: 5,
  Struct: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Enum: 15,
  EnumMember: 16,
  Keyword: 17,
  Snippet: 27,
  Constant: 14,
  TypeParameter: 24,
};
const SEVERITY = { Error: 8, Warning: 4, Info: 2, Hint: 1 };

describe("monaco mapping", () => {
  it("maps LSP completion kinds to Monaco kinds and falls back to Text", () => {
    expect(completionKind(KINDS, 2)).toBe(KINDS.Method);
    expect(completionKind(KINDS, 3)).toBe(KINDS.Function);
    expect(completionKind(KINDS, 22)).toBe(KINDS.Struct);
    expect(completionKind(KINDS, 14)).toBe(KINDS.Keyword);
    expect(completionKind(KINDS, undefined)).toBe(KINDS.Text);
    expect(completionKind(KINDS, 99)).toBe(KINDS.Text);
  });

  it("builds a Monaco completion with snippet rules and the server edit range", () => {
    const fallback = {
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 5,
    };
    const item = toMonacoCompletion(
      KINDS,
      4,
      {
        label: "append(_:)",
        kind: 2,
        detail: "Void",
        insertTextFormat: 2,
        textEdit: {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 4 },
          },
          newText: "append(${1:x})",
        },
        filterText: "append",
        sortText: "0001",
      },
      fallback,
    );
    expect(item).toEqual({
      label: "append(_:)",
      kind: KINDS.Method,
      detail: "Void",
      documentation: undefined,
      insertText: "append(${1:x})",
      insertTextRules: 4,
      range: {
        startLineNumber: 2,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 5,
      },
      filterText: "append",
      sortText: "0001",
    });
    const plain = toMonacoCompletion(KINDS, 4, { label: "count" }, fallback);
    expect(plain).toMatchObject({
      label: "count",
      insertText: "count",
      range: fallback,
      kind: KINDS.Text,
    });
    expect(plain.insertTextRules).toBeUndefined();
  });

  it("turns diagnostics into markers with 1-based positions", () => {
    expect(
      toMonacoMarkers(SEVERITY, [
        {
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 9 },
          },
          severity: 1,
          message: "bad",
        },
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          severity: 2,
          message: "meh",
        },
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 1 },
          },
          severity: 4,
          message: "hint",
        },
      ]),
    ).toEqual([
      {
        startLineNumber: 3,
        startColumn: 5,
        endLineNumber: 3,
        endColumn: 10,
        severity: 8,
        message: "bad",
        source: "sourcekit-lsp",
      },
      {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
        severity: 4,
        message: "meh",
        source: "sourcekit-lsp",
      },
      {
        startLineNumber: 2,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 2,
        severity: 1,
        message: "hint",
        source: "sourcekit-lsp",
      },
    ]);
  });
});
