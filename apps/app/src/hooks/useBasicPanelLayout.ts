import { useLayoutEffect, useState, type RefObject } from 'react';

/** Room for a readable conversation and result, measured after shell/sidebar allocation. */
export const BASIC_PANEL_SPLIT_MIN_WIDTH = 960;

export function useBasicPanelLayout(ref: RefObject<HTMLElement | null>, basic: boolean): boolean {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    if (!basic || !ref.current) return;
    // Split conversations portal their panel beside the entire workspace. Measure
    // that owner rather than the conversation, whose width changes with the panel.
    const container = ref.current.closest<HTMLElement>('.split-workspace-host') ?? ref.current;
    const measure = () => {
      const width = container.getBoundingClientRect().width;
      // A retained off-route pane has no layout. Keep its last meaningful size.
      if (width > 0) setCompact(width < BASIC_PANEL_SPLIT_MIN_WIDTH);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [ref, basic]);
  return basic && compact;
}
