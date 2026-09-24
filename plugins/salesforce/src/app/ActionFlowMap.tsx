import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { flowPositions, type FlowModel } from './action-flow.js';

export function ActionFlowMap({ model, onOpenTarget }: { model: FlowModel; onOpenTarget(target: string): void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const arrowId = `flow-${useId().replace(/:/g, '')}`;
  const positions = useMemo(() => flowPositions(model), [model]);
  const width = Math.max(500, ...[...positions.values()].map(p => p.x + 240));
  const height = Math.max(180, ...[...positions.values()].map(p => p.y + 95));
  const fit = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return false;
    setZoom(Math.max(.45, Math.min(1, (rect.width - 24) / width, (rect.height - 20) / height)));
    return true;
  }, [width, height]);
  useEffect(() => {
    let fitted = fit();
    const observer = new ResizeObserver(() => { if (!fitted) fitted = fit(); });
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [fit]);
  const node = model.nodes.find(n => n.id === selected);
  return <div className="af-flow">
    <div className="af-flow-toolbar"><span>{model.nodes.length} steps · Select a step to inspect</span><button aria-label="Fit Flow to view" onClick={fit}>Fit</button><button aria-label="Zoom out Flow" onClick={() => setZoom(z => Math.max(.45, z - .2))}>−</button><button aria-label="Reset Flow zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button aria-label="Zoom in Flow" onClick={() => setZoom(z => Math.min(2, z + .2))}>+</button></div>
    {model.truncated && <p className="af-action-note">Showing the first 120 steps and 300 connections. Use source for the full Flow.</p>}
    {!model.nodes.length ? <p className="af-action-note">No drawable steps. Open Source to inspect this Flow’s metadata.</p> : <div className="af-flow-viewport" ref={viewport}><svg aria-label="Flow implementation map" width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`}>
      <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
      {model.edges.map((edge, i) => {
        const from = positions.get(edge.from), to = positions.get(edge.to);
        if (!from || !to) return null;
        const x = from.x + 100, y = from.y + 66, tx = to.x + 100, ty = to.y;
        const loop = ty <= y;
        const d = loop ? `M${x},${y} C${x + 145},${y + 40} ${tx + 145},${ty - 20} ${tx},${ty}` : `M${x},${y} C${x},${y + 30} ${tx},${ty - 30} ${tx},${ty}`;
        return <g key={i} className={edge.fault ? 'is-fault' : ''}><path className="af-flow-edge" d={d} markerEnd={`url(#${arrowId})`} /><text className="af-flow-edge-label" x={(x + tx) / 2 + 8} y={(y + ty) / 2 + (loop ? 10 : 0)}>{edge.label}</text></g>;
      })}
      {model.nodes.map(step => {
        const p = positions.get(step.id)!;
        return <g key={step.id} className={`af-flow-node${selected === step.id ? ' is-selected' : ''}`} transform={`translate(${p.x} ${p.y})`} role="button" aria-label={`${step.kind}: ${step.label}`} tabIndex={0} onClick={() => setSelected(step.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(step.id); } }}>
          <rect width="210" height="66" rx="8" /><text className="af-flow-kind" x="13" y="22">{step.kind}</text><text className="af-flow-label" x="13" y="45">{step.label.length > 25 ? `${step.label.slice(0, 24)}…` : step.label}</text><title>{step.label}</title>
        </g>;
      })}
    </svg></div>}
    {node && <section className="af-flow-detail" aria-label="Flow step details"><div><strong>{node.label}</strong><button aria-label="Close step details" onClick={() => setSelected(null)}>×</button></div>{node.target && <button className="af-target-link" onClick={() => onOpenTarget(node.target!)}>Open {node.target} ↗</button>}<pre>{JSON.stringify(node.detail, null, 2)}</pre></section>}
  </div>;
}
