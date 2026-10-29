import { useEffect, useId, useRef, useState } from 'react';
import { Activity, Play } from 'lucide-react';
import type { StudioRunDescriptor } from './run-workspaces.js';

export function StudioRunTray({ runs, onOpen }: { runs: StudioRunDescriptor[]; onOpen(run: StudioRunDescriptor): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const active = runs.filter(run => run.path && (run.status === 'active' || run.status === 'running'));
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  if (!active.length) return null;
  return <div ref={root} className="sf-studio-runs" onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="sf-studio-runs-trigger" aria-label="Active runs" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>
      <Activity size={14} aria-hidden="true" /><span>{active.length} active</span>
    </button>
    {open && <div className="sf-studio-runs-list" id={listId} role="region" aria-label="Active run sessions">
      <strong>Active runs</strong><p>Open a run to return to its agent and tool.</p>
      {active.map(run => <button key={run.key} type="button" onClick={() => { setOpen(false); trigger.current?.focus(); onOpen(run); }}>
        <Play size={14} aria-hidden="true" /><span><strong>{run.path!.split('/').pop()}</strong>
          <span>{run.view === 'roleplay' ? 'Role-play' : run.view === 'org-preview' ? 'Org preview' : 'Preview'} · {run.status === 'running' ? 'Running' : 'Session open'} · Turn {run.turn}{run.orgAlias ? ` · ${run.orgAlias}` : ''}</span>
        </span>
      </button>)}
    </div>}
  </div>;
}
