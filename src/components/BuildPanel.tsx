import { useLayoutEffect, useRef, useState } from 'react';
import type { BuildState } from '../xtool/buildState';
import { validateProjectName } from '../xtool/parse';
import type { Diagnostic, XtoolInfo, XtoolOp, XtoolRunArgs } from '../xtool/types';
import '../build-panel.css';

export interface BuildPanelProps {
  info: XtoolInfo | null;
  infoLoading: boolean;
  compatibility: 'tested' | 'untested' | 'unknown';
  versionLabel: string | null;
  swiftLabel: string | null;
  hasWorkspace: boolean;
  state: BuildState;
  diagnostics: Diagnostic[];
  outcomeLabel: string | null;
  onRedetect(): void;
  onRun(op: XtoolOp, args: XtoolRunArgs): void;
  onCancel(): void;
  onClose(): void;
  onOpenFile(path: string, line: number | null): void;
}

type Tab = 'output' | 'problems';

export function BuildPanel(props: BuildPanelProps) {
  const { info, infoLoading, compatibility, versionLabel, swiftLabel, hasWorkspace, state, diagnostics } = props;
  const [tab, setTab] = useState<Tab>('output');
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [configuration, setConfiguration] = useState<'debug' | 'release'>('debug');
  const [project, setProject] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const found = info?.found === true;
  const nameCheck = validateProjectName(name);
  const nameError = name.length > 0 && !nameCheck.ok ? nameCheck.reason : null;

  let blocked: string | null = null;
  if (state.running) blocked = 'A run is already active. Cancel it or wait for it to finish.';
  else if (!found) blocked = 'xtool was not found, so this action is unavailable.';
  else if (!hasWorkspace) blocked = 'Open a workspace folder first.';

  const onScroll = () => {
    const el = logRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.lines.length, tab]);

  const submitNew = () => {
    if (blocked || !nameCheck.ok) return;
    props.onRun('new', { name });
    setShowNew(false);
    setName('');
  };

  return (
    <section className="bp-panel" aria-label="Build panel">
      <div className="bp-head">
        <h2>Build</h2>
        <button type="button" onClick={props.onClose} aria-label="Close build panel">
          Close
        </button>
      </div>

      <div className="bp-status" aria-live="polite">
        {infoLoading || !info ? (
          <span>Detecting xtool...</span>
        ) : found ? (
          <>
            <dl>
              <dt>xtool</dt>
              <dd>Found{info.path ? ` at ${info.path}` : ''}</dd>
              <dt>Version</dt>
              <dd>{versionLabel ?? 'unknown'}</dd>
              <dt>Swift toolchain</dt>
              <dd>{swiftLabel ?? 'Not found on PATH'}</dd>
            </dl>
            {compatibility !== 'tested' && (
              <div className="bp-warn" role="alert">
                {compatibility === 'untested'
                  ? 'Untested version: this xtool version has not been verified with Open iOS Studio. Command flags, output format and diagnostics parsing may differ from what was tested.'
                  : 'Unknown version: the xtool version could not be determined, so compatibility with Open iOS Studio is unverified (command flags, output format and diagnostics parsing).'}
              </div>
            )}
          </>
        ) : (
          <div className="bp-help">
            <p>
              <strong>Not available:</strong> xtool was not found{info.error ? ` (${info.error})` : ''}. Builds cannot run
              until it is installed.
            </p>
            <p>
              Install xtool: github.com/xtool-org/xtool, see the Installation-Linux docs. The Darwin SDK must be installed
              by you with <code>xtool sdk install</code> from an Xcode.xip.
            </p>
            <p>
              Open iOS Studio never handles Apple credentials. Run <code>xtool setup</code> in your own terminal.
            </p>
            <p>Swift toolchain: {swiftLabel ?? 'Not found on PATH'}</p>
          </div>
        )}
      </div>

      <div className="bp-actions" role="toolbar" aria-label="Build actions">
        <button type="button" onClick={props.onRedetect} disabled={infoLoading || state.running} title={state.running ? 'A run is active.' : undefined}>
          Re-detect
        </button>
        <button type="button" onClick={() => props.onRun('sdk-status', {})} disabled={blocked !== null} title={blocked ?? undefined}>
          SDK status
        </button>
        <button type="button" onClick={() => setShowNew((v) => !v)} disabled={blocked !== null} title={blocked ?? undefined} aria-expanded={showNew}>
          New project
        </button>
        {showNew && (
          <span className="bp-actions">
            <label>
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitNew()}
                aria-invalid={nameError !== null}
              />
            </label>
            <button type="button" onClick={submitNew} disabled={blocked !== null || !nameCheck.ok} title={blocked ?? nameError ?? undefined}>
              Create
            </button>
            {nameError && <span className="bp-error" role="alert">{nameError}</span>}
          </span>
        )}
        <label>
          Configuration
          <select value={configuration} onChange={(e) => setConfiguration(e.target.value as 'debug' | 'release')}>
            <option value="debug">debug</option>
            <option value="release">release</option>
          </select>
        </label>
        <label>
          Project dir
          <input type="text" value={project} placeholder="(workspace root)" onChange={(e) => setProject(e.target.value)} />
        </label>
        <button type="button" onClick={() => props.onRun('build', { project, configuration })} disabled={blocked !== null} title={blocked ?? undefined}>
          Build
        </button>
        {state.running && (
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
        )}
      </div>

      <div className="bp-tabs" role="tablist" aria-label="Build output">
        <button type="button" role="tab" className="bp-tab" aria-selected={tab === 'output'} onClick={() => setTab('output')}>
          Output
        </button>
        <button type="button" role="tab" className="bp-tab" aria-selected={tab === 'problems'} onClick={() => setTab('problems')}>
          Problems ({diagnostics.length})
        </button>
      </div>

      <div className="bp-body" role="tabpanel" ref={logRef} onScroll={onScroll}>
        {tab === 'output' ? (
          <>
            {state.dropped > 0 && <div className="bp-note">{state.dropped} earlier lines dropped</div>}
            <pre className="bp-log" aria-label="Build log">
              {state.lines.map((l) => (
                <span key={l.id} className={l.stream === 'stderr' ? 'bp-line-stderr' : 'bp-line-stdout'}>
                  {l.text}
                  {'\n'}
                </span>
              ))}
            </pre>
          </>
        ) : diagnostics.length === 0 ? (
          <div className="bp-note">No problems reported.</div>
        ) : (
          <ul className="bp-problems">
            {diagnostics.map((d, i) => (
              <li key={i}>
                <span className={`bp-badge bp-badge-${d.severity}`}>{d.severity}</span>
                <span>{d.message}</span>
                {d.file && (
                  <button type="button" className="bp-link" onClick={() => props.onOpenFile(d.file as string, d.line)}>
                    {d.file}
                    {d.line !== null ? `:${d.line}` : ''}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {props.outcomeLabel && (
        <div className="bp-outcome" role="status">
          {props.outcomeLabel}
        </div>
      )}
      <p className="bp-disclaimer">
        Build success is not App Store compliance. Check App Store Readiness and Security Center separately.
      </p>
    </section>
  );
}
