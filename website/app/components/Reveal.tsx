'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Progressive-enhancement scroll reveals. Renders nothing; it marks the document
 * root `reveal-ready` and observes every `[data-reveal]` / `[data-reveal-stagger]`
 * element, adding `.reveal-in` as each scrolls into view.
 *
 * Re-runs on every route change (`usePathname` dep): this component lives in the
 * PERSISTENT root layout, so its effect would otherwise fire only on first mount.
 * After a client-side navigation the new page's `[data-reveal]` elements are
 * hidden by CSS (`.reveal-ready` is still set) but were never observed by the
 * first-mount observer — leaving the whole page body permanently invisible. Re-
 * querying per pathname fixes that.
 *
 * Safety by design: the hidden (opacity:0 / translateY) state in globals.css is
 * scoped under `.reveal-ready`, which is ONLY added here — and only when motion
 * is allowed. So with JS disabled OR `prefers-reduced-motion: reduce`, nothing is
 * ever hidden: content renders fully visible and static. No FOUC, no a11y trap.
 */
export function Reveal() {
  const pathname = usePathname();

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const root = document.documentElement;
    // Add synchronously so the hidden state is armed before first paint (no FOUC).
    root.classList.add('reveal-ready');

    // Re-query on each route change. rAF lets the new route's DOM commit first so
    // querySelectorAll sees the incoming page's elements, not the outgoing one's.
    let observer: IntersectionObserver | undefined;
    const raf = requestAnimationFrame(() => {
      const targets = Array.from(
        document.querySelectorAll<HTMLElement>('[data-reveal], [data-reveal-stagger]')
      );
      if (!targets.length) {
        root.classList.remove('reveal-ready');
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add('reveal-in');
              observer!.unobserve(e.target); // reveal once, then stop watching
            }
          }
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0.08 }
      );
      targets.forEach((t) => observer!.observe(t));
    });

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [pathname]);

  return null;
}
