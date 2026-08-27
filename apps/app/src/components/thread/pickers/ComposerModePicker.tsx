import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Columns2, Flag } from 'lucide-react';
import { placePopoverMenu, useExclusivePopover } from '../../ui/PopoverPicklist.js';
import {
  COMPOSER_MODE_LABELS,
  type ComposerWorkMode
} from './composer-mode.js';

const MENU_MIN_WIDTH = 180;

function ModeIcon({ mode }: { mode: ComposerWorkMode }): ReactNode {
  if (mode === 'agent') {
    return <span className="composer-mode-picker-infinity" aria-hidden="true">∞</span>;
  }
  if (mode === 'plan') {
    return <Columns2 size={14} aria-hidden="true" />;
  }
  return <Flag size={14} aria-hidden="true" />;
}

export function ComposerModePicker({
  value,
  modes,
  onChange,
  disabled
}: {
  value: ComposerWorkMode;
  modes: readonly ComposerWorkMode[];
  onChange: (value: ComposerWorkMode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useExclusivePopover();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedLabel = COMPOSER_MODE_LABELS[value];

  useEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const position = placePopoverMenu(rect, { width: window.innerWidth, height: window.innerHeight }, MENU_MIN_WIDTH);
    const menu = menuRef.current;
    menu.style.left = `${position.left}px`;
    menu.style.width = `${Math.max(position.width, MENU_MIN_WIDTH)}px`;
    menu.style.maxHeight = `${position.maxHeight}px`;
    if (position.bottom != null) {
      menu.style.bottom = `${position.bottom}px`;
      menu.style.top = 'auto';
    } else {
      menu.style.top = `${position.top}px`;
      menu.style.bottom = 'auto';
    }
  }, [open, modes.length]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [open, setOpen]);

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="composer-mode-picker-trigger"
      aria-label="Composer mode"
      aria-keyshortcuts="Shift+Tab"
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled}
      title={`${selectedLabel} (Shift+Tab)`}
      data-testid="composer-mode-picker-trigger"
      onClick={() => setOpen((current) => !current)}
    >
      <ModeIcon mode={value} />
      <span className="composer-mode-picker-label">{selectedLabel}</span>
      {disabled ? null : <ChevronDown size={14} aria-hidden="true" />}
    </button>
  );

  if (disabled) return trigger;

  return (
    <>
      {trigger}
      {open && createPortal(
        <div
          ref={menuRef}
          className="model-reasoning-picker-menu"
          role="listbox"
          aria-label="Composer mode"
          data-testid="composer-mode-picker-menu"
        >
          {modes.map((mode) => {
            const selected = mode === value;
            return (
              <button
                key={mode}
                type="button"
                role="option"
                aria-selected={selected}
                className={`model-reasoning-picker-row${selected ? ' is-selected' : ''}`}
                data-testid={`composer-mode-${mode}`}
                onClick={() => {
                  onChange(mode);
                  setOpen(false);
                }}
              >
                <span className="composer-mode-picker-row-label">
                  <ModeIcon mode={mode} />
                  {COMPOSER_MODE_LABELS[mode]}
                </span>
                {selected ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
