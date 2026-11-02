/** Step model of the release panel. Pure: the panel only renders what this returns. */

export type StepId = 'settings' | 'credentials' | 'build' | 'repack' | 'prepare' | 'sign' | 'upload';
export type StepState = 'done' | 'ready' | 'blocked' | 'running' | 'failed';

export interface Step {
  id: StepId;
  label: string;
  state: StepState;
  /** Why the step cannot run (Turkish), or null. */
  why: string | null;
  /** Needs a paid Apple Developer account. */
  needsApple: boolean;
}

export interface StepInput {
  desktop: boolean;
  hasWorkspace: boolean;
  xtoolFound: boolean;
  configValid: boolean;
  ascConfigured: boolean;
  /** Steps that finished in this session (artifacts exist). */
  done: Partial<Record<StepId, boolean>>;
  running: StepId | null;
  failed: StepId | null;
}

/** Shown next to every Apple step until the first real run with an account. */
export const APPLE_UNVERIFIED = 'Apple Developer hesabıyla henüz denenmedi (NOT_VERIFIED). İlk gerçek deneme sonucu STATUS.md’ye işlenir.';

const LABELS: Record<StepId, string> = {
  settings: 'Yayın ayarları',
  credentials: 'App Store Connect anahtarı',
  build: 'Release IPA derle',
  repack: 'IPA’yı hazırla (simge, gizlilik)',
  prepare: 'Sertifika ve profil',
  sign: 'İmzala',
  upload: 'App Store Connect’e yükle',
};

const NEEDS_APPLE: Record<StepId, boolean> = { settings: false, credentials: true, build: false, repack: false, prepare: true, sign: true, upload: true };

export function buildSteps(i: StepInput): Step[] {
  const order: StepId[] = ['settings', 'credentials', 'build', 'repack', 'prepare', 'sign', 'upload'];
  const isDone = (id: StepId) => (id === 'settings' ? i.configValid : id === 'credentials' ? i.ascConfigured : i.done[id] === true);

  const blockReason = (id: StepId): string | null => {
    if (!i.desktop && id !== 'settings') return 'Yalnızca masaüstü uygulaması.';
    if (i.running !== null && i.running !== id) return 'Başka bir işlem çalışıyor.';
    switch (id) {
      case 'settings':
        return i.hasWorkspace ? null : 'Önce bir çalışma klasörü açın.';
      case 'credentials':
        return null;
      case 'build':
        if (!i.hasWorkspace) return 'Önce bir çalışma klasörü açın.';
        if (!i.xtoolFound) return 'xtool bulunamadı.';
        return i.configValid ? null : 'Önce yayın ayarlarını tamamlayın.';
      case 'repack':
        return i.done.build ? null : 'Önce release IPA derleyin.';
      case 'prepare':
        if (!i.ascConfigured) return 'Önce App Store Connect anahtarını ekleyin.';
        return i.configValid ? null : 'Önce yayın ayarlarını tamamlayın.';
      case 'sign':
        if (!i.done.repack) return 'Önce IPA’yı hazırlayın.';
        return i.done.prepare ? null : 'Önce sertifika ve profili hazırlayın.';
      case 'upload':
        if (!i.done.sign) return 'Önce IPA’yı imzalayın.';
        return i.ascConfigured ? null : 'Önce App Store Connect anahtarını ekleyin.';
    }
  };

  return order.map((id) => {
    const why = blockReason(id);
    let state: StepState;
    if (i.running === id) state = 'running';
    else if (i.failed === id) state = 'failed';
    else if (why !== null) state = isDone(id) && id !== 'settings' && id !== 'credentials' ? 'done' : 'blocked';
    else state = isDone(id) ? 'done' : 'ready';
    return { id, label: LABELS[id], state, why: state === 'blocked' ? why : null, needsApple: NEEDS_APPLE[id] };
  });
}

/** Index of the next step the user should do, or null when everything is done. */
export function nextStep(steps: Step[]): Step | null {
  return steps.find((s) => s.state === 'ready' || s.state === 'failed') ?? null;
}
