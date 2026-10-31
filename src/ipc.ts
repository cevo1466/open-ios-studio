import { invoke } from '@tauri-apps/api/core';

export interface Entry {
  name: string;
  /** Workspace-relative path with `/` separators. */
  path: string;
  isDir: boolean;
}

export const inDesktopApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const ipc = {
  pickWorkspace: () => invoke<string | null>('pick_workspace'),
  listDir: (path: string) => invoke<Entry[]>('list_dir', { path }),
  readFile: (path: string) => invoke<string>('read_file', { path }),
  writeFile: (path: string, content: string) => invoke<void>('write_file', { path, content }),
  createFile: (path: string) => invoke<void>('create_file', { path }),
};
