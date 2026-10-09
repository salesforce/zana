import { useLayoutEffect, useState } from 'react';

/** Container-width breakpoints of the Studio: <400 icon strip, <620 compact, >=620 wide, >=960 roomy. */
export const STUDIO_TIERS: readonly number[] = [400, 620, 960];
export type StudioLayout = 'legacy' | 'compact' | 'wide';

/** Tier counts how many breakpoints the container meets; `null` means "not measured yet" (legacy layout). */
export function layoutForTier(tier: number | null): StudioLayout {
  if (tier === null) return 'legacy';
  return tier < 2 ? 'compact' : 'wide';
}

/**
 * How many of the ascending `breakpoints` the element is at least as wide as. Re-renders only when that count
 * changes. `null` until a real width exists. Attach the returned callback as the element's `ref`.
 * Same contract as plugins/design-docs/src/app/hooks.ts useWidthTier.
 */
export function useWidthTier(breakpoints: readonly number[] = STUDIO_TIERS): [(element: HTMLElement | null) => void, number | null] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [tier, setTier] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = (width: number) => setTier(width > 0 ? breakpoints.filter(min => width >= min).length : null);
    measure(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => measure(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, breakpoints]);
  return [setElement, tier];
}
