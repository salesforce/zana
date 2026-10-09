import type { ReactNode } from 'react';

export interface StripItem { id: string; title: string; icon: ReactNode; badge?: number }

/**
 * One strip, two shapes. `horizontal` is the compact tool switcher (icons only below 400px);
 * `vertical` is the wide activity bar.
 */
export function ToolStrip({ items, active, iconsOnly = false, orientation = 'horizontal', label, onSelect, trailing }: {
  items: StripItem[];
  active: string | null;
  iconsOnly?: boolean;
  orientation?: 'horizontal' | 'vertical';
  label: string;
  onSelect(id: string): void;
  trailing?: ReactNode;
}) {
  const horizontal = orientation === 'horizontal';
  const move = (index: number, key: string) => {
    const next = key === 'ArrowRight' || key === 'ArrowDown' ? (index + 1) % items.length
      : key === 'ArrowLeft' || key === 'ArrowUp' ? (index + items.length - 1) % items.length
      : key === 'Home' ? 0 : key === 'End' ? items.length - 1 : -1;
    return next;
  };
  return <div className={`sf-strip is-${orientation}${iconsOnly ? ' is-icons' : ''}`} role={horizontal ? 'tablist' : 'toolbar'} aria-label={label} aria-orientation={orientation}>
    {items.map((item, index) => <button key={item.id} type="button" className={`sf-strip-item${active === item.id ? ' is-active' : ''}`}
      title={item.title} aria-label={item.title} data-strip-id={item.id}
      {...(horizontal ? { role: 'tab', 'aria-selected': active === item.id, tabIndex: active === item.id || (active === null && index === 0) ? 0 : -1 } : { 'aria-pressed': active === item.id })}
      onClick={() => onSelect(item.id)}
      onKeyDown={event => {
        const next = move(index, event.key);
        if (next < 0) return;
        event.preventDefault();
        const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.sf-strip-item');
        buttons?.[next]?.focus();
        if (horizontal) onSelect(items[next].id);
      }}>
      <span className="sf-strip-icon" aria-hidden="true">{item.icon}</span>
      {!iconsOnly && horizontal && <span className="sf-strip-label">{item.title}</span>}
      {item.badge ? <span className="sf-strip-badge" aria-label={`${item.badge} problems`}>{item.badge > 99 ? '99+' : item.badge}</span> : null}
    </button>)}
    {trailing}
  </div>;
}
