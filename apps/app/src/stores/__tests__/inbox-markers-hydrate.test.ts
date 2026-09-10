import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxMarkersSnapshot, SavedRecord } from '@zana-ai/zcc-domain/product';

describe('inbox marker hydrate', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k)
    };
    (globalThis as { localStorage?: typeof localStorage }).localStorage = localStorage;
    globalThis.window = {
      localStorage,
      cc: {
        config: { get: vi.fn(async () => ({})), set: vi.fn(), onDidChange: vi.fn(() => vi.fn()) },
        ipc: { on: vi.fn(() => vi.fn()), invoke: vi.fn(), send: vi.fn() }
      }
    } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { localStorage?: unknown }).localStorage;
    vi.resetModules();
  });

  it('hydrates from a server snapshot and markRead does not write localStorage', async () => {
    const { applyInboxMarkersSnapshot, hydrateSavedMarksFromRecords, useInboxRead, useInboxAnswered, useInboxKeep, useSavedMark } =
      await import('../live.js');

    const snapshot: InboxMarkersSnapshot = {
      version: 1,
      readIds: { a: true },
      answeredIds: { b: true },
      keptIds: { c: true }
    };
    applyInboxMarkersSnapshot(snapshot);
    expect(useInboxRead.getState().readIds).toEqual({ a: true });
    expect(useInboxAnswered.getState().answeredIds).toEqual({ b: true });
    expect(useInboxKeep.getState().keptIds).toEqual({ c: true });

    useInboxRead.getState().markRead('d');
    expect(useInboxRead.getState().readIds.d).toBe(true);
    expect(globalThis.localStorage.getItem('zcc.inbox-read.v1')).toBeNull();
    expect(globalThis.localStorage.getItem('zcc.inbox-answered.v1')).toBeNull();
    expect(globalThis.localStorage.getItem('zcc.inbox-keep.v1')).toBeNull();

    hydrateSavedMarksFromRecords([
      { id: 's1', savedAt: 1, projectId: 'p', title: 't', sourceEntryId: 'a' }
    ] as SavedRecord[]);
    expect(useSavedMark.getState().savedEntryIds).toEqual({ a: true });
    expect(globalThis.localStorage.getItem('zcc.inbox-saved.v1')).toBeNull();
  });
});
