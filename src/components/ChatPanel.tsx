import { useLayoutEffect, useRef, useState } from 'react';
import type { ChatState } from '../ai/chatState';
import { MAX_NOTES_CHARS, type AiSettings } from '../ai/settings';
import { CLI_BADGE_TEXT, CLI_COMMAND, cliBadge, cliBlockedReason, looksLikeApiKeyLogin } from '../ai/cli';
import { PROVIDERS, type CliProviderId, type CliStatus, type ProviderId } from '../ai/types';
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
  onSend(text: string, mode: 'chat' | 'generate' | 'plan'): void;
  onStop(): void;
  onDecide(path: string, d: 'approved' | 'rejected'): void;
  onDecideAll(d: 'approved' | 'rejected'): void;
  onApply(): void;
  applying: boolean;
  applyBlockedReason: string | null;
  keyringError: string | null;
  /** Non-null when the selected provider is a subscription CLI (ADR-0008). */
  cliProvider: CliProviderId | null;
  cliStatus: CliStatus | null;
  cliError: string | null;
  onRefreshCli(): void;
  onLoginEmbedded(): void;
  onLoginSystem(): void;
  onClose(): void;
}

const EXAMPLES = [
  'Giriş ekranı olan bir SwiftUI uygulaması oluştur',
  'Bu projedeki derleme hatalarını açıkla',
  'Sayaç uygulaması için bir ViewModel ekle',
];

const LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic (API anahtarı)',
  openai: 'OpenAI (API anahtarı)',
  ollama: 'Ollama (yerel)',
  'claude-cli': 'Claude (abonelik, CLI)',
  'codex-cli': 'Codex (ChatGPT aboneliği, CLI)',
};

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
  if (!hasWorkspace) blocked = 'Önce bir çalışma klasörü açın.';
  else if (props.cliProvider) blocked = cliBlockedReason(props.cliProvider, props.cliStatus);
  else if (!model.trim()) blocked = 'Önce bir model seçin veya yazın.';
  else if (keyStored === false) blocked = 'Önce bu sağlayıcı için bir API anahtarı kaydedin.';
  else if (streaming) blocked = 'Bir yanıt zaten geliyor.';
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
    <aside className="ai-panel" aria-label="Yapay zekâ asistanı">
      <div className="ai-head">
        <h2>Yapay Zekâ</h2>
        <button type="button" onClick={props.onClose} aria-label="Yapay zekâ panelini kapat">
          Kapat
        </button>
      </div>

      {keyStored !== true && !props.cliProvider && (
        <details className="ai-help" open={keyStored === false}>
          <summary>Nasıl bağlanırım?</summary>
          <ul>
            <li>
              <strong>Claude:</strong> console.anthropic.com adresinden bir Anthropic API anahtarı alın.
            </li>
            <li>
              <strong>OpenAI / Codex:</strong> platform.openai.com adresinden bir OpenAI API anahtarı alın.
            </li>
            <li>
              <strong>Ollama:</strong> yerel çalışır, anahtar gerekmez (http://localhost:11434, yalnızca yerel adres).
            </li>
          </ul>
          <p>
            API anahtarı istemiyorsanız sağlayıcı olarak <strong>Claude (abonelik, CLI)</strong> veya <strong>Codex (ChatGPT aboneliği, CLI)</strong> seçin:
            Studio resmi <code>claude</code> / <code>codex</code> komutlarını çalıştırır ve aboneliğinizle giriş yapmanızı sağlar.
          </p>
          <p>Anahtarınız işletim sisteminin anahtarlığında (keyring) saklanır; Studio'nun dosyalarına yazılmaz.</p>
        </details>
      )}

      <div className="ai-config">
        <label className="ai-field">
          <span>Sağlayıcı</span>
          <select value={settings.provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {LABELS[p]}
              </option>
            ))}
          </select>
        </label>

        <div className="ai-field">
          <label htmlFor="ai-model-input">Model</label>
          <div className="ai-row">
            <input
              id="ai-model-input"
              type="text"
              list="ai-models"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={props.cliProvider ? 'Boş bırakın: CLI varsayılan modeli kullanılır' : 'Model adını yazın veya listeden seçin'}
              spellCheck={false}
              autoComplete="off"
              className="ai-grow"
            />
            <datalist id="ai-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button type="button" onClick={props.onRefreshModels} disabled={props.modelsLoading || !!props.cliProvider} aria-label="Model listesini yenile" title={props.cliProvider ? 'CLI sağlayıcılarda model listesi yok' : undefined}>
              {props.modelsLoading ? 'Yükleniyor...' : 'Yenile'}
            </button>
          </div>
        </div>
        {props.modelsError && (
          <p className="ai-error" role="alert">
            {props.modelsError}
          </p>
        )}

        {props.cliProvider ? (
          <div className="ai-field" aria-live="polite">
            <span className="ai-note">
              Abonelik girişi: <strong>{CLI_BADGE_TEXT[cliBadge(props.cliStatus)]}</strong>
              {props.cliStatus?.detail ? ` — ${props.cliStatus.detail}` : ''}
            </span>
            {looksLikeApiKeyLogin(props.cliStatus) && (
              <p className="ai-warn">Bu CLI bir API anahtarıyla giriş yapmış görünüyor; kullanım API üzerinden faturalanır. Abonelikle girmek için yeniden giriş yapın.</p>
            )}
            <div className="ai-row">
              <button type="button" onClick={props.onLoginEmbedded} disabled={props.cliStatus?.installed === false}>
                Gömülü terminalde giriş yap
              </button>
              <button type="button" onClick={props.onLoginSystem} disabled={props.cliStatus?.installed === false}>
                Sistem terminalinde aç
              </button>
              <button type="button" onClick={props.onRefreshCli}>
                Durumu yenile
              </button>
            </div>
            <span className="ai-note">
              Komut: <code>{CLI_COMMAND[props.cliProvider]}</code>. Giriş bittikten sonra &quot;Durumu yenile&quot;ye basın. Studio oturum belgelerinizi okumaz; yalnızca
              CLI&apos;ı çalıştırır. Abonelik kullanım limitleri geçerlidir.
            </span>
            {props.cliError && (
              <p className="ai-error" role="alert">
                {props.cliError}
              </p>
            )}
          </div>
        ) : keyStored === null ? (
          <p className="ai-note">Yerel model, API anahtarı gerekmez; yalnızca 127.0.0.1:11434 adresine bağlanır.</p>
        ) : (
          <div className="ai-field">
            <span className="ai-note" aria-live="polite">
              API anahtarı: {keyStored ? 'işletim sistemi anahtarlığında kayıtlı' : 'ayarlanmadı'}
            </span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label="API anahtarı"
              placeholder={keyStored ? 'Anahtarı değiştir' : 'Anahtarı yapıştırın'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <div className="ai-row">
              <button type="button" onClick={saveKey} disabled={!keyInput || keyBusy}>
                Anahtarı kaydet
              </button>
              <button type="button" onClick={removeKey} disabled={!keyStored || keyBusy}>
                Anahtarı sil
              </button>
            </div>
          </div>
        )}
        {props.keyringError && (
          <p className="ai-error" role="alert">
            {props.keyringError}
          </p>
        )}

        <button type="button" className="ai-link" aria-expanded={notesOpen} aria-controls="ai-notes" onClick={() => setNotesOpen(!notesOpen)}>
          Proje notları {notesOpen ? '(gizle)' : '(göster)'}
        </button>
        {notesOpen && (
          <div id="ai-notes">
            <textarea
              aria-label="Proje notları"
              rows={4}
              maxLength={MAX_NOTES_CHARS}
              value={settings.notes}
              onChange={(e) => props.onSettings({ ...settings, notes: e.target.value.slice(0, MAX_NOTES_CHARS) })}
              placeholder="Her istekle birlikte gönderilecek kurallar veya kısıtlar"
            />
            <span className="ai-note">
              {settings.notes.length}/{MAX_NOTES_CHARS}
            </span>
          </div>
        )}
      </div>

      <p className="ai-warn">Yapay zekâ çıktısı güvenilmezdir. Yalnızca dosya değişikliği önerebilir; siz onaylayana kadar hiçbir şey yazılmaz.</p>

      <div className="ai-messages" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label="Conversation">
        {state.messages.length === 0 && (
          <div className="ai-examples">
            <p className="ai-note">Henüz mesaj yok. Bağlam: {props.contextSummary}.</p>
            <p className="ai-note">
              <strong>Örnek istekler</strong> (tıklayınca metin kutusuna yazılır, otomatik gönderilmez):
            </p>
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
          placeholder="Bir soru sorun veya üretilecek dosyaları anlatın (sormak için Ctrl+Enter)"
        />
        <div className="ai-row">
          <span className="ai-note ai-grow">Bağlam: {props.contextSummary}</span>
          {streaming && (
            <button type="button" onClick={props.onStop}>
              Durdur
            </button>
          )}
          <button type="button" disabled={!canSend} title={blocked ?? (draft.trim() ? undefined : 'Önce bir mesaj yazın')} onClick={() => send('chat')}>
            Sor
          </button>
          <button type="button" disabled={!canSend} title={blocked ?? 'Kod yazmadan, önce kısa bir adım listesi ister'} onClick={() => send('plan')}>
            Önce plan
          </button>
          <button
            type="button"
            className="ai-primary"
            disabled={!canSend}
            title={blocked ?? (draft.trim() ? undefined : 'Önce bir mesaj yazın')}
            onClick={() => send('generate')}
          >
            Dosya üret
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
