import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../ipc';
import { parseDiagnostics } from '../xtool/parse';
import type { Diagnostic } from '../xtool/types';
import sample from '../../examples/LocalSimulator/Counter.swift?raw';
import { SimulatorCanvas } from './SimulatorCanvas';
import type { Frame, SimulatorEvent, SimulatorInfo } from './types';
import './simulator.css';
import { sourcePath } from './sourcePath';

interface Props {
  workspace: string | null;
  selected: string | null;
  savedRevision: string;
  onOpen(path: string): void;
  onDiagnostics(diagnostics: Diagnostic[]): void;
  onClose(): void;
}
const PROFILES = [{ label: 'Compact · 375 × 812', width: 375, height: 812 }, { label: 'Standard · 390 × 844', width: 390, height: 844 }, { label: 'Large · 430 × 932', width: 430, height: 932 }];

export function SimulatorPanel({ workspace, selected, savedRevision, onOpen, onDiagnostics, onClose }: Props) {
  const [info, setInfo] = useState<SimulatorInfo | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [running, setRunning] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [profile, setProfile] = useState(1);
  const [landscape, setLandscape] = useState(false);
  const [dark, setDark] = useState(false);
  const [zoom, setZoom] = useState(0.65);
  const [autoReload, setAutoReload] = useState(false);
  const [source, setSource] = useState(selected?.endsWith('.swift') ? selected : 'SimulatorExample/Counter.swift');
  const activeStream = useRef(0);
  const sequence = useRef(0);
  const generation = useRef(0);
  const deviceRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const log = useCallback((text: string) => setLogs((old) => [...old.slice(-199), text]), []);

  useEffect(() => {
    let live = true;
    void ipc.simulatorInfo().then((value) => { if (live) setInfo(value); }).catch((e: unknown) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    generation.current += 1;
    activeStream.current = 0;
    onDiagnostics([]);
    return () => { generation.current += 1; activeStream.current = 0; void ipc.simulatorStop().catch(() => {}); };
  }, [workspace, onDiagnostics]);

  const start = useCallback(async () => {
    if (!workspace || building) return;
    setBuilding(true);
    setError(null);
    const token = ++sequence.current;
    const buildGeneration = generation.current;
    let candidate: Frame | null = null;
    let exited = false;
    const onEvent = (event: SimulatorEvent) => {
      if (buildGeneration !== generation.current) return;
      if (event.kind === 'frame') {
        candidate = event.frame;
        if (activeStream.current === token) setFrame(event.frame);
      } else if (event.kind === 'log') log(event.text);
      else {
        exited = true;
        if (activeStream.current === token) { setRunning(false); log(`Runtime exited: ${event.code ?? 'signal'}`); }
      }
    };
    try {
      const result = await ipc.simulatorStart(source, onEvent);
      if (buildGeneration !== generation.current) return;
      const diagnostics = parseDiagnostics(result.output).map((d) => ({ ...d, file: sourcePath(workspace, d.file) }));
      onDiagnostics(diagnostics);
      result.output.forEach(log);
      if (result.ok) {
        activeStream.current = token;
        setSessionVersion((version) => version + 1);
        if (candidate) setFrame(candidate);
        setRunning(!exited);
        log(`Started local Swift application: ${source}`);
      } else setError('Derleme başarısız. Önceki çalışan uygulama korunuyor; hatalar aşağıda ve düzenleyicide.');
    } catch (e) { if (buildGeneration === generation.current) setError(String(e)); }
    finally { setBuilding(false); }
  }, [workspace, building, source, log, onDiagnostics]);

  const startRef = useRef(start);
  useEffect(() => { startRef.current = start; }, [start]);
  useEffect(() => {
    if (!autoReload || !running) return;
    const timer = window.setTimeout(() => void startRef.current(), 600);
    return () => window.clearTimeout(timer);
    // Rebuild only after a saved source snapshot changes, never on runtime renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedRevision, autoReload]);

  const stop = async () => {
    generation.current += 1;
    activeStream.current = 0;
    await ipc.simulatorStop().catch((e: unknown) => setError(String(e)));
    setRunning(false);
    log('Simulator stopped. Start/reload resets in-memory app data.');
  };
  const openSample = async () => {
    const path = 'SimulatorExample/Counter.swift';
    try {
      if (await ipc.readFileIfExists(path) === null) await ipc.applyFile(path, sample);
      setSource(path);
      onOpen(path);
    } catch (e) { setError(String(e)); }
  };
  const capture = () => {
    const device = deviceRef.current;
    if (!device) return;
    const clone = device.cloneNode(true) as HTMLElement;
    clone.style.transform = '';
    clone.style.margin = '0';
    // Retain live form values in the exported local SVG.
    clone.querySelectorAll('input').forEach((input, index) => {
      const original = device.querySelectorAll('input')[index];
      input.setAttribute('value', original.value);
      if (original.checked) input.setAttribute('checked', 'checked'); else input.removeAttribute('checked');
    });
    const styles = Array.from(document.styleSheets).flatMap((sheet) => { try { return Array.from(sheet.cssRules).map((rule) => rule.cssText); } catch { return []; } }).join('\n');
    const content = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width + 20}" height="${height + 20}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${styles.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</style>${content}</div></foreignObject></svg>`;
    const link = document.createElement('a');
    link.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    link.download = 'local-simulator.svg';
    link.click();
  };
  const chosen = PROFILES[profile];
  const width = landscape ? chosen.height : chosen.width;
  const height = landscape ? chosen.width : chosen.height;
  return <section className="sim-panel" aria-label="Yerel Swift simülatörü" ref={panelRef}>
    <header className="sim-header"><div><strong>Yerel Swift simülatörü</strong><small>{building ? 'Derleniyor…' : running ? `Çalışıyor · kare ${frame?.revision ?? 0}` : 'Durduruldu'} · bağımsız uyumluluk ortamı</small></div><button type="button" onClick={onClose} aria-label="Simülatörü kapat">×</button></header>
    {info && <p className="sim-explanation" role="status">Paketle birlikte kurulu · {info.platformSupported ? info.compilerPath ? 'Swift derleyicisi hazır' : `Çalıştırmak için Swift araç zincirini (swiftc) kurun: swift.org/install/${info.platform === 'windows' ? 'windows' : 'linux'}` : 'Bu platformda çalıştırma henüz desteklenmiyor.'}</p>}
    <div className="sim-toolbar">
      <label>Kaynak <input aria-label="Simülatör kaynak dosyası" value={source} onChange={(e) => setSource(e.target.value)} /></label>
      <button type="button" disabled={!workspace || building || (info !== null && (!info.platformSupported || !info.compilerPath))} onClick={() => void start()}>{running ? 'Yeniden derle / başlat' : 'Simülatörü başlat'}</button>
      <button type="button" disabled={!running && !building} onClick={() => void stop()}>Durdur</button>
      <button type="button" disabled={!workspace || building} onClick={() => void openSample()}>Örneği aç</button>
      <label><input type="checkbox" checked={autoReload} onChange={(e) => setAutoReload(e.target.checked)} />Kaydedince derle</label>
    </div>
    <div className="sim-toolbar">
      <select aria-label="Sanal cihaz profili" value={profile} onChange={(e) => setProfile(Number(e.target.value))}>{PROFILES.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}</select>
      <button type="button" onClick={() => setLandscape((old) => !old)}>Döndür</button>
      <button type="button" onClick={() => setDark((old) => !old)}>{dark ? 'Açık görünüm' : 'Koyu görünüm'}</button>
      <label>Ölçek <select aria-label="Simülatör ölçeği" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>{[0.4, 0.5, 0.65, 0.8, 1].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}</select></label>
      <button type="button" disabled={!frame} onClick={capture}>SVG görüntüsü</button>
      <button type="button" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : panelRef.current?.requestFullscreen() ?? Promise.resolve()).catch((e: unknown) => setError(String(e)))}>Tam ekran</button>
    </div>
    {!workspace && <p className="sim-explanation">Önce bir proje klasörü açın, ardından “Örneği aç” ile derlenebilir uygulamayı düzenleyin.</p>}
    {error && <p className="sim-error" role="alert">{error}</p>}
    <div className="sim-stage"><div style={{ width: (width + 20) * zoom, height: (height + 20) * zoom }}><div ref={deviceRef} className={`sim-device${dark ? ' sim-dark' : ''}`} style={{ width: width + 20, height: height + 20, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
      <div className="sim-screen"><div className="sim-status"><time>9:41</time><span>LOCAL · 100%</span></div><div className="sim-viewport" style={{ pointerEvents: running ? 'auto' : 'none' }}>
        {frame ? <SimulatorCanvas key={sessionVersion} node={frame.root} send={(id, value) => void ipc.simulatorInput(id, value).catch((e: unknown) => setError(String(e)))} /> : <div className="sim-placeholder"><strong>Swift uygulamanı çalıştır</strong><p>Kaynağı derle, arayüzle etkileş ve gerçek durum değişikliklerini izle.</p></div>}
      </div><div className="sim-home" /></div>
    </div></div></div>
    <details className="sim-logs"><summary>Çalışma günlükleri ({logs.length})</summary><pre>{logs.join('\n') || 'Henüz çıktı yok.'}</pre></details>
    <p className="sim-explanation">Deneysel SwiftUI alt kümesi. Profiller ve safe area ölçüleri yaklaşık. iOS ikili dosyaları, Apple framework’leri, SF Symbols, sanal klavye ve iOS animasyonları desteklenmiyor. Sistem klavyesiyle yazabilirsiniz.</p>
  </section>;
}
