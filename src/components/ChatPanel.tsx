import { useLayoutEffect, useRef, useState } from 'react';
import type { ChatState } from '../ai/chatState';
import { sendBlockedReason, sessionState } from '../ai/readiness';
import type { AiSettings } from '../ai/settings';
import type { CliStatus } from '../ai/types';
import { PROVIDER_LABELS } from './AiSettingsPanel';
import { ChangeReview } from './ChangeReview';
import '../ai-panel.css';

export interface ChatPanelProps {
  state: ChatState;
  settings: AiSettings;
  keyStored: boolean | null;
  cliStatus: CliStatus | null;
  contextSummary: string;
  hasWorkspace: boolean;
  theme: 'light' | 'dark';
  onSend(text: string, mode: 'chat' | 'generate' | 'plan'): void;
  onStop(): void;
  onDecide(path: string, d: 'approved' | 'rejected'): void;
  onDecideAll(d: 'approved' | 'rejected'): void;
  onApply(): void;
  applying: boolean;
  applyBlockedReason: string | null;
  onOpenSettings(): void;
  onClose(): void;
}

const EXAMPLES = [
  'Giriş ekranı olan bir SwiftUI uygulaması oluştur',
  'Bu projedeki derleme hatalarını açıkla',
  'Sayaç uygulaması için bir ViewModel ekle',
];

/** Right panel: the conversation, proposed changes and the composer. Configuration lives on the left. */
export function ChatPanel(props: ChatPanelProps) {
  const { state, settings, hasWorkspace } = props;
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const streaming = state.status === 'streaming';
  const model = settings.models[settings.provider];
  const blocked = sendBlockedReason({
    provider: settings.provider,
    model,
    keyStored: props.keyStored,
    cliStatus: props.cliStatus,
    hasWorkspace,
    streaming,
  });
  const session = sessionState({ provider: settings.provider, keyStored: props.keyStored, cliStatus: props.cliStatus });
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

  const send = (mode: 'chat' | 'generate' | 'plan') => {
    if (!canSend) return;
    props.onSend(draft.trim(), mode);
    setDraft('');
  };

  const u = state.usage;
  const hint = blocked ?? (draft.trim() ? undefined : 'Önce bir mesaj yazın');

  return (
    <aside className="ai-panel" aria-label="Yapay zekâ asistanı">
      <header className="ai-head">
        <div className="ai-head-main">
          <h2>Yapay zekâ</h2>
          <button type="button" className="ai-chip" onClick={props.onOpenSettings} title="Sağlayıcı ve model ayarlarını aç">
            <span className={`sb-dot sb-${session.tone === 'warn' ? 'warn' : session.tone === 'ok' ? 'ok' : 'unknown'}`} aria-hidden="true" />
            {PROVIDER_LABELS[settings.provider]}
            {model ? ` · ${model}` : ''}
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Yapay zekâ panelini kapat">
          Kapat
        </button>
      </header>

      {blocked && hasWorkspace && (
        <p className="ai-callout">
          {blocked}{' '}
          <button type="button" className="tree-link" onClick={props.onOpenSettings}>
            Ayarlara git
          </button>
        </p>
      )}

      <div className="ai-messages" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label="Sohbet">
        {state.messages.length === 0 && (
          <div className="ai-examples">
            <p className="ai-note">Ne yapmak istediğinizi yazın. Önerilen dosyalar önce fark olarak gösterilir; siz onaylamadan hiçbir şey yazılmaz.</p>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="ai-example" onClick={() => setDraft(ex)}>
                {ex}
              </button>
            ))}
          </div>
        )}
        {state.messages.map((m) => (
          <div key={m.id} className={`ai-msg ai-msg-${m.role}`}>
            <div className="ai-msg-role">{m.role === 'user' ? 'Siz' : m.role === 'assistant' ? 'Asistan' : 'Not'}</div>
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
            {u.input ?? '?'} giriş / {u.output ?? '?'} çıkış token
          </div>
        )}
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

      <div className="ai-composer">
        <textarea
          aria-label="Mesaj"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send('chat');
            }
          }}
          placeholder="Bir soru sorun veya üretilecek dosyaları anlatın (Ctrl+Enter ile sorun)"
        />
        <div className="ai-row">
          <button type="button" className="primary ai-grow" disabled={!canSend} title={blocked ?? (draft.trim() ? 'Dosya önerilerini fark olarak hazırlar' : 'Önce bir mesaj yazın')} onClick={() => send('generate')}>
            Dosya üret
          </button>
          <button type="button" disabled={!canSend} title={blocked ?? 'Kod yazmadan, önce kısa bir adım listesi ister'} onClick={() => send('plan')}>
            Önce plan
          </button>
          <button type="button" disabled={!canSend} title={hint} onClick={() => send('chat')}>
            Sor
          </button>
          {streaming && (
            <button type="button" className="danger" onClick={props.onStop}>
              Durdur
            </button>
          )}
        </div>
        <span className="ai-note">Bağlam: {props.contextSummary}</span>
      </div>
    </aside>
  );
}
