export interface Tab {
  path: string;
  content: string;
  saved: string;
}

export interface EditorState {
  workspace: string | null;
  tabs: Tab[];
  active: string | null;
}

export type Action =
  | { type: 'workspace'; root: string }
  | { type: 'open'; path: string; content: string }
  | { type: 'edit'; path: string; content: string }
  | { type: 'saved'; path: string; content: string }
  | { type: 'close'; path: string }
  | { type: 'reloaded'; path: string; content: string }
  | { type: 'activate'; path: string };

export const initialState: EditorState = { workspace: null, tabs: [], active: null };

export const isDirty = (tab: Tab): boolean => tab.content !== tab.saved;

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'workspace':
      return { workspace: action.root, tabs: [], active: null };
    case 'open': {
      if (state.tabs.some((t) => t.path === action.path)) {
        return { ...state, active: action.path };
      }
      const tab: Tab = { path: action.path, content: action.content, saved: action.content };
      return { ...state, tabs: [...state.tabs, tab], active: action.path };
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
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.path === action.path ? { ...t, content: action.content, saved: action.content } : t)),
      };
    case 'activate':
      return state.tabs.some((t) => t.path === action.path) ? { ...state, active: action.path } : state;
  }
}
