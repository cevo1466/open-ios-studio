import type { Diagnostic } from '../xtool/types';

interface Props {
  diagnostics: Diagnostic[];
  onOpenFile(path: string, line: number | null): void;
}

const LABEL: Record<Diagnostic['severity'], string> = { error: 'Hata', warning: 'Uyarı', note: 'Not' };

export function ProblemsList({ diagnostics, onOpenFile }: Props) {
  if (diagnostics.length === 0) {
    return <p className="log-empty">Bildirilen sorun yok. Derleme hataları ve uyarıları burada listelenir.</p>;
  }
  return (
    <ul className="bp-problems" aria-label="Sorunlar">
      {diagnostics.map((d, i) => (
        <li key={i}>
          <span className={`bp-badge bp-badge-${d.severity}`}>{LABEL[d.severity]}</span>
          <span className="prob-msg">{d.message}</span>
          {d.file && (
            <button type="button" className="bp-link" onClick={() => onOpenFile(d.file as string, d.line)}>
              {d.file}
              {d.line !== null ? `:${d.line}` : ''}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
