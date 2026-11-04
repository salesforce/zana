import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_ORPHAN_MAX, CONNECTION_REMOVING_TIMEOUT_MS, CONNECTION_STATUS_MAX, CONNECTION_STATUS_PER_PLUGIN_MAX, PeerConnectionRegistry } from './peer-connections.js';

afterEach(() => { vi.useRealTimers(); });

describe('PeerConnectionRegistry', () => {
  it('allows one removing handler per plugin and unsubscribes', async () => {
    const r = new PeerConnectionRegistry(), h = vi.fn();
    const off = r.onRemoving('a', h);
    expect(() => r.onRemoving('a', vi.fn())).toThrow('only one');
    expect(() => r.onRemoving('b', 'x' as never)).toThrow('function');
    await r.runRemoving('c1');
    expect(h).toHaveBeenCalledWith('c1');
    off(); off();
    await r.runRemoving('c1');
    expect(h).toHaveBeenCalledTimes(1);
    expect(() => r.onRemoving('a', vi.fn())).not.toThrow();
  });

  it('runs handlers in parallel; a throw or a hang is recorded and never vetoes', async () => {
    vi.useFakeTimers();
    const r = new PeerConnectionRegistry(), ok = vi.fn(async () => undefined);
    r.onRemoving('ok', ok);
    r.onRemoving('bad', async () => { throw new Error('boom'); });
    r.onRemoving('hang', () => new Promise<void>(() => undefined));
    const run = r.runRemoving('c1');
    await vi.advanceTimersByTimeAsync(CONNECTION_REMOVING_TIMEOUT_MS);
    const failed = await run;
    expect(ok).toHaveBeenCalledTimes(1);
    expect(failed.sort((x, y) => x.pluginId.localeCompare(y.pluginId))).toEqual([{ pluginId: 'bad', reason: 'error' }, { pluginId: 'hang', reason: 'timeout' }]);
    expect(r.failuresFor('c1')).toHaveLength(2);
    r.forget('c1');
    expect(r.failuresFor('c1')).toEqual([]);
  });

  it('shares an in-flight run per connection and a retry replaces the failure record', async () => {
    const r = new PeerConnectionRegistry();
    let fail = true, calls = 0;
    r.onRemoving('a', async () => { calls++; await Promise.resolve(); if (fail) throw new Error('x'); });
    const [one, two] = [r.runRemoving('c1'), r.runRemoving('c1')];
    expect(one).toBe(two);
    await one;
    expect(calls).toBe(1);
    expect(r.failuresFor('c1')).toHaveLength(1);
    fail = false;
    expect(await r.runRemoving('c1')).toEqual([]);
    expect(r.failuresFor('c1')).toEqual([]);
  });

  it('notifies change listeners once each, isolates throwing ones, and stops after unsubscribe or dispose', () => {
    const r = new PeerConnectionRegistry(), a = vi.fn(), b = vi.fn(() => { throw new Error('x'); }), c = vi.fn();
    const offA = r.onChange(a); r.onChange(b); r.onChange(c);
    r.notifyChanged();
    expect([a, b, c].map(f => f.mock.calls.length)).toEqual([1, 1, 1]);
    offA();
    r.notifyChanged();
    expect(a).toHaveBeenCalledTimes(1);
    r.dispose();
    r.notifyChanged();
    expect(c).toHaveBeenCalledTimes(2);
  });

  it('validates, bounds and clears statuses', async () => {
    const r = new PeerConnectionRegistry(), id = randomUUID();
    expect(r.setStatus('a', id, 'Syncing')).toBe(true);
    expect(r.statusOf('a', id)).toBe('Syncing');
    expect(r.setStatus('a', 'not an id!', 'x')).toBe(false);
    expect(r.setStatus('a', id, 'bad\u0007text')).toBe(false);
    expect(r.setStatus('a', id, 5 as never)).toBe(false);
    r.setStatus('a', id, 'y'.repeat(CONNECTION_STATUS_MAX + 50));
    expect(r.statusOf('a', id)).toHaveLength(CONNECTION_STATUS_MAX);
    for (let i = 1; i < CONNECTION_STATUS_PER_PLUGIN_MAX; i++) expect(r.setStatus('a', randomUUID(), 'x')).toBe(true);
    expect(r.setStatus('a', randomUUID(), 'x')).toBe(false);
    expect(r.setStatus('a', id, 'update existing')).toBe(true);
    expect(r.setStatus('b', randomUUID(), 'other plugin unaffected')).toBe(true);
    expect(r.setStatus('a', id, null)).toBe(true);
    expect(r.statusOf('a', id)).toBeUndefined();
    r.setStatus('a', id, 'again');
    r.onRemoving('a', async () => undefined);
    await r.runRemoving(id);
    expect(r.statusOf('a', id)).toBeUndefined();
    r.setStatus('a', id, 'z');
    r.clearPlugin('a');
    expect(r.statusOf('a', id)).toBeUndefined();
  });

  it('keeps hidden orphan records per computer for Remove anyway, bounded and cleared on dispose', () => {
    const registry = new PeerConnectionRegistry();
    registry.recordOrphans('c1', []);
    expect(registry.orphansOf('a')).toEqual([]);
    registry.recordOrphans('c1', [{ pluginId: 'a', reason: 'error' }]);
    registry.recordOrphans('c2', [{ pluginId: 'a', reason: 'timeout' }, { pluginId: 'b', reason: 'error' }]);
    expect(registry.orphansOf('a')).toEqual(['c1', 'c2']);
    expect(registry.orphansOf('b')).toEqual(['c2']);
    registry.forget('c1');
    expect(registry.orphansOf('a')).toEqual(['c1', 'c2']);
    for (let i = 0; i < CONNECTION_ORPHAN_MAX; i++) registry.recordOrphans(`x${i}`, [{ pluginId: 'z', reason: 'error' }]);
    expect(registry.orphansOf('a')).toEqual([]);
    expect(registry.orphansOf('z')).toHaveLength(CONNECTION_ORPHAN_MAX);
    registry.dispose();
    expect(registry.orphansOf('z')).toEqual([]);
  });

  it('lists orphan records with name and failures, newest last, and forgets them', () => {
    const registry = new PeerConnectionRegistry();
    expect(registry.orphanRecords()).toEqual([]);
    expect(registry.forgetOrphan('nope')).toBe(false);
    registry.recordOrphans('c1', [{ pluginId: 'a', reason: 'error' }], 'Ada');
    registry.recordOrphans('c2', [{ pluginId: 'b', reason: 'timeout' }], 'x'.repeat(200));
    registry.recordOrphans('c3', [{ pluginId: 'b', reason: 'timeout' }]);
    registry.recordOrphans('c1', [{ pluginId: 'a', reason: 'timeout' }], 'Ada again');
    const records = registry.orphanRecords();
    expect(records.map(r => r.computerId)).toEqual(['c2', 'c3', 'c1']);
    expect(records[0]!.name).toHaveLength(80);
    expect(records[1]!.name).toBe('');
    expect(records[2]).toEqual({ computerId: 'c1', name: 'Ada again', failed: [{ pluginId: 'a', reason: 'timeout' }] });
    records[2]!.failed.length = 0;
    expect(registry.orphanRecords()[2]!.failed).toHaveLength(1);
    expect(registry.hasOrphan('c2')).toBe(true);
    expect(registry.forgetOrphan('c2')).toBe(true);
    expect(registry.hasOrphan('c2')).toBe(false);
    expect(registry.orphansOf('b')).toEqual(['c3']);
  });

  it('bounds the orphan record list to 64 and the store to the cap; dispose clears records', () => {
    const registry = new PeerConnectionRegistry();
    for (let i = 0; i < CONNECTION_ORPHAN_MAX + 5; i++) registry.recordOrphans(`x${i}`, [{ pluginId: 'z', reason: 'error' }]);
    expect(registry.orphansOf('z')).toHaveLength(CONNECTION_ORPHAN_MAX);
    const records = registry.orphanRecords();
    expect(records).toHaveLength(64);
    expect(records.at(-1)!.computerId).toBe(`x${CONNECTION_ORPHAN_MAX + 4}`);
    registry.dispose();
    expect(registry.orphanRecords()).toEqual([]);
    expect(registry.hasOrphan('x300')).toBe(false);
  });
});
