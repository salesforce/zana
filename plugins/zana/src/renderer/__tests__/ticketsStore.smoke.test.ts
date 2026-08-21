/**
 * B3 light smoke test for the `useTickets` store. The canonical 10-case sweep
 * is B4's (`src/renderer/__tests__/ticketsStore.test.ts`); this only confirms
 * the headline behaviours so the shipped public API is green on its own.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ZanaSnapshot } from '@shared/zana-types';

const getSnapshot = vi.fn();
const listProfiles = vi.fn();
const assignTicket = vi.fn();

vi.mock('../ticketsApi', () => ({
  ticketsApi: {
    getSnapshot: (...a: unknown[]) => getSnapshot(...a),
    listProfiles: (...a: unknown[]) => listProfiles(...a),
    assignTicket: (...a: unknown[]) => assignTicket(...a)
  }
}));

import { useTickets, __resetTicketsStoreForTest, type TicketsKey } from '../ticketsStore';

const KEY: TicketsKey = { projectId: 'p', projectPath: '/p' };

function snap(tickets: ZanaSnapshot['tickets'] = []): ZanaSnapshot {
  return {
    source: { kind: 'project', label: 'p', path: '/p/.zana' },
    kpis: {
      totalTickets: 0,
      openTickets: 0,
      closedTickets: 0,
      blockedTickets: 0,
      byStatus: {},
      byPriority: {},
      sprintCount: 0,
      artifactCount: 0
    },
    tickets,
    sprints: [],
    artifacts: [],
    isInitialized: true
  };
}

const ticket = { id: 't1', title: 'T', status: 'backlog', labels: [], blockedBy: [] };

beforeEach(() => {
  vi.useFakeTimers();
  getSnapshot.mockReset().mockResolvedValue(snap([{ ...ticket }]));
  listProfiles.mockReset().mockResolvedValue([]);
  assignTicket.mockReset().mockResolvedValue(undefined);
  __resetTicketsStoreForTest();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('useTickets store (B3 smoke)', () => {
  it('ensure x3 fires exactly one getSnapshot + one listProfiles', async () => {
    const s = useTickets.getState();
    s.ensure(KEY);
    s.ensure(KEY);
    await vi.runAllTimersAsync();
    s.ensure(KEY);
    await vi.runAllTimersAsync();
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(listProfiles).toHaveBeenCalledTimes(1);
    expect(useTickets.getState().byKey['p']?.snapshot?.tickets).toHaveLength(1);
  });

  it('global key maps to __global__, distinct from project keys', async () => {
    useTickets.getState().ensure({ projectId: '', useGlobal: true });
    useTickets.getState().ensure(KEY);
    await vi.runAllTimersAsync();
    const { byKey } = useTickets.getState();
    expect(byKey['__global__']).toBeDefined();
    expect(byKey['p']).toBeDefined();
    expect(byKey['']).toBeUndefined();
  });

  it('optimistic assign patches now, commits past the undo window', async () => {
    useTickets.getState().ensure(KEY);
    await vi.runAllTimersAsync();
    useTickets
      .getState()
      .applyAssign(KEY, { ...ticket }, { kind: 'name', assigneeName: 'Ada' });
    expect(useTickets.getState().byKey['p']?.snapshot?.tickets[0].assigneeName).toBe('Ada');
    expect(assignTicket).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6000);
    expect(assignTicket).toHaveBeenCalledTimes(1);
    expect(assignTicket).toHaveBeenCalledWith(
      { kind: 'project', projectPath: '/p' },
      't1',
      { assigneeName: 'Ada' }
    );
  });

  it('undo before commit cancels the write and restores baseline', async () => {
    useTickets.getState().ensure(KEY);
    await vi.runAllTimersAsync();
    useTickets
      .getState()
      .applyAssign(KEY, { ...ticket }, { kind: 'name', assigneeName: 'Ada' });
    useTickets.getState().undoAssign(KEY, 't1');
    await vi.advanceTimersByTimeAsync(6000);
    expect(assignTicket).not.toHaveBeenCalled();
    expect(useTickets.getState().byKey['p']?.snapshot?.tickets[0].assigneeName).toBeUndefined();
    expect(useTickets.getState().assignUndo['p']).toBeNull();
  });

  it('commit rejection reverts and surfaces error on the entry', async () => {
    assignTicket.mockRejectedValue(new Error('boom'));
    useTickets.getState().ensure(KEY);
    await vi.runAllTimersAsync();
    useTickets
      .getState()
      .applyAssign(KEY, { ...ticket }, { kind: 'name', assigneeName: 'Ada' });
    await vi.advanceTimersByTimeAsync(6000);
    await vi.runAllTimersAsync();
    const entry = useTickets.getState().byKey['p'];
    expect(entry?.snapshot?.tickets[0].assigneeName).toBeUndefined();
    expect(entry?.error).toContain('boom');
  });

  it('auto-refresh is ref-counted: two starts => one tick fires once', async () => {
    useTickets.getState().ensure(KEY);
    await vi.runAllTimersAsync();
    getSnapshot.mockClear();
    useTickets.getState().startAutoRefresh(KEY);
    useTickets.getState().startAutoRefresh(KEY);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    useTickets.getState().stopAutoRefresh(KEY);
    useTickets.getState().stopAutoRefresh(KEY);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('paused key does not refresh on tick; unpause resumes', async () => {
    useTickets.getState().ensure(KEY);
    await vi.runAllTimersAsync();
    getSnapshot.mockClear();
    useTickets.getState().startAutoRefresh(KEY);
    useTickets.getState().setPaused(KEY, true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getSnapshot).toHaveBeenCalledTimes(0);
    useTickets.getState().setPaused(KEY, false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    useTickets.getState().stopAutoRefresh(KEY);
  });

  it('background refresh failure keeps a good board and error null', async () => {
    useTickets.getState().ensure(KEY);
    await vi.runAllTimersAsync();
    getSnapshot.mockRejectedValueOnce(new Error('net'));
    await useTickets.getState().refresh(KEY, { background: true });
    const entry = useTickets.getState().byKey['p'];
    expect(entry?.snapshot?.tickets).toHaveLength(1);
    expect(entry?.error).toBeNull();
  });

  it('hydrateAll warms byKey for every project in one sequential pass (D5)', async () => {
    const projects = [
      { id: 'a', path: '/a' },
      { id: 'b', path: '/b' }
    ];
    await useTickets.getState().hydrateAll(projects);
    await vi.runAllTimersAsync();
    const { byKey } = useTickets.getState();
    expect(byKey['a']?.snapshot).toBeTruthy();
    expect(byKey['b']?.snapshot).toBeTruthy();
    // One getSnapshot per project — no fan-out storm beyond N reads.
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(getSnapshot).toHaveBeenCalledWith({ kind: 'project', projectPath: '/a' });
    expect(getSnapshot).toHaveBeenCalledWith({ kind: 'project', projectPath: '/b' });
  });

  it('hydrateAll is idempotent: a second pass re-fetches nothing (D5)', async () => {
    const projects = [{ id: 'a', path: '/a' }];
    await useTickets.getState().hydrateAll(projects);
    await vi.runAllTimersAsync();
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    // Re-invoking (e.g. a stray re-init) must not re-hit IPC for a warmed key.
    await useTickets.getState().hydrateAll(projects);
    await vi.runAllTimersAsync();
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('hydrateAll does not clobber a key already warmed by ensure (D5)', async () => {
    useTickets.getState().ensure(KEY); // warms 'p'
    await vi.runAllTimersAsync();
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    await useTickets.getState().hydrateAll([{ id: 'p', path: '/p' }]);
    await vi.runAllTimersAsync();
    // ensure already settled 'p'; hydrateAll skips it — still one fetch total.
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('hydrateAll with no projects is a harmless no-op (D5)', async () => {
    await useTickets.getState().hydrateAll();
    await vi.runAllTimersAsync();
    expect(getSnapshot).toHaveBeenCalledTimes(0);
    await useTickets.getState().hydrateAll([]);
    await vi.runAllTimersAsync();
    expect(getSnapshot).toHaveBeenCalledTimes(0);
  });

  it('clearProject removes the entry and cancels pending timers', async () => {
    useTickets.getState().ensure(KEY);
    await vi.runAllTimersAsync();
    useTickets
      .getState()
      .applyAssign(KEY, { ...ticket }, { kind: 'name', assigneeName: 'Ada' });
    useTickets.getState().clearProject('p');
    expect(useTickets.getState().byKey['p']).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(assignTicket).not.toHaveBeenCalled();
  });
});
