import './welcome.css';

export interface WelcomeProps {
  desktop: boolean;
  workspace: string | null;
  /** null = not checked yet */
  xtoolFound: boolean | null;
  aiProviderLabel: string;
  /** true when no key is needed (Ollama) or a key is stored; null while unknown */
  aiReady: boolean | null;
  onOpenFolder: () => void;
  onNewFile: () => void;
  onOpenAi: () => void;
  onOpenBuild: () => void;
  onOpenAppStore: () => void;
}

type StepState = 'done' | 'todo' | 'unknown';

function Step({
  n,
  state,
  title,
  children,
  action,
}: {
  n: number;
  state: StepState;
  title: string;
  children: React.ReactNode;
  action: React.ReactNode;
}) {
  const label = state === 'done' ? 'Tamam' : state === 'todo' ? 'Yapılacak' : 'Denetlenmedi';
  return (
    <li className={`wl-step wl-${state}`}>
      <span className="wl-num" aria-hidden="true">
        {state === 'done' ? '✓' : n}
      </span>
      <div className="wl-body">
        <h3>
          {title} <span className="wl-badge">{label}</span>
        </h3>
        <p>{children}</p>
      </div>
      <div className="wl-action">{action}</div>
    </li>
  );
}

export function WelcomeScreen(p: WelcomeProps) {
  return (
    <section className="welcome" aria-label="Başlangıç rehberi">
      <h1>Open iOS Studio’ya hoş geldiniz</h1>
      <p className="wl-lead">
        Mac olmadan, yapay zekâ yardımıyla iPhone uygulaması geliştirin. Aşağıdaki adımları sırayla izleyin; her adımın
        yanında şu anki durumu görürsünüz.
      </p>
      <ol className="wl-steps">
        <Step
          n={1}
          state={p.workspace ? 'done' : 'todo'}
          title="Proje klasörünü açın"
          action={
            <button type="button" className="primary" onClick={p.onOpenFolder} disabled={!p.desktop}>
              {p.workspace ? 'Başka klasör aç' : 'Klasör aç'}
            </button>
          }
        >
          {p.workspace
            ? `Açık klasör: ${p.workspace}`
            : 'Boş bir klasör ya da mevcut bir SwiftPM projesi seçin. Dosyalar sol tarafta görünür.'}
        </Step>
        <Step
          n={2}
          state={p.aiReady === null ? 'unknown' : p.aiReady ? 'done' : 'todo'}
          title="Yapay zekâyı bağlayın"
          action={
            <button type="button" onClick={p.onOpenAi} disabled={!p.desktop}>
              Yapay zekâ panelini aç
            </button>
          }
        >
          Seçili sağlayıcı: <strong>{p.aiProviderLabel}</strong>. Claude için Anthropic, Codex/ChatGPT tarafı için OpenAI API
          anahtarı gerekir; Ollama yereldir ve anahtar istemez. Claude Code veya Codex <em>aboneliği</em> API anahtarı yerine
          geçmez.
        </Step>
        <Step
          n={3}
          state={p.xtoolFound === null ? 'unknown' : p.xtoolFound ? 'done' : 'todo'}
          title="xtool’u denetleyin"
          action={
            <button type="button" onClick={p.onOpenBuild} disabled={!p.desktop}>
              Derle panelini aç
            </button>
          }
        >
          {p.xtoolFound
            ? 'xtool bulundu. Derleme ve iPhone’a kurulum için Apple SDK ve Apple Kimliği ayrıca kurulmalıdır.'
            : 'iOS derlemesi xtool ile yapılır. xtool bu bilgisayarda bulunamadı; kurulum için Derle panelindeki yönergelere bakın.'}
        </Step>
        <Step
          n={4}
          state="unknown"
          title="Üretin, inceleyin, derleyin"
          action={
            <button type="button" onClick={p.onNewFile} disabled={!p.workspace}>
              Yeni dosya
            </button>
          }
        >
          Yapay zekâya ne istediğinizi yazın. Önerilen dosyalar önce <strong>fark olarak</strong> gösterilir; siz onaylamadan
          hiçbir şey yazılmaz. Derleme başarısız olursa hatayı yapay zekâya düzelttirebilirsiniz.
        </Step>
      </ol>
      <p className="wl-foot">
        Yayına çıkmadan önce{' '}
        <button type="button" className="link" onClick={p.onOpenAppStore}>
          App Store hazırlık denetimini
        </button>{' '}
        çalıştırın. Bu denetim kaynak düzeyindedir ve App Store onayını garanti etmez.
      </p>
    </section>
  );
}
