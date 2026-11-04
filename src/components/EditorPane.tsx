import { useEffect, useRef, type ReactNode } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { Tab, ViewId } from '../state/store';
import { isDirty } from '../state/store';
import { useThemeDef } from '../theme/ThemeContext';
import { monacoThemeName } from '../theme/themes';

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
  /** Non-file views open as tabs after the files (singletons, no dirty state). */
  views: { id: ViewId; title: string }[];
  /** The view in front, or null when the active file is. */
  activeView: ViewId | null;
  /** Rendered instead of the editor while a view is in front. */
  viewContent: ReactNode;
  theme: 'light' | 'dark';
  fontSize: number;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onActivateView: (id: ViewId) => void;
  onCloseView: (id: ViewId) => void;
  onChange: (path: string, content: string) => void;
  onSave: () => void;
  /** Called once per editor mount with the Monaco instance (language providers register here). */
  onEditorMount?: (editor: Parameters<OnMount>[0], monaco: Parameters<OnMount>[1]) => void;
}

export function EditorPane({ tabs, active, views, activeView, viewContent, theme, fontSize, onActivate, onClose, onActivateView, onCloseView, onChange, onSave, onEditorMount }: Props) {
  const themeDef = useThemeDef(theme);
  const current = activeView === null ? tabs.find((t) => t.path === active) : undefined;
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
    <section className="editor-pane" aria-label="Düzenleyici">
      <div className="tabs" role="tablist">
        {tabs.map((tab) => (
          <div key={tab.path} className={`tab${activeView === null && tab.path === active ? ' active' : ''}`}>
            <button type="button" role="tab" aria-selected={activeView === null && tab.path === active} onClick={() => onActivate(tab.path)}>
              {tab.path.split('/').pop()}
              {isDirty(tab) && <span className="dirty" title="Kaydedilmemiş değişiklikler"> ●</span>}
            </button>
            <button type="button" className="tab-close" aria-label={`${tab.path} sekmesini kapat`} onClick={() => onClose(tab.path)}>
              ×
            </button>
          </div>
        ))}
        {views.map((v) => (
          <div key={v.id} className={`tab view${v.id === activeView ? ' active' : ''}`}>
            <button type="button" role="tab" aria-selected={v.id === activeView} onClick={() => onActivateView(v.id)}>
              {v.title}
            </button>
            <button type="button" className="tab-close" aria-label={`${v.title} sekmesini kapat`} onClick={() => onCloseView(v.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
      {activeView !== null ? (
        viewContent
      ) : current ? (
        <Editor
          path={current.path}
          language={languageFor(current.path)}
          defaultValue={current.content}
          theme={monacoThemeName(themeDef)}
          options={{ fontSize, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false }}
          onChange={(value) => onChange(current.path, value ?? '')}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave);
            onEditorMount?.(editor, monaco);
          }}
        />
      ) : (
        <div className="empty">
          <h2>Açık dosya yok</h2>
          <p>Gezginden bir dosya seçin veya “Yeni dosya” ile oluşturun.</p>
        </div>
      )}
    </section>
  );
}
