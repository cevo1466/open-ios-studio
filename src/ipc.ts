import { Channel, invoke } from '@tauri-apps/api/core';
import type { AiEvent, ChatRequest, ModelInfo, ProviderId } from './ai/types';
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
  createFile: (path: string) => invoke<void>('create_file', { path }),
};
