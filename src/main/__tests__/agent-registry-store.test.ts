import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAgentRegistryStore,
  type IAgentRegistryStore
} from '../agent-registry-store.js';

describe('AgentRegistryStore', () => {
  let store: IAgentRegistryStore;

  beforeEach(() => {
    store = createAgentRegistryStore();
  });

  it('upsert fills server fields and stamps registeredAt', () => {
    const before = Date.now();
    const rec = store.upsert({
      sessionId: 'sess-1',
      projectId: 'proj-1',
      cwd: '/work/p1',
      handle: 'reviewer',
      role: 'reviewer',
      capabilities: ['typescript']
    });
    expect(rec.sessionId).toBe('sess-1');
    expect(rec.projectId).toBe('proj-1');
    expect(rec.cwd).toBe('/work/p1');
    expect(rec.handle).toBe('reviewer');
    expect(rec.role).toBe('reviewer');
    expect(rec.capabilities).toEqual(['typescript']);
    expect(rec.registeredAt).toBeGreaterThanOrEqual(before);
  });

  it('re-upsert for the same session updates fields but preserves registeredAt and handle', () => {
    const first = store.upsert({ sessionId: 's1', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    const second = store.upsert({
      sessionId: 's1',
      projectId: 'p1',
      cwd: '/a',
      handle: 'reviewer', // same handle — must NOT self-suffix
      role: 'now-with-a-role'
    });
    expect(second.registeredAt).toBe(first.registeredAt);
    expect(second.handle).toBe('reviewer');
    expect(second.role).toBe('now-with-a-role');
    expect(store.list()).toHaveLength(1); // updated, not duplicated
  });

  it('a display-only re-seed never clears a registered handle, role, or capabilities', () => {
    // register_agent sets the authoritative identity…
    store.upsert({
      sessionId: 's1',
      projectId: 'p1',
      cwd: '/a',
      handle: 'reviewer',
      role: 'reviewer',
      capabilities: ['ts']
    });
    // …then the auto-seed fires again on a sessionUpdated with ONLY a displayName.
    const reseeded = store.upsert({
      sessionId: 's1',
      projectId: 'p1',
      cwd: '/a',
      displayName: 'Investigate the flaky test'
    });
    // The drifting tab title lands in displayName; the registered identity holds.
    expect(reseeded.handle).toBe('reviewer');
    expect(reseeded.role).toBe('reviewer');
    expect(reseeded.capabilities).toEqual(['ts']);
    expect(reseeded.displayName).toBe('Investigate the flaky test');
  });

  it('auto-seed (displayName only) leaves handle undefined until the agent registers', () => {
    const seeded = store.upsert({
      sessionId: 's1',
      projectId: 'p1',
      cwd: '/a',
      displayName: 'claude'
    });
    expect(seeded.handle).toBeUndefined();
    expect(seeded.displayName).toBe('claude');
    // The agent later registers — handle becomes authoritative, display persists.
    const registered = store.upsert({ sessionId: 's1', projectId: 'p1', cwd: '/a', handle: 'pinger' });
    expect(registered.handle).toBe('pinger');
    expect(registered.displayName).toBe('claude');
  });

  it('dedupes handles per project (suffixing the colliding one)', () => {
    store.upsert({ sessionId: 's1', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    const second = store.upsert({ sessionId: 's2', projectId: 'p1', cwd: '/b', handle: 'reviewer' });
    expect(second.handle).toBe('reviewer-2');
    const third = store.upsert({ sessionId: 's3', projectId: 'p1', cwd: '/c', handle: 'reviewer' });
    expect(third.handle).toBe('reviewer-3');
  });

  it('the same handle in two DIFFERENT projects coexists without suffixing', () => {
    const a = store.upsert({ sessionId: 's1', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    const b = store.upsert({ sessionId: 's2', projectId: 'p2', cwd: '/b', handle: 'reviewer' });
    expect(a.handle).toBe('reviewer');
    expect(b.handle).toBe('reviewer');
  });

  it('list scopes by project', () => {
    store.upsert({ sessionId: 's1', projectId: 'p1', cwd: '/a', handle: 'a' });
    store.upsert({ sessionId: 's2', projectId: 'p1', cwd: '/b', handle: 'b' });
    store.upsert({ sessionId: 's3', projectId: 'p2', cwd: '/c', handle: 'c' });
    expect(store.list('p1').map((r) => r.sessionId).sort()).toEqual(['s1', 's2']);
    expect(store.list('p2').map((r) => r.sessionId)).toEqual(['s3']);
    expect(store.list()).toHaveLength(3);
  });

  it('find matches by role and capability, scoped to a project', () => {
    store.upsert({ sessionId: 's1', projectId: 'p1', cwd: '/a', handle: 'r', role: 'reviewer' });
    store.upsert({
      sessionId: 's2',
      projectId: 'p1',
      cwd: '/b',
      handle: 'i',
      role: 'implementer',
      capabilities: ['tests']
    });
    store.upsert({ sessionId: 's3', projectId: 'p2', cwd: '/c', handle: 'r2', role: 'reviewer' });

    expect(store.find({ role: 'reviewer', projectId: 'p1' }).map((r) => r.sessionId)).toEqual(['s1']);
    expect(store.find({ capability: 'tests', projectId: 'p1' }).map((r) => r.sessionId)).toEqual([
      's2'
    ]);
    // cross-project (no projectId scope)
    expect(store.find({ role: 'reviewer' }).map((r) => r.sessionId).sort()).toEqual(['s1', 's3']);
    // handle match
    expect(store.find({ handle: 'i', projectId: 'p1' }).map((r) => r.sessionId)).toEqual(['s2']);
  });

  it('find by name falls back to displayName for an unregistered (auto-seeded) peer', () => {
    // s1 registered a handle; s2 was only auto-seeded with a display name.
    store.upsert({ sessionId: 's1', projectId: 'p1', cwd: '/a', handle: 'pinger' });
    store.upsert({ sessionId: 's2', projectId: 'p1', cwd: '/b', displayName: 'Debug Kanban View' });
    // Addressable by the authoritative handle…
    expect(store.find({ handle: 'pinger', projectId: 'p1' }).map((r) => r.sessionId)).toEqual(['s1']);
    // …and an unregistered peer is still addressable by its tab title.
    expect(
      store.find({ handle: 'Debug Kanban View', projectId: 'p1' }).map((r) => r.sessionId)
    ).toEqual(['s2']);
  });

  it('ranks an authoritative handle match ahead of a colliding displayName (no mis-route)', () => {
    // s2 is inserted FIRST and its drifting tab title collides with the handle
    // s1 later registers — without precedence, find()[0] would resolve to s2.
    store.upsert({ sessionId: 's2', projectId: 'p1', cwd: '/b', displayName: 'reviewer' });
    store.upsert({ sessionId: 's1', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    const found = store.find({ handle: 'reviewer', projectId: 'p1' });
    // Both match, but the registered handle owner must rank first so callers
    // taking [0] (agent_send) deliver to the real peer, not the colliding one.
    expect(found.map((r) => r.sessionId)).toEqual(['s1', 's2']);
  });

  it('drop removes a record and reports whether it existed', () => {
    store.upsert({ sessionId: 's1', projectId: 'p1', cwd: '/a', handle: 'a' });
    expect(store.get('s1')).not.toBeNull();
    expect(store.drop('s1')).toBe(true);
    expect(store.get('s1')).toBeNull();
    expect(store.drop('s1')).toBe(false); // already gone
  });

  it('dropping a handle frees it for re-use by a later session', () => {
    store.upsert({ sessionId: 's1', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    store.drop('s1');
    const next = store.upsert({ sessionId: 's2', projectId: 'p1', cwd: '/b', handle: 'reviewer' });
    expect(next.handle).toBe('reviewer'); // not reviewer-2 — s1 is gone
  });

  it('onChanged fires on upsert and drop, and unsubscribes cleanly', () => {
    let count = 0;
    const dispose = store.onChanged(() => {
      count += 1;
    });
    store.upsert({ sessionId: 's1', projectId: 'p1', cwd: '/a', handle: 'a' });
    store.drop('s1');
    expect(count).toBe(2);
    dispose();
    store.upsert({ sessionId: 's2', projectId: 'p1', cwd: '/b', handle: 'b' });
    expect(count).toBe(2); // no further calls after dispose
  });
});
