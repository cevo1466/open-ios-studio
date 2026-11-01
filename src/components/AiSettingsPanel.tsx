import { useState } from 'react';
import { CLI_BADGE_TEXT, CLI_COMMAND, cliBadge, looksLikeApiKeyLogin } from '../ai/cli';
import { sessionState } from '../ai/readiness';
import { MAX_NOTES_CHARS, type AiSettings } from '../ai/settings';
import { PROVIDERS, type CliProviderId, type CliStatus, type ProviderId, type RemoteProtocol, type RemoteSite } from '../ai/types';
import { modelChoices } from '../ai/models';
import { ModelPicker } from './ModelPicker';
import '../ai-panel.css';

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic (API anahtarı)',
  openai: 'OpenAI (API anahtarı)',
  ollama: 'Ollama (yerel)',
  'claude-cli': 'Claude (abonelik)',
  'codex-cli': 'Codex (ChatGPT aboneliği)',
};

export interface AiSettingsPanelProps {
  settings: AiSettings;
  keyStored: boolean | null;
  keyringError: string | null;
  models: string[];
  modelsLoading: boolean;
  modelsError: string | null;
  cliProvider: CliProviderId | null;
  cliStatus: CliStatus | null;
  cliError: string | null;
  chatOpen: boolean;
  onSettings(next: AiSettings): void;
  onSetKey(key: string): Promise<void>;
  onDeleteKey(): Promise<void>;
  onRefreshModels(): void;
  onRefreshCli(): void;
  onLoginEmbedded(): void;
  onLoginSystem(): void;
  /** Opens an interactive Claude Code session in the embedded terminal, in the project, with studio context. */
  onOpenClaudeCode(remote?: RemoteSite): void;
  onOpenChat(): void;
}

/** Left "Yapay zekâ" view: provider, model and session only. The conversation lives in the right panel. */
export function AiSettingsPanel(props: AiSettingsPanelProps) {
  const { settings, keyStored, cliProvider } = props;
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [remote, setRemote] = useState<{ protocol: RemoteProtocol; host: string; port: string; user: string; password: string }>({ protocol: 'sftp', host: '', port: '', user: '', password: '' });
  const remoteReady = remote.host.trim() !== '' && remote.user.trim() !== '';
  const setRemoteField = (patch: Partial<typeof remote>) => setRemote((r) => ({ ...r, ...patch }));
  const openClaudeCode = () => {
    if (!remoteReady) {
      props.onOpenClaudeCode();
      return;
    }
    const port = Number.parseInt(remote.port, 10);
    props.onOpenClaudeCode({ protocol: remote.protocol, host: remote.host.trim(), port: Number.isFinite(port) && port > 0 && port < 65536 ? port : 0, user: remote.user.trim(), password: remote.password });
    // The password is only needed to start the session; do not keep it in the form.
    setRemote((r) => ({ ...r, password: '' }));
  };
  const model = settings.models[settings.provider];
  const session = sessionState({ provider: settings.provider, keyStored, cliStatus: props.cliStatus });

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    setKeyBusy(true);
    try {
      await fn();
      after?.();
    } catch {
      /* the parent reports the failure through keyringError */
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <div className="ais">
      <div className={`ais-session ais-${session.tone}`} aria-live="polite">
        <span className={`sb-dot sb-${session.tone === 'warn' ? 'warn' : session.tone === 'ok' ? 'ok' : 'unknown'}`} aria-hidden="true" />
        <span>
          <strong>{PROVIDER_LABELS[settings.provider]}</strong>
          <span className="ais-state">{session.label}</span>
        </span>
      </div>

      <label className="ai-field">
        <span>Sağlayıcı</span>
        <select value={settings.provider} onChange={(e) => props.onSettings({ ...settings, provider: e.target.value as ProviderId })}>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
      </label>

      {modelChoices(settings.provider) ? (
        <ModelPicker
          provider={settings.provider}
          model={model}
          effort={settings.efforts[settings.provider]}
          onModel={(v) => props.onSettings({ ...settings, models: { ...settings.models, [settings.provider]: v } })}
          onEffort={(v) => props.onSettings({ ...settings, efforts: { ...settings.efforts, [settings.provider]: v } })}
        />
      ) : (
      <div className="ai-field">
        <label htmlFor="ai-model-input">Model</label>
        <div className="ai-row">
          <input
            id="ai-model-input"
            type="text"
            list="ai-models"
            value={model}
            onChange={(e) => props.onSettings({ ...settings, models: { ...settings.models, [settings.provider]: e.target.value } })}
            placeholder={cliProvider ? 'Boş: CLI varsayılan modeli' : 'Model adı'}
            spellCheck={false}
            autoComplete="off"
            className="ai-grow"
          />
          <datalist id="ai-models">
            {props.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button type="button" onClick={props.onRefreshModels} disabled={props.modelsLoading || !!cliProvider} aria-label="Model listesini yenile" title={cliProvider ? 'CLI sağlayıcılarda model listesi yok' : undefined}>
            {props.modelsLoading ? '…' : 'Yenile'}
          </button>
        </div>
        {props.modelsError && (
          <p className="ai-error" role="alert">
            {props.modelsError}
          </p>
        )}
      </div>
      )}

      {cliProvider ? (
        <div className="ai-field">
          <span className="ai-label">Oturum</span>
          <p className="ai-note" aria-live="polite">
            {CLI_BADGE_TEXT[cliBadge(props.cliStatus)]}
            {props.cliStatus?.detail ? ` · ${props.cliStatus.detail}` : ''}
          </p>
          {looksLikeApiKeyLogin(props.cliStatus) && <p className="ai-warn">CLI API anahtarıyla girmiş görünüyor; kullanım API üzerinden faturalanır.</p>}
          <div className="ai-row">
            <button type="button" className="primary" onClick={props.onLoginEmbedded} disabled={props.cliStatus?.installed === false}>
              Giriş yap
            </button>
            <button type="button" onClick={props.onRefreshCli}>
              Durumu yenile
            </button>
            <button type="button" className="ghost" onClick={props.onLoginSystem} disabled={props.cliStatus?.installed === false} title="Giriş komutunu sistem terminalinde açar">
              Sistem terminali
            </button>
          </div>
          {props.cliError && (
            <p className="ai-error" role="alert">
              {props.cliError}
            </p>
          )}
          {cliProvider === 'claude-cli' && (
            <div className="ai-field">
              <button type="button" className="wide" onClick={openClaudeCode} disabled={props.cliStatus?.installed === false}>
                {remoteReady ? "Claude Code'u bu projede ve uzak siteyle aç" : "Claude Code'u bu projede aç"}
              </button>
              <p className="ai-note">Gömülü terminalde, proje klasöründe ve seçtiğiniz model/eforla başlar. Claude proje türünü ve xtool'u önceden bilir.</p>
              <details className="ai-info remote-site">
                <summary>Uzak site (FTP / SSH) · isteğe bağlı</summary>
                <p className="ai-note">Canlı sitenizin bilgilerini verirseniz Claude bağlanıp site yapısını ve mobil (responsive) tasarımı inceler, uygulamayı ona göre yazar. Yalnızca okur; değiştirmesini siz istemedikçe sitede bir şey yapmaz.</p>
                <label className="ai-field">
                  <span>Bağlantı türü</span>
                  <select value={remote.protocol} onChange={(e) => setRemoteField({ protocol: e.target.value as RemoteProtocol })}>
                    <option value="sftp">SFTP / SSH (önerilen)</option>
                    <option value="ftps">FTPS (şifreli FTP)</option>
                    <option value="ftp">FTP (şifresiz)</option>
                  </select>
                </label>
                {remote.protocol === 'ftp' && <p className="ai-warn">Düz FTP şifrenizi şifrelemeden gönderir. Sunucunuz destekliyorsa SFTP veya FTPS seçin.</p>}
                <div className="ai-row">
                  <label className="ai-field ai-grow">
                    <span>Sunucu</span>
                    <input type="text" aria-label="Uzak sunucu" value={remote.host} onChange={(e) => setRemoteField({ host: e.target.value })} placeholder="ftp.siteniz.com" spellCheck={false} autoComplete="off" />
                  </label>
                  <label className="ai-field remote-port">
                    <span>Port</span>
                    <input type="text" inputMode="numeric" aria-label="Uzak port" value={remote.port} onChange={(e) => setRemoteField({ port: e.target.value.replace(/\D/g, '').slice(0, 5) })} placeholder={remote.protocol === 'sftp' ? '22' : '21'} autoComplete="off" />
                  </label>
                </div>
                <label className="ai-field">
                  <span>Kullanıcı adı</span>
                  <input type="text" aria-label="Uzak kullanıcı adı" value={remote.user} onChange={(e) => setRemoteField({ user: e.target.value })} spellCheck={false} autoComplete="off" />
                </label>
                <label className="ai-field">
                  <span>Şifre</span>
                  <input type="password" aria-label="Uzak şifre" value={remote.password} onChange={(e) => setRemoteField({ password: e.target.value })} autoComplete="off" />
                </label>
                <p className="ai-note">Bilgiler yalnızca açılan terminal oturumuna verilir; dosyaya veya günlüğe yazılmaz, oturum kapanınca kaybolur. Claude bağlanırken bu bilgilere erişir. Gereken araçlar: <code>sudo apt install lftp sshpass</code>. Claude komutları çalıştırmadan önce size sorar.</p>
              </details>
            </div>
          )}
        </div>
      ) : settings.provider === 'ollama' ? (
        <p className="ai-note">Yerel model; anahtar gerekmez. Yalnızca 127.0.0.1:11434 adresine bağlanır.</p>
      ) : (
        <div className="ai-field">
          <label htmlFor="ai-key-input">API anahtarı</label>
          <input id="ai-key-input" type="password" autoComplete="off" spellCheck={false} placeholder={keyStored ? 'Değiştirmek için yeni anahtarı yapıştırın' : 'Anahtarı yapıştırın'} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
          <div className="ai-row">
            <button type="button" className="primary" onClick={() => void run(() => props.onSetKey(keyInput), () => setKeyInput(''))} disabled={!keyInput || keyBusy}>
              Kaydet
            </button>
            <button type="button" onClick={() => void run(props.onDeleteKey)} disabled={!keyStored || keyBusy}>
              Sil
            </button>
          </div>
          <p className="ai-note">İşletim sisteminin anahtarlığında saklanır.</p>
          {props.keyringError && (
            <p className="ai-error" role="alert">
              {props.keyringError}
            </p>
          )}
        </div>
      )}

      <button type="button" className="wide" onClick={props.onOpenChat} aria-pressed={props.chatOpen}>
        {props.chatOpen ? 'Sohbet açık' : 'Sohbeti aç'}
      </button>

      <details className="ai-info">
        <summary>Proje notları</summary>
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
      </details>

      <details className="ai-info">
        <summary>Bilgi: nasıl bağlanırım?</summary>
        <ul>
          <li>
            <strong>Abonelik:</strong> “Claude (abonelik)” veya “Codex (ChatGPT aboneliği)” seçin; Studio resmi <code>claude</code> / <code>codex</code> komutunu çalıştırır. Giriş komutu: <code>{CLI_COMMAND[cliProvider ?? 'claude-cli']}</code>.
          </li>
          <li>
            <strong>API anahtarı:</strong> Anthropic veya OpenAI anahtarı alıp yukarıya yapıştırın.
          </li>
          <li>
            <strong>Ollama:</strong> yerel çalışır, anahtar gerekmez.
          </li>
        </ul>
        <p className="ai-note">Studio oturum belgelerinizi okumaz. Abonelik kullanım limitleri geçerlidir.</p>
      </details>
    </div>
  );
}
