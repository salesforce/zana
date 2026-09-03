import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, RefreshCw, Users } from 'lucide-react';
import { placePopoverMenu, useExclusivePopover } from '../../ui/PopoverPicklist.js';

const MENU_MIN_WIDTH = 200;

export type NativeRoleOption = { value: string; name?: string };

export function NativeRolePicker({
  value,
  options,
  onChange,
  onRefresh,
  disabled
}: {
  value: string | undefined;
  options: readonly NativeRoleOption[];
  onChange: (value: string | undefined) => void;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useExclusivePopover();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value) ?? options[0];
  const label = selected?.name ?? selected?.value ?? 'Role';

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
  }, [open, options.length]);

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

  if (options.length === 0) return null;

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="reasoning-effort-picker-trigger"
      aria-label="Native role"
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled}
      title="Native role"
      data-testid="native-role-picker-trigger"
      onClick={() => setOpen((current) => !current)}
    >
      <Users size={14} aria-hidden="true" />
      <span className="reasoning-effort-picker-label">{label}</span>
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
          aria-label="Native role"
          data-testid="native-role-picker-menu"
        >
          {options.map((option) => {
            const isSelected = option.value === (selected?.value ?? '');
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`model-reasoning-picker-row${isSelected ? ' is-selected' : ''}`}
                data-testid={`native-role-${option.value}`}
                onClick={() => {
                  onChange(option.value || undefined);
                  setOpen(false);
                }}
              >
                <span className="reasoning-effort-picker-row-label">
                  {option.name ?? option.value}
                </span>
                {isSelected ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            );
          })}
          <button
            type="button"
            className="model-reasoning-picker-row"
            data-testid="native-role-refresh"
            onClick={() => {
              onRefresh();
              setOpen(false);
            }}
          >
            <span className="reasoning-effort-picker-row-label">
              <RefreshCw size={14} aria-hidden="true" />
              Refresh roles
            </span>
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
