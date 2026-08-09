/**
 * Control-plane unit tests — the security-critical surface: token/nonce auth,
 * operator-vs-agent caller classification, the agent-class refusal of every
 * mutating op, and that term.create delegates to the injected (confined)
 * creator rather than trusting the caller's path.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { connect } from 'node:net';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authorizeRequest,
  classifyCaller,
  dispatchOp,
  startControlPlane,
  type ControlPlaneDeps,
  type ControlPlaneHandle
} from './control-plane.js';

const EXPECTED = { token: 'good-token', nonce: 'good-nonce' };

describe('classifyCaller', () => {
  it('treats absence of a caller-session marker as operator', () => {
    expect(classifyCaller(undefined)).toBe('operator');
    expect(classifyCaller('')).toBe('operator');
  });
  it('treats any non-empty caller-session id as agent (fail-safe restrict)', () => {
    expect(classifyCaller('sess-123')).toBe('agent');
  });
  it('promotes an app-attested session to orchestrator', () => {
    const isOrch = (id: string) => id === 'orch-1';
    const verify = (id: string, credential: unknown) => id === 'orch-1' && credential === 'bound-token';
    expect(classifyCaller('orch-1', isOrch, 'bound-token', verify)).toBe('orchestrator');
    // Live orchestrator id alone is forgeable and must not promote.
    expect(classifyCaller('orch-1', isOrch)).toBe('agent');
    // A non-attested app session is still a plain agent…
    expect(classifyCaller('sess-2', isOrch)).toBe('agent');
    // …and absence of the marker is still the operator path regardless.
    expect(classifyCaller('', isOrch)).toBe('operator');
  });
});

describe('authorizeRequest', () => {
  it('rejects a bad/missing token', () => {
    const r = authorizeRequest({ token: 'nope', nonce: 'good-nonce', op: 'status' }, EXPECTED);
    expect(r).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });
  it('rejects a stale nonce even with a good token', () => {
    const r = authorizeRequest({ token: 'good-token', nonce: 'old', op: 'status' }, EXPECTED);
    expect(r).toMatchObject({ ok: false, code: 'STALE' });
  });
  it('rejects an unknown op', () => {
    const r = authorizeRequest({ ...EXPECTED, op: 'rm-rf' }, EXPECTED);
    expect(r).toMatchObject({ ok: false, code: 'BAD_OP' });
  });
  it('allows an operator to call a mutating op', () => {
    const r = authorizeRequest({ ...EXPECTED, op: 'term.create' }, EXPECTED);
    expect(r).toMatchObject({ ok: true, op: 'term.create', caller: 'operator' });
  });
  it('allows an agent the read surface', () => {
    const r = authorizeRequest({ ...EXPECTED, op: 'status', callerSessionId: 'sess-1' }, EXPECTED);
    expect(r).toMatchObject({ ok: true, caller: 'agent' });
  });

  // Read-only ops (incl. the new persona.list) are allowed for agent-class callers.
  it.each(['status', 'project.list', 'persona.list', 'agent.list', 'term.list', 'sched.list'])(
    'allows agent-class caller for read op %s',
    (op) => {
      const r = authorizeRequest({ ...EXPECTED, op, callerSessionId: 'sess-1' }, EXPECTED);
      expect(r).toMatchObject({ ok: true, caller: 'agent' });
    }
  );

  // The keystone guarantee: an agent shelling out to `zcc` cannot mutate.
  it.each(['term.create', 'term.close', 'term.close-summary', 'term.reply', 'agent.send', 'sched.runNow', 'sched.setEnabled'])(
    'refuses agent-class caller for mutating op %s',
    (op) => {
      const r = authorizeRequest({ ...EXPECTED, op, callerSessionId: 'sess-1' }, EXPECTED);
      expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN_AGENT' });
    }
  );

  // Orchestrator-class callers: attested by the injected predicate, they get the
  // bounded open/close surface ON TOP of the read surface — but nothing more.
  const isOrch = (id: string) => id === 'orch-1';
  const verify = (id: string, credential: unknown) => id === 'orch-1' && credential === 'bound-token';
  it.each(['term.create', 'term.close', 'term.close-summary'])(
    'allows an app-attested orchestrator the open/close op %s',
    (op) => {
      const r = authorizeRequest(
        { ...EXPECTED, op, callerSessionId: 'orch-1', callerCredential: 'bound-token' },
        EXPECTED,
        isOrch,
        verify
      );
      expect(r).toMatchObject({ ok: true, caller: 'orchestrator' });
    }
  );
  it.each(['status', 'project.list', 'persona.list', 'agent.list', 'term.list', 'sched.list'])(
    'allows an orchestrator the read op %s',
    (op) => {
      const r = authorizeRequest(
        { ...EXPECTED, op, callerSessionId: 'orch-1', callerCredential: 'bound-token' },
        EXPECTED,
        isOrch,
        verify
      );
      expect(r).toMatchObject({ ok: true, caller: 'orchestrator' });
    }
  );
  it.each(['term.reply', 'agent.send', 'sched.runNow', 'sched.setEnabled'])(
    'still refuses an orchestrator the operator-only op %s',
    (op) => {
      const r = authorizeRequest(
        { ...EXPECTED, op, callerSessionId: 'orch-1', callerCredential: 'bound-token' },
        EXPECTED,
        isOrch,
        verify
      );
      expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN_AGENT' });
    }
  );
  it('does not promote a non-attested session even for an open op', () => {
    // Same predicate, different (un-attested) session id → stays agent, refused.
    const r = authorizeRequest({ ...EXPECTED, op: 'term.create', callerSessionId: 'sess-9' }, EXPECTED, isOrch);
    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN_AGENT' });
    // The message names the agent class, not orchestrator (it was never promoted).
    if (!r.ok) expect(r.message).toContain('agent-class');
  });
});

function makeDeps(over: Partial<ControlPlaneDeps> = {}): ControlPlaneDeps {
  return {
    listProjects: () => [{ id: 'p1', name: 'Proj', path: '/tmp/p1' }],
    listTerminals: () => [],
    createTerminal: vi.fn(() => ({ ok: true as const, value: { id: 's1' } as any })),
    closeTerminal: () => true,
    summarizeAndCloseTerminals: async () => ({ closed: 1, summarized: 1, entryId: 'e1' }),
    replyTerminal: () => true,
    getAgentStatus: () => 'idle',
    isLiveSession: () => true,
    listAgents: () => [],
    listPersonas: () => [{ id: 'builtin:reviewer', name: 'Code Reviewer', baseProfile: 'claude' }],
    listTeams: () => [{ id: 'builtin:review-squad', name: 'Review Squad', slotCount: 3 }],
    sendToAgent: () => ({ ok: true, delivered: true, handle: 'r', id: 'm1' }),
    listSchedules: () => [],
    runScheduleNow: () => ({ ok: true, value: {} as any }),
    setScheduleEnabled: () => ({ ok: true, value: {} as any }),
    ...over
  };
}

describe('dispatchOp', () => {
  it('term.create delegates to the injected (confined) creator, never trusting cwd directly', async () => {
    const createTerminal = vi.fn(() => ({ ok: true as const, value: { id: 's9' } as any }));
    const deps = makeDeps({ createTerminal });
    const r = await dispatchOp(
      'term.create',
      { projectId: 'p1', profile: 'claude', cwd: '/etc', prompt: 'hi' },
      deps
    );
    expect(r.ok).toBe(true);
    // The op forwards the raw request to the confined creator — the creator (in
    // main) decides whether /etc is within the project, not the control plane.
    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', profile: 'claude', cwd: '/etc', prompt: 'hi' }),
      { class: 'operator' }
    );
  });

  it('term.create rejects missing required args before touching the creator', async () => {
    const createTerminal = vi.fn();
    const deps = makeDeps({ createTerminal: createTerminal as any });
    const r = await dispatchOp('term.create', { profile: 'claude' }, deps);
    expect(r).toMatchObject({ ok: false, code: 'BAD_ARGS' });
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it('status summarizes projects, agents (with live state), enabled schedules', async () => {
    const deps = makeDeps({
      listAgents: () => [
        { sessionId: 's1', projectId: 'p1', handle: 'reviewer', cwd: '/tmp/p1', role: 'qa' }
      ],
      getAgentStatus: () => 'working',
      listSchedules: () =>
        [
          { id: 'sch1', name: 'nightly', enabled: true, schedule: { every: '24h' } } as any,
          { id: 'sch2', name: 'off', enabled: false, schedule: { every: '1h' } } as any
        ]
    });
    const r = await dispatchOp('status', {}, deps);
    expect(r.ok).toBe(true);
    const v = (r as any).value;
    expect(v.projects).toBe(1);
    expect(v.agents).toEqual([
      { handle: 'reviewer', sessionId: 's1', projectId: 'p1', role: 'qa', state: 'working' }
    ]);
    expect(v.enabledSchedules).toEqual([
      { id: 'sch1', name: 'nightly', every: '24h', cadence: 'every 1d' }
    ]);
  });

  it('persona.list returns the injected persona summaries', async () => {
    const deps = makeDeps({
      listPersonas: () => [
        { id: 'builtin:reviewer', name: 'Code Reviewer', baseProfile: 'claude', model: 'opus' },
        { id: 'builtin:qa-engineer', name: 'QA Engineer', baseProfile: 'claude' }
      ]
    });
    const r = await dispatchOp('persona.list', {}, deps);
    expect(r.ok).toBe(true);
    expect((r as any).value).toEqual([
      { id: 'builtin:reviewer', name: 'Code Reviewer', baseProfile: 'claude', model: 'opus' },
      { id: 'builtin:qa-engineer', name: 'QA Engineer', baseProfile: 'claude' }
    ]);
  });

  it('term.close returns NOT_FOUND for an unknown session', async () => {
    const deps = makeDeps({ closeTerminal: () => false });
    const r = await dispatchOp('term.close', { sessionId: 'ghost' }, deps);
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('term.close-summary requires projectId and at least one sessionId', async () => {
    const deps = makeDeps();
    expect(await dispatchOp('term.close-summary', { sessionIds: ['s1'] }, deps)).toMatchObject({
      ok: false,
      code: 'BAD_ARGS'
    });
    expect(await dispatchOp('term.close-summary', { projectId: 'p1' }, deps)).toMatchObject({
      ok: false,
      code: 'BAD_ARGS'
    });
  });

  it('term.close-summary delegates to summarizeAndCloseTerminals (summarize defaults true)', async () => {
    const summarizeAndCloseTerminals = vi.fn(async () => ({ closed: 2, summarized: 2, entryId: 'e1' }));
    const deps = makeDeps({ summarizeAndCloseTerminals });
    const r = await dispatchOp(
      'term.close-summary',
      { projectId: 'p1', sessionIds: ['s1', 's2'] },
      deps
    );
    expect(r).toMatchObject({ ok: true, value: { closed: 2, summarized: 2, entryId: 'e1' } });
    expect(summarizeAndCloseTerminals).toHaveBeenCalledWith('p1', ['s1', 's2'], true);
  });

  it('term.close-summary honors summarize:false (close without summarizing)', async () => {
    const summarizeAndCloseTerminals = vi.fn(async () => ({ closed: 1, summarized: 0 }));
    const deps = makeDeps({ summarizeAndCloseTerminals });
    await dispatchOp(
      'term.close-summary',
      { projectId: 'p1', sessionIds: ['s1'], summarize: false },
      deps
    );
    expect(summarizeAndCloseTerminals).toHaveBeenCalledWith('p1', ['s1'], false);
  });

  it('term.close-summary returns NOT_FOUND when nothing matched', async () => {
    const deps = makeDeps({
      summarizeAndCloseTerminals: async () => ({ closed: 0, summarized: 0 })
    });
    const r = await dispatchOp('term.close-summary', { projectId: 'p1', sessionIds: ['ghost'] }, deps);
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('term.reply returns NOT_FOUND when the pty rejects the write', async () => {
    const deps = makeDeps({ replyTerminal: () => false });
    const r = await dispatchOp('term.reply', { sessionId: 'ghost', text: 'hi' }, deps);
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('term.create rejects an unknown profile before touching the creator', async () => {
    const createTerminal = vi.fn(() => ({ ok: true as const, value: { id: 's' } as any }));
    const deps = makeDeps({ createTerminal });
    const r = await dispatchOp('term.create', { projectId: 'p1', profile: 'bogus' }, deps);
    expect(r).toMatchObject({ ok: false, code: 'BAD_ARGS' });
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it('term.create clamps NaN/0/negative cols+rows to sane fallbacks', async () => {
    const createTerminal = vi.fn(() => ({ ok: true as const, value: { id: 's' } as any }));
    const deps = makeDeps({ createTerminal });
    await dispatchOp(
      'term.create',
      { projectId: 'p1', profile: 'shell', cols: Number.NaN, rows: -5 },
      deps
    );
    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ cols: 80, rows: 24 }),
      { class: 'operator' }
    );
  });

  it('caps oversized prompt / reply / message fields', async () => {
    const deps = makeDeps();
    const bigPrompt = 'x'.repeat(32_001);
    expect(await dispatchOp('term.create', { projectId: 'p1', profile: 'claude', prompt: bigPrompt }, deps))
      .toMatchObject({ ok: false, code: 'BAD_ARGS' });
    const bigText = 'x'.repeat(16_001);
    expect(await dispatchOp('term.reply', { sessionId: 's1', text: bigText }, deps))
      .toMatchObject({ ok: false, code: 'BAD_ARGS' });
    expect(await dispatchOp('agent.send', { to: 'r', message: bigText }, deps))
      .toMatchObject({ ok: false, code: 'BAD_ARGS' });
  });

  it('agent.send maps a failed resolve to SEND_FAILED', async () => {
    const deps = makeDeps({ sendToAgent: () => ({ ok: false, error: 'no peer' }) });
    const r = await dispatchOp('agent.send', { to: 'ghost', message: 'hi' }, deps);
    expect(r).toMatchObject({ ok: false, code: 'SEND_FAILED', message: 'no peer' });
  });
});

describe('token/nonce auth is constant-time but still correct', () => {
  it('accepts the exact token+nonce and rejects near-misses without throwing', () => {
    const exp = { token: 'a'.repeat(64), nonce: 'b'.repeat(32) };
    expect(authorizeRequest({ ...exp, op: 'status' }, exp).ok).toBe(true);
    // One byte off → rejected.
    expect(
      authorizeRequest({ token: 'a'.repeat(63) + 'c', nonce: exp.nonce, op: 'status' }, exp)
    ).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    // Wrong length → rejected (the hash-then-compare path must not throw).
    expect(
      authorizeRequest({ token: 'short', nonce: exp.nonce, op: 'status' }, exp)
    ).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });
});

// Integration: a real UDS server, driven by a raw socket, so we exercise the
// NDJSON framing + auth round-trip the unit tests above can't reach.
describe('startControlPlane (real socket)', () => {
  const dirs: string[] = [];
  let handle: ControlPlaneHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function boot(over: Partial<ControlPlaneDeps> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-ctl-'));
    dirs.push(dir);
    const socketPath = join(dir, 'control.sock');
    const tokenPath = join(dir, 'control.token');
    handle = await startControlPlane({ socketPath, tokenPath, ...makeDeps(over) });
    return { socketPath, tokenPath, dir };
  }

  /** Send `payload` bytes (possibly in chunks) and resolve the parsed response. */
  function rawRequest(socketPath: string, chunks: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const sock = connect(socketPath);
      let buf = '';
      sock.on('connect', () => {
        // Write each chunk on a separate tick so the server sees multiple `data`
        // events — exercises the multi-chunk framing path.
        let i = 0;
        const pump = () => {
          if (i < chunks.length) {
            sock.write(chunks[i++]);
            setTimeout(pump, 5);
          } else {
            // Half-close after the last chunk so a payload WITHOUT a trailing
            // newline still reaches the server's `end`-path framing.
            sock.end();
          }
        };
        pump();
      });
      sock.on('data', (c) => {
        buf += c.toString('utf8');
      });
      sock.on('end', () => {
        try {
          resolve(JSON.parse(buf.trim()));
        } catch (e) {
          reject(e);
        }
      });
      sock.on('error', reject);
    });
  }

  it('writes a 0600 token file with token+nonce+socket and serves a status request', async () => {
    const { socketPath, tokenPath } = await boot();
    expect(existsSync(tokenPath)).toBe(true);
    // 0600 perms (low 9 bits == owner rw only).
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    const tok = JSON.parse(readFileSync(tokenPath, 'utf8'));
    const resp = await rawRequest(socketPath, [
      JSON.stringify({ token: tok.token, nonce: tok.nonce, op: 'status' }) + '\n'
    ]);
    expect(resp).toMatchObject({ ok: true });
    expect(resp.value.projects).toBe(1);
  });

  it('reassembles a request split across multiple data chunks (newline straddling)', async () => {
    const { socketPath, tokenPath } = await boot();
    const tok = JSON.parse(readFileSync(tokenPath, 'utf8'));
    const full = JSON.stringify({ token: tok.token, nonce: tok.nonce, op: 'project.list' }) + '\n';
    // Split mid-payload AND put the newline in its own trailing chunk.
    const mid = Math.floor(full.length / 2);
    const resp = await rawRequest(socketPath, [full.slice(0, mid), full.slice(mid, -1), '\n']);
    expect(resp).toMatchObject({ ok: true });
    expect(Array.isArray(resp.value)).toBe(true);
  });

  it('handles a request with NO trailing newline that half-closes (end-path framing)', async () => {
    const { socketPath, tokenPath } = await boot();
    const tok = JSON.parse(readFileSync(tokenPath, 'utf8'));
    // No '\n' — the client just ends the stream after the payload.
    const resp = await rawRequest(socketPath, [
      JSON.stringify({ token: tok.token, nonce: tok.nonce, op: 'project.list' })
    ]);
    expect(resp).toMatchObject({ ok: true });
  });

  it('rejects a bad token over the wire', async () => {
    const { socketPath } = await boot();
    const resp = await rawRequest(socketPath, [
      JSON.stringify({ token: 'wrong', nonce: 'wrong', op: 'status' }) + '\n'
    ]);
    expect(resp).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('requires native confirmation before an unbound operator mutation dispatches', async () => {
    const closeTerminal = vi.fn(() => true);
    const confirmOperatorMutation = vi.fn(async () => false);
    const { socketPath, tokenPath } = await boot({ closeTerminal, confirmOperatorMutation });
    const tok = JSON.parse(readFileSync(tokenPath, 'utf8'));
    const denied = await rawRequest(socketPath, [
      JSON.stringify({ token: tok.token, nonce: tok.nonce, op: 'term.close', args: { sessionId: 's1' } }) + '\n'
    ]);
    expect(denied).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(confirmOperatorMutation).toHaveBeenCalledWith('term.close', { sessionId: 's1' });
    expect(closeTerminal).not.toHaveBeenCalled();
  });

  it('dispatches an unbound operator mutation only after native confirmation', async () => {
    const closeTerminal = vi.fn(() => true);
    const { socketPath, tokenPath } = await boot({
      closeTerminal,
      confirmOperatorMutation: async () => true
    });
    const tok = JSON.parse(readFileSync(tokenPath, 'utf8'));
    const allowed = await rawRequest(socketPath, [
      JSON.stringify({ token: tok.token, nonce: tok.nonce, op: 'term.close', args: { sessionId: 's1' } }) + '\n'
    ]);
    expect(allowed).toMatchObject({ ok: true, value: true });
    expect(closeTerminal).toHaveBeenCalledWith('s1');
  });

  it('removes the socket + token file on close', async () => {
    const { socketPath, tokenPath } = await boot();
    await handle!.close();
    handle = null;
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(tokenPath)).toBe(false);
  });
});
