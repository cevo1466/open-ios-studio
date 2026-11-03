/**
 * Command palette entries, built from the app's state and a set of actions. Pure, so the list and
 * the enabled rules are unit-tested; App.tsx only supplies the handlers.
 */
import type { SidebarView } from '../components/ActivityBar';
import type { Command } from '../components/CommandPalette';
import type { BottomTabId } from '../layout/BottomPanel';
import type { ViewId } from '../state/store';

export interface CommandActions {
  openFolder(): void;
  newFile(): void;
  save(): void;
  settings(): void;
  togglePanel(): void;
  toggleTheme(): void;
  sidebar(view: SidebarView): void;
  terminal(): void;
  toggleChat(): void;
  openView(id: ViewId): void;
  runPreflight(): void;
  runDoctor(): void;
  claudeCode(): void;
  bottom(tab: BottomTabId): void;
  redetect(): void;
}

export interface CommandContext {
  desktop: boolean;
  hasWorkspace: boolean;
  chatOpen: boolean;
  terminalOpen: boolean;
  actions: CommandActions;
}

export function buildCommands(ctx: CommandContext): Command[] {
  const { desktop, hasWorkspace, actions: a } = ctx;
  const project = desktop && hasWorkspace;
  return [
    { id: 'open', title: 'Klasör aç…', enabled: desktop, run: a.openFolder },
    { id: 'new', title: 'Yeni dosya…', enabled: hasWorkspace, run: a.newFile },
    { id: 'save', title: 'Dosyayı kaydet', enabled: hasWorkspace, hint: 'Ctrl+S', run: a.save },
    { id: 'settings', title: 'Ayarları aç', enabled: true, run: a.settings },
    { id: 'panel', title: 'Alt paneli göster/gizle', enabled: desktop, hint: 'Ctrl+J', run: a.togglePanel },
    { id: 'theme', title: 'Açık/koyu temayı değiştir', enabled: true, run: a.toggleTheme },
    { id: 'theme-pick', title: 'Renk temasını seç…', enabled: true, run: a.settings },
    { id: 'view-files', title: 'Dosyalar', enabled: true, run: () => a.sidebar('files') },
    { id: 'view-build', title: 'Derle', enabled: desktop, run: () => a.sidebar('build') },
    { id: 'view-devices', title: 'Cihazlar', enabled: desktop, run: () => a.sidebar('devices') },
    { id: 'view-ai', title: 'Yapay zekâ', enabled: desktop, run: () => a.sidebar('ai') },
    { id: 'terminal', title: 'Terminali aç', enabled: desktop, run: a.terminal },
    { id: 'chat', title: ctx.chatOpen ? 'Sohbeti kapat' : 'Sohbeti aç/kapat', enabled: desktop, run: a.toggleChat },
    { id: 'view-appstore', title: 'App Store hazırlığı', enabled: true, run: () => a.openView('appstore') },
    { id: 'view-security', title: 'Güvenlik merkezi', enabled: true, run: () => a.openView('security') },
    { id: 'view-preflight', title: 'Yayın öncesi denetimi aç', enabled: true, run: () => a.openView('preflight') },
    { id: 'preflight-run', title: 'Yayın öncesi denetimi çalıştır', enabled: project, run: a.runPreflight },
    { id: 'doctor', title: 'Ortamı denetle', enabled: desktop, run: a.runDoctor },
    { id: 'updates', title: 'Güncellemeleri denetle', enabled: true, run: a.settings },
    { id: 'claude-code', title: "Claude Code'u projeyle aç", enabled: project, run: a.claudeCode },
    { id: 'bottom-output', title: 'Alt panel: Çıktı', enabled: desktop, run: () => a.bottom('output') },
    { id: 'bottom-problems', title: 'Alt panel: Sorunlar', enabled: desktop, run: () => a.bottom('problems') },
    { id: 'bottom-terminal', title: 'Alt panel: Terminal', enabled: desktop && ctx.terminalOpen, run: () => a.bottom('terminal') },
    { id: 'bottom-devicelog', title: 'Alt panel: Cihaz günlükleri', enabled: desktop, run: () => a.bottom('devicelog') },
    { id: 'redetect', title: 'Yeniden algıla', enabled: desktop, run: a.redetect },
  ];
}
