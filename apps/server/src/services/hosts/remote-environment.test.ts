import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import type { HostRpcCommand } from '@zana-ai/zcc-contracts/host-rpc';
import {
  createHostHubRemoteEnvironment,
  createRemoteEnvironmentService,
  nonPrimaryHostCheck,
  parseRemoteEnvironmentNames,
  type RemoteEnvironmentService
} from './remote-environment.js';

const SECRET = 'ghp_super_secret_token_value_123';
const PRIMARY = 'primary-host';
const REMOTE_A = 'remote-a';
const REMOTE_B = 'remote-b';

type Call = { hostId: string; command: Extract<HostRpcCommand, { type: 'host.environment.replace' }>; timeoutMs: number };

function setup(overrides: Partial<Parameters<typeof createRemoteEnvironmentService>[0]> = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const connected = [PRIMARY, REMOTE_A, REMOTE_B];
  const callHost = vi.fn(async (hostId: string, command: HostRpcCommand, timeoutMs: number) => {
    calls.push({ hostId, command: command as Call['command'], timeoutMs });
    return { applied: [] as string[], skipped: [] as string[] };
  });
  const service = createRemoteEnvironmentService({
    connectedHostIds: () => connected,
    isEligibleHost: (hostId) => hostId !== PRIMARY,
    callHost,
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    resolveTimeoutMs: 1_000,
    pushTimeoutMs: 1_000,
    resyncIntervalMs: 60_000,
    ...overrides
  });
  return { service, calls, logs, connected, callHost };
}

const token = (value = SECRET) => [{ name: 'GH_TOKEN', value }];
const allow = ['GH_TOKEN', 'GIT_CONFIG_*', 'GIT_AUTHOR_NAME'];

let active: RemoteEnvironmentService | undefined;
afterEach(() => { active?.dispose(); active = undefined; vi.useRealTimers(); });

describe('parseRemoteEnvironmentNames', () => {
  it('reads exact names and prefix patterns from the manifest extra', () => {
    expect(parseRemoteEnvironmentNames({ remoteEnvironment: ['GH_TOKEN', 'GIT_CONFIG_*'] })).toEqual(['GH_TOKEN', 'GIT_CONFIG_*']);
  });
  it('ignores missing, malformed, forbidden and over-long declarations', () => {
    expect(parseRemoteEnvironmentNames({})).toEqual([]);
    expect(parseRemoteEnvironmentNames({ remoteEnvironment: 'GH_TOKEN' })).toEqual([]);
    expect(parseRemoteEnvironmentNames({ remoteEnvironment: ['PATH', 'LD_*', 'bad name', 7, '', '*', 'GH_TOKEN'] })).toEqual(['GH_TOKEN']);
    expect(parseRemoteEnvironmentNames({ remoteEnvironment: Array.from({ length: 40 }, (_, i) => `NAME_${i}`) })).toHaveLength(32);
  });
});

describe('RemoteEnvironmentService', () => {
  it('pushes plugin environment to every connected non-primary machine and never to the primary', async () => {
    const { service, calls } = setup(); active = service;
    service.register({ pluginId: 'p', allowedNames: allow, resolve: () => token() });
    await service.refresh();
    expect(calls.map((c) => c.hostId).sort()).toEqual([REMOTE_A, REMOTE_B]);
    for (const call of calls) {
      expect(call.command).toEqual({ type: 'host.environment.replace', entries: [{ name: 'GH_TOKEN', value: SECRET }] });
      expect(call.timeoutMs).toBe(1_000);
    }
  });

  it('refuses a registration without a manifest allowlist', () => {
    const { service } = setup(); active = service;
    expect(() => service.register({ pluginId: 'p', allowedNames: [], resolve: () => [] })).toThrow(/remoteEnvironment/);
  });

  it('drops entries the manifest did not allow, forbidden names and malformed entries', async () => {
    const { service, calls } = setup(); active = service;
    service.register({ pluginId: 'p', allowedNames: ['GH_TOKEN', 'GIT_CONFIG_*'], resolve: () => [
      { name: 'GH_TOKEN', value: 'a' },
      { name: 'GIT_CONFIG_COUNT', value: '1', group: 'git' },
      { name: 'NOT_DECLARED', value: 'x' },
      { name: 'PATH', value: '/evil' },
      { name: 'GH_TOKEN2', value: 'x' },
      { name: 'GIT_CONFIG_KEY_0', value: 'a\u0000b' },
      null, 'text', { name: 5, value: 'x' }
    ] });
    await service.refresh();
    expect(calls[0]!.command.entries.map((e) => e.name)).toEqual(['GH_TOKEN', 'GIT_CONFIG_COUNT']);
  });

  it('namespaces groups per plugin and lets the first plugin win a name conflict as a whole group', async () => {
    const { service, calls } = setup(); active = service;
    service.register({ pluginId: 'b-plugin', allowedNames: ['GH_TOKEN', 'GIT_AUTHOR_NAME'], resolve: () => [
      { name: 'GH_TOKEN', value: 'b-token' },
      { name: 'GIT_AUTHOR_NAME', value: 'b', group: 'id' }
    ] });
    service.register({ pluginId: 'a-plugin', allowedNames: ['GH_TOKEN', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL'], resolve: () => [
      { name: 'GH_TOKEN', value: 'a-token' },
      { name: 'GIT_AUTHOR_NAME', value: 'a', group: 'id' },
      { name: 'GIT_AUTHOR_EMAIL', value: 'a@x', group: 'id' }
    ] });
    await service.refresh();
    const latest = () => calls.filter((c) => c.hostId === REMOTE_A).at(-1)?.command.entries ?? [];
    await vi.waitFor(() => expect(latest().find((e) => e.name === 'GH_TOKEN')?.value).toBe('a-token'));
    const entries = latest();
    expect(entries.map((e) => e.group)).toEqual([undefined, 'a-plugin:id', 'a-plugin:id']);
    expect(entries.some((e) => e.value === 'b' || e.value === 'b-token')).toBe(false);
  });

  it('does not re-push an unchanged set but re-pushes after a reconnect', async () => {
    const { service, calls } = setup(); active = service;
    service.register({ pluginId: 'p', allowedNames: allow, resolve: () => token() });
    await service.refresh();
    await service.refresh();
    expect(calls).toHaveLength(2);
    service.hostDisconnected(REMOTE_A);
    service.hostConnected(REMOTE_A);
    await vi.waitFor(() => expect(calls.filter((c) => c.hostId === REMOTE_A)).toHaveLength(2));
  });

  it('pushes the cached set to a newly connected machine without waiting for the plugin to resolve again', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let first = true;
    const { service, calls, connected } = setup(); active = service;
    connected.splice(0, connected.length, PRIMARY);
    service.register({ pluginId: 'p', allowedNames: allow, resolve: async () => {
      if (first) { first = false; return token(); }
      await gate;
      return token();
    } });
    await service.refresh();
    connected.push(REMOTE_A);
    service.hostConnected(REMOTE_A);
    await vi.waitFor(() => expect(calls.map((c) => c.hostId)).toEqual([REMOTE_A]));
    release();
  });

  it('pushes an empty set once to a machine it never delivered to, so a leftover environment is cleared', async () => {
    const { service, calls } = setup(); active = service;
    service.register({ pluginId: 'p', allowedNames: allow, resolve: () => [] });
    await service.refresh();
    await service.refresh();
    expect(calls.map((c) => [c.hostId, c.command.entries.length])).toEqual([[REMOTE_A, 0], [REMOTE_B, 0]]);
  });

  it('gives a machine that connects during a refresh the result of a follow-up run, not the old snapshot', async () => {
    let value = 'old';
    let release!: () => void;
    const { service, calls, connected } = setup(); active = service;
    connected.splice(0, connected.length, PRIMARY, REMOTE_A);
    service.register({ pluginId: 'p', allowedNames: allow, resolve: async () => {
      if (value === 'old') return token('old');
      await new Promise<void>((resolve) => { release = resolve; });
      return token(value);
    } });
    await service.refresh();
    value = 'new';
    const running = service.refresh();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    connected.push(REMOTE_B);
    service.hostConnected(REMOTE_B);
    release();
    await running;
    await vi.waitFor(() => expect(calls.filter((c) => c.hostId === REMOTE_B)).toHaveLength(1));
    expect(calls.find((c) => c.hostId === REMOTE_B)?.command.entries).toEqual(token('new'));
  });

  it('clears a machine when the plugin stops contributing (setting turned off, logout, dispose)', async () => {
    let entries: unknown[] = token();
    const { service, calls } = setup(); active = service;
    const registration = service.register({ pluginId: 'p', allowedNames: allow, resolve: () => entries });
    await service.refresh();
    calls.length = 0;
    entries = [];
    registration.refresh();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.every((c) => c.command.entries.length === 0)).toBe(true);
    calls.length = 0;
    entries = token();
    await service.refresh();
    calls.length = 0;
    registration.dispose();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.every((c) => c.command.entries.length === 0)).toBe(true);
  });

  it('degrades to no forwarding when the plugin throws or never answers, without leaking detail', async () => {
    vi.useFakeTimers();
    const { service, calls, logs } = setup(); active = service;
    service.register({ pluginId: 'bad', allowedNames: allow, resolve: () => { throw new Error(`boom ${SECRET}`); } });
    service.register({ pluginId: 'slow', allowedNames: allow, resolve: () => new Promise(() => {}) });
    const done = service.refresh();
    await vi.advanceTimersByTimeAsync(3_000);
    await done;
    expect(calls.every((c) => c.command.entries.length === 0)).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain(SECRET);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('retries a failed push on the next refresh and logs the failure once without values', async () => {
    const { service, calls, logs, callHost } = setup(); active = service;
    callHost.mockImplementationOnce(async () => { throw new Error(`rpc failed for ${SECRET}`); });
    service.register({ pluginId: 'p', allowedNames: allow, resolve: () => token() });
    await service.refresh();
    expect(logs.join('\n')).not.toContain(SECRET);
    expect(logs.filter((line) => line.includes('failed'))).toHaveLength(1);
    await service.refresh();
    expect(calls.map((c) => c.hostId).sort()).toEqual([REMOTE_A, REMOTE_B]);
  });

  it('logs applied and skipped names only', async () => {
    const { service, logs, callHost } = setup(); active = service;
    callHost.mockResolvedValue({ applied: ['GIT_AUTHOR_NAME'], skipped: ['GH_TOKEN'] });
    service.register({ pluginId: 'p', allowedNames: allow, resolve: () => token() });
    await service.refresh();
    const text = logs.join('\n');
    expect(text).toContain('GH_TOKEN');
    expect(text).not.toContain(SECRET);
  });

  it('coalesces overlapping refreshes into one trailing run', async () => {
    let resolves = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { service } = setup(); active = service;
    service.register({ pluginId: 'p', allowedNames: allow, resolve: async () => { resolves++; await gate; return token(); } });
    const first = service.refresh();
    void service.refresh(); void service.refresh(); void service.refresh();
    release();
    await first;
    await vi.waitFor(() => expect(resolves).toBe(2));
  });

  it('bounds concurrent pushes', async () => {
    let running = 0; let peak = 0;
    const hosts = Array.from({ length: 10 }, (_, i) => `remote-${i}`);
    const { service } = setup({
      connectedHostIds: () => hosts,
      callHost: async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; return { applied: [], skipped: [] }; },
      maxConcurrentPushes: 3
    }); active = service;
    service.register({ pluginId: 'p', allowedNames: allow, resolve: () => token() });
    await service.refresh();
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('re-syncs on a timer while a plugin is registered and stops the timer when none is', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { service, calls } = setup({ resyncIntervalMs: 1_000 }); active = service;
    expect(vi.getTimerCount()).toBe(0);
    const registration = service.register({ pluginId: 'p', allowedNames: allow, resolve: () => token(`tok-${++n}`) });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(calls.some((c) => c.command.entries[0]?.value === 'tok-2')).toBe(true);
    registration.dispose();
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never talks to a machine that is not eligible or not connected', async () => {
    const { service, calls, connected } = setup({ isEligibleHost: (id) => id === REMOTE_A }); active = service;
    connected.splice(0, connected.length, REMOTE_A, REMOTE_B);
    service.register({ pluginId: 'p', allowedNames: allow, resolve: () => token() });
    await service.refresh();
    expect(calls.map((c) => c.hostId)).toEqual([REMOTE_A]);
    service.hostConnected(PRIMARY);
    await Promise.resolve();
    expect(calls).toHaveLength(1);
  });

  it('does not ask plugins to resolve anything while no non-primary machine is connected', async () => {
    const { service, calls, connected } = setup(); active = service;
    connected.splice(0, connected.length, PRIMARY);
    const resolve = vi.fn(() => token());
    service.register({ pluginId: 'p', allowedNames: allow, resolve });
    await service.refresh();
    service.hostConnected(PRIMARY);
    await service.refresh();
    expect(resolve).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    connected.push(REMOTE_A);
    service.hostConnected(REMOTE_A);
    await vi.waitFor(() => expect(calls.map((c) => c.hostId)).toEqual([REMOTE_A]));
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('is inert after dispose', async () => {
    const { service, calls } = setup();
    service.register({ pluginId: 'p', allowedNames: allow, resolve: () => token() });
    service.dispose();
    await service.refresh();
    service.hostConnected(REMOTE_A);
    await Promise.resolve();
    expect(calls).toEqual([]);
    expect(() => service.register({ pluginId: 'p', allowedNames: allow, resolve: () => token() })).toThrow(/disposed/);
  });

  it('keeps forwarded values in memory only', () => {
    const source = readFileSync(fileURLToPath(new URL('./remote-environment.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/from 'node:fs|from "node:fs|require\('fs'\)|writeFile|appendFile|createWriteStream/);
    expect(source).not.toMatch(/console\./);
  });
});

describe('nonPrimaryHostCheck', () => {
  let dir: string;
  let db: ZccDatabase;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'remote-env-')); db = openDatabase(join(dir, 'db.sqlite')); });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('accepts only registered, live, non-primary hosts', () => {
    const primary = upsertHost(db, { name: 'Laptop', hostKeyHash: 'a'.repeat(64) });
    const remote = upsertHost(db, { name: 'Remote', hostKeyHash: 'b'.repeat(64) });
    const gone = upsertHost(db, { name: 'Gone', hostKeyHash: 'c'.repeat(64) });
    db.sqlite.prepare('UPDATE hosts SET destroyed_at = ? WHERE id = ?').run(Date.now(), gone.id);
    const check = nonPrimaryHostCheck(db);
    expect(primary.isPrimary).toBe(true);
    expect(check(primary.id)).toBe(false);
    expect(check(remote.id)).toBe(true);
    expect(check(gone.id)).toBe(false);
    expect(check('unknown')).toBe(false);
  });
});

describe('createHostHubRemoteEnvironment', () => {
  let dir: string;
  let db: ZccDatabase;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'remote-env-hub-')); db = openDatabase(join(dir, 'db.sqlite')); });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('pushes through the hub to connected non-primary machines and logs names only', async () => {
    const primary = upsertHost(db, { name: 'Laptop', hostKeyHash: 'a'.repeat(64) });
    const remote = upsertHost(db, { name: 'Remote', hostKeyHash: 'b'.repeat(64) });
    const callHostOnlineRpc = vi.fn()
      .mockResolvedValueOnce({ applied: ['GH_TOKEN'], skipped: [] })
      .mockRejectedValueOnce(new Error(`upstream said ${SECRET}`));
    const logger = { info: vi.fn(), warn: vi.fn() };
    const service = active = createHostHubRemoteEnvironment(
      { connectedHostIds: () => [primary.id, remote.id], callHostOnlineRpc }, db, logger);
    let value = SECRET;
    service.register({ pluginId: 'p', allowedNames: allow, resolve: () => token(value) });

    await service.refresh();
    expect(callHostOnlineRpc).toHaveBeenCalledExactlyOnceWith({
      hostId: remote.id,
      command: { type: 'host.environment.replace', entries: token() },
      timeoutMs: expect.any(Number)
    });
    expect(logger.info).toHaveBeenCalledWith(`[remote-env] ${remote.id} applied [GH_TOKEN] skipped []`);

    value = `${SECRET}_rotated`;
    // register() already started a run, so this refresh queues one more behind it.
    service.refresh();
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledExactlyOnceWith(`[remote-env] push to ${remote.id} failed (Error); will retry`));
    expect(JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls])).not.toContain(SECRET);
  });
});
