import { describe, it, expect } from 'vitest';
import type { AgentState, TerminalSession } from '../../../shared/types.js';
import {
  bucketSessions,
  isRecentlyFinished,
  FINISHED_LINGER_MS,
  type SessionBucketId
} from '../sessionBuckets.js';

function session(over: Partial<TerminalSession>): TerminalSession {
  return {
    id: 'sid',
    projectId: 'p1',
    title: 'claude',
    profile: 'claude',
    cwd: '/work/p1',
    status: 'running',
    createdAt: 0,
    ...over
  };
}

/** Convenience: map bucket id → the session ids it contains. */
function idsByBucket(
  sessions: TerminalSession[],
  agentById: Record<string, AgentState>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const b of bucketSessions(sessions, agentById)) {
    out[b.id] = b.sessions.map((s) => s.id);
  }
  return out;
}

describe('bucketSessions — agent state classification', () => {
  it('maps each AgentState to its bucket (running pty so unknown lands in running)', () => {
    const sessions = [
      session({ id: 'a' }),
      session({ id: 'b' }),
      session({ id: 'c' }),
      session({ id: 'd' }),
      session({ id: 'e' })
    ];
    const agentById: Record<string, AgentState> = {
      a: 'blocked',
      b: 'working',
      c: 'done',
      d: 'idle',
      e: 'unknown'
    };
    expect(idsByBucket(sessions, agentById)).toEqual({
      blocked: ['a'],
      running: ['b', 'e'], // working + unknown-on-a-running-pty
      done: ['c'],
      idle: ['d']
    });
  });

  it('defaults a session with no agent entry to unknown', () => {
    // running pty + no agent entry → running
    expect(idsByBucket([session({ id: 'a', status: 'running' })], {})).toEqual({
      running: ['a']
    });
    // starting pty + no agent entry → idle (not running)
    expect(idsByBucket([session({ id: 'b', status: 'starting' })], {})).toEqual({
      idle: ['b']
    });
  });
});

describe('bucketSessions — unknown heuristic by pty status', () => {
  it('unknown on a running pty → running, on a non-running pty → idle', () => {
    const sessions = [
      session({ id: 'live', status: 'running' }),
      session({ id: 'starting', status: 'starting' })
    ];
    const agentById: Record<string, AgentState> = {
      live: 'unknown',
      starting: 'unknown'
    };
    expect(idsByBucket(sessions, agentById)).toEqual({
      running: ['live'],
      idle: ['starting']
    });
  });
});

describe('bucketSessions — shells get their own bucket', () => {
  it('a plain shell lands in shell, not running, even on a live pty', () => {
    const sessions = [
      session({ id: 'sh', profile: 'shell', status: 'running' }),
      session({ id: 'ag', profile: 'claude', status: 'running' })
    ];
    // The shell would previously masquerade as a "running" agent (unknown +
    // live pty). Now it's kept apart.
    expect(idsByBucket(sessions, { ag: 'working' })).toEqual({
      running: ['ag'],
      shell: ['sh']
    });
  });

  it('routes shells by profile regardless of any agent state on the session', () => {
    // A shell never emits agent state, but guard against a stray entry: profile
    // wins over agent state for the shell→bucket decision.
    const sessions = [session({ id: 'sh', profile: 'shell', status: 'running' })];
    expect(idsByBucket(sessions, { sh: 'working' })).toEqual({ shell: ['sh'] });
  });

  it('an exited shell still goes to exited, not shell', () => {
    const sessions = [session({ id: 'sh', profile: 'shell', status: 'exited', exitCode: 0 })];
    expect(idsByBucket(sessions, {})).toEqual({ exited: ['sh'] });
  });

  it('orders the shell bucket below the agent buckets, above exited', () => {
    const sessions = [
      session({ id: 'ex', profile: 'shell', status: 'exited', exitCode: 0 }),
      session({ id: 'sh', profile: 'shell', status: 'running' }),
      session({ id: 'run', profile: 'claude', status: 'running' })
    ];
    const buckets = bucketSessions(sessions, { run: 'working' });
    expect(buckets.map((b) => b.id)).toEqual(['running', 'shell', 'exited']);
    expect(buckets.find((b) => b.id === 'shell')?.label).toBe('Shells');
  });
});

describe('bucketSessions — exited precedence', () => {
  it('exited pty goes to exited regardless of agent state', () => {
    const sessions = [session({ id: 'a', status: 'exited', exitCode: 0 })];
    // even a "working" agent reading is overridden by the dead pty
    expect(idsByBucket(sessions, { a: 'working' })).toEqual({ exited: ['a'] });
  });

  it('sorts crashed (non-zero exitCode) before clean exits, preserving order within', () => {
    const sessions = [
      session({ id: 'clean1', status: 'exited', exitCode: 0 }),
      session({ id: 'crash1', status: 'exited', exitCode: 1 }),
      session({ id: 'clean2', status: 'exited', exitCode: 0 }),
      session({ id: 'crash2', status: 'exited', exitCode: 137 })
    ];
    expect(idsByBucket(sessions, {})).toEqual({
      exited: ['crash1', 'crash2', 'clean1', 'clean2']
    });
  });

  it('treats a missing exitCode as a clean exit (not crashed)', () => {
    const sessions = [
      session({ id: 'noCode', status: 'exited' }),
      session({ id: 'crash', status: 'exited', exitCode: 2 })
    ];
    expect(idsByBucket(sessions, {})).toEqual({
      exited: ['crash', 'noCode']
    });
  });
});

describe('bucketSessions — hidden (headless) sessions classify by status', () => {
  it('a hidden tab sorts by its agent state, not into a separate bucket', () => {
    const sessions = [
      session({ id: 'a', headless: true }),
      session({ id: 'b', headless: true })
    ];
    // headless no longer overrides — they land in their real status buckets.
    expect(idsByBucket(sessions, { a: 'working', b: 'blocked' })).toEqual({
      blocked: ['b'],
      running: ['a']
    });
  });

  it('a hidden tab still goes to exited once its pty dies', () => {
    const sessions = [session({ id: 'a', headless: true, status: 'exited', exitCode: 0 })];
    expect(idsByBucket(sessions, { a: 'working' })).toEqual({ exited: ['a'] });
  });

  it('excludes scheduler-spawned jobs from the buckets entirely', () => {
    const sessions = [
      session({ id: 'job', scheduled: true, headless: true }),
      session({ id: 'tab', status: 'running' })
    ];
    // The scheduled job is surfaced via the inbox, not the session list.
    expect(idsByBucket(sessions, { job: 'working', tab: 'working' })).toEqual({
      running: ['tab']
    });
  });
});

describe('bucketSessions — empty-bucket omission & ordering', () => {
  it('omits buckets that have no sessions', () => {
    const buckets = bucketSessions([session({ id: 'a', status: 'running' })], {
      a: 'blocked'
    });
    expect(buckets.map((b) => b.id)).toEqual(['blocked']);
  });

  it('returns buckets in display order (most-urgent first) with correct labels', () => {
    const sessions = [
      session({ id: 'ex', status: 'exited', exitCode: 0 }),
      session({ id: 'idle', status: 'starting' }),
      session({ id: 'done' }),
      session({ id: 'run', status: 'running' }),
      session({ id: 'blk' })
    ];
    const agentById: Record<string, AgentState> = {
      idle: 'idle',
      done: 'done',
      run: 'working',
      blk: 'blocked'
    };
    const buckets = bucketSessions(sessions, agentById);
    const order: SessionBucketId[] = ['blocked', 'running', 'done', 'idle', 'exited'];
    expect(buckets.map((b) => b.id)).toEqual(order);
    expect(buckets.map((b) => b.label)).toEqual([
      'Needs you',
      'Running',
      'Done',
      'Idle',
      'Exited'
    ]);
  });

  it('preserves input order of sessions within a non-exited bucket', () => {
    const sessions = [
      session({ id: 'r1', status: 'running' }),
      session({ id: 'r2', status: 'running' }),
      session({ id: 'r3', status: 'running' })
    ];
    const agentById: Record<string, AgentState> = {
      r1: 'working',
      r2: 'working',
      r3: 'working'
    };
    expect(idsByBucket(sessions, agentById)).toEqual({
      running: ['r1', 'r2', 'r3']
    });
  });

  it('returns an empty array for no sessions', () => {
    expect(bucketSessions([], {})).toEqual([]);
  });
});

describe('isRecentlyFinished — finished-list auto-dismiss', () => {
  const NOW = 1_000_000;

  it('is false for a live (non-exited) session', () => {
    expect(isRecentlyFinished(session({ status: 'running' }), NOW)).toBe(false);
    expect(isRecentlyFinished(session({ status: 'starting' }), NOW)).toBe(false);
  });

  it('is true for an exited session finished within the linger window', () => {
    const s = session({ status: 'exited', finishedAt: NOW - 1000 });
    expect(isRecentlyFinished(s, NOW)).toBe(true);
  });

  it('is true at exactly the linger boundary, false just past it', () => {
    expect(
      isRecentlyFinished(session({ status: 'exited', finishedAt: NOW - FINISHED_LINGER_MS }), NOW)
    ).toBe(true);
    expect(
      isRecentlyFinished(
        session({ status: 'exited', finishedAt: NOW - FINISHED_LINGER_MS - 1 }),
        NOW
      )
    ).toBe(false);
  });

  it('treats an exited session with no finishedAt stamp as recent (never hides prematurely)', () => {
    expect(isRecentlyFinished(session({ status: 'exited' }), NOW)).toBe(true);
  });
});
