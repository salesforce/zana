import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function ChipButton({
  icon,
  label,
  activeText,
  children,
  align = 'start',
  variant = 'chip',
  ariaLabel
}: {
  icon?: ReactNode;
  label?: string;
  activeText?: string;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  variant?: 'chip' | 'ghost';
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const active = Boolean(activeText);
  return (
    <div className={`tsk-chip-wrap ${align === 'end' ? 'tsk-chip-wrap-end' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`${variant === 'ghost' ? 'tsk-icon-btn' : 'tsk-chip'} ${active ? 'is-active' : ''}`}
        aria-label={ariaLabel ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {variant === 'chip' ? label : null}
        {activeText ? <span className="tsk-chip-value">{activeText}</span> : null}
      </button>
      {open ? (
        <div id={menuId} role="menu" className="tsk-menu">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  icon,
  checked,
  children,
  onSelect
}: {
  icon?: ReactNode;
  checked?: boolean;
  children: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} className="tsk-menu-item" onClick={onSelect}>
      {icon}
      <span className="tsk-menu-item-label">{children}</span>
      {checked ? <span className="tsk-menu-check">✓</span> : null}
    </button>
  );
}
