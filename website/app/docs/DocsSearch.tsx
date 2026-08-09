'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchEntry } from '@/lib/search-index';

/** A flattened, scored hit shown in the palette. */
interface Hit {
  slug: string;
  docTitle: string;
  group: string;
  heading: string;
  anchor: string; // '' for the doc intro
  snippet: string;
  score: number;
}

/** Split a query into lowercased word tokens. */
function tokens(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Score one section against the query tokens. Higher = better; 0 = no match. */
function scoreSection(
  qs: string[],
  heading: string,
  body: string,
  docTitle: string
): number {
  const hHead = heading.toLowerCase();
  const hBody = body.toLowerCase();
  const hTitle = docTitle.toLowerCase();
  let score = 0;
  for (const t of qs) {
    const inHead = hHead.includes(t);
    const inTitle = hTitle.includes(t);
    const inBody = hBody.includes(t);
    if (!inHead && !inTitle && !inBody) return 0; // every token must match somewhere (AND)
    if (inHead) score += 10;
    if (inTitle) score += 4;
    if (inBody) score += 2;
    if (hHead.startsWith(t)) score += 6;
  }
  return score;
}

/** A short snippet of the body centered on the first matched token. */
function snippet(body: string, qs: string[]): string {
  if (!body) return '';
  const lower = body.toLowerCase();
  let at = -1;
  for (const t of qs) {
    const i = lower.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return body.slice(0, 120);
  const start = Math.max(0, at - 40);
  return (start > 0 ? '…' : '') + body.slice(start, start + 140).trim() + '…';
}

function search(index: SearchEntry[], q: string): Hit[] {
  const qs = tokens(q);
  if (!qs.length) return [];
  const hits: Hit[] = [];
  for (const doc of index) {
    for (const s of doc.sections) {
      const sc = scoreSection(qs, s.heading, s.body, doc.title);
      if (sc > 0) {
        hits.push({
          slug: doc.slug,
          docTitle: doc.title,
          group: doc.group,
          heading: s.level === 1 ? doc.title : s.heading,
          anchor: s.id,
          snippet: snippet(s.body, qs),
          score: sc + (s.level === 1 ? 1 : 0)
        });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12);
}

export function DocsSearch({ index }: { index: SearchEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const hits = useMemo(() => search(index, q), [index, q]);

  const close = useCallback(() => {
    setOpen(false);
    setQ('');
    setActive(0);
    // restore focus to whatever opened the palette
    openerRef.current?.focus();
  }, []);

  const openPalette = useCallback(() => {
    openerRef.current = (document.activeElement as HTMLElement) ?? null;
    setOpen(true);
  }, []);

  // ⌘K / Ctrl-K to open; also "/" when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open ? close() : openPalette();
      } else if (
        e.key === '/' &&
        !open &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '')
      ) {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener('keydown', onKey);
    // let a sidebar button open the palette without prop-drilling
    const onOpen = () => openPalette();
    window.addEventListener('zcc:open-docs-search', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('zcc:open-docs-search', onOpen);
    };
  }, [open, close, openPalette]);

  // focus the input + lock scroll while open
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  // keep the active row scrolled into view
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const go = useCallback(
    (h: Hit) => {
      close();
      router.push(`/docs/${h.slug}/${h.anchor ? `#${h.anchor}` : ''}`);
    },
    [router, close]
  );

  // Focus trap: keep Tab / Shift+Tab cycling inside the aria-modal dialog.
  // Handled at the dialog level (capture) so it applies regardless of which
  // child currently holds focus.
  function onDialogKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeEl = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (activeEl === first || !dialog.contains(activeEl)) {
        e.preventDefault();
        last.focus();
      }
    } else if (activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hits[active]) go(hits[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  if (!open) return null;

  return (
    <div
      className="cmdk-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Search documentation"
        ref={dialogRef}
        onKeyDown={onDialogKeyDown}
      >
        <div className="cmdk-input-row">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Search the docs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            aria-label="Search documentation"
            aria-controls="cmdk-list"
            aria-activedescendant={hits[active] ? `cmdk-opt-${active}` : undefined}
            role="combobox"
            aria-expanded={hits.length > 0}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmdk-esc">Esc</kbd>
        </div>

        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {q && hits.length === 0 && (
            <div className="cmdk-empty">No results for “{q}”.</div>
          )}
          {!q && <div className="cmdk-hint">Type to search titles, headings, and content.</div>}
          {hits.map((h, i) => (
            <button
              type="button"
              key={`${h.slug}-${h.anchor}-${i}`}
              id={`cmdk-opt-${i}`}
              data-idx={i}
              role="option"
              aria-selected={i === active}
              className={`cmdk-opt ${i === active ? 'active' : ''}`}
              onMouseMove={() => setActive(i)}
              onClick={() => go(h)}
            >
              <span className="cmdk-opt-main">
                <span className="cmdk-opt-title">{h.heading}</span>
                {h.snippet && <span className="cmdk-opt-snippet">{h.snippet}</span>}
              </span>
              <span className="cmdk-opt-meta">
                {h.docTitle}
                {h.anchor ? ' ›' : ''}
              </span>
            </button>
          ))}
        </div>

        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

/** A button that opens the palette — placed in the docs sidebar/header. */
export function DocsSearchButton() {
  return (
    <button
      type="button"
      className="docs-search-btn"
      onClick={() => window.dispatchEvent(new Event('zcc:open-docs-search'))}
      aria-label="Search documentation"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <span>Search docs</span>
      <kbd>⌘K</kbd>
    </button>
  );
}
