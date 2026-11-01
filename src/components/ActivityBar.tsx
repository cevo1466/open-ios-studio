import type { ReactNode } from 'react';
import { IconBuild, IconDevice, IconFiles, IconLock, IconSettings, IconSparkle, IconStore, IconTerminal } from './icons';

export type SidebarView = 'files' | 'build' | 'devices' | 'ai';

interface Props {
  view: SidebarView;
  desktop: boolean;
  terminalOpen: boolean;
  onView(v: SidebarView): void;
  onTerminal(): void;
  onStore(): void;
  onSecurity(): void;
  onSettings(): void;
}

function Item({
  icon,
  label,
  name,
  active,
  disabled,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  /** Full accessible name when the visible label is shortened. */
  name?: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={`act${active ? ' active' : ''}`}
      aria-label={name ?? label}
      aria-current={active ? 'page' : undefined}
      title={title ?? name ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="act-label">{label}</span>
    </button>
  );
}

/** Left activity bar: the section switch. Each entry shows one thing in the side panel, or acts. */
export function ActivityBar({ view, desktop, terminalOpen, onView, onTerminal, onStore, onSecurity, onSettings }: Props) {
  const only = desktop ? undefined : 'Yalnızca masaüstü uygulaması';
  return (
    <nav className="activity" aria-label="Bölümler">
      <Item icon={<IconFiles />} label="Dosyalar" active={view === 'files'} onClick={() => onView('files')} />
      <Item icon={<IconBuild />} label="Derle" title={only ?? 'xtool ile derle ve iPhone’a yükle'} disabled={!desktop} active={view === 'build'} onClick={() => onView('build')} />
      <Item icon={<IconDevice />} label="Cihazlar" title={only ?? 'Bağlı iPhone’lar ve imza durumu'} disabled={!desktop} active={view === 'devices'} onClick={() => onView('devices')} />
      <Item icon={<IconSparkle />} label="Yapay zekâ" title={only ?? 'Yapay zekâ ayarları ve sohbet'} disabled={!desktop} active={view === 'ai'} onClick={() => onView('ai')} />
      <Item icon={<IconTerminal />} label="Terminal" title={only ?? 'Gömülü terminal (Ctrl+J paneli gösterir/gizler)'} disabled={!desktop} active={terminalOpen} onClick={onTerminal} />
      <span className="act-sep" aria-hidden="true" />
      <Item icon={<IconStore />} label="App Store" name="App Store hazırlığı" title="App Store hazırlık denetimi (kaynak düzeyinde)" onClick={onStore} />
      <Item icon={<IconLock />} label="Güvenlik" name="Güvenlik merkezi" title="Güvenlik denetimi (kaynak düzeyinde)" onClick={onSecurity} />
      <Item icon={<IconSettings />} label="Ayarlar" onClick={onSettings} />
    </nav>
  );
}
