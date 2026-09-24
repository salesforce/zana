import { afterEach, describe, expect, it, vi } from 'vitest';
import { boardDropAction, boardItemKey, createAgentBoardMoves } from './agent-board-moves.js';
import type { FleetItem } from '../components/fleet-item.js';
import type { LaneKey } from '../components/AgentBoard.js';

const agent = { kind: 'agent', id: 's', card: { session: { status: 'running' } } } as FleetItem;
const thread = { kind: 'thread', id: 's' } as FleetItem;
const lanes: LaneKey[] = ['blocked', 'working', 'idle', 'done', 'scheduled'];
afterEach(() => vi.useRealTimers());

describe('board move policy', () => {
  it.each([agent, thread])('implements the entire lane matrix for $kind', (item) => {
    for (const from of lanes) for (const to of lanes) {
      const expected = ['blocked', 'working', 'idle'].includes(from) && to === 'done' ? 'done'
        : ['blocked', 'working'].includes(from) && to === 'idle' ? 'stop' : null;
      expect(boardDropAction(item, from, to), `${from} → ${to}`).toBe(expected);
    }
  });
  it('never moves schedules, exited agents, or execution hosts/members', () => {
    const items = [
      { kind: 'schedule' },
      { kind: 'agent', card: { session: { status: 'exited' } } },
      { kind: 'agent', card: { isSyntheticExecutionHost: true, session: {} } },
      { kind: 'agent', card: { session: { cohort: { executionId: 'execution' } } } }
    ] as FleetItem[];
    for (const item of items) expect(boardDropAction(item, 'working', 'done')).toBeNull();
    expect(boardItemKey(agent)).not.toBe(boardItemKey(thread));
  });
});

function setup() {
  vi.useFakeTimers();
  const deps = { stop: vi.fn(async () => {}), close: vi.fn(async () => {}), exists: vi.fn(() => true), onError: vi.fn() };
  return { ...deps, moves: createAgentBoardMoves(deps) };
}

describe('board move lifecycle', () => {
  it.each(['blocked', 'working'] as const)('%s → Idle interrupts once without closing', async (from) => {
    const { moves, stop, close } = setup();
    await moves.move(agent, from, 'idle');
    expect(stop).toHaveBeenCalledExactlyOnceWith(agent);
    expect(moves.store.getState()).toEqual({ done: {}, busy: new Set() });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(close).not.toHaveBeenCalled();
  });
  it.each(['blocked', 'working', 'idle'] as const)('%s → Done stays visible for exactly a minute, then closes once', async (from) => {
    const { moves, stop, close } = setup();
    await moves.move(thread, from, 'done');
    expect(stop).toHaveBeenCalledTimes(from === 'idle' ? 0 : 1);
    expect(moves.store.getState().done['thread:s']).toBe(Date.now() + 60_000);
    await moves.move(thread, from, 'done');
    await vi.advanceTimersByTimeAsync(59_999);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(close).toHaveBeenCalledExactlyOnceWith(thread);
    expect(moves.store.getState()).toEqual({ done: {}, busy: new Set() });
  });
  it('ignores invalid moves and missing targets', async () => {
    const { moves, stop, close, exists } = setup();
    await moves.move(agent, 'idle', 'working');
    exists.mockReturnValue(false);
    await moves.move(agent, 'working', 'done');
    expect(stop).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('deduplicates moves while stop is in flight', async () => {
    const { moves, stop } = setup();
    let resolve!: () => void;
    stop.mockImplementation(() => new Promise<void>((r) => { resolve = r; }));
    const first = moves.move(agent, 'working', 'done');
    await moves.move(agent, 'working', 'done');
    expect(stop).toHaveBeenCalledTimes(1);
    resolve();
    await first;
    expect(vi.getTimerCount()).toBe(1);
    moves.dispose();
  });
  it('does not mark Done when interrupt fails and permits a retry', async () => {
    const { moves, stop, onError } = setup();
    stop.mockRejectedValueOnce(new Error('offline'));
    await moves.move(agent, 'working', 'done');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(moves.store.getState()).toEqual({ done: {}, busy: new Set() });
    await moves.move(agent, 'working', 'done');
    expect(vi.getTimerCount()).toBe(1);
    moves.dispose();
  });
  it('reports a failed close and removes the Done overlay so it can be retried', async () => {
    const { moves, close, onError } = setup();
    close.mockRejectedValueOnce(new Error('offline'));
    await moves.move(thread, 'idle', 'done');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(moves.store.getState()).toEqual({ done: {}, busy: new Set() });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['after-stop', 'before-close'])('skips removed or replaced sessions (%s)', async (when) => {
    const { moves, exists, close } = setup();
    if (when === 'after-stop') exists.mockReturnValueOnce(true).mockReturnValue(false);
    await moves.move(agent, 'working', 'done');
    exists.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(close).not.toHaveBeenCalled();
    expect(moves.store.getState()).toEqual({ done: {}, busy: new Set() });
  });
  it('releases pending timers on app teardown', async () => {
    const { moves, close } = setup();
    await moves.move(agent, 'idle', 'done');
    moves.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(close).not.toHaveBeenCalled();
  });
  it('releases a removed session immediately while keeping other deadlines', async () => {
    const { moves, exists, close } = setup();
    await moves.move(agent, 'idle', 'done');
    await moves.move(thread, 'idle', 'done');
    exists.mockImplementation((item?: FleetItem) => item?.kind === 'thread');
    moves.reconcile();
    expect(vi.getTimerCount()).toBe(1);
    expect(moves.store.getState().done['agent:s']).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(close).toHaveBeenCalledExactlyOnceWith(thread);
  });
  it.each([false, true])('teardown invalidates an in-flight interrupt (reject=%s)', async (reject) => {
    const { moves, stop, onError } = setup();
    let finish!: () => void;
    stop.mockImplementation(() => new Promise<void>((resolve, fail) => { finish = reject ? () => fail(new Error('offline')) : resolve; }));
    const pending = moves.move(agent, 'working', 'done');
    moves.dispose();
    finish();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    expect(moves.store.getState()).toEqual({ done: {}, busy: new Set() });
    expect(onError).not.toHaveBeenCalled();
  });
});
