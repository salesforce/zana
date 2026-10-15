import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { EditorTab } from './studio-layout.js';

const KIND_MARK: Record<EditorTab['kind'], string> = { agent: 'AGENT', apex: 'APEX', flow: 'FLOW', type: 'TYPE' };

/** Open editor tabs: agent (editable), Apex (read-only), Flow (read-only map) and Lightning Type (read-only schema). */
export function EditorTabs({ tabs, active, dirtyId, problems, onSelect, onClose }: {
  tabs: EditorTab[];
  active: string | null;
  /** Tab id whose draft has unsaved edits. */
  dirtyId?: string | null;
  /** Problem count shown on the active agent tab. */
  problems?: number;
  onSelect(id: string): void;
  onClose(id: string): void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const hasTabs = tabs.length > 0;
  // The strip hides its scrollbar, so a vertical wheel scrolls it sideways. Native and non-passive, so the page does not scroll too.
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || element.scrollWidth <= element.clientWidth) return;
      event.preventDefault();
      element.scrollLeft += event.deltaY;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [hasTabs]);
  // A tab opened or selected off-screen scrolls into view.
  useEffect(() => {
    strip.current?.querySelector('.sf-etab.is-active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);
  if (!hasTabs) return null;
  return <div ref={strip} className="sf-etabs" role="tablist" aria-label="Open files">
    {tabs.map((tab, index) => {
      const selected = tab.id === active;
      return <span key={tab.id} className={`sf-etab${selected ? ' is-active' : ''}`} data-kind={tab.kind}>
        <button type="button" role="tab" className="sf-etab-label" aria-selected={selected} tabIndex={selected ? 0 : -1}
          title={tab.path ?? tab.target ?? tab.label} onClick={() => onSelect(tab.id)}
          onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
            if (next === null) return;
            event.preventDefault(); onSelect(tabs[next].id);
            event.currentTarget.closest('.sf-etabs')?.querySelectorAll<HTMLButtonElement>('.sf-etab-label')[next]?.focus();
          }}>
          <span className="sf-etab-kind">{KIND_MARK[tab.kind]}</span>
          <span className="sf-etab-name">{tab.label}</span>
          {tab.kind !== 'agent' && <span className="sf-etab-ro">read-only</span>}
          {dirtyId === tab.id && <span className="sf-etab-dirty" role="img" aria-label="Unsaved changes">●</span>}
          {selected && tab.kind === 'agent' && problems ? <span className="sf-etab-problems" aria-label={`${problems} problems`}>{problems}</span> : null}
        </button>
        <button type="button" className="sf-etab-close" aria-label={`Close ${tab.label}`} onClick={() => onClose(tab.id)}><X size={11} aria-hidden="true" /></button>
      </span>;
    })}
  </div>;
}
