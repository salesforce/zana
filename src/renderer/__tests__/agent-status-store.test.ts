import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStatus, useData } from '../store.js';

/**
 * Tests for the useAgentStatus Zustand slice's cursor-replay staleness guard
 * (cmux #2 — reconnectable event stream). The `seq` carried on each `apply` is
 * main's authoritative monotonic counter (Rule 1); the slice tracks a
 * PER-SESSION high-water mark (`seqById`) so a stale reseed event — replayed
 * behind a live push that raced ahead of the async `agentStatusSince` reseed on
 * init — can't clobber the newer state.
 *
 * The global `lastSeq` cursor can't gate a write: seq is global, so an unrelated
 * session's push would suppress this session's legitimate replay. Hence the
 * per-session mark. These tests pin that distinction.
 */

describe('useAgentStatus — cursor-replay staleness guard', () => {
  beforeEach(() => {
    useAgentStatus.setState({ byId: {}, since: {}, rollup: {}, lastSeq: 0, seqById: {} });
    useData.setState({ terminals: {} });
  });

  it('advances byId + both cursors on a fresh transition', () => {
    useAgentStatus.getState().apply('s1', 'p1', 'working', 3);
    const s = useAgentStatus.getState();
    expect(s.byId['s1']).toBe('working');
    expect(s.seqById['s1']).toBe(3);
    expect(s.lastSeq).toBe(3);
  });

  it('drops a stale reseed event that raced behind a newer live push (the race)', () => {
    // Live push arrives first with the newest seq for this session.
    useAgentStatus.getState().apply('s1', 'p1', 'working', 3);
    // A replayed OLDER event for the same session resolves late.
    useAgentStatus.getState().apply('s1', 'p1', 'idle', 2);
    const s = useAgentStatus.getState();
    // byId must NOT regress to the stale 'idle' — the whole point of the guard.
    expect(s.byId['s1']).toBe('working');
    // The per-session mark stays at the newer seq.
    expect(s.seqById['s1']).toBe(3);
  });

  it('drops an equal-seq re-apply (idempotent replay)', () => {
    useAgentStatus.getState().apply('s1', 'p1', 'working', 3);
    const before = useAgentStatus.getState();
    useAgentStatus.getState().apply('s1', 'p1', 'idle', 3); // same seq, different state
    const after = useAgentStatus.getState();
    expect(after.byId['s1']).toBe('working'); // unchanged
    expect(before).toBe(after); // no mutation at all
  });

  it('does NOT let one session\'s seq suppress another session\'s replay (per-session, not global)', () => {
    // s2's live push advances the GLOBAL cursor to 5.
    useAgentStatus.getState().apply('s2', 'p1', 'working', 5);
    expect(useAgentStatus.getState().lastSeq).toBe(5);
    // s1's legitimate replay at seq 2 must still land, even though 2 < global lastSeq.
    useAgentStatus.getState().apply('s1', 'p1', 'idle', 2);
    expect(useAgentStatus.getState().byId['s1']).toBe('idle');
  });

  it('applies a seq-less write (snapshot fallback) without the guard blocking it', () => {
    useAgentStatus.getState().apply('s1', 'p1', 'working', 3);
    // Snapshot fallback carries no seq — it should still update byId.
    useAgentStatus.getState().apply('s1', 'p1', 'idle');
    expect(useAgentStatus.getState().byId['s1']).toBe('idle');
  });

  it('advances the global cursor even when the per-session guard drops the write', () => {
    useAgentStatus.getState().apply('s1', 'p1', 'working', 3);
    // A stale-for-s1 event at seq 4 (newer globally, older for the racing state):
    // s1 already at seq 3, so this newer seq is applied normally. Use seq 3 to
    // exercise the drop path while a higher GLOBAL seq exists.
    useAgentStatus.setState({ lastSeq: 2 }); // simulate global behind
    useAgentStatus.getState().apply('s1', 'p1', 'idle', 3); // == per-session mark → dropped for byId
    const s = useAgentStatus.getState();
    expect(s.byId['s1']).toBe('working'); // dropped
    expect(s.lastSeq).toBe(3); // but global cursor still advanced
  });

  it('drops the high-water mark on clear so a reused session id starts clean', () => {
    useAgentStatus.getState().apply('s1', 'p1', 'working', 5);
    useAgentStatus.getState().clear('s1', 'p1');
    expect(useAgentStatus.getState().seqById['s1']).toBeUndefined();
    // A reused id at a lower seq now applies (no stale mark to block it).
    useAgentStatus.getState().apply('s1', 'p1', 'idle', 1);
    expect(useAgentStatus.getState().byId['s1']).toBe('idle');
  });

  it('drops per-session marks for every session in a cleared project', () => {
    useData.setState({
      terminals: {
        p1: [
          { id: 's1', projectId: 'p1', profile: 'claude', cwd: '/proj', status: 'running' } as any,
          { id: 's2', projectId: 'p1', profile: 'claude', cwd: '/proj', status: 'running' } as any
        ]
      }
    });
    useAgentStatus.getState().apply('s1', 'p1', 'working', 4);
    useAgentStatus.getState().apply('s2', 'p1', 'idle', 5);
    useAgentStatus.getState().clearProject('p1');
    const s = useAgentStatus.getState();
    expect(s.seqById['s1']).toBeUndefined();
    expect(s.seqById['s2']).toBeUndefined();
  });
});
