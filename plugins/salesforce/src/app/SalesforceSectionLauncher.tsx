import { useLayoutEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUpRight, Bot, Check, ChevronDown, Database, FlaskConical, House, Package, Search, X } from 'lucide-react';
import type { WorkbenchView } from '../../lib/workbench-contract.js';

export const SALESFORCE_SECTIONS = [
  { id: 'overview', label: 'Overview', detail: 'Project health and recent activity', Icon: House, color: '#6575ce' },
  { id: 'data', label: 'Data', detail: 'Objects, records and SOQL', Icon: Database, color: '#089b95' },
  { id: 'apex', label: 'Apex & logs', detail: 'Tests, code and debug logs', Icon: FlaskConical, color: '#bd681f' },
  { id: 'deployments', label: 'Deployments', detail: 'Metadata changes and job history', Icon: Package, color: '#8261bd' },
  { id: 'agentforce', label: 'Agentforce', detail: 'AgentScripts, previews and tests', Icon: Bot, color: '#0176d3' },
] as const satisfies ReadonlyArray<{ id: WorkbenchView; label: string; detail: string; Icon: typeof House; color: string }>;

/** Familiar Salesforce launcher, scoped to this project's tools. External items retain the current Studio. */
export function SalesforceSectionLauncher({ value, external = [], actions, onSelect }: {
  value: WorkbenchView;
  external?: readonly WorkbenchView[];
  /** Compact headers expose org actions inside the launcher. */
  actions?: ReactNode;
  onSelect(view: WorkbenchView): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = SALESFORCE_SECTIONS.find(section => section.id === value)!;
  const choices = SALESFORCE_SECTIONS.filter(section => `${section.label} ${section.detail}`.toLowerCase().includes(query.trim().toLowerCase()));
  const dismiss = (restoreFocus = false) => {
    setOpen(false); setQuery('');
    if (restoreFocus) trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const popup = dialog.current;
    const bounds = trigger.current?.getBoundingClientRect();
    if (popup && bounds) {
      const width = Math.min(380, Math.max(0, window.innerWidth - 16));
      const top = bounds.bottom + 8;
      popup.style.width = `${width}px`;
      popup.style.left = `${Math.min(Math.max(8, bounds.left + 8), Math.max(8, window.innerWidth - width - 8))}px`;
      popup.style.top = `${top}px`;
      popup.style.maxHeight = `${Math.max(0, window.innerHeight - top - 8)}px`;
      // The top layer keeps the launcher above editor and host-panel resize handles.
      if (typeof popup.showPopover === 'function') popup.showPopover();
      else popup.removeAttribute('popover');
    }
    search.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) dismiss(); };
    // Editor iframe clicks do not bubble pointer events to this document.
    const blur = () => dismiss();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur); };
  }, [open]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); return; }
    const items = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('[data-section]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (index >= 0 && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault(); (event.key === 'Home' ? items[0] : items.at(-1))?.focus();
    } else if (event.key === 'Tab') {
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button,input') ?? [])].filter(element => {
        const compactActions = element.closest('.sf-section-footer');
        return getComputedStyle(element).display !== 'none' && (!compactActions || getComputedStyle(compactActions).display !== 'none');
      });
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  return <div className="sf-section-launcher" ref={root}>
    <button ref={trigger} className="sf-section-trigger" type="button" aria-label="Open Salesforce tools" aria-describedby={`${id}-current`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      title={`Salesforce tools · ${current.label}`} onClick={() => { setQuery(''); setOpen(value => !value); }}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
      <span className="sf-section-waffle" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
      <span id={`${id}-current`} className="sf-section-current">{current.label}</span><ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && <div ref={dialog} id={id} className="sf-section-popup" popover="manual" role="dialog" aria-labelledby={`${id}-heading`} onKeyDown={keyDown}>
      <div className="sf-section-popup-heading"><h2 id={`${id}-heading`}>Salesforce tools</h2><button type="button" aria-label="Close Salesforce tools" onClick={() => dismiss(true)}><X size={18} aria-hidden="true" /></button></div>
      <p>{external.length ? 'Tools marked ↗ open in the main window.' : 'Switch tools in this project.'}</p>
      <label className="sf-section-search"><Search size={17} aria-hidden="true" /><input ref={search} aria-label="Search Salesforce tools" placeholder="Search tools…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="sf-section-choices">
        {choices.map(({ id, label, detail, Icon, color }) => <button type="button" className="sf-section-choice" data-section={id} key={id}
          aria-current={id === value ? 'page' : undefined} onClick={() => { dismiss(true); onSelect(id); }}>
          <span className="sf-section-tile" style={{ backgroundColor: color }}><Icon size={19} aria-hidden="true" /></span>
          <span className="sf-section-description"><strong>{label}</strong><small>{detail}</small></span>
          {external.includes(id) ? <ArrowUpRight size={15} aria-label="Opens in main window" /> : id === value ? <Check size={16} aria-hidden="true" /> : null}
        </button>)}
        {!choices.length && <p className="sf-section-empty" role="status">No tools match “{query}”.</p>}
      </div>
      {actions && <div className="sf-section-footer" onClick={() => dismiss(true)}>{actions}</div>}
    </div>}
  </div>;
}
