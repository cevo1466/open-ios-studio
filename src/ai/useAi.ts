import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ipc } from '../ipc';
import type { ProjectFile } from '../policy/types';
import type { Diagnostic } from '../xtool/types';
import { approvedChanges, chatReducer, initialChatState, type ChatState } from './chatState';
import { applyBlockedReason, filesForRepair, findingsForChanges, MAX_REPAIR_ATTEMPTS, prepareContext, toPending } from './engine';
import { buildGenerationMessages, buildPlanMessages, buildRepairMessages } from './prompts';
import { parseProposedChanges } from './protocol';
import { loadAiSettings, saveAiSettings, type AiSettings } from './settings';
import { loadConversation, saveConversation } from './storage';
import type { AiEvent, ChatMessage, ProviderId } from './types';

interface Params {
  workspace: string | null;
  openPaths: string[];
  activePath: string | null;
  dirtyPaths: string[];
  diagnostics: Diagnostic[];
  buildFailed: boolean;
  /** Called after approved files were written, so the editor and explorer can refresh. */
  onApplied: (paths: string[]) => void;
}

const HISTORY_LIMIT = 10;

export function useAi(params: Params) {
  const { workspace, openPaths, activePath, dirtyPaths, diagnostics, buildFailed, onApplied } = params;
  const [settings, setSettingsState] = useState<AiSettings>(loadAiSettings);
  const [chat, dispatch] = useReducer(chatReducer, initialChatState);
  const [keyStored, setKeyStored] = useState<boolean | null>(null);
  const [keyringError, setKeyringError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [contextSummary, setContextSummary] = useState('henüz hazırlanmadı');
  const [applying, setApplying] = useState(false);
  const [repairAttempt, setRepairAttempt] = useState(0);
  const lastGoal = useRef('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Switching project swaps the conversation (React's "adjust state while rendering" pattern).
  if (workspace !== loadedFor) {
    setLoadedFor(workspace);
    if (workspace) {
      const saved = loadConversation(workspace);
      dispatch(saved ? { type: 'load', state: saved } : { type: 'reset' });
    }
    setRepairAttempt(0);
  }

  const provider = settings.provider;
  const needsKey = provider !== 'ollama';

  const setSettings = useCallback((next: AiSettings) => {
    setSettingsState(next);
    saveAiSettings(next);
  }, []);

  const refreshKey = useCallback(async (p: ProviderId) => {
    if (p === 'ollama') return;
    try {
      setKeyStored(await ipc.secretStatus(p));
      setKeyringError(null);
    } catch (e) {
      setKeyStored(false);
      setKeyringError(String(e));
    }
  }, []);

  const refreshModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      setModels((await ipc.aiListModels(provider)).map((m) => m.id));
    } catch (e) {
      setModels([]);
      setModelsError(String(e));
    } finally {
      setModelsLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    if (provider === 'ollama') return;
    let cancelled = false;
    ipc
      .secretStatus(provider)
      .then((stored) => {
        if (cancelled) return;
        setKeyStored(stored);
        setKeyringError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setKeyStored(false);
        setKeyringError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    if (workspace && chat.status === 'idle') saveConversation(workspace, chat);
  }, [workspace, chat]);


  const setKey = useCallback(
    async (key: string) => {
      try {
        await ipc.secretSet(provider, key);
        setKeyringError(null);
        await refreshKey(provider);
      } catch (e) {
        setKeyringError(String(e));
      }
    },
    [provider, refreshKey],
  );

  const deleteKey = useCallback(async () => {
    try {
      await ipc.secretDelete(provider);
      setKeyringError(null);
      await refreshKey(provider);
    } catch (e) {
      setKeyringError(String(e));
    }
  }, [provider, refreshKey]);

  /** Stream one model answer into the chat; resolves with the full text, or null on error/cancel. */
  const stream = useCallback(
    async (messages: ChatMessage[]): Promise<string | null> => {
      let text = '';
      let failed = false;
      dispatch({ type: 'assistantStart' });
      const onEvent = (event: AiEvent) => {
        if (event.kind === 'delta') {
          text += event.text;
          dispatch({ type: 'assistantDelta', text: event.text });
        } else if (event.kind === 'done') {
          dispatch({
            type: 'assistantDone',
            stopReason: event.stopReason,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
          });
        } else {
          failed = true;
          dispatch({ type: 'assistantError', message: event.message });
        }
      };
      try {
        await ipc.aiStream({ provider, model: settings.models[provider], messages }, onEvent);
      } catch (e) {
        failed = true;
        dispatch({ type: 'assistantError', message: String(e) });
      }
      return failed ? null : text;
    },
    [provider, settings.models],
  );

  const reviewProposal = useCallback(
    async (text: string, files: ProjectFile[]) => {
      const parsed = parseProposedChanges(text);
      if (parsed.problems.length > 0) {
        dispatch({ type: 'note', text: `Doğrulama tarafından yok sayıldı: ${parsed.problems.join('; ')}` });
      }
      if (parsed.changes.length === 0) return;
      const originals: Record<string, string | null> = {};
      for (const c of parsed.changes) {
        try {
          originals[c.path] = await ipc.readFileIfExists(c.path);
        } catch {
          originals[c.path] = null;
        }
      }
      dispatch({ type: 'setPending', changes: toPending(parsed.changes, originals, findingsForChanges(files, parsed.changes)) });
    },
    [],
  );

  const send = useCallback(
    async (userText: string, mode: 'chat' | 'generate' | 'plan') => {
      if (!workspace) return;
      lastGoal.current = userText;
      if (mode === 'generate') setRepairAttempt(0);
      const history: ChatMessage[] = chat.messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error && m.content)
        .slice(-HISTORY_LIMIT)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          // Earlier file blocks are summarised so history cannot blow the context budget.
          content: m.content
            .replace(/<<<FILE path="([^"]+)">>>[\s\S]*?<<<END FILE>>>/g, '[proposed file $1]')
            .slice(0, 6000),
        }));
      dispatch({ type: 'userMessage', text: userText });
      dispatch({ type: 'clearPending' });
      try {
        const scan = await ipc.scanWorkspace();
        const ctx = prepareContext({ files: scan.files, openPaths, activePath, settings });
        setContextSummary(ctx.summary);
        const messages =
          mode === 'plan'
            ? buildPlanMessages({
                userRequest: userText,
                projectContext: ctx.projectContext,
                policyContext: ctx.policyContext,
              })
            : buildGenerationMessages({
                userRequest: userText,
                projectContext: ctx.projectContext,
                policyContext: ctx.policyContext,
                history,
                mode,
              });
        const answer = await stream(messages);
        if (answer !== null && mode === 'generate') await reviewProposal(answer, scan.files);
      } catch (e) {
        dispatch({ type: 'assistantError', message: String(e) });
      }
    },
    [workspace, chat.messages, openPaths, activePath, settings, stream, reviewProposal],
  );

  const repair = useCallback(async () => {
    if (!workspace || repairAttempt >= MAX_REPAIR_ATTEMPTS) return;
    const attempt = repairAttempt + 1;
    setRepairAttempt(attempt);
    dispatch({ type: 'userMessage', text: `Derleme hatalarını düzelt (deneme ${attempt}/${MAX_REPAIR_ATTEMPTS}).` });
    dispatch({ type: 'clearPending' });
    try {
      const scan = await ipc.scanWorkspace();
      const ctx = prepareContext({ files: scan.files, openPaths, activePath, settings });
      setContextSummary(ctx.summary);
      const messages = buildRepairMessages({
        userGoal: lastGoal.current || 'Make the project build.',
        diagnostics,
        attempt,
        maxAttempts: MAX_REPAIR_ATTEMPTS,
        files: filesForRepair(scan.files, diagnostics),
        projectContext: ctx.projectContext,
        policyContext: ctx.policyContext,
      });
      const answer = await stream(messages);
      if (answer !== null) await reviewProposal(answer, scan.files);
    } catch (e) {
      dispatch({ type: 'assistantError', message: String(e) });
    }
  }, [workspace, repairAttempt, openPaths, activePath, settings, diagnostics, stream, reviewProposal]);

  const stop = useCallback(() => {
    void ipc.aiCancel();
    dispatch({ type: 'cancel' });
  }, []);

  const approved = useMemo(() => approvedChanges(chat), [chat]);
  const applyBlocked = useMemo(() => applyBlockedReason(approved, dirtyPaths), [approved, dirtyPaths]);

  const apply = useCallback(async () => {
    if (applyBlocked || approved.length === 0) return;
    setApplying(true);
    const written: string[] = [];
    try {
      for (const change of approved) {
        await ipc.applyFile(change.path, change.content);
        written.push(change.path);
        dispatch({ type: 'appliedOne', path: change.path });
      }
    } catch (e) {
      dispatch({ type: 'assistantError', message: `Tüm dosyalar yazılamadı: ${String(e)}` });
    } finally {
      setApplying(false);
      if (written.length > 0) onApplied(written);
    }
  }, [applyBlocked, approved, onApplied]);

  return {
    settings,
    setSettings,
    chat: chat as ChatState,
    keyStored: needsKey ? keyStored : null,
    needsKey,
    keyringError,
    models,
    modelsLoading,
    modelsError,
    contextSummary,
    applying,
    applyBlockedReason: applyBlocked,
    repairAttempt,
    repairAvailable: buildFailed && diagnostics.length > 0 && repairAttempt < MAX_REPAIR_ATTEMPTS && chat.status === 'idle',
    setKey,
    deleteKey,
    refreshModels: () => void refreshModels(),
    send: (text: string, mode: 'chat' | 'generate' | 'plan') => void send(text, mode),
    repair: () => void repair(),
    stop,
    decide: (path: string, decision: 'approved' | 'rejected') => dispatch({ type: 'decide', path, decision }),
    decideAll: (decision: 'approved' | 'rejected') => dispatch({ type: 'decideAll', decision }),
    apply: () => void apply(),
  };
}
