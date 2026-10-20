import { useLayoutEffect, useState, type RefObject } from 'react';

/** True while the clamped element's content is taller than its box. Re-measures on resize. */
export function useMessageOverflow(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  measurementKey: string
): boolean {
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) {
      setOverflowing(false);
      return;
    }
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled, measurementKey]);
  return overflowing;
}
