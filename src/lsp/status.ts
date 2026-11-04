/** The status-bar segment for the Swift language server. Labels are fixed by the design spec. */

export type LspPhase = "off" | "starting" | "running" | "stopped" | "missing";

export interface LspStatusInput {
  phase: LspPhase;
  /** The workspace root has `.bsp/xtool.json`, so sourcekit-lsp builds for the iOS target. */
  bsp: boolean;
}

export interface LspStatusLabel {
  label: string;
  tone: "ok" | "warn" | "off" | "unknown";
  title?: string;
}

export const LINUX_TARGET_TITLE =
  "Proje xtool build server tanımlamıyor; iOS'a özel API'ler hata olarak görünebilir.";
export const MISSING_TITLE =
  "sourcekit-lsp bulunamadı; Swift araç zinciriyle (swiftly) birlikte gelir.";

export function lspStatus({ phase, bsp }: LspStatusInput): LspStatusLabel {
  switch (phase) {
    case "off":
      return { label: "Swift LSP: kapalı", tone: "off" };
    case "starting":
      return { label: "Swift LSP: başlatılıyor", tone: "unknown" };
    case "running":
      return bsp
        ? { label: "Swift LSP: çalışıyor", tone: "ok" }
        : {
            label: "Swift LSP: Linux hedefi",
            tone: "warn",
            title: LINUX_TARGET_TITLE,
          };
    case "stopped":
      return { label: "Swift LSP: durdu", tone: "warn" };
    case "missing":
      return { label: "Swift LSP: yok", tone: "off", title: MISSING_TITLE };
  }
}
