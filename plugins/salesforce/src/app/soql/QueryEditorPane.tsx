import { useEffect, useRef, useState, type ReactNode } from 'react';

export function QueryEditorPane({ children }: { children: ReactNode }) {
  const pane = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const [height, setHeight] = useState(180);
  const [maximum, setMaximum] = useState(520);
  useEffect(() => {
    const parent = pane.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      if (!parent.clientHeight) return;
      const limit = Math.max(140, Math.min(520, Math.floor(parent.clientHeight * .65), parent.clientHeight - 160));
      setMaximum(limit);
      setHeight(value => Math.min(value, limit));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const resize = (value: number) => setHeight(Math.max(140, Math.min(maximum, value)));
  return <>
    <div className="sf-soql-editor-pane" ref={pane} style={{ height }}>{children}</div>
    <div className="sf-query-divider" role="separator" aria-orientation="horizontal" aria-label="Resize query editor" aria-valuemin={140} aria-valuemax={maximum} aria-valuenow={height} tabIndex={0}
      onPointerDown={event => { if (event.button !== 0 || drag.current) return; event.preventDefault(); event.currentTarget.focus(); drag.current = { pointerId: event.pointerId, y: event.clientY, height: pane.current?.getBoundingClientRect().height || height }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current && drag.current.pointerId === event.pointerId) resize(drag.current.height + event.clientY - drag.current.y); }}
      onPointerUp={event => { if (drag.current?.pointerId !== event.pointerId) return; drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => resize(180)}
      onKeyDown={event => { if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); resize(event.key === 'Home' ? 140 : event.key === 'End' ? maximum : height + (event.key === 'ArrowUp' ? -24 : 24)); }}
    ><span /></div>
  </>;
}
