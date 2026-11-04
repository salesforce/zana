import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Folder, GitBranch, Info, Laptop, Server, X } from 'lucide-react';
import { placePopoverMenu, type PopoverMenuPlacement } from '../ui/PopoverPicklist.js';
import { fallbackProviderOption } from './pickers/fallback-models.js';
import { humanThreadModelLabel } from './pickers/thread-execution-labels.js';

export type ThreadDetailContextAgent = {
  providerId: string | null;
  model: string | null;
  projectName: string | null;
  branchName: string | null;
  machineName?: string;
  machineRemote?: boolean;
};

/** Quiet second-line metadata, with full context available in narrow panes. */
export function ThreadDetailContext({ agent }: { agent: ThreadDetailContextAgent }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverMenuPlacement>();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const provider = agent.providerId ? fallbackProviderOption(agent.providerId).displayName : null;
  const model = agent.model ? humanThreadModelLabel(agent.model, agent.providerId ?? undefined) : null;
  const identity = [provider, model].filter(Boolean).join(' · ');
  const rows = [
    { label: 'Agent', value: provider },
    { label: 'Model', value: model },
    { label: 'Machine', value: agent.machineName, icon: agent.machineRemote ? Server : Laptop },
    { label: 'Project', value: agent.projectName, icon: Folder },
    { label: 'Branch', value: agent.branchName, icon: GitBranch }
  ].filter(row => row.value);
  const hasContext = rows.length > 0;
  const locations = rows.filter(row => row.label === 'Project' || row.label === 'Branch');
  const summary = locations.length ? locations : rows.filter(row => row.label === 'Machine');

  useEffect(() => {
    if (!open || !hasContext) return;
    const doc = trigger.current!.ownerDocument;
    const view = doc.defaultView!;
    panel.current?.querySelector('button')?.focus();
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    const resize = () => setOpen(false);
    const scroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('focusin', outside);
    doc.addEventListener('keydown', escape);
    doc.addEventListener('scroll', scroll, true);
    view.addEventListener('resize', resize);
    return () => {
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('focusin', outside);
      doc.removeEventListener('keydown', escape);
      doc.removeEventListener('scroll', scroll, true);
      view.removeEventListener('resize', resize);
    };
  }, [open, hasContext]);

  if (!hasContext) return null;
  return <>
    <div className="thread-detail-meta" data-testid="thread-header-meta">
    {identity ? <span className="thread-context-identity" title={identity}>{identity}</span> : null}
    {identity && summary.length > 0 ? <span className="thread-context-separator" aria-hidden="true">·</span> : null}
    <button
      ref={trigger}
      type="button"
      className="thread-context-trigger"
      data-testid="thread-context-trigger"
      aria-label="Thread context"
      title={identity ? `${identity} — Thread context` : 'Thread context'}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        const view = event.currentTarget.ownerDocument.defaultView!;
        setPosition(placePopoverMenu(event.currentTarget.getBoundingClientRect(),
          { width: view.innerWidth, height: view.innerHeight }, Math.min(340, view.innerWidth - 16)));
        setOpen(current => !current);
      }}
    >
      {summary.length ? <>
        {summary.map(({ label, value, icon: Icon }, index) => <span
          key={label}
          className={`thread-context-summary thread-context-${label.toLowerCase()}`}
          title={`${label}: ${value}`}
        >
          {index > 0 ? <span className="thread-context-separator" aria-hidden="true">/</span> : null}
          {Icon ? <Icon size={12} aria-hidden="true" /> : null}<span>{value}</span>
        </span>)}
        <ChevronDown size={10} aria-hidden="true" />
      </> : <Info size={12} aria-hidden="true" />}
    </button>
    </div>
    {open && createPortal(<div
      ref={panel}
      id={id}
      className="thread-context-popover"
      role="dialog"
      aria-label="Thread context"
      data-testid="thread-detail-meta"
      style={position}
      onPointerDown={event => event.stopPropagation()}
    >
      <div className="thread-context-heading">
        <span>Thread context</span>
        <button type="button" className="icon-btn" aria-label="Close thread context" onClick={() => {
          setOpen(false);
          trigger.current?.focus();
        }}><X size={14} aria-hidden="true" /></button>
      </div>
      <dl>{rows.map(({ label, value, icon: Icon }) => <div key={label}>
        <dt>{label}</dt>
        <dd title={`${label}: ${value}`}>{Icon ? <Icon size={13} aria-hidden="true" /> : null}<span>{value}</span></dd>
      </div>)}</dl>
    </div>, trigger.current!.ownerDocument.body)}
  </>;
}
