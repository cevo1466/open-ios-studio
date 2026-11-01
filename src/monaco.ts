import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import { loader } from '@monaco-editor/react';
import { THEMES, monacoThemeName } from './theme/themes';

// Bundle Monaco locally: the desktop app must work offline and under a strict CSP.
(globalThis as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};
loader.config({ monaco });

// Register the extra colour themes once; the two defaults use Monaco's built-ins.
for (const def of THEMES) {
  if (def.id === 'dark' || def.id === 'light') continue;
  monaco.editor.defineTheme(monacoThemeName(def), def.monaco);
}
