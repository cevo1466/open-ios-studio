export interface Tab {
  path: string;
  content: string;
  saved: string;
  /** Changes when the content was replaced from outside the editor (open, reload from disk). */
  rev: number;
}

/** Non-file views that open as editor tabs (VS Code's Settings/Welcome model). Singletons. */
export type ViewId = 'appstore' | 'security' | 'preflight';

export const VIEW_TITLE: Record<ViewId, string> = {
  appstore: 'App Store Hazırlığı',
  security: 'Güvenlik Merkezi',
  preflight: 'Yayın öncesi denetim',
};

export interface EditorState {
  workspace: string | null;
  tabs: Tab[];
  /** Active file; shown when no view is in front. */
  active: string | null;
  revCounter: number;
  /** Open view tabs in strip order. */
  views: ViewId[];
  /** The view in front, or null when the active file is. */
  activeView: ViewId | null;
}

export type Action =
  | { type: 'workspace'; root: string }
  | { type: 'open'; path: string; content: string }
  | { type: 'edit'; path: string; content: string }
  | { type: 'saved'; path: string; content: string }
  | { type: 'close'; path: string }
  | { type: 'reloaded'; path: string; content: string }
  | { type: 'activate'; path: string }
  | { type: 'openView'; id: ViewId }
  | { type: 'closeView'; id: ViewId }
  | { type: 'activateView'; id: ViewId };

export const initialState: EditorState = { workspace: null, tabs: [], active: null, revCounter: 0, views: [], activeView: null };

export const isDirty = (tab: Tab): boolean => tab.content !== tab.saved;

/** What Ctrl+W closes: the view in front, else the active file, else nothing. */
export function tabToClose(state: EditorState): { kind: 'view'; id: ViewId } | { kind: 'file'; path: string } | null {
  if (state.activeView !== null) return { kind: 'view', id: state.activeView };
  if (state.active !== null) return { kind: 'file', path: state.active };
  return null;
}

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'workspace':
      return { workspace: action.root, tabs: [], active: null, revCounter: state.revCounter, views: [], activeView: null };
    case 'open': {
      if (state.tabs.some((t) => t.path === action.path)) {
        return { ...state, active: action.path, activeView: null };
      }
      const tab: Tab = { path: action.path, content: action.content, saved: action.content, rev: state.revCounter + 1 };
      return { ...state, tabs: [...state.tabs, tab], active: action.path, revCounter: state.revCounter + 1, activeView: null };
    }
    case 'edit':
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.path === action.path ? { ...t, content: action.content } : t)),
      };
    case 'saved':
      // Only the saved snapshot moves; edits made while the write was in flight stay dirty.
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.path === action.path ? { ...t, saved: action.content } : t)),
      };
    case 'close': {
      const index = state.tabs.findIndex((t) => t.path === action.path);
      if (index === -1) return state;
      const tabs = state.tabs.filter((t) => t.path !== action.path);
      const active =
        state.active === action.path ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? null) : state.active;
      return { ...state, tabs, active };
    }
    case 'reloaded':
      // The file was rewritten on disk (approved AI change): editor and saved snapshot both follow it.
      if (!state.tabs.some((t) => t.path === action.path)) return state;
      return {
        ...state,
        revCounter: state.revCounter + 1,
        tabs: state.tabs.map((t) =>
          t.path === action.path ? { ...t, content: action.content, saved: action.content, rev: state.revCounter + 1 } : t,
        ),
      };
    case 'activate':
      return state.tabs.some((t) => t.path === action.path) ? { ...state, active: action.path, activeView: null } : state;
    case 'openView':
      return {
        ...state,
        views: state.views.includes(action.id) ? state.views : [...state.views, action.id],
        activeView: action.id,
      };
    case 'activateView':
      return state.views.includes(action.id) ? { ...state, activeView: action.id } : state;
    case 'closeView': {
      const index = state.views.indexOf(action.id);
      if (index === -1) return state;
      const views = state.views.filter((v) => v !== action.id);
      const activeView = state.activeView === action.id ? (views[Math.min(index, views.length - 1)] ?? null) : state.activeView;
      return { ...state, views, activeView };
    }
  }
}
