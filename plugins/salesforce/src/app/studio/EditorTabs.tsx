import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { EditorTab } from './studio-layout.js';

/** Script and the view tabs (Preview, Tests, Graph, Org preview) are named by their label alone. */
const KIND_MARK: Record<EditorTab['kind'], string> = { agent: '', view: '', apex: 'APEX', flow: 'FLOW', type: 'TYPE', lwc: 'LWC', org: 'ORG' };

/** Open editor tabs of the active agent: Script (editable, fixed), views, Apex (read-only), Flow (read-only map) and Lightning Type (read-only schema). */
/** Tab ids each context-menu command closes, in strip order. */
export function tabsToClose(tabs: EditorTab[], id: string, command: 'close' | 'others' | 'right' | 'all'): string[] {
  const index = tabs.findIndex(tab => tab.id === id);
  if (index < 0) return [];
  if (command === 'close') return [id];
  if (command === 'others') return tabs.filter(tab => tab.id !== id).map(tab => tab.id);
  if (command === 'right') return tabs.slice(index + 1).map(tab => tab.id);
  return tabs.map(tab => tab.id);
}

type MenuCommand = Parameters<typeof tabsToClose>[2];
const MENU: Array<[MenuCommand, string]> = [['close', 'Close'], ['others', 'Close others'], ['right', 'Close to the right'], ['all', 'Close all']];

function TabMenu({ tabs, id, x, y, onRun, onDismiss }: { tabs: EditorTab[]; id: string; x: number; y: number; onRun(command: MenuCommand): void; onDismiss(): void }) {
  const menu = useRef<HTMLDivElement>(null);
  // A container-query ancestor becomes the containing block of a fixed element: measure, then shift onto the
  // pointer, kept inside the window.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;
    const left = Math.max(0, Math.min(x, (view?.innerWidth ?? Infinity) - box.width));
    const top = Math.max(0, Math.min(y, (view?.innerHeight ?? Infinity) - box.height));
    element.style.left = `${x + left - box.left}px`;
    element.style.top = `${y + top - box.top}px`;
  }, [x, y]);
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const away = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) onDismiss(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onDismiss(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', onDismiss);
    window.addEventListener('resize', onDismiss);
    return () => {
      document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key);
      window.removeEventListener('blur', onDismiss); window.removeEventListener('resize', onDismiss);
    };
  }, [onDismiss]);
  const label = tabs.find(tab => tab.id === id)?.label ?? '';
  return <div ref={menu} className="sf-etab-menu" role="menu" aria-label={`${label} tab actions`} style={{ left: x, top: y }}
    onKeyDown={event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }}>
    {MENU.map(([command, text]) => <button key={command} type="button" role="menuitem" disabled={!tabsToClose(tabs, id, command).length} onClick={() => onRun(command)}>{text}</button>)}
  </div>;
}

export function EditorTabs({ tabs, active, dirtyId, problems, problemsId, trailing, onSelect, onClose, onCloseMany }: {
  tabs: EditorTab[];
  active: string | null;
  /** Tab id whose draft has unsaved edits. */
  dirtyId?: string | null;
  /** Problem count of the loaded agent. */
  problems?: number;
  /** Tab id the problems belong to: the loaded agent stays badged while a Flow or Apex tab is in front. Defaults to the active agent tab. */
  problemsId?: string | null;
  /** Project-wide controls pinned after the tabs, outside the scrolling strip. */
  trailing?: ReactNode;
  onSelect(id: string): void;
  onClose(id: string): void;
  /** Closes several tabs at once; `focus` is the tab the command was opened on. Without it, the context menu is off. */
  onCloseMany?(ids: string[], focus?: string): void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const dismiss = useRef(() => setMenu(null)).current;
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
  const openMenu = (id: string, x: number, y: number) => { if (onCloseMany) setMenu({ id, x, y }); };
  const run = (command: MenuCommand) => {
    if (!menu) return;
    const ids = tabsToClose(tabs, menu.id, command);
    setMenu(null);
    if (ids.length) onCloseMany!(ids, menu.id);
  };
  const badged = problemsId === undefined ? active : problemsId;
  const list = <div ref={strip} className="sf-etabs" role="tablist" aria-label="Open files">
    {tabs.map((tab, index) => {
      const selected = tab.id === active;
      return <span key={tab.id} className={`sf-etab${selected ? ' is-active' : ''}`} data-kind={tab.kind}
        onContextMenu={event => { if (!onCloseMany) return; event.preventDefault(); openMenu(tab.id, event.clientX, event.clientY); }}>
        <button type="button" role="tab" className="sf-etab-label" aria-selected={selected} tabIndex={selected ? 0 : -1}
          title={tab.path ?? tab.target ?? tab.label} onClick={() => onSelect(tab.id)}
          onKeyDown={event => {
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
              if (!onCloseMany) return;
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              openMenu(tab.id, box.left, box.bottom);
              return;
            }
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
            if (next === null) return;
            event.preventDefault(); onSelect(tabs[next].id);
            event.currentTarget.closest('.sf-etabs')?.querySelectorAll<HTMLButtonElement>('.sf-etab-label')[next]?.focus();
          }}>
          {KIND_MARK[tab.kind] && <span className="sf-etab-kind">{tab.kind === 'org' && tab.target === 'tests' ? 'TESTS' : KIND_MARK[tab.kind]}</span>}
          <span className="sf-etab-name">{tab.kind === 'agent' ? 'Script' : tab.label}</span>
          {tab.kind !== 'agent' && tab.kind !== 'org' && tab.kind !== 'view' && <span className="sf-etab-ro">read-only</span>}
          {dirtyId === tab.id && <span className="sf-etab-dirty" role="img" aria-label="Unsaved changes">●</span>}
          {tab.id === badged && tab.kind === 'agent' && problems ? <span className="sf-etab-problems" aria-label={`${problems} problems`}>{problems}</span> : null}
        </button>
        {tab.kind !== 'agent' && <button type="button" className="sf-etab-close" aria-label={`Close ${tab.label}`} onClick={() => onClose(tab.id)}><X size={11} aria-hidden="true" /></button>}
      </span>;
    })}
    {menu && <TabMenu tabs={tabs} id={menu.id} x={menu.x} y={menu.y} onRun={run} onDismiss={dismiss} />}
  </div>;
  return trailing ? <div className="sf-etabs-bar">{list}<div className="sf-etabs-actions">{trailing}</div></div> : list;
}
