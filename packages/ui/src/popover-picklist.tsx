import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useExclusivePopover } from './use-exclusive-popover.js';

export { useExclusivePopover } from './use-exclusive-popover.js';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const VIEWPORT_PAD = 8;
const MENU_GAP = 4;
const FLIP_BELOW_PX = 160;
const MENU_MAX_HEIGHT_PX = 360;
const MENU_MAX_HEIGHT_VH = 0.55;

export interface PopoverMenuPlacement {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

/** Keep a fixed menu attached to its trigger and fully inside the viewport. */
export function placePopoverMenu(
  trigger: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width'>,
  viewport: { width: number; height: number },
  minWidth: number
): PopoverMenuPlacement {
  const width = Math.max(trigger.width, minWidth);
  let left = trigger.left;
  if (left + width > viewport.width - VIEWPORT_PAD) {
    left = trigger.right - width;
  }
  if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
  if (left + width > viewport.width - VIEWPORT_PAD) {
    left = Math.max(VIEWPORT_PAD, viewport.width - width - VIEWPORT_PAD);
  }

  const spaceBelow = viewport.height - trigger.bottom - VIEWPORT_PAD;
  const spaceAbove = trigger.top - VIEWPORT_PAD;
  const openAbove = spaceBelow < FLIP_BELOW_PX && spaceAbove > spaceBelow;
  const available = Math.max(120, openAbove ? spaceAbove : spaceBelow);
  const cap = Math.min(
    MENU_MAX_HEIGHT_PX,
    Math.floor(viewport.height * MENU_MAX_HEIGHT_VH)
  );
  const maxHeight = Math.min(available, cap);
  if (openAbove) {
    return {
      left,
      width,
      maxHeight,
      bottom: viewport.height - trigger.top + MENU_GAP
    };
  }
  return {
    left,
    width,
    maxHeight,
    top: trigger.bottom + MENU_GAP
  };
}

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
  /** Keeps an unavailable choice visible without allowing it to be selected. */
  disabled?: boolean;
}

export interface PopoverPicklistProps<T extends string> {
  id?: string;
  ariaLabel: string;
  value: T | '';
  options: readonly PopoverPicklistOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
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
 * project and model pickers each hand-rolled, so a new dropdown does not fall
 * back to a plain native menu. Reuses the `launch-model-picker-*` CSS
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
  title,
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
  const [position, setPosition] = useState<PopoverMenuPlacement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const menuId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);
  const visibleOptions = useMemo(() => {
    if (!searchable) return options;
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery
      ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
      : options;
  }, [options, query, searchable]);
  const activeOption = visibleOptions[activeIndex];

  const optionId = (option: PopoverPicklistOption<T>) => `${menuId}-${option.value}`;
  const selectOption = (option: PopoverPicklistOption<T> | undefined) => {
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };
  const moveActive = (direction: 1 | -1) => {
    if (visibleOptions.length === 0) return;
    setActiveIndex((current) => {
      for (let offset = 1; offset <= visibleOptions.length; offset += 1) {
        const index = (current + direction * offset + visibleOptions.length) % visibleOptions.length;
        if (!visibleOptions[index].disabled) return index;
      }
      return current;
    });
  };
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement | HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const index = visibleOptions.findIndex((option) => !option.disabled);
      if (index >= 0) setActiveIndex(index);
    } else if (event.key === 'End') {
      event.preventDefault();
      const index = visibleOptions.length - 1 - [...visibleOptions].reverse().findIndex((option) => !option.disabled);
      if (index >= 0) setActiveIndex(index);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectOption(activeOption);
    }
  };

  useIsomorphicLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = anchorToParent
      ? triggerRef.current.parentElement?.getBoundingClientRect() ?? triggerRef.current.getBoundingClientRect()
      : triggerRef.current.getBoundingClientRect();
    setPosition(placePopoverMenu(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      minWidth
    ));
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
      const selectedIndex = visibleOptions.findIndex((option) => option.value === value && !option.disabled);
      const firstEnabledIndex = visibleOptions.findIndex((option) => !option.disabled);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : Math.max(0, firstEnabledIndex));
      if (searchable) searchRef.current?.focus();
      else menuRef.current?.focus();
    } else {
      setQuery('');
      if (wasOpenRef.current) triggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open, searchable, value]);

  useEffect(() => {
    if (activeIndex >= visibleOptions.length) setActiveIndex(0);
  }, [activeIndex, visibleOptions.length]);

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`${triggerClassName} ${className}`}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
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
          id={menuId}
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
          onKeyDown={handleMenuKeyDown}
          style={position ? {
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            ...(position.bottom != null
              ? { bottom: position.bottom, top: 'auto' }
              : { top: position.top })
          } : { visibility: 'hidden' }}
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
                aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
                onKeyDown={handleMenuKeyDown}
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
                id={optionId(option)}
                className={`launch-model-picker-option${option.className ? ` ${option.className}` : ''}${value === option.value ? ' is-selected' : ''}${activeIndex === index ? ' is-active' : ''}`}
                role="option"
                aria-selected={value === option.value}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
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
