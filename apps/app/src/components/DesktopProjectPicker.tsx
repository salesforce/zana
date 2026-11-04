import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Folder, FolderPlus, Home, Laptop, Plus, Search, Server } from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { MachineProjectGroup } from '../lib/machine-projects.js';
import { composerProjectLabel, isScratchWorkspaceProject } from './composer-project-default.js';
import { picklistOptionVisible, placePopoverMenu, useExclusivePopover, type PopoverMenuPlacement, type PopoverPicklistOption, type PopoverPicklistProps } from './ui/PopoverPicklist.js';
import './desktop-project-picker.css';

export interface DesktopProjectOption extends PopoverPicklistOption<string> {
  machineId?: string;
  project?: Project;
}

interface Props extends Pick<PopoverPicklistProps<string>,
  'value' | 'onChange' | 'placeholder' | 'disabled' | 'title' | 'triggerIcon' | 'ariaLabel' | 'className' | 'searchPlaceholder' | 'emptyHint'> {
  options: readonly DesktopProjectOption[];
  machines: readonly MachineProjectGroup[];
  selectedMachineId?: string;
  onAddProject?: (machine: MachineProjectGroup) => void;
}

function machineStatus(machine: MachineProjectGroup): string {
  return machine.host?.status === 'connected' ? 'Online' : machine.host ? 'Offline'
    : machine.hostId ? 'Unavailable' : machine.remote ? 'Setup needed' : 'Local';
}

function projectPath(option: DesktopProjectOption, machine?: MachineProjectGroup): string {
  if (!option.project) return option.description ?? '';
  if (isScratchWorkspaceProject(option.project)) return `General tasks on ${machine?.name ?? 'this machine'}`;
  const path = option.project.remote?.remotePath ?? option.project.path;
  const home = machine?.host?.homeDir?.replace(/\/$/, '');
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Browse a machine without changing the draft; only a project commits a location. */
export function DesktopProjectPicker({
  value, options, machines, selectedMachineId, onChange, onAddProject, placeholder,
  disabled, title, triggerIcon, ariaLabel, className, searchPlaceholder, emptyHint
}: Props) {
  const [open, setOpen] = useExclusivePopover();
  const [query, setQuery] = useState('');
  const [machineId, setMachineId] = useState(selectedMachineId);
  const [activeValue, setActiveValue] = useState<string>();
  const [position, setPosition] = useState<PopoverMenuPlacement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const id = useId();
  const selected = options.find(option => option.value === value);
  const machine = machines.find(row => row.id === machineId) ?? machines[0];
  const searching = query.trim().length > 0;
  const items = options.filter(option => !option.sticky && (searching
    ? picklistOptionVisible({ ...option, description: `${option.description ?? ''} ${option.project?.path ?? ''} ${projectPath(option, machines.find(row => row.id === option.machineId))}` }, query)
    : option.machineId === machine?.id));
  const enabled = items.filter(option => !option.disabled);
  const active = enabled.find(option => option.value === activeValue) ?? enabled[0];
  const optionId = (option: DesktopProjectOption) => `${id}-${option.value}`;

  const show = () => {
    setQuery('');
    setMachineId(selectedMachineId);
    setActiveValue(value);
    setOpen(true);
  };
  const choose = (option: DesktopProjectOption) => {
    setOpen(false);
    onChange(option.value);
  };
  const browse = (next: MachineProjectGroup) => {
    setMachineId(next.id);
    setQuery('');
    setActiveValue(undefined);
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    // Machine and footer buttons keep their native Tab / Enter behavior.
    if (event.target !== searchRef.current && !listRef.current?.contains(event.target as Node)) return;
    const index = enabled.findIndex(option => option.value === active?.value);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveValue(enabled[(index + direction + enabled.length) % enabled.length]?.value);
    } else if (event.key === 'Home' || event.key === 'End') {
      // Preserve text-editing keys in the search field.
      if (event.target === searchRef.current) return;
      event.preventDefault();
      setActiveValue((event.key === 'Home' ? enabled[0] : enabled.at(-1))?.value);
    } else if (event.key === 'Enter' && active) {
      event.preventDefault();
      choose(active);
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const next = placePopoverMenu(rect, { width: window.innerWidth, height: window.innerHeight }, Math.min(550, window.innerWidth - 16));
      const available = next.bottom != null ? window.innerHeight - next.bottom - 8 : window.innerHeight - next.top! - 8;
      setPosition({ ...next, maxHeight: Math.min(440, window.innerHeight * .65, available) });
    };
    const scroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) place(); };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && position) searchRef.current?.focus({ preventScroll: true });
  }, [open, position !== null]);
  useEffect(() => {
    if (!open && wasOpen.current && document.activeElement === document.body) triggerRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  useEffect(() => {
    if (open && active) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  }, [open, active?.value]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return <>
    <button ref={triggerRef} type="button" className={`launch-model-picker-trigger ${className ?? ''}${open ? ' is-open' : ''}`}
      disabled={disabled} title={title} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
      }}>
      {triggerIcon}<span>{selected?.compactLabel ?? selected?.label ?? placeholder}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menuRef} id={id} role="dialog" aria-label="Choose project"
      className="desktop-project-picker" onKeyDown={onKeyDown} onMouseDown={event => event.stopPropagation()}
      style={position ? { left: position.left, width: position.width, maxHeight: position.maxHeight,
        ...(position.bottom != null ? { bottom: position.bottom } : { top: position.top }) } : { visibility: 'hidden' }}>
      <div className="desktop-project-picker-search">
        <Search size={15} aria-hidden="true" />
        <input ref={searchRef} type="search" value={query} placeholder={searchPlaceholder} aria-label={searchPlaceholder}
          role="combobox" aria-expanded="true" aria-controls={`${id}-projects`} aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active) : undefined}
          onChange={event => { setQuery(event.target.value); setActiveValue(undefined); if (listRef.current) listRef.current.scrollTop = 0; }} />
        <button type="button" className="desktop-project-picker-escape" aria-label="Close project picker" onClick={() => setOpen(false)}>esc</button>
      </div>
      <div className="desktop-project-picker-body">
        <nav className="desktop-project-picker-machines" aria-label="Machines">
          <div className="desktop-project-picker-rail-title">Machines</div>
          {machines.map(row => <button key={row.id} type="button" aria-pressed={row.id === machine?.id}
            className="desktop-project-picker-machine" onClick={() => browse(row)} title={row.name}>
            {row.primary ? <Laptop size={14} aria-hidden="true" /> : <Server size={14} aria-hidden="true" />}
            <span className="desktop-project-picker-machine-copy"><span>{row.name}</span>
              <small><i className={row.host?.status === 'connected' ? 'online' : ''} />{machineStatus(row)}</small></span>
            <span className="desktop-project-picker-count">{options.filter(option => !option.sticky && option.machineId === row.id).length}</span>
          </button>)}
        </nav>
        <div ref={listRef} id={`${id}-projects`} className="desktop-project-picker-projects" role="listbox" aria-label={ariaLabel}
          tabIndex={0} aria-activedescendant={active ? optionId(active) : undefined}>
          {items.map((option, index) => {
            const owner = machines.find(row => row.id === option.machineId);
            const heading = index === 0 || items[index - 1].machineId !== option.machineId;
            const path = projectPath(option, owner);
            return <div key={option.value}>
              {heading && <div className="desktop-project-picker-heading" role="presentation">
                {owner?.primary ? <Laptop size={13} aria-hidden="true" /> : <Server size={13} aria-hidden="true" />}
                <span>{owner?.name ?? 'Unavailable machine'}</span>
                {!searching && <small>{items.length} {items.length === 1 ? 'project' : 'projects'}</small>}
              </div>}
              <button type="button" role="option" id={optionId(option)} tabIndex={-1} disabled={option.disabled}
                aria-disabled={option.disabled || undefined} aria-selected={option.value === value}
                aria-label={`${option.label} ${option.description ?? ''}`.trim()}
                className={`desktop-project-picker-project${option.value === value ? ' is-selected' : ''}${active?.value === option.value ? ' is-active' : ''}`}
                title={option.project?.remote?.remotePath ?? option.project?.path ?? option.description}
                onMouseEnter={() => { if (!option.disabled) setActiveValue(option.value); }} onClick={() => choose(option)}>
                {option.project && isScratchWorkspaceProject(option.project) ? <Home size={16} aria-hidden="true" /> : <Folder size={16} aria-hidden="true" />}
                <span className="desktop-project-picker-project-copy"><span>{option.project ? composerProjectLabel(option.project) : option.label}</span><small>{path}</small></span>
                {option.value === value && <Check size={14} className="desktop-project-picker-check" aria-hidden="true" />}
              </button>
            </div>;
          })}
          {items.length === 0 && <p className="desktop-project-picker-empty" role="status">{searching ? emptyHint : 'No projects on this machine'}</p>}
        </div>
      </div>
      {onAddProject && machine && <button type="button" className="desktop-project-picker-add" onClick={() => { setOpen(false); onAddProject(machine); }}>
        <FolderPlus size={16} aria-hidden="true" /><span>Add project on {machine.name}</span><Plus size={13} aria-hidden="true" />
      </button>}
    </div>, document.body)}
  </>;
}
