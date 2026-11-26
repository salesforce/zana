import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, RefreshCw, ShieldAlert } from 'lucide-react';
import { placePopoverMenu, useExclusivePopover } from '../ui/PopoverPicklist.js';
import './composer-settings-pill.css';

const MENU_WIDTH = 320;

export interface SettingsChoice<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  tone?: 'default' | 'warning';
}

export interface SettingsGroup<T extends string = string> {
  id: string;
  /** Accessible name of the radio group, e.g. "Permission mode". */
  label: string;
  /** Visible section title. */
  title: string;
  value: T;
  choices: readonly SettingsChoice<T>[];
  onChange: (value: T) => void;
  hint?: string;
  /** Leave a one-choice group out of the menu (it still feeds the summary). */
  hideWhenSingle?: boolean;
  action?: { label: string; onClick: () => void };
}

/** Summary shown on the trigger: the mode, then the effort, then a warning glyph. */
export function composerSettingsSummary(groups: readonly SettingsGroup[]): {
  mode?: SettingsChoice<string>;
  parts: string[];
  warning?: string;
} {
  const pick = (id: string) => {
    const group = groups.find((row) => row.id === id);
    return group?.choices.find((choice) => choice.value === group.value);
  };
  const mode = pick('mode');
  const reasoning = pick('reasoning');
  const permission = pick('permission');
  const permissionGroup = groups.find((row) => row.id === 'permission');
  const parts = [mode?.label, reasoning?.label].filter((part): part is string => Boolean(part));
  return { mode, parts, warning: permission?.tone === 'warning' ? `${permissionGroup?.title ?? 'Permissions'}: ${permission.label}` : undefined };
}

/**
 * One trigger for the composer's less-often-changed settings (mode, thinking,
 * permissions, send mode) so the model can own the main row.
 */
export function ComposerSettingsPill({
  groups,
  disabled
}: {
  groups: readonly SettingsGroup[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useExclusivePopover();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const summary = composerSettingsSummary(groups.filter((group) => group.choices.length > 0));
  const visible = groups.filter((group) => group.choices.length > (group.hideWhenSingle ? 1 : 0));
  const title = [...summary.parts, summary.warning].filter(Boolean).join(' · ');

  useEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const position = placePopoverMenu(rect, { width: window.innerWidth, height: window.innerHeight }, MENU_WIDTH);
    const menu = menuRef.current;
    menu.style.left = `${position.left}px`;
    menu.style.width = `${MENU_WIDTH}px`;
    menu.style.maxHeight = `${position.maxHeight}px`;
    if (position.bottom != null) {
      menu.style.bottom = `${position.bottom}px`;
      menu.style.top = 'auto';
    } else {
      menu.style.top = `${position.top}px`;
      menu.style.bottom = 'auto';
    }
    menu.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Escape is handled on the document: the focused choice can unmount (a group
    // hides once its only valid choice is picked), leaving focus on <body>.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, setOpen]);

  if (visible.length === 0 && summary.parts.length === 0) return null;

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const radio = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="radio"]');
    const group = radio?.closest('[role="radiogroup"]');
    if (!radio || !group) return;
    event.preventDefault();
    const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = radios[(radios.indexOf(radio) + step + radios.length) % radios.length];
    next?.focus();
    next?.click();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`composer-settings-pill${summary.warning ? ' has-warning' : ''}`}
        aria-label="Composer settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={title}
        disabled={disabled || visible.length === 0}
        data-testid="composer-settings-pill"
        onClick={() => setOpen((current) => !current)}
      >
        {summary.mode?.icon ? <span className="composer-settings-pill-icon">{summary.mode.icon}</span> : null}
        {summary.parts.map((part, index) => (
          <span key={part} className="composer-settings-pill-part">
            {index > 0 ? <span className="composer-settings-pill-sep" aria-hidden="true">·</span> : null}
            {part}
          </span>
        ))}
        {summary.warning ? (
          <ShieldAlert size={14} className="composer-settings-pill-warning" aria-label={summary.warning} />
        ) : null}
        {disabled || visible.length === 0 ? null : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={`${id}-menu`}
          className="composer-settings-menu"
          role="dialog"
          aria-label="Composer settings"
          data-testid="composer-settings-menu"
          onKeyDown={onMenuKeyDown}
        >
          {visible.map((group) => {
            const selected = group.choices.find((choice) => choice.value === group.value);
            const note = selected?.tone === 'warning' ? selected.description : group.hint;
            return (
              <section key={group.id} className="composer-settings-section" data-testid={`composer-settings-${group.id}`}>
                <div className="composer-settings-section-head">
                  <span id={`${id}-${group.id}`}>{group.title}</span>
                  {group.action ? (
                    <button type="button" className="composer-settings-action" onClick={group.action.onClick}>
                      <RefreshCw size={12} aria-hidden="true" />
                      {group.action.label}
                    </button>
                  ) : null}
                </div>
                <div
                  className={`composer-settings-segment${group.choices.length > 4 ? ' is-wrapping' : ''}`}
                  role="radiogroup"
                  aria-label={group.label}
                >
                  {group.choices.map((choice) => {
                    const checked = choice.value === group.value;
                    return (
                      <button
                        key={choice.value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        tabIndex={checked ? 0 : -1}
                        title={choice.description}
                        className={`composer-settings-choice${checked ? ' is-selected' : ''}${choice.tone === 'warning' ? ' is-warning' : ''}`}
                        data-testid={`composer-settings-${group.id}-${choice.value}`}
                        onClick={() => { if (!checked) group.onChange(choice.value); }}
                      >
                        {choice.icon}
                        {choice.label}
                      </button>
                    );
                  })}
                </div>
                {note ? (
                  <p className={`composer-settings-note${selected?.tone === 'warning' ? ' is-warning' : ''}`}>{note}</p>
                ) : null}
              </section>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
