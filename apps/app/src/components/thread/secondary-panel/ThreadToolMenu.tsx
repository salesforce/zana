import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placePopoverMenu, type PopoverMenuPlacement } from '../../ui/PopoverPicklist.js';

export interface ThreadToolMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  description?: string;
  run: () => void;
}

/** Portalled above the panel; native browser views yield while this menu is open. */
export function ThreadToolMenu({ anchor, label, items, onClose }: {
  anchor: HTMLElement;
  label: string;
  items: ThreadToolMenuItem[];
  onClose: (restoreFocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverMenuPlacement | null>(null);
  useLayoutEffect(() => {
    const document = anchor.ownerDocument;
    const view = document.defaultView!;
    setPosition(placePopoverMenu(anchor.getBoundingClientRect(), { width: view.innerWidth, height: view.innerHeight }, 236));
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: Event) => {
      if (!ref.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(false);
    };
    const resize = () => onClose(false);
    const scroll = (event: Event) => { if (!ref.current?.contains(event.target as Node)) onClose(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true);
    view.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scroll, true);
      view.removeEventListener('resize', resize);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="thread-tool-menu" role="menu" aria-label={label}
      style={{ position: 'fixed', ...position }}
      onKeyDown={event => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') event.preventDefault();
          event.stopPropagation();
          onClose(true);
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = Array.from(ref.current!.querySelectorAll('button'));
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus();
        }
      }}>
      <div className="thread-tool-menu-title">{label}</div>
      {items.map(item => <button key={item.id} type="button" role="menuitem" tabIndex={-1}
        onClick={() => { onClose(true); item.run(); }}>
        {item.icon}<span>{item.label}{item.description ? <small>{item.description}</small> : null}</span>
      </button>)}
    </div>, anchor.ownerDocument.body
  );
}
