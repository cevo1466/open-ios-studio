import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { Tab } from '../state/store';
import { isDirty } from '../state/store';

const LANGUAGES: Record<string, string> = {
  swift: 'swift',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  plist: 'xml',
  xml: 'xml',
  json: 'json',
  sh: 'shell',
};

export const languageFor = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGES[ext] ?? 'plaintext';
};

interface Props {
  tabs: Tab[];
  active: string | null;
  theme: 'light' | 'dark';
  fontSize: number;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onSave: () => void;
}

export function EditorPane({ tabs, active, theme, fontSize, onActivate, onClose, onChange, onSave }: Props) {
  const current = tabs.find((t) => t.path === active);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const appliedRev = useRef(new Map<string, number>());
  const path = current?.path;
  const rev = current?.rev;
  const content = current?.content;

  // The editor is uncontrolled while the user types: feeding every keystroke back through React
  // state raced with fast input and scrambled characters. Only content replaced from outside the
  // editor (a new tab, a reload after an approved AI change) is pushed in, tracked by `rev`.
  useEffect(() => {
    if (path === undefined || rev === undefined) return;
    const seen = appliedRev.current.get(path);
    appliedRev.current.set(path, rev);
    if (seen === rev) return;
    const model = editorRef.current?.getModel();
    if (model && content !== undefined && model.getValue() !== content) model.setValue(content);
    // `content` is intentionally not a dependency: it changes on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, rev]);
  return (
    <section className="editor-pane" aria-label="Editor">
      <div className="tabs" role="tablist">
        {tabs.map((tab) => (
          <div key={tab.path} className={`tab${tab.path === active ? ' active' : ''}`}>
            <button type="button" role="tab" aria-selected={tab.path === active} onClick={() => onActivate(tab.path)}>
              {tab.path.split('/').pop()}
              {isDirty(tab) && <span className="dirty" title="Unsaved changes"> ●</span>}
            </button>
            <button type="button" className="tab-close" aria-label={`Close ${tab.path}`} onClick={() => onClose(tab.path)}>
              ×
            </button>
          </div>
        ))}
      </div>
      {current ? (
        <Editor
          path={current.path}
          language={languageFor(current.path)}
          defaultValue={current.content}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          options={{ fontSize, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false }}
          onChange={(value) => onChange(current.path, value ?? '')}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave);
          }}
        />
      ) : (
        <div className="empty">
          <h2>No file open</h2>
          <p>Pick a file in the explorer, or create one with “New file”.</p>
        </div>
      )}
    </section>
  );
}
