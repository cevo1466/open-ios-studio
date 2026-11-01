import { Channel, invoke } from '@tauri-apps/api/core';
import type { AiEvent, ChatRequest, CliProviderId, CliStatus, ModelInfo, ProviderId, PtyEvent, PtyKind } from './ai/types';
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

export const inDesktopApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const ipc = {
  pickWorkspace: () => invoke<string | null>('pick_workspace'),
  listDir: (path: string) => invoke<Entry[]>('list_dir', { path }),
  readFile: (path: string) => invoke<string>('read_file', { path }),
  writeFile: (path: string, content: string) => invoke<void>('write_file', { path, content }),
  scanWorkspace: () => invoke<ScanResult>('scan_workspace'),
  xtoolDetect: () => invoke<XtoolInfo>('xtool_detect'),
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
  ptyOpen: (kind: PtyKind, rows: number, cols: number, onEvent: (event: PtyEvent) => void) => {
    const channel = new Channel<PtyEvent>();
    channel.onmessage = onEvent;
    return invoke<number>('pty_open', { kind, rows, cols, onEvent: channel });
  },
  ptyWrite: (id: number, data: string) => invoke<void>('pty_write', { id, data }),
  ptyResize: (id: number, rows: number, cols: number) => invoke<void>('pty_resize', { id, rows, cols }),
  ptyClose: (id: number) => invoke<void>('pty_close', { id }),
  createFile: (path: string) => invoke<void>('create_file', { path }),
};
