import { useEffect, useRef, type CSSProperties } from 'react';
import type { SendInput, UINode } from './types';

function TextInput({ node, send }: { node: UINode; send: SendInput }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // A delayed native frame must not discard locally typed keystrokes.
    if (input.current && document.activeElement !== input.current) input.current.value = node.props.value ?? '';
  }, [node.props.value]);
  return <input ref={input} className="sim-input" aria-label={node.props.text} placeholder={node.props.text} type={node.kind === 'securefield' ? 'password' : 'text'} defaultValue={node.props.value ?? ''} onChange={(event) => send(node.id, event.target.value)} />;
}

function Tabs({ node, send }: { node: UINode; send: SendInput }) {
  const selected = Math.max(0, node.children.findIndex((child) => child.props.tag === node.props.selection));
  return <div className="sim-tabs">
    <div className="sim-tab-content">{node.children[selected] && <SimulatorCanvas node={node.children[selected]} send={send} />}</div>
    <div role="tablist">{node.children.map((child, index) => <button type="button" role="tab" aria-selected={selected === index} key={child.id} onClick={() => send(node.id, Number(child.props.tag))}>{child.props.tabTitle ?? `Tab ${index + 1}`}</button>)}</div>
  </div>;
}

export function SimulatorCanvas({ node, send }: { node: UINode; send: SendInput }) {
  const p = node.props;
  const children = node.children.map((child) => <SimulatorCanvas key={child.id} node={child} send={send} />);
  const style: CSSProperties = {};
  for (const key of ['padding', 'fontSize', 'width', 'height', 'borderRadius', 'opacity'] as const) {
    if (p[key] !== undefined && Number.isFinite(Number(p[key]))) style[key] = Number(p[key]);
  }
  if (p.color) style.color = p.color;
  if (p.background) style.background = p.background;
  if (p.offsetX || p.offsetY) style.transform = `translate(${Number(p.offsetX) || 0}px, ${Number(p.offsetY) || 0}px)`;
  switch (node.kind) {
    case 'empty': return null;
    case 'group': return <>{children}</>;
    case 'text': return <span className="sim-text">{p.text}</span>;
    case 'symbol': return <span title="SF Symbols assets are unsupported">[symbol: {p.text}]</span>;
    case 'button': return <button type="button" className="sim-button" onClick={() => send(node.id)}>{children}</button>;
    case 'textfield': case 'securefield':
      return <TextInput node={node} send={send} />;
    case 'toggle': return <label className="sim-toggle">{p.text}<input type="checkbox" checked={p.value === 'true'} onChange={(event) => send(node.id, event.target.checked)} /></label>;
    case 'slider': return <input aria-label="Slider" type="range" min={p.min} max={p.max} step="any" value={p.value} onChange={(event) => send(node.id, Number(event.target.value))} />;
    case 'progress': return <div role="status"><progress />{p.text}</div>;
    case 'spacer': return <div className="sim-spacer" />;
    case 'tabs': return <Tabs node={node} send={send} />;
    case 'sheet': case 'alert': return <div className="sim-overlay"><div role="dialog" aria-modal="true" aria-label={p.text || 'Sheet'} className={`sim-${node.kind}`}><strong>{p.text}</strong>{children}</div></div>;
    case 'modified': return <div className="sim-modified" style={style}>{p.title && <h2 className="sim-nav-title">{p.title}</h2>}{children}</div>;
    case 'vstack': case 'hstack': case 'zstack': case 'list': case 'scroll': case 'navigation': case 'presentation':
      return <div className={`sim-node sim-${node.kind}`} style={{ gap: Number(p.spacing) || undefined }}>{children}</div>;
    default: return <div role="alert">Unsupported runtime node: {node.kind}</div>;
  }
}
