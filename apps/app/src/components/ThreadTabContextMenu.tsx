import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ThreadTabMenuItem {
  label: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  run: () => void;
}

/** Outside the scrolling titlebar so the menu remains clickable below it. */
export function ThreadTabContextMenu({ x, y, anchor, items, onClose }: {
  x: number;
  y: number;
  anchor: HTMLElement;
  items: ThreadTabMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const document = anchor.ownerDocument;
    const view = document.defaultView!;
    const element = ref.current!;
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, view.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, view.innerHeight - rect.height - 8))
    });
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (!element.contains(event.target as Node)) onClose();
    };
    const scroll = (event: Event) => {
      // Streaming conversations scroll themselves. Only movement of the tab's
      // own ancestors (or the viewport) invalidates this menu's position.
      const target = event.target;
      if (target === document || (target instanceof Element && target.contains(anchor))) onClose();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('contextmenu', outside);
    document.addEventListener('scroll', scroll, true);
    view.addEventListener('blur', onClose);
    view.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('contextmenu', outside);
      document.removeEventListener('scroll', scroll, true);
      view.removeEventListener('blur', onClose);
      view.removeEventListener('resize', onClose);
    };
  }, [x, y, anchor, onClose]);

  const dismiss = () => { onClose(); if (anchor.isConnected) anchor.focus(); };
  return createPortal(
    <div ref={ref} role="menu" aria-label="Thread tab actions" className="titlebar-thread-context-menu"
      style={position} onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') event.preventDefault();
          dismiss();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
      <div className="titlebar-thread-menu-note">Closing tabs keeps threads running</div>
      {items.map(item => <div key={item.label}>
        {item.separatorBefore && <div role="separator" className="titlebar-thread-menu-separator" />}
        <button type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
          onClick={() => { dismiss(); item.run(); }}>{item.label}</button>
      </div>)}
    </div>, anchor.ownerDocument.body
  );
}
