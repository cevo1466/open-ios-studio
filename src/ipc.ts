import { Channel, invoke } from '@tauri-apps/api/core';
import type { AiEvent, ChatRequest, CliProviderId, CliStatus, ModelInfo, ProviderId, PtyEvent, PtyKind, PtyOptions } from './ai/types';
import type { PngHeader } from './preflight/icon';
import type { DoctorCheck } from './xtool/doctor';
import type { RunEvent, XtoolInfo, XtoolOp, XtoolRunArgs } from './xtool/types';

export interface Entry {
  name: string;
  /** Workspace-relative path with `/` separators. */
  path: string;
  isDir: boolean;
}

export interface ScanResult {
  files: { path: string; content: string }[];
  truncated: boolean;
  skipped: number;
}

export interface SkillsInstallReport {
  installed: string[];
  unchanged: string[];
  kept: string[];
}

export type UpdateAssetKind = 'deb' | 'app-image';
export type InstallKind = 'app-image' | 'deb' | 'unknown';

export interface UpdateInfo {
  current: string;
  latest: string;
  newer: boolean;
  prerelease: boolean;
  publishedAt: string | null;
  htmlUrl: string;
  assets: { name: string; size: number; kind: UpdateAssetKind | 'checksums' | 'other' }[];
  installKind: InstallKind;
}

export interface UpdateDownload {
  path: string;
  name: string;
  sha256: string;
  installCommand: string | null;
  canReplaceRunningAppimage: boolean;
}

export const inDesktopApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const ipc = {
  pickWorkspace: () => invoke<string | null>('pick_workspace'),
  listDir: (path: string) => invoke<Entry[]>('list_dir', { path }),
  readFile: (path: string) => invoke<string>('read_file', { path }),
  writeFile: (path: string, content: string) => invoke<void>('write_file', { path, content }),
  scanWorkspace: () => invoke<ScanResult>('scan_workspace'),
  xtoolDetect: () => invoke<XtoolInfo>('xtool_detect'),
  /** Read-only environment check: Swift, Darwin SDK, xtool, SDK/auth status, device, usbmuxd, git. */
  envDoctor: () => invoke<DoctorCheck[]>('env_doctor'),
  xtoolRun: (op: XtoolOp, args: XtoolRunArgs, onEvent: (event: RunEvent) => void) => {
    const channel = new Channel<RunEvent>();
    channel.onmessage = onEvent;
    return invoke<void>('xtool_run', { op, args, onEvent: channel });
  },
  xtoolCancel: () => invoke<void>('xtool_cancel'),
  readFileIfExists: (path: string) => invoke<string | null>('read_file_if_exists', { path }),
  applyFile: (path: string, content: string) => invoke<void>('apply_file', { path, content }),
  secretSet: (provider: ProviderId, key: string) => invoke<void>('secret_set', { provider, key }),
  secretDelete: (provider: ProviderId) => invoke<void>('secret_delete', { provider }),
  secretStatus: (provider: ProviderId) => invoke<boolean>('secret_status', { provider }),
  aiListModels: (provider: ProviderId) => invoke<ModelInfo[]>('ai_list_models', { provider }),
  aiStream: (request: ChatRequest, onEvent: (event: AiEvent) => void) => {
    const channel = new Channel<AiEvent>();
    channel.onmessage = onEvent;
    return invoke<void>('ai_stream', { request, onEvent: channel });
  },
  aiCancel: () => invoke<void>('ai_cancel'),
  cliStatus: (provider: CliProviderId) => invoke<CliStatus>('cli_status', { provider }),
  cliLoginTerminal: (provider: CliProviderId) => invoke<string>('cli_login_terminal', { provider }),
  cliStream: (request: ChatRequest, onEvent: (event: AiEvent) => void) => {
    const channel = new Channel<AiEvent>();
    channel.onmessage = onEvent;
    return invoke<void>('cli_stream', { request, onEvent: channel });
  },
  ptyOpen: (kind: PtyKind, options: PtyOptions | undefined, rows: number, cols: number, onEvent: (event: PtyEvent) => void) => {
    const channel = new Channel<PtyEvent>();
    channel.onmessage = onEvent;
    return invoke<number>('pty_open', { kind, options, rows, cols, onEvent: channel });
  },
  ptyWrite: (id: number, data: string) => invoke<void>('pty_write', { id, data }),
  ptyResize: (id: number, rows: number, cols: number) => invoke<void>('pty_resize', { id, rows, cols }),
  ptyClose: (id: number) => invoke<void>('pty_close', { id }),
  revealPath: (path: string, parent: boolean) => invoke<void>('reveal_path', { path, parent }),
  /** Copies the bundled agent skills into the open project's .claude/skills (edited files are kept). */
  skillsInstallBundled: () => invoke<SkillsInstallReport>('skills_install_bundled'),
  /** PNG signature + IHDR of a workspace file; null when the file does not exist. */
  readPngHeader: (path: string) => invoke<PngHeader | null>('read_png_header', { path }),
  /** Latest GitHub release of this project compared with the running version (read-only). */
  updateCheck: () => invoke<UpdateInfo>('update_check'),
  /** Downloads the DEB or AppImage into the downloads folder and verifies it against SHA256SUMS.txt. */
  updateDownload: (kind: UpdateAssetKind) => invoke<UpdateDownload>('update_download', { kind }),
  /** Replaces the running AppImage with a verified download; the app must be restarted afterwards. */
  updateApplyAppimage: (path: string, sha256: string) => invoke<string>('update_apply_appimage', { path, sha256 }),
  updateReveal: (path: string) => invoke<void>('update_reveal', { path }),
  createFile: (path: string) => invoke<void>('create_file', { path }),
};
