import { useLayoutEffect, useRef, useState } from 'react';
import type { BuildState } from '../xtool/buildState';

interface Props {
  state: BuildState;
  emptyText: string;
  onClear(): void;
  onCancel(): void;
}

/** Line-based log with follow-the-tail behaviour that stops as soon as the user scrolls up. */
export function LogView({ state, emptyText, onClear, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [following, setFollowing] = useState(true);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stick.current = atEnd;
    setFollowing(atEnd);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.lines.length]);

  const jump = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = true;
    setFollowing(true);
    el.scrollTop = el.scrollHeight;
  };

  return (
    <div className="log">
      <div className="log-bar">
        <span className="log-state" aria-live="polite">
          {state.running ? 'Çalışıyor…' : state.outcome ? `Bitti (kod ${state.outcome.code ?? '—'})` : 'Boşta'}
        </span>
        <span className="log-spacer" />
        {!following && (
          <button type="button" className="icon-btn" onClick={jump}>
            Sona git
          </button>
        )}
        {state.running && (
          <button type="button" className="icon-btn" onClick={onCancel}>
            İptal
          </button>
        )}
        <button type="button" className="icon-btn" onClick={onClear} disabled={state.running || state.lines.length === 0}>
          Temizle
        </button>
      </div>
      <div className="log-body" ref={ref} onScroll={onScroll} role="log" aria-label="Çıktı günlüğü">
        {state.lines.length === 0 ? (
          <p className="log-empty">{emptyText}</p>
        ) : (
          <pre className="bp-log">
            {state.dropped > 0 && <span className="bp-note">Önceki {state.dropped} satır atıldı{'\n'}</span>}
            {state.lines.map((l) => (
              <span key={l.id} className={l.stream === 'stderr' ? 'bp-line-stderr' : 'bp-line-stdout'}>
                {l.text}
                {'\n'}
              </span>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
