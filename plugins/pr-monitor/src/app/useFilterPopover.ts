import { useLayoutEffect, useRef, useState } from 'react';

/** Keep filter pickers inside the window and return keyboard focus to their trigger. */
export function useFilterPopover(
  anchorRef: { current: HTMLElement | null }, onClose: () => void, alignEnd = false,
) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 400 });
  useLayoutEffect(() => {
    const menu = ref.current;
    const anchor = anchorRef.current;
    if (!menu || !anchor) return;
    const place = () => {
      const bounds = anchor.getBoundingClientRect();
      const top = Math.max(12, Math.min(bounds.bottom + 6, window.innerHeight - 160));
      const width = menu.getBoundingClientRect().width;
      const left = Math.max(12, Math.min(alignEnd ? bounds.right - width : bounds.left, window.innerWidth - width - 12));
      setPosition({ top, left, maxHeight: window.innerHeight - top - 12 });
    };
    place();
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === 'Tab') {
        closeRef.current();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        if (!items.length) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
          (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
    };
    window.addEventListener('resize', place);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('keydown', onKey);
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchorRef, alignEnd]);
  return { ref, position };
}
