import type { ReactNode } from 'react';
import './welcome.css';

export interface WelcomeProps {
  desktop: boolean;
  workspace: string | null;
  /** null = not checked yet */
  xtoolFound: boolean | null;
  aiProviderLabel: string;
  /** true when the provider is ready (key stored, CLI logged in, Ollama); null while unknown */
  aiReady: boolean | null;
  onOpenFolder: () => void;
  onNewFile: () => void;
  onOpenAi: () => void;
  onOpenBuild: () => void;
  onOpenAppStore: () => void;
}

type StepState = 'done' | 'todo' | 'unknown';

const LABEL: Record<StepState, string> = { done: 'Hazır', todo: 'Yapılacak', unknown: 'Kontrol edilmedi' };

function Card({
  n,
  state,
  title,
  action,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className={`wl-card wl-${state}`}>
      <div className="wl-card-head">
        <span className="wl-num" aria-hidden="true">
          {n}
        </span>
        <h2>{title}</h2>
        <span className="wl-status">{LABEL[state]}</span>
      </div>
      <p>{children}</p>
      <div className="wl-action">{action}</div>
    </li>
  );
}

export function WelcomeScreen(p: WelcomeProps) {
  const next: 1 | 2 | 3 | 4 = !p.workspace ? 1 : p.aiReady !== true ? 2 : p.xtoolFound !== true ? 3 : 4;
  return (
    <section className="welcome" aria-label="Başlangıç">
      <header className="wl-head">
        <h1>Open iOS Studio</h1>
        <p>Mac olmadan, yapay zekâ yardımıyla iPhone uygulaması geliştirin. Dört adımda başlayın.</p>
      </header>
      <ol className="wl-grid">
        <Card
          n={1}
          state={p.workspace ? 'done' : 'todo'}
          title="Proje aç"
          action={
            <button type="button" className={next === 1 ? 'primary' : ''} onClick={p.onOpenFolder} disabled={!p.desktop}>
              {p.workspace ? 'Başka klasör aç' : 'Klasör aç'}
            </button>
          }
        >
          {p.workspace ? <span className="wl-path">{p.workspace}</span> : 'Boş bir klasör ya da mevcut bir SwiftPM projesi seçin.'}
        </Card>
        <Card
          n={2}
          state={p.aiReady === null ? 'unknown' : p.aiReady ? 'done' : 'todo'}
          title="Yapay zekâyı bağla"
          action={
            <button type="button" className={next === 2 ? 'primary' : ''} onClick={p.onOpenAi} disabled={!p.desktop}>
              Yapay zekâ ayarları
            </button>
          }
        >
          Seçili: <strong>{p.aiProviderLabel}</strong>. Claude veya ChatGPT aboneliğinizle giriş yapabilir ya da API anahtarı kullanabilirsiniz.
        </Card>
        <Card
          n={3}
          state={p.xtoolFound === null ? 'unknown' : p.xtoolFound ? 'done' : 'todo'}
          title="xtool ve SDK’yı doğrula"
          action={
            <button type="button" className={next === 3 ? 'primary' : ''} onClick={p.onOpenBuild} disabled={!p.desktop}>
              Derle bölümünü aç
            </button>
          }
        >
          {p.xtoolFound ? 'xtool bulundu. Apple SDK ve Apple Kimliği ayrıca kurulmalıdır.' : 'iOS derlemesi xtool ile yapılır. xtool bu bilgisayarda bulunamadı.'}
        </Card>
        <Card
          n={4}
          state="unknown"
          title="Üret, derle, yükle"
          action={
            <button type="button" className={next === 4 ? 'primary' : ''} onClick={p.onNewFile} disabled={!p.workspace}>
              Yeni dosya
            </button>
          }
        >
          Yapay zekâya isteğinizi yazın; önerileri fark olarak inceleyin, onaylayın, derleyip iPhone’a yükleyin.
        </Card>
      </ol>
      <p className="wl-foot">
        Yayına çıkmadan önce{' '}
        <button type="button" className="link" onClick={p.onOpenAppStore}>
          App Store hazırlık denetimini
        </button>{' '}
        çalıştırın. Denetim kaynak düzeyindedir ve onayı garanti etmez.
      </p>
    </section>
  );
}
