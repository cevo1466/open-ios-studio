import { useLayoutEffect, useRef, useState } from 'react';
import type { ChatState } from '../ai/chatState';
import { MAX_NOTES_CHARS, type AiSettings } from '../ai/settings';
import { PROVIDERS, type ProviderId } from '../ai/types';
import { ChangeReview } from './ChangeReview';
import '../ai-panel.css';

export interface ChatPanelProps {
  state: ChatState;
  settings: AiSettings;
  /** null = provider needs no key (ollama). */
  keyStored: boolean | null;
  models: string[];
  modelsLoading: boolean;
  modelsError: string | null;
  contextSummary: string;
  hasWorkspace: boolean;
  theme: 'light' | 'dark';
  onSettings(next: AiSettings): void;
  onSetKey(key: string): Promise<void>;
  onDeleteKey(): Promise<void>;
  onRefreshModels(): void;
  onSend(text: string, mode: 'chat' | 'generate'): void;
  onStop(): void;
  onDecide(path: string, d: 'approved' | 'rejected'): void;
  onDecideAll(d: 'approved' | 'rejected'): void;
  onApply(): void;
  applying: boolean;
  applyBlockedReason: string | null;
  keyringError: string | null;
  onClose(): void;
}

const LABELS: Record<ProviderId, string> = { anthropic: 'Anthropic', openai: 'OpenAI', ollama: 'Ollama (local)' };

export function ChatPanel(props: ChatPanelProps) {
  const { state, settings, keyStored, models, hasWorkspace } = props;
  const [draft, setDraft] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const model = settings.models[settings.provider];
  const streaming = state.status === 'streaming';
  let blocked: string | null = null;
  if (!hasWorkspace) blocked = 'Open a workspace folder first.';
  else if (!model.trim()) blocked = 'Choose or type a model first.';
  else if (keyStored === false) blocked = 'Save an API key for this provider first.';
  else if (streaming) blocked = 'A response is already streaming.';
  const canSend = !blocked && draft.trim().length > 0;

  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  const lastLen = state.messages.length ? state.messages[state.messages.length - 1].content.length : 0;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, lastLen]);

  const send = (mode: 'chat' | 'generate') => {
    if (!canSend) return;
    props.onSend(draft.trim(), mode);
    setDraft('');
  };

  const saveKey = async () => {
    if (!keyInput || keyBusy) return;
    setKeyBusy(true);
    try {
      await props.onSetKey(keyInput);
      setKeyInput('');
    } catch {
      /* the parent reports the failure through keyringError */
    } finally {
      setKeyBusy(false);
    }
  };
  const removeKey = async () => {
    setKeyBusy(true);
    try {
      await props.onDeleteKey();
    } catch {
      /* reported through keyringError */
    } finally {
      setKeyBusy(false);
    }
  };

  const setProvider = (provider: ProviderId) => props.onSettings({ ...settings, provider });
  const setModel = (v: string) => props.onSettings({ ...settings, models: { ...settings.models, [settings.provider]: v } });

  const u = state.usage;
  return (
    <aside className="ai-panel" aria-label="AI assistant">
      <div className="ai-head">
        <h2>AI</h2>
        <button type="button" onClick={props.onClose} aria-label="Close AI panel">
          Close
        </button>
      </div>

      <div className="ai-config">
        <div className="ai-row">
          <label>
            Provider{' '}
            <select value={settings.provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="ai-grow">
            Model{' '}
            <input
              type="text"
              list="ai-models"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Type or pick a model id"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <datalist id="ai-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button type="button" onClick={props.onRefreshModels} disabled={props.modelsLoading} aria-label="Refresh model list">
            {props.modelsLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        {props.modelsError && (
          <p className="ai-error" role="alert">
            {props.modelsError}
          </p>
        )}

        {keyStored === null ? (
          <p className="ai-note">Local model, no API key; connects to 127.0.0.1:11434 only.</p>
        ) : (
          <div className="ai-row">
            <span className="ai-note" aria-live="polite">
              API key: {keyStored ? 'stored in the OS keyring' : 'not set'}
            </span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label="API key"
              placeholder={keyStored ? 'Replace key' : 'Paste key'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="ai-grow"
            />
            <button type="button" onClick={saveKey} disabled={!keyInput || keyBusy}>
              Save key
            </button>
            <button type="button" onClick={removeKey} disabled={!keyStored || keyBusy}>
              Remove key
            </button>
          </div>
        )}
        {props.keyringError && (
          <p className="ai-error" role="alert">
            {props.keyringError}
          </p>
        )}

        <button type="button" className="ai-link" aria-expanded={notesOpen} aria-controls="ai-notes" onClick={() => setNotesOpen(!notesOpen)}>
          Project notes {notesOpen ? '(hide)' : '(show)'}
        </button>
        {notesOpen && (
          <div id="ai-notes">
            <textarea
              aria-label="Project notes"
              rows={4}
              maxLength={MAX_NOTES_CHARS}
              value={settings.notes}
              onChange={(e) => props.onSettings({ ...settings, notes: e.target.value.slice(0, MAX_NOTES_CHARS) })}
              placeholder="Conventions or constraints sent with every request"
            />
            <span className="ai-note">
              {settings.notes.length}/{MAX_NOTES_CHARS}
            </span>
          </div>
        )}
      </div>

      <p className="ai-warn">AI output is untrusted. It can only propose file changes; nothing is written until you approve.</p>

      <div className="ai-messages" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label="Conversation">
        {state.messages.length === 0 && <p className="ai-note">No messages yet. Context: {props.contextSummary}.</p>}
        {state.messages.map((m) => (
          <div key={m.id} className={`ai-msg ai-msg-${m.role}`}>
            <div className="ai-msg-role">{m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Assistant' : 'Note'}</div>
            <div className="ai-msg-body">
              {m.content}
              {m.streaming && <span className="ai-caret" aria-hidden="true" />}
            </div>
            {m.error && (
              <div className="ai-error" role="alert">
                {m.error}
              </div>
            )}
          </div>
        ))}
        {u && (u.input !== null || u.output !== null) && (
          <div className="ai-note">
            {u.input ?? '?'} input / {u.output ?? '?'} output tokens
          </div>
        )}
      </div>

      <div className="ai-composer">
        <textarea
          aria-label="Message"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send('chat');
            }
          }}
          placeholder="Ask a question or describe files to generate (Ctrl+Enter to ask)"
        />
        <div className="ai-row">
          <span className="ai-note ai-grow">Context: {props.contextSummary}</span>
          {streaming && (
            <button type="button" onClick={props.onStop}>
              Stop
            </button>
          )}
          <button type="button" disabled={!canSend} title={blocked ?? (draft.trim() ? undefined : 'Type a message first')} onClick={() => send('chat')}>
            Ask
          </button>
          <button
            type="button"
            className="ai-primary"
            disabled={!canSend}
            title={blocked ?? (draft.trim() ? undefined : 'Type a message first')}
            onClick={() => send('generate')}
          >
            Generate files
          </button>
        </div>
      </div>

      {state.pending.length > 0 && (
        <ChangeReview
          changes={state.pending}
          theme={props.theme}
          onDecide={props.onDecide}
          onDecideAll={props.onDecideAll}
          onApply={props.onApply}
          applying={props.applying}
          blockedReason={props.applyBlockedReason}
        />
      )}
    </aside>
  );
}
