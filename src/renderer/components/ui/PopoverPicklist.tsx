import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useExclusivePopover } from '../../util/useExclusivePopover';

export interface PopoverPicklistOption<T extends string> {
  value: T;
  /** Plain text used for the trigger, search matching, and the default option row. */
  label: string;
  /** Optional richer option-row rendering (icon, meta line, ...); falls back to `label`. */
  content?: ReactNode;
  /** Extra class on this option's row, e.g. for a taller/richer layout. */
  className?: string;
  /** Renders a group header above the first option of a new group, in list order. */
  group?: string;
}

export interface PopoverPicklistProps<T extends string> {
  id?: string;
  ariaLabel: string;
  value: T | '';
  options: readonly PopoverPicklistOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyHint?: string;
  className?: string;
  /** Class on the trigger button; defaults to the bordered field look. */
  triggerClassName?: string;
  /** Minimum popover width in px; defaults to 200. */
  minWidth?: number;
  /**
   * Anchor the popover to the trigger's parent element instead of the
   * trigger itself — for a compound field (e.g. a leading icon beside the
   * trigger) where the popover's left edge should align with the whole field.
   */
  anchorToParent?: boolean;
}

/**
 * Generic single-select popover: a trigger button + a portal-rendered,
 * optionally searchable options menu. Generalizes the popover pattern the
 * project and model pickers each hand-rolled, so a new dropdown doesn't fall
 * back to a plain native `<select>`. Reuses the `launch-model-picker-*` CSS
 * classes those pickers already share.
 */
export function PopoverPicklist<T extends string>({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled,
  searchable = true,
  searchPlaceholder = 'Search…',
  emptyHint = 'No matches',
  className = '',
  triggerClassName = 'launch-model-picker-trigger',
  minWidth = 200,
  anchorToParent = false
}: PopoverPicklistProps<T>) {
  const [open, setOpen] = useExclusivePopover();
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const selected = options.find((option) => option.value === value);
  const visibleOptions = useMemo(() => {
    if (!searchable) return options;
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery
      ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
      : options;
  }, [options, query, searchable]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = anchorToParent
      ? triggerRef.current.parentElement?.getBoundingClientRect() ?? triggerRef.current.getBoundingClientRect()
      : triggerRef.current.getBoundingClientRect();
    setPosition({ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, minWidth) });
  }, [open, anchorToParent, minWidth]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Capture phase: a modal dialog (e.g. the New Agent launcher) stops
    // mousedown propagation on its own container to keep clicks inside it from
    // bubbling to a backdrop's close-on-click-outside handler. That stopPropagation
    // runs during the bubble phase, so a bubble-phase document listener here would
    // never see clicks made inside that modal. Capture fires top-down BEFORE bubble,
    // so it can't be blocked by a descendant's later stopPropagation call.
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      if (searchable) searchRef.current?.focus();
    } else {
      setQuery('');
      if (wasOpenRef.current) triggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open, searchable]);

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`${triggerClassName} ${className}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span>{selected?.label ?? placeholder}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="launch-model-picker-menu"
          role="listbox"
          aria-label={ariaLabel}
          style={position ? { left: position.left, top: position.top, width: position.width } : { visibility: 'hidden' }}
        >
          {searchable && (
            <div className="launch-model-picker-search">
              <Search size={13} aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </div>
          )}
          {visibleOptions.map((option, index) => (
            <div key={option.value}>
              {option.group && option.group !== visibleOptions[index - 1]?.group && (
                <div className="launch-model-picker-group-label">{option.group}</div>
              )}
              <button
                type="button"
                className={`launch-model-picker-option${option.className ? ` ${option.className}` : ''}${value === option.value ? ' is-selected' : ''}`}
                role="option"
                aria-selected={value === option.value}
                onClick={() => { onChange(option.value); setOpen(false); }}
              >
                {option.content ?? <span>{option.label}</span>}
                {value === option.value && <Check size={14} aria-hidden="true" />}
              </button>
            </div>
          ))}
          {visibleOptions.length === 0 && <div className="launch-model-picker-hint">{emptyHint}</div>}
        </div>,
        document.body
      )}
    </>
  );
}
