/**
 * Tests for `zcc run` aliases, control-plane leftovers, and persona resolution.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, resolvePersona } from '../lib/run-cli.js';
import type { PersonaSummary } from '../lib/types.js';

let server: Server | null = null;
const dirs: string[] = [];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function spawnFetch(opts?: { prompt?: (value: string) => void; id?: string; status?: string }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && url.pathname === '/api/v1/threads') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string };
      opts?.prompt?.(body.prompt ?? '');
      return jsonResponse(201, {
        thread: { id: opts?.id ?? 'sess-1', status: 'starting', projectId: 'p-api', title: '' }
      });
    }
    if (method === 'GET' && url.pathname.startsWith('/api/v1/threads/')) {
      return jsonResponse(200, {
        thread: { id: opts?.id ?? 'sess-1', status: opts?.status ?? 'idle', projectId: 'p-api' }
      });
    }
    return jsonResponse(404, { error: `unmocked ${method} ${url.pathname}` });
  }) as typeof fetch;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function boot(handler: (req: any, callCount: number) => any): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-run-'));
  dirs.push(dir);
  const socketPath = join(dir, 'control.sock');
  writeFileSync(join(dir, 'control.token'), JSON.stringify({ token: 't', nonce: 'n', socket: socketPath }));
  writeFileSync(
    join(dir, 'projects.json'),
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'p-api', name: 'api', path: '/tmp/api', createdAt: 0, lastActiveAt: 0 },
        { id: 'p-apex', name: 'apex', path: '/tmp/apex', createdAt: 0, lastActiveAt: 0 }
      ]
    })
  );
  let calls = 0;
  server = createServer((sock) => {
    let buf = '';
    sock.on('data', (c) => {
      buf += c.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const req = JSON.parse(buf.slice(0, nl));
      const resp = handler(req, calls++);
      sock.end(JSON.stringify(resp) + '\n');
    });
  });
  server.listen(socketPath);
  return dir;
}

function ready(): Promise<void> {
  return new Promise((r) => (server!.listening ? r() : server!.once('listening', () => r())));
}

describe('zcc run — flag/prompt disambiguation', () => {
  it('keeps flag-like tokens after `--` as literal prompt text', async () => {
    let seenPrompt = '';
    const r = await runCli(
      ['node', 'zcc', 'run', 'api', '--', 'review', 'the', '--wait', 'handler'],
      { fetchImpl: spawnFetch({ prompt: (value) => { seenPrompt = value; }, id: 'sess-1' }) }
    );
    expect(seenPrompt).toBe('review the --wait handler');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('sess-1');
    expect(r.stderr).toMatch(/deprecated/);
  });

  it('keeps a literal `--json` in the `--` tail and does NOT enable json output', async () => {
    let seenPrompt = '';
    const r = await runCli(
      ['node', 'zcc', 'run', 'api', '--', 'explain', 'the', '--json', 'output'],
      { fetchImpl: spawnFetch({ prompt: (value) => { seenPrompt = value; }, id: 'sess-2' }) }
    );
    expect(seenPrompt).toBe('explain the --json output');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim().startsWith('{')).toBe(false);
    expect(r.stdout).toContain('sess-2');
  });

  it('keeps a literal `--data-dir X` in the `--` tail without treating it as a flag', async () => {
    let seenPrompt = '';
    const r = await runCli(
      ['node', 'zcc', 'run', 'api', '--', 'use', '--data-dir', '/tmp/elsewhere'],
      { fetchImpl: spawnFetch({ prompt: (value) => { seenPrompt = value; }, id: 'sess-3' }) }
    );
    expect(seenPrompt).toBe('use --data-dir /tmp/elsewhere');
    expect(r.exitCode).toBe(0);
  });

  it('--wait and --detach together is a usage error (exit 2)', async () => {
    let spawned = false;
    const r = await runCli(['node', 'zcc', 'run', 'api', 'do it', '--wait', '--detach'], {
      fetchImpl: spawnFetch({ prompt: () => { spawned = true; } })
    });
    expect(r.exitCode).toBe(2);
    expect(spawned).toBe(false);
  });

  it('rejects an invalid --timeout (exit 2) before spawning', async () => {
    let spawned = false;
    const r = await runCli(['node', 'zcc', 'run', 'api', 'go', '--wait', '--timeout', 'soon'], {
      fetchImpl: spawnFetch({ prompt: () => { spawned = true; } })
    });
    expect(r.exitCode).toBe(2);
    expect(spawned).toBe(false);
  });

  it('rejects a zero-duration --timeout (exit 2) before spawning', async () => {
    let spawned = false;
    const r = await runCli(['node', 'zcc', 'run', 'api', 'go', '--wait', '--timeout', '0s'], {
      fetchImpl: spawnFetch({ prompt: () => { spawned = true; } })
    });
    expect(r.exitCode).toBe(2);
    expect(spawned).toBe(false);
  });
});

describe('resolvePersona', () => {
  const personas: PersonaSummary[] = [
    { id: 'builtin:reviewer', name: 'Code Reviewer', baseProfile: 'claude' },
    { id: 'builtin:qa-engineer', name: 'QA Engineer', baseProfile: 'claude' },
    { id: 'builtin:architect', name: 'Architect', baseProfile: 'claude' }
  ];

  it('resolves by exact id', () => {
    const r = resolvePersona(personas, 'builtin:reviewer');
    expect(r).toMatchObject({ kind: 'found', persona: { id: 'builtin:reviewer' } });
  });

  it('resolves by exact name', () => {
    const r = resolvePersona(personas, 'Architect');
    expect(r).toMatchObject({ kind: 'found', persona: { id: 'builtin:architect' } });
  });

  it('resolves by unique id-prefix, case-insensitive', () => {
    expect(resolvePersona(personas, 'BUILTIN:REV')).toMatchObject({
      kind: 'found',
      persona: { id: 'builtin:reviewer' }
    });
  });

  it('resolves by unique name-prefix, case-insensitive', () => {
    expect(resolvePersona(personas, 'qa')).toMatchObject({
      kind: 'found',
      persona: { id: 'builtin:qa-engineer' }
    });
  });

  it('returns none for an unknown ref', () => {
    expect(resolvePersona(personas, 'nope')).toEqual({ kind: 'none' });
  });

  it('returns ambiguous with candidates when a prefix matches >1 persona', () => {
    const r = resolvePersona(personas, 'builtin:');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates.length).toBeGreaterThan(1);
  });
});

describe('zcc term reply', () => {
  it('maps to the term.reply op with joined message text', async () => {
    let seen: any = null;
    const dir = boot((req) => {
      if (req.op === 'term.reply') {
        seen = req.args;
        return { ok: true, value: true };
      }
      return { ok: true, value: {} };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'term', 'reply', 'sess-abc', 'also', 'check', 'errors']);
    expect(r.exitCode).toBe(0);
    expect(seen).toEqual({ sessionId: 'sess-abc', text: 'also check errors' });
  });

  it('requires a sessionId and a message (exit 2)', async () => {
    const dir = boot(() => ({ ok: true, value: true }));
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'term', 'reply', 'sess-abc']);
    expect(r.exitCode).toBe(2);
  });
});

describe('zcc run --wait — poll resilience', () => {
  it('tolerates a single dropped poll and still succeeds when the thread goes idle', async () => {
    let polls = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/api/v1/threads') {
        return jsonResponse(201, { thread: { id: 'sess-9', status: 'starting', projectId: 'api' } });
      }
      if (method === 'GET' && url.pathname === '/api/v1/threads/sess-9') {
        polls += 1;
        if (polls === 1) return jsonResponse(500, { message: 'transient' });
        return jsonResponse(200, { thread: { id: 'sess-9', status: 'idle' } });
      }
      return jsonResponse(404, { error: 'unmocked' });
    }) as typeof fetch;
    let now = 0;
    const r = await runCli(['node', 'zcc', 'run', 'api', 'go', '--wait', '--timeout', '30s'], {
      fetchImpl,
      nowMs: () => now,
      sleep: async () => {
        now += 500;
      }
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('idle');
  });
});

describe('zcc agent ls', () => {
  it('routes to the agent.list op and renders a compact table', async () => {
    let seenOp: string | null = null;
    let seenArgs: any = null;
    const dir = boot((req) => {
      if (req.op === 'agent.list') {
        seenOp = req.op;
        seenArgs = req.args;
        return {
          ok: true,
          value: [
            { handle: 'reviewer', state: 'idle', sessionId: 'sess-abc12345', role: 'qa' },
            { handle: 'builder', state: 'working', sessionId: 'sess-def67890', role: 'impl' }
          ]
        };
      }
      return { ok: true, value: [] };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'agent', 'ls']);
    expect(r.exitCode).toBe(0);
    expect(seenOp).toBe('agent.list');
    expect(seenArgs).toEqual({});
    expect(r.stdout).toContain('reviewer\tidle\tsess-abc\tqa');
    expect(r.stdout).toContain('builder\tworking\tsess-def\timpl');
  });

  it('emits full JSON records with --json', async () => {
    const dir = boot((req) =>
      req.op === 'agent.list'
        ? { ok: true, value: [{ handle: 'reviewer', state: 'idle', sessionId: 'sess-abc12345', role: 'qa' }] }
        : { ok: true, value: [] }
    );
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'agent', 'ls', '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toEqual([{ handle: 'reviewer', state: 'idle', sessionId: 'sess-abc12345', role: 'qa' }]);
  });

  it('prints a friendly line when there are no live agents', async () => {
    const dir = boot((req) => (req.op === 'agent.list' ? { ok: true, value: [] } : { ok: true, value: [] }));
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'agent', 'ls']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No live agents.');
  });
});

describe('zcc agent send', () => {
  it('aliases thread tell over HTTP', async () => {
    let seen = '';
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if ((init?.method ?? 'GET').toUpperCase() === 'POST' && url.pathname === '/api/v1/threads/thr-1/send') {
        seen = JSON.parse(String(init?.body)).text;
        return jsonResponse(200, { thread: { id: 'thr-1', status: 'active', projectId: 'p', title: '' } });
      }
      return jsonResponse(404, { error: 'unmocked' });
    }) as typeof fetch;
    const r = await runCli(['node', 'zcc', 'agent', 'send', 'thr-1', 'PR', '#214', 'is', 'ready'], { fetchImpl });
    expect(r.exitCode).toBe(0);
    expect(seen).toBe('PR #214 is ready');
    expect(r.stderr).toMatch(/deprecated/);
  });

  it('requires a handle and a message (exit 2), without dispatching', async () => {
    let dispatched = false;
    const r = await runCli(['node', 'zcc', 'agent', 'send', 'reviewer'], {
      fetchImpl: async () => {
        dispatched = true;
        return jsonResponse(200, {});
      }
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('agent send requires');
    expect(dispatched).toBe(false);
  });
});

describe('runCli — daemon down (no control socket)', () => {
  it('returns exit 1 with a "not running" message for a live command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-down-'));
    dirs.push(dir);
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'agent', 'ls']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not running');
  });

  it('`zcc run` also exits 1 when the app is not running', async () => {
    const r = await runCli(['node', 'zcc', 'run', 'api', 'hi'], {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      }
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not running');
  });
});

describe('zcc team ls', () => {
  it('renders the team catalogue as a compact table', async () => {
    const dir = boot((req) => {
      if (req.op === 'team.list') {
        return {
          ok: true,
          value: [
            { id: 'builtin:review-crew', name: 'Review Crew', slotCount: 3 },
            { id: 'solo', name: 'Solo', slotCount: 1 }
          ]
        };
      }
      return { ok: true, value: [] };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'team', 'ls']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('builtin:review-crew');
    expect(r.stdout).toContain('Review Crew');
    expect(r.stdout).toContain('3 slots');
    expect(r.stdout).toContain('1 slot\n');
  });

  it('emits full JSON records with --json', async () => {
    const dir = boot((req) =>
      req.op === 'team.list'
        ? { ok: true, value: [{ id: 't1', name: 'Team One', description: 'd', slotCount: 2 }] }
        : { ok: true, value: [] }
    );
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'team', 'ls', '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toEqual([{ id: 't1', name: 'Team One', description: 'd', slotCount: 2 }]);
  });

  it('prints a friendly line when there are no teams', async () => {
    const dir = boot((req) => (req.op === 'team.list' ? { ok: true, value: [] } : { ok: true, value: [] }));
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'team', 'ls']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No teams.');
  });
});

describe('zcc term ls', () => {
  it('lists terminals over HTTP and warns about the alias', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.pathname === '/api/v1/terminals') {
        return jsonResponse(200, {
          sessions: [
            { id: 'sess-abc12345', status: 'idle', projectId: 'p', title: 'review' }
          ]
        });
      }
      return jsonResponse(404, { error: 'unmocked' });
    }) as typeof fetch;
    const r = await runCli(['node', 'zcc', 'term', 'ls'], { fetchImpl });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('sess-abc12345');
    expect(r.stderr).toMatch(/deprecated/);
  });

  it('prints a friendly line when there are no live sessions', async () => {
    const fetchImpl = (async () => jsonResponse(200, { sessions: [] })) as typeof fetch;
    const r = await runCli(['node', 'zcc', 'term', 'ls'], { fetchImpl });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No terminals');
  });
});

describe('zcc term close', () => {
  it('closes a terminal over HTTP', async () => {
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if ((init?.method ?? 'GET').toUpperCase() === 'POST' && url.pathname === '/api/v1/terminals/sess-xyz/close') {
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(404, { error: 'unmocked' });
    }) as typeof fetch;
    const r = await runCli(['node', 'zcc', 'term', 'close', 'sess-xyz'], { fetchImpl });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('closed');
  });

  it('requires a <sessionId> (exit 2), without dispatching', async () => {
    let dispatched = false;
    const r = await runCli(['node', 'zcc', 'term', 'close'], {
      fetchImpl: async () => {
        dispatched = true;
        return jsonResponse(200, {});
      }
    });
    expect(r.exitCode).toBe(2);
    expect(dispatched).toBe(false);
  });
});

describe('runCli — control-plane auth forwarding', () => {
  it('forwards the bearer token + nonce from control.token on a live command', async () => {
    let seen: any = null;
    const dir = boot((req) => {
      if (req.op === 'agent.list') {
        seen = req;
        return { ok: true, value: [] };
      }
      return { ok: true, value: [] };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'agent', 'ls']);
    expect(r.exitCode).toBe(0);
    expect(seen.token).toBe('t');
    expect(seen.nonce).toBe('n');
  });
});
