import { useSyncExternalStore } from 'react';
import type { ZccWindowTitle, ZccWindowTitleTone } from '@zana-ai/zcc-plugin-sdk/app';

/** A plugin's own title for its plugin view window, after the host cleaned it. */
export interface PluginViewTitle {
  title: string;
  detail?: string;
  badge?: string;
  tone: ZccWindowTitleTone;
}

const TONES: readonly ZccWindowTitleTone[] = ['neutral', 'warning', 'danger'];
const LIMITS = { title: 120, detail: 80, badge: 24 } as const;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g;

function part(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Trims and caps each part; null when there is no title to show. Plugin input is untyped at runtime. */
export function sanitizePluginViewTitle(raw: ZccWindowTitle | null | undefined): PluginViewTitle | null {
  if (!raw || typeof raw !== 'object') return null;
  const title = part(raw.title, LIMITS.title);
  if (!title) return null;
  const detail = part(raw.detail, LIMITS.detail);
  const badge = part(raw.badge, LIMITS.badge);
  const tone = TONES.includes(raw.tone as ZccWindowTitleTone) ? (raw.tone as ZccWindowTitleTone) : 'neutral';
  return { title, ...(detail ? { detail } : {}), ...(badge ? { badge } : {}), tone };
}

// The window shows the newest title still mounted, so a dialog's title gives way to the pane's again.
// Each caller keeps its place from mount to unmount; a changed title updates that place.
let entries: Array<{ token: symbol; title: PluginViewTitle | null }> = [];
let current: PluginViewTitle | null = null;
const listeners = new Set<() => void>();

function publish(): void {
  current = [...entries].reverse().find((entry) => entry.title)?.title ?? null;
  for (const listener of listeners) listener();
}

export interface PluginViewTitleSlot {
  set(title: PluginViewTitle | null): void;
  release(): void;
}

/** Takes the next place in the stack, empty until `set`. */
export function claimPluginViewTitle(): PluginViewTitleSlot {
  const token = Symbol('plugin-view-title');
  entries = [...entries, { token, title: null }];
  return {
    set(title) {
      const index = entries.findIndex((entry) => entry.token === token);
      if (index < 0) return;
      entries = entries.map((entry, at) => (at === index ? { token, title } : entry));
      publish();
    },
    release() {
      const next = entries.filter((entry) => entry.token !== token);
      if (next.length === entries.length) return;
      entries = next;
      publish();
    }
  };
}

/** Shows a title until the returned release runs. */
export function setPluginViewTitle(title: PluginViewTitle): () => void {
  const slot = claimPluginViewTitle();
  slot.set(title);
  return slot.release;
}

export function getPluginViewTitle(): PluginViewTitle | null {
  return current;
}

export function subscribePluginViewTitle(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePluginViewTitle(): PluginViewTitle | null {
  return useSyncExternalStore(subscribePluginViewTitle, getPluginViewTitle, getPluginViewTitle);
}
