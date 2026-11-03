import { describe, expect, it, vi } from 'vitest';
import { buildCommands, type CommandContext } from './commands';

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  const actions: CommandContext['actions'] = {
    openFolder: vi.fn(),
    newFile: vi.fn(),
    save: vi.fn(),
    settings: vi.fn(),
    togglePanel: vi.fn(),
    toggleTheme: vi.fn(),
    sidebar: vi.fn(),
    terminal: vi.fn(),
    toggleChat: vi.fn(),
    openView: vi.fn(),
    runPreflight: vi.fn(),
    runDoctor: vi.fn(),
    restartLsp: vi.fn(),
    claudeCode: vi.fn(),
    bottom: vi.fn(),
    redetect: vi.fn(),
  };
  return { desktop: true, hasWorkspace: true, chatOpen: false, terminalOpen: false, actions, ...overrides };
}

const titles = (c: CommandContext) => buildCommands(c).map((x) => x.title);

describe('buildCommands', () => {
  it('lists every panel and action by title', () => {
    const t = titles(ctx());
    for (const expected of [
      'Klasör aç…',
      'Yeni dosya…',
      'Dosyayı kaydet',
      'Ayarları aç',
      'Alt paneli göster/gizle',
      'Dosyalar',
      'Derle',
      'Cihazlar',
      'Yapay zekâ',
      'Terminali aç',
      'Sohbeti aç/kapat',
      'App Store hazırlığı',
      'Güvenlik merkezi',
      'Yayın öncesi denetimi aç',
      'Yayın öncesi denetimi çalıştır',
      'Ortamı denetle',
      'Güncellemeleri denetle',
      "Claude Code'u projeyle aç",
      'Alt panel: Çıktı',
      'Alt panel: Sorunlar',
      'Alt panel: Terminal',
      'Alt panel: Cihaz günlükleri',
      'Yeniden algıla',
    ]) {
      expect(t, expected).toContain(expected);
    }
    const ids = buildCommands(ctx()).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('desktop-only entries are disabled in the browser', () => {
    const cmds = buildCommands(ctx({ desktop: false }));
    const byId = (id: string) => cmds.find((c) => c.id === id)!;
    expect(byId('view-build').enabled).toBe(false);
    expect(byId('terminal').enabled).toBe(false);
    expect(byId('claude-code').enabled).toBe(false);
    expect(byId('settings').enabled).toBe(true);
    expect(byId('view-appstore').enabled).toBe(true);
  });

  it('project entries are disabled without a workspace', () => {
    const cmds = buildCommands(ctx({ hasWorkspace: false }));
    const byId = (id: string) => cmds.find((c) => c.id === id)!;
    expect(byId('preflight-run').enabled).toBe(false);
    expect(byId('new').enabled).toBe(false);
    expect(byId('open').enabled).toBe(true);
  });

  it('runs the matching action', () => {
    const c = ctx();
    const byId = (id: string) => buildCommands(c).find((x) => x.id === id)!;
    byId('view-devices').run();
    expect(c.actions.sidebar).toHaveBeenCalledWith('devices');
    byId('view-security').run();
    expect(c.actions.openView).toHaveBeenCalledWith('security');
    byId('bottom-problems').run();
    expect(c.actions.bottom).toHaveBeenCalledWith('problems');
    byId('updates').run();
    expect(c.actions.settings).toHaveBeenCalled();
    byId('lsp-restart').run();
    expect(c.actions.restartLsp).toHaveBeenCalled();
  });
});
