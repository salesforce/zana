import { ChevronDown, ChevronRight } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { ResizeHandle, useElementSize, usePaneSize } from './StudioResize.js';

export type BottomTab = 'problems' | 'trace' | 'output' | 'tests';
export const BOTTOM_TABS: ReadonlyArray<{ id: BottomTab; title: string }> = [
  { id: 'problems', title: 'Problems' }, { id: 'trace', title: 'Trace' }, { id: 'output', title: 'Output' }, { id: 'tests', title: 'Tests' }
];
export const isBottomTab = (value: unknown): value is BottomTab => BOTTOM_TABS.some(tab => tab.id === value);

/**
 * Wide: tabbed panel under the editor (Problems / Trace / Output / Tests). Compact: a collapsible
 * "N problems" bar that expands to the Problems view only. Panes stay mounted (hidden) so their state survives tab switches.
 */
export function BottomPanel({ open, active, problems, testFailures = 0, compact, storageKey, onToggle, onSelect, render }: {
  open: boolean;
  active: BottomTab;
  problems: number;
  testFailures?: number;
  compact?: boolean;
  storageKey?: string;
  onToggle(): void;
  onSelect(tab: BottomTab): void;
  /** Called for each visible-or-mounted pane; `visible` lets lazy panes skip work. */
  render(tab: BottomTab, visible: boolean): ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useElementSize(panel, setBounds, true);
  const maximum = bounds.height > 0 ? Math.max(40, Math.min(640, bounds.height * .65, bounds.height - 200)) : 640;
  const minimum = Math.min(80, maximum);
  const pane = usePaneSize(storageKey, compact ? 160 : 220, minimum, maximum);
  const tabs = compact ? BOTTOM_TABS.filter(tab => tab.id === 'problems') : BOTTOM_TABS;
  const label = problems === 0 ? 'No problems' : `${problems} ${problems === 1 ? 'problem' : 'problems'}`;
  return <section ref={panel} className="sf-bottom" data-open={open} data-compact={compact ? 'true' : undefined} aria-label="Studio panel">
    {open && <ResizeHandle key={storageKey} label="Resize bottom panel" orientation="horizontal" value={pane.size} min={minimum} max={maximum} step={-24}
      {...pane} scale={() => -1} />}
    {compact
      ? <button type="button" className="sf-bottom-bar" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        <span className={problems > 0 ? 'sf-bottom-count is-problem' : 'sf-bottom-count'}>{label}</span>
      </button>
      : <div className="sf-bottom-tabs" role="tablist" aria-label="Panel">
        {tabs.map(tab => <button key={tab.id} type="button" role="tab" id={`sf-bottom-tab-${tab.id}`} aria-selected={open && active === tab.id} aria-controls={`sf-bottom-pane-${tab.id}`}
          className={`sf-bottom-tab${open && active === tab.id ? ' is-active' : ''}`}
          onClick={() => { if (open && active === tab.id) onToggle(); else onSelect(tab.id); }}>
          {tab.title}{tab.id === 'problems' && problems > 0 ? <span className="sf-bottom-badge">{problems}</span> : tab.id === 'tests' && testFailures > 0 ? <span className="sf-bottom-badge">{testFailures}</span> : null}
        </button>)}
        <button type="button" className="sf-bottom-toggle" aria-label={open ? 'Collapse panel' : 'Expand panel'} aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        </button>
      </div>}
    <div className="sf-bottom-body" hidden={!open} style={{ height: pane.size }}>
      {tabs.map(tab => <div key={tab.id} id={`sf-bottom-pane-${tab.id}`} role="tabpanel" className="sf-bottom-pane" aria-labelledby={`sf-bottom-tab-${tab.id}`} hidden={active !== tab.id}>
        {render(tab.id, open && active === tab.id)}
      </div>)}
    </div>
  </section>;
}
