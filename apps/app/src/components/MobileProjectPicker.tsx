import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Modal } from './Modal.js';
import { splitPicklistOptions, type PopoverPicklistOption, type PopoverPicklistProps } from './ui/PopoverPicklist.js';
import './mobile-project-picker.css';

/** A stable scrollport with actions outside it, even with the phone keyboard open. */
export function MobileProjectPicker({ value, options, onChange, placeholder, disabled, title, triggerIcon, ariaLabel, emptyHint, className, searchPlaceholder = 'Search projects' }: PopoverPicklistProps<string>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(option => option.value === value);
  const { items, sticky } = splitPicklistOptions(options, query);
  useEffect(() => {
    // Opening the picker should not summon the software keyboard.
    if (open) closeRef.current?.focus({ preventScroll: true });
    else setQuery('');
  }, [open]);
  const row = (option: PopoverPicklistOption<string>) => <button
    key={option.value}
    type="button"
    disabled={option.disabled}
    aria-pressed={option.value === value}
    onClick={() => { setOpen(false); onChange(option.value); }}
  >
    <span className="mobile-project-picker-copy">
      <span>{option.content ?? option.label}</span>
      {option.description && <small>{option.description}</small>}
    </span>
    {option.value === value && <Check size={20} aria-hidden="true" />}
  </button>;
  return <>
    <button type="button" className={`launch-model-picker-trigger ${className ?? ''}`} disabled={disabled} title={title}
      aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open}
      onPointerDown={event => {
        if (event.button !== 0) return;
        // Native press focus can expand the composer and move this control
        // before click. Keep it in place until the completed tap opens its sheet.
        event.preventDefault();
      }}
      onClick={event => { event.currentTarget.focus(); setOpen(true); }}>
      {triggerIcon}<span>{selected?.label ?? placeholder}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <Modal title="Choose project" className="mobile-project-picker" onClose={() => setOpen(false)}
      header={<header className="mobile-project-picker-header">
        <h2>Choose project</h2>
        <button ref={closeRef} type="button" aria-label="Close project picker" onClick={() => setOpen(false)}><X size={22} aria-hidden="true" /></button>
      </header>}
      footer={sticky.length > 0 ? <div className="mobile-project-picker-actions">{sticky.map(row)}</div> : undefined}>
      <label className="mobile-project-picker-search">
        <Search size={18} aria-hidden="true" />
        <input type="search" aria-label={searchPlaceholder} placeholder={searchPlaceholder} value={query}
          onChange={event => setQuery(event.target.value)} />
      </label>
      <div className="mobile-project-picker-list" aria-label="Projects">
        {items.map(row)}
        {items.length === 0 && <p role="status">{emptyHint}</p>}
      </div>
    </Modal>}
  </>;
}
