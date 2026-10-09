import { createContext, useEffect, useRef, useState } from 'react';
import { buildCorpus } from './corpus';
import { getStaticEntries } from './registry';
import type { SettingsSearchEntry, SettingsValueSnapshot } from './types';

export const REVEAL_WAIT_MS = 2_000;
export const FLASH_MS = 1_200;
export const FLASH_CLASS = 'settings-search-flash';

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface RevealState {
  /** Entry id currently being revealed (null when idle). */
  target: string | null;
  /** Container the target lives in that collapsibles should expand. */
  reveal: SettingsSearchEntry['reveal'] | null;
}

const IDLE: RevealState = { target: null, reveal: null };

/**
 * Collapsibles read this while a jump is in flight: `target` names the row
 * being revealed and `reveal` the container to open. It returns to idle once
 * the reveal finishes, so a block the user collapses afterwards stays collapsed
 * and a repeat jump to the same row re-opens it.
 */
export const RevealContext = createContext<RevealState>(IDLE);

/**
 * False while the element is not rendered, e.g. inside an inactive tab panel:
 * nothing to scroll to yet. Cheap checks first, no per-frame style
 * recalculation: a `hidden` ancestor (how tab panels hide), then the native
 * `checkVisibility()`. The computed-style walk is only a fallback for DOMs
 * without it.
 */
export function isShown(el: HTMLElement): boolean {
  if (el.closest('[hidden]')) return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility();
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.hidden || window.getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

export function findTarget(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-settings-target="${CSS.escape(id)}"]`);
}

export function findAnchor(anchor: string): HTMLElement | null {
  return document.getElementById(`settings-anchor-${anchor}`);
}

function lookupEntry(id: string, snapshot: SettingsValueSnapshot): SettingsSearchEntry | undefined {
  return getStaticEntries().find((e) => e.id === id) ?? buildCorpus(snapshot).entries.find((r) => r.entry.id === id)?.entry;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Open every collapsed `<details>` that holds the row (or that the row wraps), so its content is reachable. */
function openDetails(el: HTMLElement): void {
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
  const wrapped = el.querySelector<HTMLDetailsElement>(':scope > details');
  if (wrapped) wrapped.open = true;
}

/** Open, scroll to, flash (self-removing) and focus a located row. */
export function revealElement(el: HTMLElement): void {
  openDetails(el);
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  el.classList.add(FLASH_CLASS);
  // ToggleSwitch puts the target attribute on the control itself.
  (el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
  window.setTimeout(() => el.classList.remove(FLASH_CLASS), FLASH_MS);
}

interface Args {
  tab: string;
  anchor: string | null;
  snapshot: SettingsValueSnapshot;
  setAnchor: (anchor: string | null) => void;
  /**
   * Drop the `#target` from the URL once handled (replace, no history entry),
   * so route memory never replays the jump and opening the same result again
   * is a real navigation.
   */
  clearHash?: () => void;
}

/** Poll each frame (up to REVEAL_WAIT_MS) until `find()` yields an element. Returns a cancel function. */
function pollFor(find: () => HTMLElement | null, onFound: (el: HTMLElement) => void, onTimeout: () => void): () => void {
  const started = Date.now();
  let frame = 0;
  let cancelled = false;
  const attempt = () => {
    if (cancelled) return;
    const el = find();
    if (el) return onFound(el);
    if (Date.now() - started < REVEAL_WAIT_MS) {
      frame = window.requestAnimationFrame(attempt);
      return;
    }
    onTimeout();
  };
  attempt();
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
  };
}

function scrollToSection(anchorId: string): void {
  findAnchor(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Resolve the URL-hash target (an entry id, or a plain section anchor id) once
 * its page has rendered: switch the container (Harness tab through its anchor,
 * `advanced` through RevealContext), retry up to 2 s, scroll to center, flash,
 * focus; fall back to the section anchor. Success and timeout both finish:
 * the pending anchor, the URL hash and the published reveal state are cleared.
 */
export function useSettingsTargetReveal({ tab, anchor, snapshot, setAnchor, clearHash }: Args): RevealState {
  const [state, setState] = useState<RevealState>(IDLE);
  const pending = useRef<SettingsSearchEntry | null>(null);
  // Latest snapshot without restarting an in-flight reveal on config churn.
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!anchor) return;
    const entry = pending.current?.anchor === anchor ? pending.current : lookupEntry(anchor, snapshotRef.current);
    if (entry && entry.id === anchor && entry.anchor && entry.anchor !== anchor) {
      // The page switches its own container (e.g. Harness tab) off the anchor.
      pending.current = entry;
      setAnchor(entry.anchor);
      return;
    }
    pending.current = null;
    const finish = () => {
      setAnchor(null);
      setState(IDLE);
      clearHash?.();
    };
    if (entry?.kind === 'section') return finish(); // the route already switched pages

    // Sections/subsections are plain anchor blocks; only settings/actions carry a target row.
    const targetId = entry && entry.kind !== 'subsection' ? entry.id : null;
    const anchorId = entry?.anchor ?? anchor;
    setState({ target: targetId, reveal: entry?.reveal ?? null });
    if (!targetId) {
      return pollFor(() => findAnchor(anchorId), (section) => { scrollToSection(section.id.replace(/^settings-anchor-/, '')); finish(); }, finish);
    }
    return pollFor(
      () => {
        const row = findTarget(targetId);
        return row && isShown(row) ? row : null;
      },
      (row) => {
        revealElement(row);
        finish();
      },
      () => {
        scrollToSection(anchorId);
        finish();
      }
    );
  }, [anchor, tab, setAnchor, clearHash]);

  return state;
}
