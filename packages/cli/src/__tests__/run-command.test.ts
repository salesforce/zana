/**
 * Tests for `zcc run` — the flag/prompt disambiguation and the --wait poll
 * behavior that the review flagged as untested: the `--` sentinel, --detach,
 * ambiguous project resolution, and that a single dropped poll does NOT abort
 * the wait into a false 124.
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

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Boot a fake control plane that responds to each op via the supplied handler,
 * write a projects.json fixture + a token file, and return the data dir. The
 * handler sees the parsed request and returns the `{ok,...}` response object.
 */
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
  // listen synchronously enough for the test; runCli connects after.
  server.listen(socketPath);
  return dir;
}

/** Wait for the server to be listening before invoking runCli. */
function ready(): Promise<void> {
  return new Promise((r) => (server!.listening ? r() : server!.once('listening', () => r())));
}

describe('zcc run — flag/prompt disambiguation', () => {
  it('keeps flag-like tokens after `--` as literal prompt text', async () => {
    let seenPrompt = '';
    const dir = boot((req) => {
      if (req.op === 'term.create') {
        seenPrompt = req.args.prompt;
        return { ok: true, value: { id: 'sess-1' } };
      }
      return { ok: true, value: {} };
    });
    await ready();
    // --data-dir is a GLOBAL flag and must sit BEFORE the `--` sentinel; the
    // tail after `--` is the literal prompt and is never scanned for flags.
    const r = await runCli(
      ['node', 'zcc', '--data-dir', dir, 'run', 'api', '--', 'review', 'the', '--wait', 'handler']
    );
    // The prompt is everything after `--`; --wait inside it is NOT a flag.
    expect(seenPrompt).toBe('review the --wait handler');
    expect(r.exitCode).toBe(0); // detach default → returns the session id
    expect(r.stdout.trim()).toBe('sess-1');
  });

  it('keeps a literal `--json` in the `--` tail and does NOT enable json output', async () => {
    let seenPrompt = '';
    const dir = boot((req) => {
      if (req.op === 'term.create') {
        seenPrompt = req.args.prompt;
        return { ok: true, value: { id: 'sess-2' } };
      }
      return { ok: true, value: {} };
    });
    await ready();
    const r = await runCli(
      ['node', 'zcc', '--data-dir', dir, 'run', 'api', '--', 'explain', 'the', '--json', 'output']
    );
    // `--json` after `--` stays in the prompt verbatim...
    expect(seenPrompt).toBe('explain the --json output');
    // ...and does NOT flip on JSON output (plain session-id line, not JSON).
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('sess-2');
  });

  it('keeps a literal `--data-dir X` in the `--` tail without repointing the data dir', async () => {
    let seenPrompt = '';
    const dir = boot((req) => {
      if (req.op === 'term.create') {
        seenPrompt = req.args.prompt;
        return { ok: true, value: { id: 'sess-3' } };
      }
      return { ok: true, value: {} };
    });
    await ready();
    // The real --data-dir is before `--`; the one after `--` is prompt text.
    // If the trailing --data-dir leaked to the global parser, the CLI would
    // point at /tmp/elsewhere (no control plane) and fail — so a clean spawn
    // proves the data dir was NOT repointed.
    const r = await runCli(
      ['node', 'zcc', '--data-dir', dir, 'run', 'api', '--', 'use', '--data-dir', '/tmp/elsewhere']
    );
    expect(seenPrompt).toBe('use --data-dir /tmp/elsewhere');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('sess-3');
  });

  it('--wait and --detach together is a usage error (exit 2)', async () => {
    const dir = boot(() => ({ ok: true, value: { id: 's' } }));
    await ready();
    const r = await runCli(['node', 'zcc', 'run', 'api', 'do it', '--wait', '--detach', '--data-dir', dir]);
    expect(r.exitCode).toBe(2);
  });

  it('rejects an invalid --timeout (exit 2) before spawning', async () => {
    let spawned = false;
    const dir = boot((req) => {
      if (req.op === 'term.create') spawned = true;
      return { ok: true, value: { id: 's' } };
    });
    await ready();
    const r = await runCli(['node', 'zcc', 'run', 'api', 'go', '--wait', '--timeout', 'soon', '--data-dir', dir]);
    expect(r.exitCode).toBe(2);
    expect(spawned).toBe(false);
  });

  it('treats an empty --profile= as absent and falls back to claude', async () => {
    let seenProfile: unknown = 'unset';
    let seenPersona: unknown = 'unset';
    const dir = boot((req) => {
      if (req.op === 'term.create') {
        seenProfile = req.args.profile;
        seenPersona = req.args.personaId;
        return { ok: true, value: { id: 'sess-p' } };
      }
      return { ok: true, value: {} };
    });
    await ready();
    const r = await runCli(
      ['node', 'zcc', '--data-dir', dir, 'run', 'api', 'go', '--profile=', '--persona=']
    );
    expect(r.exitCode).toBe(0);
    // Empty profile → default 'claude'; empty persona → undefined (not '').
    expect(seenProfile).toBe('claude');
    expect(seenPersona).toBeUndefined();
  });

  it('rejects a zero-duration --timeout (exit 2) before spawning', async () => {
    let spawned = false;
    const dir = boot((req) => {
      if (req.op === 'term.create') spawned = true;
      return { ok: true, value: { id: 's' } };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'run', 'api', 'go', '--wait', '--timeout', '0s']);
    expect(r.exitCode).toBe(2);
    expect(spawned).toBe(false);
  });

  it('reports an ambiguous project prefix with candidates (exit 3)', async () => {
    const dir = boot(() => ({ ok: true, value: { id: 's' } }));
    await ready();
    // "ap" is a prefix of both "api" and "apex".
    const r = await runCli(['node', 'zcc', 'run', 'ap', 'hello', '--data-dir', dir]);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('ambiguous');
    expect(r.stderr).toContain('api');
    expect(r.stderr).toContain('apex');
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

describe('zcc run — persona resolution', () => {
  it('resolves --persona by name to its id before term.create', async () => {
    let seenPersonaId: unknown = 'unset';
    const dir = boot((req) => {
      if (req.op === 'persona.list') {
        return {
          ok: true,
          value: [{ id: 'builtin:reviewer', name: 'Code Reviewer', baseProfile: 'claude' }]
        };
      }
      if (req.op === 'term.create') {
        seenPersonaId = req.args.personaId;
        return { ok: true, value: { id: 'sess-r' } };
      }
      return { ok: true, value: {} };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'run', 'api', 'go', '--persona', 'Code Reviewer']);
    expect(r.exitCode).toBe(0);
    expect(seenPersonaId).toBe('builtin:reviewer');
  });

  it('fails with exit 3 when --persona does not resolve, without spawning', async () => {
    let spawned = false;
    const dir = boot((req) => {
      if (req.op === 'persona.list') return { ok: true, value: [] };
      if (req.op === 'term.create') spawned = true;
      return { ok: true, value: { id: 's' } };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'run', 'api', 'go', '--persona', 'ghost']);
    expect(r.exitCode).toBe(3);
    expect(spawned).toBe(false);
  });

  it('does NOT query persona.list when no --persona is given', async () => {
    let askedPersonas = false;
    const dir = boot((req) => {
      if (req.op === 'persona.list') askedPersonas = true;
      if (req.op === 'term.create') return { ok: true, value: { id: 'sess-np' } };
      return { ok: true, value: {} };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'run', 'api', 'go']);
    expect(r.exitCode).toBe(0);
    expect(askedPersonas).toBe(false);
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
  it('tolerates a single dropped poll and still succeeds when the agent goes idle', async () => {
    // call 0 = term.create; call 1 = session.status (fail); call 2 = idle.
    const dir = boot((req, n) => {
      if (req.op === 'term.create') return { ok: true, value: { id: 'sess-9' } };
      if (n === 1) return { ok: false, code: 'INTERNAL', message: 'transient' };
      return { ok: true, value: { state: 'idle' } };
    });
    await ready();
    const r = await runCli(['node', 'zcc', 'run', 'api', 'go', '--wait', '--timeout', '30s', '--data-dir', dir]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('idle');
  }, 15_000);

  it('gives up with a non-124 error after sustained poll failures', async () => {
    const dir = boot((req) => {
      if (req.op === 'term.create') return { ok: true, value: { id: 'sess-x' } };
      return { ok: false, code: 'INTERNAL', message: 'app wedged' };
    });
    await ready();
    const r = await runCli(['node', 'zcc', 'run', 'api', 'go', '--wait', '--timeout', '60s', '--data-dir', dir]);
    // Sustained failure → exit 1 (lost contact), NOT 124 (which means "still working").
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('lost contact');
  }, 20_000);
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
    // Dispatched to the agent.list op with no args…
    expect(seenOp).toBe('agent.list');
    expect(seenArgs).toEqual({});
    // …and rendered as tab-separated rows (sessionId truncated to 8 chars).
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
  it('routes to the agent.send op forwarding { to, message } with the message joined', async () => {
    let seen: any = null;
    const dir = boot((req) => {
      if (req.op === 'agent.send') {
        seen = req.args;
        return { ok: true, value: { delivered: true, handle: 'reviewer', id: 'msg-1' } };
      }
      return { ok: true, value: {} };
    });
    await ready();
    const r = await runCli(
      ['node', 'zcc', '--data-dir', dir, 'agent', 'send', 'reviewer', 'PR', '#214', 'is', 'ready']
    );
    expect(r.exitCode).toBe(0);
    // Handle is the first positional; the rest is joined into one message.
    expect(seen).toEqual({ to: 'reviewer', message: 'PR #214 is ready' });
    expect(r.stdout).toContain('Delivered to @reviewer');
  });

  it('requires a handle and a message (exit 2), without dispatching', async () => {
    let dispatched = false;
    const dir = boot((req) => {
      if (req.op === 'agent.send') dispatched = true;
      return { ok: true, value: {} };
    });
    await ready();
    // Missing the message entirely.
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'agent', 'send', 'reviewer']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('agent send requires <handle> and a message');
    expect(dispatched).toBe(false);
  });

  it('is a usage error (exit 2) when even the handle is missing', async () => {
    const dir = boot(() => ({ ok: true, value: {} }));
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'agent', 'send']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('agent send requires <handle> and a message');
  });
});

describe('runCli — daemon down (no control socket)', () => {
  it('returns exit 1 with a "not running" message for a live command', async () => {
    // A data dir with NO control.token / socket — the app is not running.
    const dir = mkdtempSync(join(tmpdir(), 'zcc-down-'));
    dirs.push(dir);
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'agent', 'ls']);
    // live() → callControlPlane → APP_NOT_RUNNING → exitCodeForControl → 1.
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not running');
  });

  it('`zcc run` also exits 1 when the app is not running (its own guard)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-down-'));
    dirs.push(dir);
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'run', 'api', 'hi']);
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
    // Singular slot label for a one-slot team.
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
  it('routes to the term.list op with empty args and renders a compact table', async () => {
    let seenOp: string | null = null;
    let seenArgs: any = null;
    const dir = boot((req) => {
      if (req.op === 'term.list') {
        seenOp = req.op;
        seenArgs = req.args;
        return {
          ok: true,
          value: [
            { id: 'sess-abc12345', profile: 'claude', status: 'idle', title: 'review' },
            { id: 'sess-def67890', profile: 'shell', status: 'working', title: 'build' }
          ]
        };
      }
      return { ok: true, value: [] };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'term', 'ls']);
    expect(r.exitCode).toBe(0);
    // Dispatched to term.list with no project filter → empty args…
    expect(seenOp).toBe('term.list');
    expect(seenArgs).toEqual({});
    // …and rendered as tab-separated rows (id truncated to 8 chars).
    expect(r.stdout).toContain('sess-abc\tclaude\tidle\treview');
    expect(r.stdout).toContain('sess-def\tshell\tworking\tbuild');
  });

  it('forwards --project to term.list as { projectId }', async () => {
    let seenArgs: any = null;
    const dir = boot((req) => {
      if (req.op === 'term.list') {
        seenArgs = req.args;
        return { ok: true, value: [] };
      }
      return { ok: true, value: [] };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'term', 'ls', '--project', 'p-api']);
    expect(r.exitCode).toBe(0);
    expect(seenArgs).toEqual({ projectId: 'p-api' });
  });

  it('emits full JSON records with --json', async () => {
    const rows = [{ id: 'sess-abc12345', profile: 'claude', status: 'idle', title: 'review' }];
    const dir = boot((req) => (req.op === 'term.list' ? { ok: true, value: rows } : { ok: true, value: [] }));
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'term', 'ls', '--json']);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(rows);
  });

  it('prints a friendly line when there are no live sessions', async () => {
    const dir = boot((req) => (req.op === 'term.list' ? { ok: true, value: [] } : { ok: true, value: [] }));
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'term', 'ls']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No live sessions.');
  });
});

describe('zcc term close', () => {
  it('routes to the term.close op forwarding { sessionId }', async () => {
    let seenOp: string | null = null;
    let seenArgs: any = null;
    const dir = boot((req) => {
      if (req.op === 'term.close') {
        seenOp = req.op;
        seenArgs = req.args;
        return { ok: true, value: true };
      }
      return { ok: true, value: {} };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'term', 'close', 'sess-xyz']);
    expect(r.exitCode).toBe(0);
    expect(seenOp).toBe('term.close');
    expect(seenArgs).toEqual({ sessionId: 'sess-xyz' });
    expect(r.stdout).toContain('Closed.');
  });

  it('requires a <sessionId> (exit 2), without dispatching', async () => {
    let dispatched = false;
    const dir = boot((req) => {
      if (req.op === 'term.close') dispatched = true;
      return { ok: true, value: true };
    });
    await ready();
    const r = await runCli(['node', 'zcc', '--data-dir', dir, 'term', 'close']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('term close requires a <sessionId>');
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
    // boot() writes control.token = { token: 't', nonce: 'n', socket } — the
    // client must forward those verbatim so the app authorizes the caller.
    expect(seen.token).toBe('t');
    expect(seen.nonce).toBe('n');
  });
});
