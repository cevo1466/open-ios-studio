/** Contract with the Rust release commands (src-tauri/src/lib.rs). camelCase mirrors serde. */

export interface AscStatus {
  configured: boolean;
  issuerId: string | null;
  keyId: string | null;
}

export interface RepackSummary {
  appName: string;
  iconsWritten: number;
  ipadOrientationsRemoved: boolean;
  privacyManifestAdded: boolean;
  buildNumberSet: string | null;
  warnings: string[];
}

export interface PrepareSummary {
  certificateCreated: boolean;
  profileName: string;
  profileUuid: string;
  profileExpires: string | null;
}

export type UploadEvent =
  | { kind: 'created'; uploadId: string }
  | { kind: 'part'; done: number; total: number }
  | { kind: 'committed' }
  | { kind: 'state'; state: string };
