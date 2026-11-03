/**
 * Asks before the desktop window closes with unsaved changes: intercepts the close request,
 * shows the prompt, saves everything or discards, then destroys the window.
 */
import { useEffect, useRef, useState, type Dispatch } from 'react';
import { ipc } from '../ipc';
import { dirtyTabs, saveAllDirty } from '../state/closeGuard';
import type { Action, Tab } from '../state/store';

export interface CloseGuardHandle {
  prompt: boolean;
  busy: boolean;
  error: string | null;
  saveAndClose: () => Promise<void>;
  discardAndClose: () => void;
  cancel: () => void;
}

export function useCloseGuard(desktop: boolean, tabs: Tab[], dispatch: Dispatch<Action>): CloseGuardHandle {
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  const [prompt, setPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ask before the window closes with unsaved changes (desktop app only).
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested((event) => {
          if (dirtyTabs(tabsRef.current).length > 0) {
            event.preventDefault();
            setPrompt(true);
          }
        }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* window API unavailable: closing is not guarded */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [desktop]);

  const forceClose = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().destroy();
    } catch (e) {
      setBusy(false);
      setError(`Pencere kapatılamadı: ${String(e)}`);
    }
  };

  const saveAndClose = async () => {
    setBusy(true);
    setError(null);
    const result = await saveAllDirty(tabsRef.current, ipc.writeFile);
    for (const s of result.saved) dispatch({ type: 'saved', path: s.path, content: s.content });
    if (result.failed.length > 0) {
      setBusy(false);
      setError(`Kaydedilemedi: ${result.failed.map((f) => `${f.path} (${f.error})`).join(', ')}`);
      return;
    }
    await forceClose();
  };

  const discardAndClose = () => {
    setBusy(true);
    void forceClose();
  };

  const cancel = () => {
    setPrompt(false);
    setError(null);
  };

  return { prompt, busy, error, saveAndClose, discardAndClose, cancel };
}
