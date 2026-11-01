import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { KEY_STEP, dragSize } from './layout';

interface Props {
  /** `horizontal`: a horizontal line that resizes a height. `vertical`: a vertical line that resizes a width. */
  orientation: 'horizontal' | 'vertical';
  value: number;
  min: number;
  /** A function lets the limit follow the window size (read at drag start and on each move). */
  max: number | (() => number);
  /** +1 when moving toward +x/+y grows the panel, -1 when it shrinks it. */
  direction: 1 | -1;
  label: string;
  /** Live size while dragging. Must not trigger heavy re-renders (the parent sets a CSS variable). */
  onLive(value: number): void;
  /** Final size, once per drag or key press. */
  onCommit(value: number): void;
  onReset(): void;
}

const CLASSES = ['is-resizing', 'is-resizing-ns', 'is-resizing-ew'];

function clearDragClasses() {
  document.documentElement.classList.remove(...CLASSES);
}

/**
 * Real pointer-driven splitter: pointer capture keeps the drag alive over Monaco/xterm, text
 * selection and the cursor are controlled through a class on <html> while dragging, and every
 * exit path (up, cancel, lost capture, unmount) restores them.
 */
export function Splitter({ orientation, value, min, max, direction, label, onLive, onCommit, onReset }: Props) {
  const horizontal = orientation === 'horizontal';
  const drag = useRef<{ start: number; startValue: number; live: number } | null>(null);
  const [active, setActive] = useState(false);
  const limit = () => (typeof max === 'function' ? max() : max);

  useEffect(() => clearDragClasses, []);

  const finish = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    clearDragClasses();
    setActive(false);
    onCommit(d.live);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: horizontal ? e.clientY : e.clientX, startValue: value, live: value };
    document.documentElement.classList.add('is-resizing', horizontal ? 'is-resizing-ns' : 'is-resizing-ew');
    setActive(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const pos = horizontal ? e.clientY : e.clientX;
    d.live = dragSize(d.startValue, pos - d.start, direction, min, Math.max(min, limit()));
    onLive(d.live);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = horizontal ? 'ArrowUp' : 'ArrowRight';
    const shrink = horizontal ? 'ArrowDown' : 'ArrowLeft';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    // Moving the line toward -x/-y is "delta < 0".
    const delta = e.key === (horizontal ? 'ArrowUp' : 'ArrowLeft') ? -KEY_STEP : KEY_STEP;
    const next = dragSize(value, delta, direction, min, Math.max(min, limit()));
    onLive(next);
    onCommit(next);
  };

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuemin={min}
      aria-valuenow={value}
      tabIndex={0}
      title="Sürükleyerek yeniden boyutlandırın, çift tıklayınca varsayılana döner"
      className={`splitter splitter-${horizontal ? 'h' : 'v'}${active ? ' active' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
