import { describe, it, expect } from 'vitest';
import {
  environmentFor,
  type ExecEnvContext
} from '../execution-environment.js';

const ctx = (over: Partial<ExecEnvContext> = {}): ExecEnvContext => ({
  sessionId: 's1',
  projectId: 'p1',
  cwd: '/tmp/workspace',
  isAvailable: () => true,
  ...over
});

const INNER = { command: '/usr/bin/claude', args: ['--session-id', 'abc', '--foo'] };

describe('environmentFor', () => {
  it('resolves local + sandbox, falls back to local for undefined/unknown', () => {
    expect(environmentFor('local').id).toBe('local');
    expect(environmentFor('sandbox').id).toBe('sandbox');
    expect(environmentFor(undefined).id).toBe('local');
    // @ts-expect-error — exercising the runtime fallback for an unknown id
    expect(environmentFor('bogus').id).toBe('local');
  });
});

describe('local environment — the identity element', () => {
  const local = environmentFor('local');
  it('wraps to the verbatim launch (byte-identical)', () => {
    expect(local.wrap(INNER, ctx())).toEqual(INNER);
  });
  it('rewriteCallbackEnv is identity', () => {
    const env = { ZCC_MCP_URL: 'http://127.0.0.1:5/x', ZCC_HOOK_URL: 'http://127.0.0.1:5/h' };
    expect(local.rewriteCallbackEnv({ ...env }, ctx())).toEqual(env);
  });
  it('claims no isolation', () => {
    expect(local.status(ctx())).toEqual({ isolated: false });
  });
});

describe('sandbox environment — kernel sandbox available', () => {
  const sandbox = environmentFor('sandbox');
  it('wraps into sandbox-exec -p <profile> <command> <args...>', () => {
    const w = sandbox.wrap(INNER, ctx({ isAvailable: () => true }));
    expect(w.command).toBe('sandbox-exec');
    expect(w.args[0]).toBe('-p');
    // profile text is arg[1]; inner command + args follow verbatim (no shell, no re-quoting)
    expect(w.args.slice(2)).toEqual(['/usr/bin/claude', '--session-id', 'abc', '--foo']);
    expect(w.args[1]).toContain('(allow default)');
    expect(w.args[1]).toContain('(deny file-write*)');
  });

  it('confines writes to the cwd and allows network by default (pty agents need the LLM API)', () => {
    const profile = sandbox.wrap(INNER, ctx({ cwd: '/tmp/ws', isAvailable: () => true })).args[1];
    expect(profile).toContain('(allow file-write* (subpath "/tmp/ws"))');
    // allowNetwork defaults ON → no network deny line
    expect(profile).not.toContain('(deny network*)');
  });

  it('allows extra linked-worktree git write roots', () => {
    const profile = sandbox.wrap(INNER, ctx({
      cwd: '/tmp/ws',
      extraWriteRoots: ['/tmp/repo/.git/objects'],
      isAvailable: () => true
    })).args[1];
    expect(profile).toContain('(allow file-write* (subpath "/tmp/repo/.git/objects"))');
  });

  it('denies egress when allowNetwork is false (untrusted work)', () => {
    const profile = sandbox
      .wrap(INNER, ctx({ allowNetwork: false, isAvailable: () => true }))
      .args[1];
    expect(profile).toContain('(deny network*)');
  });

  it('reports isolated:true', () => {
    expect(sandbox.status(ctx({ isAvailable: () => true }))).toEqual({ isolated: true });
  });
});

describe('sandbox environment — kernel unavailable (warn-and-run)', () => {
  const sandbox = environmentFor('sandbox');
  const unavailable = ctx({ isAvailable: () => false });

  it('degrades to the verbatim launch — never blocks a spawn', () => {
    expect(sandbox.wrap(INNER, unavailable)).toEqual(INNER);
  });

  it('status is isolated:false WITH a reason (distinguishes from local no-op)', () => {
    const s = sandbox.status(unavailable);
    expect(s.isolated).toBe(false);
    expect(s.reason).toBeTruthy();
  });
});
