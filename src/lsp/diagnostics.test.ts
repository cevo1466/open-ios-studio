import { describe, expect, it } from "vitest";
import { lspToDiagnostics, uriToPath, pathToUri } from "./diagnostics";

describe("lspToDiagnostics", () => {
  it("maps severity and 1-based lines", () => {
    const out = lspToDiagnostics("/ws/Sources/A.swift", [
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
          start: { line: 5, character: 1 },
          end: { line: 5, character: 1 },
        },
        severity: 3,
        message: "info",
      },
      {
        range: {
          start: { line: 6, character: 1 },
          end: { line: 6, character: 1 },
        },
        severity: 4,
        message: "hint",
      },
      {
        range: {
          start: { line: 7, character: 1 },
          end: { line: 7, character: 1 },
        },
        message: "no severity",
      },
    ]);
    const f = "/ws/Sources/A.swift";
    expect(out).toEqual([
      {
        file: f,
        line: 3,
        column: 5,
        severity: "error",
        message: "bad (sourcekit-lsp)",
        raw: `${f}:3:5: error: bad (sourcekit-lsp)`,
      },
      {
        file: f,
        line: 1,
        column: 1,
        severity: "warning",
        message: "meh (sourcekit-lsp)",
        raw: `${f}:1:1: warning: meh (sourcekit-lsp)`,
      },
      {
        file: f,
        line: 6,
        column: 2,
        severity: "note",
        message: "info (sourcekit-lsp)",
        raw: `${f}:6:2: note: info (sourcekit-lsp)`,
      },
      {
        file: f,
        line: 7,
        column: 2,
        severity: "note",
        message: "hint (sourcekit-lsp)",
        raw: `${f}:7:2: note: hint (sourcekit-lsp)`,
      },
      {
        file: f,
        line: 8,
        column: 2,
        severity: "error",
        message: "no severity (sourcekit-lsp)",
        raw: `${f}:8:2: error: no severity (sourcekit-lsp)`,
      },
    ]);
  });
});

describe("uri helpers", () => {
  it("round-trips paths with spaces and Turkish letters", () => {
    const p = "/ws/Kaynak Dosyaları/İçerik.swift";
    expect(uriToPath(pathToUri(p))).toBe(p);
    expect(pathToUri("/ws/a b.swift")).toBe("file:///ws/a%20b.swift");
  });
});

 describe("Windows URI helpers", () => {
  it("encodes a drive path and removes the canonical prefix", () => {
    expect(pathToUri("C:\\Work\\a b.swift")).toBe("file:///C:/Work/a%20b.swift");
    expect(uriToPath("file:///c:/Work/a%20b.swift")).toBe("c:/Work/a b.swift");
    expect(pathToUri("\\\\?\\C:\\Work\\A.swift")).toBe("file:///C:/Work/A.swift");
  });
  it("round trips UNC paths and Unicode", () => {
    expect(pathToUri("\\\\host\\share\\İçerik.swift")).toBe("file://host/share/%C4%B0%C3%A7erik.swift");
    expect(uriToPath("file://host/share/%C4%B0%C3%A7erik.swift")).toBe("//host/share/İçerik.swift");
  });
});
