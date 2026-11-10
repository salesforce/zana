import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

interface SpawnCall { command: string; args: string[]; env: Record<string, string> }
const spawns: SpawnCall[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[], opts: { env?: Record<string, string> }) => {
    spawns.push({ command, args, env: opts?.env ?? {} });
    return { pid: 5000 + spawns.length, write() {}, onData() {}, onExit() {}, resize() {}, kill() {} };
  }
}));
vi.mock('../tmux.js', () => ({
  isTmuxAvailable: () => false,
  buildLocalTmuxCommand: (_id: string, command: string, args: string[]) => ({ command, args }),
  wrapRemoteTmux: (_id: string, quoted: string) => quoted,
  tmuxSessionName: (sessionId: string) => `cc-${sessionId}`
}));
vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`,
  alwaysOnPluginMcpAllowlist: () => [], sessionPluginMcpServers: () => []
}));

import { PtyManager } from '../pty.js';
import { clearInheritedSessionIdentity, sessionIdentityEnv } from '../session-identity-env.js';

const CONFIG: AppConfig = { version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };
const base = { nativeToolPolicyRequired: false, projectId: 'proj-1', profile: 'shell' as const, cwd: '/tmp/work', cols: 80, rows: 24, config: CONFIG };
const AMBIENT = ['ZCC_PROJECT_ID', 'ZCC_THREAD_ID'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  spawns.length = 0;
  for (const key of AMBIENT) { saved[key] = process.env[key]; delete process.env[key]; }
});
afterEach(() => {
  for (const key of AMBIENT) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});

describe('sessionIdentityEnv', () => {
  it('always carries the project and carries the thread only when bound', () => {
    expect(sessionIdentityEnv({ projectId: 'p' })).toEqual({ ZCC_PROJECT_ID: 'p' });
    expect(sessionIdentityEnv({ projectId: 'p', threadId: 't' })).toEqual({ ZCC_PROJECT_ID: 'p', ZCC_THREAD_ID: 't' });
    expect(sessionIdentityEnv({ projectId: 'p', threadId: '' })).toEqual({ ZCC_PROJECT_ID: 'p' });
  });
  it('clears inherited identity', () => {
    const env: Record<string, string> = { ZCC_PROJECT_ID: 'x', ZCC_THREAD_ID: 'y', KEEP: '1' };
    clearInheritedSessionIdentity(env);
    expect(env).toEqual({ KEEP: '1' });
  });
});

describe('PTY session identity env', () => {
  it('local spawn: project always, thread when main bound one, record carries the binding', () => {
    const mgr = new PtyManager();
    const bound = mgr.create({ ...base, threadId: 'thread-1' });
    expect(spawns.at(-1)!.env).toMatchObject({ ZCC_SESSION_ID: bound.id, ZCC_PROJECT_ID: 'proj-1', ZCC_THREAD_ID: 'thread-1' });
    expect(bound.threadId).toBe('thread-1');
    const unbound = mgr.create(base);
    expect(spawns.at(-1)!.env.ZCC_PROJECT_ID).toBe('proj-1');
    expect(spawns.at(-1)!.env).not.toHaveProperty('ZCC_THREAD_ID');
    expect(unbound).not.toHaveProperty('threadId');
  });

  it('local spawn never inherits another session\'s ambient identity', () => {
    process.env.ZCC_PROJECT_ID = 'parent-project';
    process.env.ZCC_THREAD_ID = 'parent-thread';
    new PtyManager().create(base);
    const env = spawns.at(-1)!.env;
    expect(env.ZCC_PROJECT_ID).toBe('proj-1');
    expect(env).not.toHaveProperty('ZCC_THREAD_ID');
  });

  it('remote spawn: same hints on the local ssh process, never forwarded in the remote command', () => {
    const mgr = new PtyManager();
    process.env.ZCC_THREAD_ID = 'parent-thread';
    const bound = mgr.createRemote({ ...base, threadId: 'thread-1', remote: { host: 'box', path: '/srv' } });
    const call = spawns.at(-1)!;
    expect(call.command).toBe('ssh');
    expect(call.env).toMatchObject({ ZCC_SESSION_ID: bound.id, ZCC_PROJECT_ID: 'proj-1', ZCC_THREAD_ID: 'thread-1' });
    expect(bound.threadId).toBe('thread-1');
    const remoteCommand = call.args.at(-1)!;
    expect(remoteCommand).not.toContain('ZCC_SESSION_TOKEN');
    expect(remoteCommand).not.toContain('ZCC_THREAD_ID');
    mgr.createRemote({ ...base, remote: { host: 'box', path: '/srv' } });
    expect(spawns.at(-1)!.env).not.toHaveProperty('ZCC_THREAD_ID');
  });
});
