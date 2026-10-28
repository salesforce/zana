import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react';

export const STUDIO_RESIZE_STYLES = `
.sf-pane-divider { position:relative; flex:0 0 9px; min-width:0; min-height:0; align-self:stretch; z-index:25; cursor:col-resize; touch-action:none; outline:none; background:linear-gradient(90deg,transparent 4px,var(--sf-border) 4px,var(--sf-border) 5px,transparent 5px); }
.sf-pane-divider::after { content:''; position:absolute; width:3px; height:28px; border-radius:3px; left:3px; top:calc(50% - 14px); background:color-mix(in srgb,var(--sf-muted) 38%,transparent); }
.sf-pane-divider[aria-orientation=horizontal] { flex-basis:9px; cursor:row-resize; background:linear-gradient(transparent 4px,var(--sf-border) 4px,var(--sf-border) 5px,transparent 5px); }
.sf-pane-divider[aria-orientation=horizontal]::after { width:28px; height:3px; left:calc(50% - 14px); top:3px; }
.sf-pane-divider:hover,.sf-pane-divider:focus-visible,.sf-pane-divider[data-resizing=true] { background:var(--sf-soft); }
.sf-pane-divider:hover::after,.sf-pane-divider:focus-visible::after,.sf-pane-divider[data-resizing=true]::after { background:var(--sf-accent); }
.sf-pane-divider:focus-visible { outline:1px solid var(--sf-accent); outline-offset:-1px; }
:where(.sf-studio,.af-workspace,.af-lab):has(.sf-pane-divider[data-resizing=true]) { user-select:none; -webkit-user-select:none; }
:where(.sf-studio,.af-workspace,.af-lab):has(.sf-pane-divider[data-resizing=true]) iframe { pointer-events:none; }
`;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** One captured pointer, incremental movement (no jump on grab), and no per-drag DOM listeners. */
export function ResizeHandle({ label, orientation = 'vertical', value, min, max, step = 4, scale = () => 1, onChange, onCommit, onReset, className = '', valueText }: {
  label: string; orientation?: 'vertical' | 'horizontal'; value: number; min: number; max: number; step?: number;
  /** Converts pointer pixels to the pane's units. Negative for a pane below the handle. */
  scale?(): number;
  onChange(value: number): void; onCommit?(value: number): void; onReset(): void;
  className?: string; valueText?: string;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; at: number; value: number; next: number; scale: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const release = () => {
    const current = drag.current;
    drag.current = null;
    if (current && handle.current?.hasPointerCapture?.(current.id)) handle.current.releasePointerCapture(current.id);
    return current;
  };
  useEffect(() => {
    const blur = () => { const current = release(); if (current) { setDragging(false); commit.current?.(current.next); } };
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('blur', blur); release(); };
  }, []);
  // A breakpoint can turn a column divider into a row divider during a drag.
  useEffect(() => { release(); setDragging(false); }, [orientation]);
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    const current = release()!;
    setDragging(false);
    onCommit?.(current.next);
  };
  const change = (next: number) => { const bounded = clamp(next, min, max); onChange(bounded); onCommit?.(bounded); };
  return <div ref={handle} className={`sf-pane-divider ${className}${dragging ? ' is-dragging' : ''}`} role="separator" tabIndex={0}
    aria-label={label} aria-orientation={orientation} aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(value)} aria-valuetext={valueText}
    data-resizing={dragging} title="Drag to resize · double-click or Enter to reset · arrow keys to adjust"
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { id: event.pointerId, at: orientation === 'vertical' ? event.clientX : event.clientY, value, next: value, scale: scale() };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDragging(true);
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const position = orientation === 'vertical' ? event.clientX : event.clientY;
      current.next = clamp(current.value + (position - current.at) * current.scale, min, max);
      onChange(current.next);
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={onReset}
    onKeyDown={event => {
      const previous = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
      const next = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onReset(); }
      else if (event.key === 'Home' || event.key === 'End' || event.key === previous || event.key === next) {
        event.preventDefault();
        change(event.key === 'Home' ? min : event.key === 'End' ? max : value + (event.key === previous ? -step : step));
      }
    }} />;
}

export function usePaneSize(storageKey: string | undefined, initial: number, min: number, max: number) {
  const read = () => {
    if (!storageKey) return initial;
    try { const saved: unknown = JSON.parse(localStorage.getItem(storageKey ?? '') ?? 'null'); return typeof saved === 'number' && Number.isFinite(saved) ? clamp(saved, min, max) : initial; }
    catch { return initial; }
  };
  const [size, setSize] = useState(read);
  useLayoutEffect(() => { setSize(read()); }, [storageKey, initial]);
  const save = (value: number) => {
    const bounded = clamp(value, min, max);
    setSize(bounded);
    if (storageKey) { try { localStorage.setItem(storageKey, JSON.stringify(bounded)); } catch { /* Layout storage is optional. */ } }
  };
  return { size: clamp(size, min, max), onChange: setSize, onCommit: save, onReset: () => save(initial) };
}

/** Measures the actual container, including a parent resize; the two panes keep useful minimum sizes. */
export function useStudioSplit({ storageKey, initial = 50, breakpoint = 760, stack = true, minPane = 220 }: {
  storageKey?: string; initial?: number; breakpoint?: number; stack?: boolean; minPane?: number;
}) {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => { const { width, height } = element.getBoundingClientRect(); setBounds({ width, height }); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const stacked = bounds.width > 0 && bounds.width <= breakpoint;
  const length = (stacked ? bounds.height : bounds.width) - 9;
  const minimum = length > 0 ? Math.min(40, (stacked ? 120 : minPane) / length * 100) : 20;
  const pane = usePaneSize(storageKey ? `${storageKey}:${stacked ? 'rows' : 'columns'}` : undefined, stacked && stack ? 58 : initial, Math.max(20, minimum), Math.min(80, 100 - minimum));
  return {
    ref, style: { '--sf-pane-ratio': pane.size } as CSSProperties, stacked,
    divider: (label: string) => !stacked || stack ? <ResizeHandle key={storageKey} label={label} orientation={stacked ? 'horizontal' : 'vertical'} value={pane.size}
      min={Math.max(20, minimum)} max={Math.min(80, 100 - minimum)} {...pane} scale={() => length > 0 ? 100 / length : 0} /> : null
  };
}

export function useElementSize(ref: RefObject<HTMLElement | null>, onSize: (bounds: { width: number; height: number }) => void, parent = false) {
  useLayoutEffect(() => {
    const element = parent ? ref.current?.parentElement : ref.current;
    if (!element) return;
    const measure = () => { const { width, height } = element.getBoundingClientRect(); onSize({ width, height }); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, onSize, parent]);
}
