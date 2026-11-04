import { describe, expect, it } from "vitest";
import { lspStatus } from "./status";

describe("lspStatus", () => {
  it("names every phase", () => {
    expect(lspStatus({ phase: "off", bsp: true })).toEqual({
      label: "Swift LSP: kapalı",
      tone: "off",
    });
    expect(lspStatus({ phase: "starting", bsp: true })).toEqual({
      label: "Swift LSP: başlatılıyor",
      tone: "unknown",
    });
    expect(lspStatus({ phase: "running", bsp: true })).toEqual({
      label: "Swift LSP: çalışıyor",
      tone: "ok",
    });
    expect(lspStatus({ phase: "stopped", bsp: true })).toEqual({
      label: "Swift LSP: durdu",
      tone: "warn",
    });
    expect(lspStatus({ phase: "missing", bsp: true })).toEqual({
      label: "Swift LSP: yok",
      tone: "off",
      title:
        "sourcekit-lsp bulunamadı; Swift araç zinciriyle (swiftly) birlikte gelir.",
    });
  });

  it("flags a workspace without the xtool build server", () => {
    expect(lspStatus({ phase: "running", bsp: false })).toEqual({
      label: "Swift LSP: Linux hedefi",
      tone: "warn",
      title:
        "Proje xtool build server tanımlamıyor; iOS'a özel API'ler hata olarak görünebilir.",
    });
  });
});
