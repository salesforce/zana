/**
 * D1 — unit lock for the Tickets-view UI-pref codec (`../zanaPrefs.ts`).
 *
 * Covers the acceptance criteria: default-ON auto-refresh, enum-validated
 * active-tab with a `'tickets'` fallback, object-guarded collapsed-columns
 * (rejecting `null`/number/array JSON), project-scoped keys with no cross-talk,
 * and graceful degradation when `localStorage` is absent or throws (quota).
 *
 * Runs in node with no jsdom — install a minimal in-memory `localStorage` stub
 * (mirrors `paletteRecents.test.ts`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  safeGet,
  safeSet,
  readActiveTab,
  writeActiveTab,
  readAutoRefresh,
  writeAutoRefresh,
  readCollapsed,
  writeCollapsed,
  collapsedKey,
  readBoardDensity,
  writeBoardDensity
} from '../zanaPrefs.js';

type StorageHooks = { onSet?: () => void; onGet?: () => void };

function installLocalStorage(hooks: StorageHooks = {}): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => {
      hooks.onGet?.();
      return store.has(k) ? store.get(k)! : null;
    },
    setItem: (k: string, v: string) => {
      hooks.onSet?.();
      store.set(k, String(v));
    },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    }
  } as Storage;
  return store;
}

function uninstallLocalStorage(): void {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
}

describe('zanaPrefs — auto-refresh (default ON)', () => {
  beforeEach(() => installLocalStorage());
  afterEach(uninstallLocalStorage);

  it('reads ON when absent (no key written yet)', () => {
    expect(readAutoRefresh()).toBe(true);
  });

  it("reads ON for an explicit 'true'", () => {
    writeAutoRefresh(true);
    expect(localStorage.getItem('zcc.tickets.autoRefresh')).toBe('true');
    expect(readAutoRefresh()).toBe(true);
  });

  it("reads OFF ONLY for an explicit 'false'", () => {
    writeAutoRefresh(false);
    expect(localStorage.getItem('zcc.tickets.autoRefresh')).toBe('false');
    expect(readAutoRefresh()).toBe(false);
  });

  it('treats any non-false garbage value as ON (never silently flips the default)', () => {
    safeSet('zcc.tickets.autoRefresh', 'yes');
    expect(readAutoRefresh()).toBe(true);
  });
});

describe('zanaPrefs — active tab (enum validated)', () => {
  beforeEach(() => installLocalStorage());
  afterEach(uninstallLocalStorage);

  it("falls back to 'tickets' when absent", () => {
    expect(readActiveTab()).toBe('tickets');
  });

  it('round-trips each valid sub-tab', () => {
    for (const tab of ['tickets', 'sprints', 'docs', 'profiles'] as const) {
      writeActiveTab(tab);
      expect(readActiveTab()).toBe(tab);
    }
  });

  it("falls back to 'tickets' on a garbage / unknown value", () => {
    safeSet('zcc.tickets.activeTab', 'kanban');
    expect(readActiveTab()).toBe('tickets');
    safeSet('zcc.tickets.activeTab', '');
    expect(readActiveTab()).toBe('tickets');
  });
});

describe('zanaPrefs — collapsed columns (object-guarded, project-scoped)', () => {
  beforeEach(() => installLocalStorage());
  afterEach(uninstallLocalStorage);

  it('round-trips a collapse map', () => {
    writeCollapsed('p1', { done: true, 'in progress': false });
    expect(readCollapsed('p1')).toEqual({ done: true, 'in progress': false });
  });

  it('returns {} on malformed JSON', () => {
    safeSet(collapsedKey('p1'), '{not json');
    expect(readCollapsed('p1')).toEqual({});
  });

  it('returns {} on non-object JSON (null, number, array)', () => {
    safeSet(collapsedKey('p1'), 'null');
    expect(readCollapsed('p1')).toEqual({});
    safeSet(collapsedKey('p1'), '42');
    expect(readCollapsed('p1')).toEqual({});
    safeSet(collapsedKey('p1'), '[1,2]');
    expect(readCollapsed('p1')).toEqual({});
  });

  it('returns {} when absent', () => {
    expect(readCollapsed('never')).toEqual({});
  });

  it('is project-scoped — two project ids do not cross-talk', () => {
    writeCollapsed('A', { done: true });
    writeCollapsed('B', { backlog: true });
    expect(collapsedKey('A')).not.toBe(collapsedKey('B'));
    expect(readCollapsed('A')).toEqual({ done: true });
    expect(readCollapsed('B')).toEqual({ backlog: true });
  });
});

describe('zanaPrefs — board density (default card, only list overrides)', () => {
  beforeEach(() => installLocalStorage());
  afterEach(uninstallLocalStorage);

  it('defaults to card when absent', () => {
    expect(readBoardDensity()).toBe('card');
  });

  it('round-trips list and card', () => {
    writeBoardDensity('list');
    expect(readBoardDensity()).toBe('list');
    writeBoardDensity('card');
    expect(readBoardDensity()).toBe('card');
  });

  it('falls back to card on any non-list value', () => {
    safeSet('zcc.tickets.boardDensity', 'grid');
    expect(readBoardDensity()).toBe('card');
  });
});

describe('zanaPrefs — graceful degradation (no storage / quota)', () => {
  afterEach(uninstallLocalStorage);

  it('safeGet returns null and safeSet is a no-op when localStorage is undefined', () => {
    uninstallLocalStorage();
    expect(typeof localStorage).toBe('undefined');
    expect(safeGet('zcc.tickets.autoRefresh')).toBeNull();
    expect(() => safeSet('zcc.tickets.autoRefresh', 'false')).not.toThrow();
    // Reads fall back to documented defaults.
    expect(readAutoRefresh()).toBe(true);
    expect(readActiveTab()).toBe('tickets');
    expect(readCollapsed('p1')).toEqual({});
  });

  it('swallows a thrown quota error on write and a thrown read', () => {
    installLocalStorage({
      onSet: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      onGet: () => {
        throw new Error('read blew up');
      }
    });
    expect(() => safeSet('zcc.tickets.autoRefresh', 'false')).not.toThrow();
    expect(safeGet('zcc.tickets.autoRefresh')).toBeNull();
    expect(() => writeAutoRefresh(false)).not.toThrow();
    expect(readAutoRefresh()).toBe(true); // read threw → default ON
  });
});
