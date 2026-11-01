import type { ReactNode } from 'react';

export type BottomTabId = 'output' | 'problems' | 'terminal' | 'devicelog';

export interface BottomTab {
  id: BottomTabId;
  label: string;
  /** Short status text next to the label, e.g. "2 hata". */
  badge?: string;
  /** `error` / `warn` colour the badge; `busy` shows a running indicator. */
  tone?: 'error' | 'warn' | 'busy';
  content: ReactNode;
}

interface Props {
  tabs: BottomTab[];
  active: BottomTabId;
  maximized: boolean;
  onSelect(id: BottomTabId): void;
  onCloseTab(id: BottomTabId): void;
  onToggleMaximize(): void;
  onHide(): void;
}

/**
 * One tabbed panel system for build output, problems, the terminal and device logs. Every tab stays mounted and the
 * inactive ones are hidden, so switching never kills a running terminal session.
 */
export function BottomPanel({ tabs, active, maximized, onSelect, onCloseTab, onToggleMaximize, onHide }: Props) {
  return (
    <>
      <div className="bottom-head">
        <div className="bottom-tabs" role="tablist" aria-label="Alt panel sekmeleri">
          {tabs.map((t) => (
            <div key={t.id} className={`btab${t.id === active ? ' active' : ''}`}>
              <button type="button" role="tab" aria-selected={t.id === active} onClick={() => onSelect(t.id)}>
                {t.label}
                {t.badge && <span className={`btab-badge${t.tone ? ` ${t.tone}` : ''}`}>{t.badge}</span>}
              </button>
              <button type="button" className="btab-close" aria-label={`${t.label} sekmesini kapat`} onClick={() => onCloseTab(t.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="bottom-actions">
          <button type="button" className="icon-btn" onClick={onToggleMaximize} aria-pressed={maximized} title={maximized ? 'Paneli küçült' : 'Paneli tam ekran yap'}>
            {maximized ? 'Küçült' : 'Tam ekran'}
          </button>
          <button type="button" className="icon-btn" onClick={onHide} title="Paneli gizle (Ctrl+J). Terminal oturumu açık kalır.">
            Gizle
          </button>
        </div>
      </div>
      <div className="bottom-body">
        {tabs.map((t) => (
          <div key={t.id} className="bottom-pane" hidden={t.id !== active} role="tabpanel" aria-label={t.label}>
            {t.content}
          </div>
        ))}
      </div>
    </>
  );
}
