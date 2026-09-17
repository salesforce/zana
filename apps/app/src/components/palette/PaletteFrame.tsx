import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Search, Star, X } from 'lucide-react';
import { PALETTE_SCOPES, type PaletteScope } from './searchItems.js';
import './palette.css';

export const PALETTE_LIST_ID = 'command-palette-results';
export const paletteOptionId = (index: number) => `command-palette-option-${index}`;
export function paletteOptionProps(index: number, activeIndex: number) {
  return { id: paletteOptionId(index), role: 'option', 'aria-selected': index === activeIndex, tabIndex: -1 } as const;
}

interface Props {
  query: string;
  onQuery: (query: string) => void;
  placeholder: string;
  scope: PaletteScope;
  onScope: (scope: PaletteScope) => void;
  modeLabel?: string;
  activeIndex: number;
  rowCount: number;
  total: number;
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onClose: () => void;
  children: ReactNode;
}

export function PaletteFrame({
  query, onQuery, placeholder, scope, onScope, modeLabel, activeIndex, rowCount, total,
  inputRef, listRef, onInputKeyDown, onClose, children
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    inputRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [inputRef]);

  const onDialogKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key !== 'Tab') return;
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([tabindex="-1"])');
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="palette-backdrop command-palette-backdrop" onMouseDown={onClose}>
      <div ref={dialogRef} className="palette command-palette" role="dialog" aria-modal="true"
        aria-label="Command palette" onKeyDown={onDialogKeyDown} onMouseDown={(e) => e.stopPropagation()}>
        <div className="command-palette-search">
          <Search size={18} strokeWidth={1.7} aria-hidden="true" />
          <input ref={inputRef} className="palette-input" role="combobox" aria-label="Search commands and destinations"
            aria-expanded="true" aria-autocomplete="list" aria-controls={PALETTE_LIST_ID}
            aria-activedescendant={rowCount > 0 ? paletteOptionId(activeIndex) : undefined}
            placeholder={placeholder} value={query} onChange={(e) => onQuery(e.target.value)} onKeyDown={onInputKeyDown} />
          <button className="command-palette-close" onClick={onClose} aria-label="Close command palette" title="Close (Esc)">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {modeLabel ? <div className="command-palette-mode">{modeLabel}</div> : (
          <div className="command-palette-scopes" role="group" aria-label="Search categories">
            {PALETTE_SCOPES.map(({ id, label }) => (
              <button key={id} aria-pressed={scope === id} onClick={() => { onScope(id); inputRef.current?.focus(); }}>
                {id === 'favorites' && <Star size={12} aria-hidden="true" />}
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="palette-list" id={PALETTE_LIST_ID} role="listbox" aria-label="Search results" ref={listRef}>
          {children}
        </div>
        <footer className="command-palette-footer">
          <span className="command-palette-help"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Select</span><span><kbd>esc</kbd> Close</span></span>
          <span role="status" aria-live="polite" aria-atomic="true">
            {rowCount < total ? `${rowCount} of ${total}` : total} {total === 1 ? 'result' : 'results'}
          </span>
        </footer>
      </div>
    </div>
  );
}
