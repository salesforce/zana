import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Check } from 'lucide-react';
import type { ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import { placePopoverMenu, useExclusivePopover } from '../../ui/PopoverPicklist.js';
import type { PickerOption } from './model-picker-option.js';
import {
  isComposerHiddenReasoningLevel,
  nextComposerReasoningLevel,
  reasoningEffortFill,
  thinkingEffortTitle
} from './reasoning-labels.js';

const MENU_MIN_WIDTH = 180;

function EffortBars({ filled }: { filled: 0 | 1 | 2 | 3 }): ReactNode {
  return (
    <svg
      className="reasoning-effort-bars"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <rect x="1" y="8" width="2.5" height="3" rx="0.5" className={filled >= 1 ? 'is-filled' : undefined} />
      <rect x="4.75" y="5" width="2.5" height="6" rx="0.5" className={filled >= 2 ? 'is-filled' : undefined} />
      <rect x="8.5" y="2" width="2.5" height="9" rx="0.5" className={filled >= 3 ? 'is-filled' : undefined} />
    </svg>
  );
}

export function ReasoningEffortPicker({
  value,
  options,
  onChange,
  disabled
}: {
  value: ReasoningLevel;
  options: readonly PickerOption<ReasoningLevel>[];
  onChange: (value: ReasoningLevel) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useExclusivePopover();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visibleOptions = options.filter((option) => !isComposerHiddenReasoningLevel(option.value));
  const displayLevel = isComposerHiddenReasoningLevel(value)
    ? (visibleOptions[visibleOptions.length - 1]?.value ?? 'xhigh')
    : value;
  const title = thinkingEffortTitle(displayLevel);
  const visibleLevels = visibleOptions.map((option) => option.value);

  const increment = () => {
    if (visibleLevels.length === 0) return;
    setOpen(false);
    const next = nextComposerReasoningLevel(visibleLevels, displayLevel);
    if (next !== value) onChange(next);
  };

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
  }, [open, visibleOptions.length]);

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

  if (visibleOptions.length === 0) return null;

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="reasoning-effort-picker-trigger"
      aria-label={title}
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled}
      title={title}
      data-testid="reasoning-effort-picker-trigger"
      onClick={increment}
      onContextMenu={(event) => {
        event.preventDefault();
        setOpen(true);
      }}
    >
      <Brain size={14} aria-hidden="true" />
      <EffortBars filled={reasoningEffortFill(displayLevel)} />
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
          aria-label="Thinking effort"
          data-testid="reasoning-effort-picker-menu"
        >
          {visibleOptions.map((option) => {
            const isSelected = option.value === displayLevel;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`model-reasoning-picker-row${isSelected ? ' is-selected' : ''}`}
                data-testid={`reasoning-effort-${option.value}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="reasoning-effort-picker-row-label">
                  <EffortBars filled={reasoningEffortFill(option.value)} />
                  {option.label}
                </span>
                {isSelected ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
