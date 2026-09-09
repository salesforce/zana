import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import { placePopoverMenu, useExclusivePopover } from '../../ui/PopoverPicklist.js';
import type { ComposerModeEntry } from '@zana-ai/zcc-domain/thread-runtime';
import { ComposerModeIcon } from './composer-mode-icon.js';

const MENU_MIN_WIDTH = 180;

export function ComposerModePicker({
  value,
  entries,
  onChange,
  onRefresh,
  disabled
}: {
  value: string;
  entries: readonly ComposerModeEntry[];
  onChange: (value: string) => void;
  onRefresh?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useExclusivePopover();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = entries.find((entry) => entry.id === value) ?? entries[0];
  const selectedLabel = selected?.label ?? entries[0]?.label ?? '';

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
  }, [open, entries.length]);

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
      <ComposerModeIcon mode={selected?.kind === 'plan' ? 'plan' : 'agent'} />
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
          {entries.map((entry) => {
            const selected = entry.id === value;
            return (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`model-reasoning-picker-row${selected ? ' is-selected' : ''}`}
                data-testid={`composer-mode-${entry.id}`}
                onClick={() => {
                  onChange(entry.id);
                  setOpen(false);
                }}
              >
                <span className="composer-mode-picker-row-label">
                  <ComposerModeIcon mode={entry.kind === 'plan' ? 'plan' : 'agent'} />
                  {entry.label}
                </span>
                {selected ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            );
          })}
          {onRefresh ? <button
            type="button"
            className="model-reasoning-picker-row"
            data-testid="composer-mode-refresh"
            onClick={onRefresh}
          >
            <span className="reasoning-effort-picker-row-label">
              <RefreshCw size={14} aria-hidden="true" />
              Refresh roles
            </span>
          </button> : null}
        </div>,
        document.body
      )}
    </>
  );
}
