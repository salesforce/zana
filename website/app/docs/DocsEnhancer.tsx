'use client';

import { useEffect } from 'react';

/**
 * Client-side progressive enhancement for the (server-rendered) doc article:
 *   1. wire the "Copy" buttons injected by lib/docs.ts onto each code block,
 *   2. scroll-spy the right-hand TOC — highlight the heading currently in view.
 * Renders nothing; it just attaches behavior to the already-present DOM.
 */
export function DocsEnhancer({ slug }: { slug: string }) {
  useEffect(() => {
    const article = document.querySelector<HTMLElement>('article.prose');
    if (!article) return;

    // ---- 1. code copy buttons ----
    const buttons = Array.from(article.querySelectorAll<HTMLButtonElement>('.code-copy'));
    const cleanups: Array<() => void> = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    for (const btn of buttons) {
      const code = btn.parentElement?.querySelector('code');
      let resetTimer: ReturnType<typeof setTimeout> | undefined;
      const onClick = async () => {
        if (!code) return;
        try {
          await navigator.clipboard.writeText(code.innerText);
          btn.textContent = 'Copied';
          btn.classList.add('copied');
          // Reset the "Copied" label after a beat. Clear any pending reset so a
          // rapid re-click doesn't stack timers, and track it so unmount (route
          // change) can cancel a still-pending callback (no mutation of a
          // detached node).
          if (resetTimer) {
            clearTimeout(resetTimer);
            timers.delete(resetTimer);
          }
          resetTimer = setTimeout(() => {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
            if (resetTimer) timers.delete(resetTimer);
          }, 1600);
          timers.add(resetTimer);
        } catch {
          /* clipboard blocked — no-op */
        }
      };
      btn.addEventListener('click', onClick);
      cleanups.push(() => btn.removeEventListener('click', onClick));
    }

    // ---- 2. TOC scroll-spy ----
    const tocLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.docs-toc a'));
    let observer: IntersectionObserver | undefined;
    if (tocLinks.length) {
      const byId = new Map(tocLinks.map((a) => [a.getAttribute('href')?.slice(1) ?? '', a]));
      const headings = Array.from(article.querySelectorAll<HTMLElement>('h2[id], h3[id]'));
      const visible = new Set<string>();
      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) visible.add(e.target.id);
            else visible.delete(e.target.id);
          }
          // highlight the topmost visible heading
          const firstVisible = headings.find((h) => visible.has(h.id));
          tocLinks.forEach((a) => a.classList.remove('active'));
          if (firstVisible) byId.get(firstVisible.id)?.classList.add('active');
        },
        { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
      );
      headings.forEach((h) => observer!.observe(h));
    }

    return () => {
      cleanups.forEach((fn) => fn());
      timers.forEach((t) => clearTimeout(t));
      observer?.disconnect();
    };
  }, [slug]);

  return null;
}
