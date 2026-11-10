import { describe, expect, it, vi } from 'vitest';
import {
  createAdmittedTerminalReply,
  createNativeToolPolicyRequiredResolver,
  createToolWindowResolver,
  devProductRoute,
  mainSpawnBindings,
  prefixedWarn,
  providerNativeToolPolicyRequired,
  recordAllowedToolStart,
  releaseRefusedSquadStart,
  replyJobTeamPty,
  resolveLaunchPluginInstructions,
  supervisedChannel,
  supervisedOrDevRoute
} from './host-plugin-gates.js';

describe('channel selection', () => {
  it('supervisedChannel reads the supervisor per call and null means no channel', async () => {
    let sup: { go(r: number): Promise<unknown> } | null = null;
    const channel = supervisedChannel(() => sup, 'go');
    expect(channel()).toBeNull();
    sup = { go: vi.fn(async (r: number) => r * 2) };
    await expect(channel()!(4)).resolves.toBe(8);
  });
  it('devProductRoute offers the route only when ELECTRON_RENDERER_URL is set', () => {
    const route = vi.fn();
    expect(devProductRoute(route, {})()).toBeNull();
    expect(devProductRoute(route, { ELECTRON_RENDERER_URL: 'http://x' })()).toBe(route);
  });
  it('supervisedOrDevRoute prefers the supervisor, then dev route, then nothing', async () => {
    const route = vi.fn(async () => 'dev');
    const env = { ELECTRON_RENDERER_URL: 'http://x' };
    const sup = { go: async (_r?: unknown) => 'sup' };
    await expect(supervisedOrDevRoute(() => sup, 'go', route, env)()!()).resolves.toBe('sup');
    await expect(supervisedOrDevRoute(() => null, 'go', route, env)()!()).resolves.toBe('dev');
    expect(supervisedOrDevRoute(() => null, 'go', route, {})()).toBeNull();
  });
  it('recordAllowedToolStart forwards the invocation id', () => {
    const started = vi.fn();
    recordAllowedToolStart({ started })('inv-1');
    expect(started).toHaveBeenCalledWith('inv-1');
  });
});

describe('createNativeToolPolicyRequiredResolver', () => {
  const make = (source: () => (() => Promise<unknown>) | null) => {
    const log = vi.fn();
    return { log, resolve: createNativeToolPolicyRequiredResolver({ source, log }) };
  };
  it('is not required when the inventory lists no required plugin', async () => {
    await expect(make(() => async () => ({ ready: false, required: [] })).resolve()).resolves.toBe(false);
  });
  it('is required when a plugin owns tool policy', async () => {
    await expect(make(() => async () => ({ required: ['p'] })).resolve()).resolves.toBe(true);
  });
  it('fails closed with no source or a torn inventory', async () => {
    await expect(make(() => null).resolve()).resolves.toBe(true);
    await expect(make(() => async () => ({ required: 'x' })).resolve()).resolves.toBe(true);
  });
  it('fails closed and logs when the read throws', async () => {
    const { resolve, log } = make(() => async () => { throw new Error('boom'); });
    await expect(resolve()).resolves.toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('failing closed: Error: boom'));
  });
});

describe('prefixedWarn', () => {
  it('warns with the bracketed tag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    prefixedWarn('pty-x')('hello');
    expect(warn).toHaveBeenCalledWith('[pty-x] hello');
    warn.mockRestore();
  });
});

describe('spawn helpers', () => {
  it('providerNativeToolPolicyRequired exempts shells and defaults providers to required', () => {
    expect(providerNativeToolPolicyRequired('shell', true)).toBe(false);
    expect(providerNativeToolPolicyRequired('claude', undefined)).toBe(true);
    expect(providerNativeToolPolicyRequired('claude', false)).toBe(false);
  });
  it('mainSpawnBindings carries only non-empty values', () => {
    expect(mainSpawnBindings(undefined)).toEqual({});
    expect(mainSpawnBindings({ threadId: '', pluginInstructions: '' })).toEqual({});
    expect(mainSpawnBindings({ threadId: 't', pluginInstructions: 'i' })).toEqual({ threadId: 't', pluginInstructions: 'i' });
  });
  it('resolveLaunchPluginInstructions skips shells, omits empty results and an absent thread', async () => {
    const resolve = vi.fn(async () => 'be careful');
    await expect(resolveLaunchPluginInstructions(resolve, { sessionId: 's', projectId: 'p', profile: 'shell' })).resolves.toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
    await expect(resolveLaunchPluginInstructions(resolve, { sessionId: 's', projectId: 'p', profile: 'claude' })).resolves.toBe('be careful');
    expect(resolve).toHaveBeenLastCalledWith({ sessionId: 's', projectId: 'p', profile: 'claude' });
    await resolveLaunchPluginInstructions(resolve, { sessionId: 's', threadId: 't', projectId: 'p', profile: 'claude' });
    expect(resolve).toHaveBeenLastCalledWith({ sessionId: 's', threadId: 't', projectId: 'p', profile: 'claude' });
    await expect(resolveLaunchPluginInstructions(async () => '', { sessionId: 's', projectId: 'p', profile: 'claude' })).resolves.toBeUndefined();
  });
});

describe('dispatch admission replies', () => {
  const refusal = { code: 'DISPATCH_REJECTED' as const, message: 'no' };
  it('replyJobTeamPty admits then replies, and does not deliver a refused dispatch', async () => {
    const reply = vi.fn(() => true);
    const admit = vi.fn(async () => null);
    await expect(replyJobTeamPty({ admit, reply }, { id: 's', projectId: 'p' }, 'hi')).resolves.toBe(true);
    expect(admit).toHaveBeenCalledWith({ sessionId: 's', projectId: 'p', entry: 'job-team-dispatch', origin: 'system', promptText: 'hi' });
    reply.mockClear();
    await expect(replyJobTeamPty({ admit: async () => refusal, reply }, { id: 's', projectId: 'p' }, 'hi')).resolves.toBe(false);
    expect(reply).not.toHaveBeenCalled();
  });
  it('createAdmittedTerminalReply passes unknown sessions through and admits known ones', async () => {
    const reply = vi.fn(() => true);
    const admit = vi.fn(async () => null as typeof refusal | null);
    const send = createAdmittedTerminalReply({ getSession: (id) => (id === 'live' ? { projectId: 'p' } : null), admit, reply });
    await expect(send('gone', 'x')).resolves.toBe(true);
    expect(admit).not.toHaveBeenCalled();
    await expect(send('live', 'x', 'orchestrator')).resolves.toBe(true);
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'live', projectId: 'p', entry: 'reply', promptText: 'x' }));
    admit.mockResolvedValueOnce(refusal);
    reply.mockClear();
    await expect(send('live', 'x')).resolves.toEqual({ refused: refusal });
    expect(reply).not.toHaveBeenCalled();
  });
});

describe('releaseRefusedSquadStart', () => {
  const slot = { recordId: 'r', slotId: 'sl', generation: 2, threadId: 't' };
  it('releases the reserved slot as terminal', async () => {
    const reconcile = vi.fn(async () => undefined);
    const markUncertain = vi.fn();
    await releaseRefusedSquadStart({ integration: { reconcileModernWorkers: reconcile }, lifecycle: { markModernWorkerUncertain: markUncertain }, logError: vi.fn() }, slot);
    expect(reconcile).toHaveBeenCalledWith([{ ...slot, state: 'terminal' }]);
    expect(markUncertain).not.toHaveBeenCalled();
  });
  it('logs and marks the slot uncertain when the release fails', async () => {
    const err = new Error('db');
    const logError = vi.fn();
    const markUncertain = vi.fn(async () => undefined);
    await releaseRefusedSquadStart({ integration: { reconcileModernWorkers: async () => { throw err; } }, lifecycle: { markModernWorkerUncertain: markUncertain }, logError }, slot);
    expect(logError).toHaveBeenCalledWith('squad start refusal release failed (thread t)', err);
    expect(markUncertain).toHaveBeenCalledWith('r', 'sl', 2, 't');
  });
});

describe('createToolWindowResolver', () => {
  type Win = { id: string; isDestroyed(): boolean };
  const win = (id: string, destroyed = false): Win => ({ id, isDestroyed: () => destroyed });
  const main = win('main');
  const thread = { id: 't1', projectId: 'p1', hostId: 'h1', visibility: 'visible', archivedAt: null };
  function make(over: Partial<Parameters<typeof createToolWindowResolver<Win>>[0]> = {}, body: unknown = { thread }, ok = true) {
    const fetchImpl = vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
    const resolve = createToolWindowResolver<Win>({
      productServerUrl: () => 'http://127.0.0.1:9000/',
      store: { listProjects: () => [{ id: 'p1' }] },
      localHostId: () => 'h1',
      windows: { values: () => [] },
      mainWindow: () => main,
      fetchImpl,
      ...over
    });
    return { resolve, fetchImpl };
  }
  it('refuses a non-loopback product server without fetching', async () => {
    const { resolve, fetchImpl } = make({ productServerUrl: () => 'http://evil.example/' });
    await expect(resolve('t1', 'p1')).resolves.toBeNull();
    const ftp = make({ productServerUrl: () => 'ftp://127.0.0.1/' });
    await expect(ftp.resolve('t1', 'p1')).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    ['no local host id', { localHostId: () => null }],
    ['unknown project', { store: { listProjects: () => [] } }],
    ['remote project', { store: { listProjects: () => [{ id: 'p1', remote: {} }] } }],
    ['project on another host', { store: { listProjects: () => [{ id: 'p1', hostId: 'other' }] } }]
  ])('refuses %s without fetching', async (_name, over) => {
    const { resolve, fetchImpl } = make(over);
    await expect(resolve('t1', 'p1')).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('refuses when the thread lookup fails or the thread does not match', async () => {
    await expect(make({}, { thread }, false).resolve('t1', 'p1')).resolves.toBeNull();
    await expect(make({}, {}).resolve('t1', 'p1')).resolves.toBeNull();
    for (const patch of [{ id: 'x' }, { projectId: 'x' }, { hostId: 'x' }, { visibility: 'hidden' }, { archivedAt: 5 }]) {
      await expect(make({}, { thread: { ...thread, ...patch } }).resolve('t1', 'p1')).resolves.toBeNull();
    }
  });
  it('requests the encoded thread id with redirects refused', async () => {
    const { resolve, fetchImpl } = make();
    await resolve('t 1', 'p1').catch(() => null);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:9000/api/v1/threads/t%201');
    expect(init.redirect).toBe('error');
  });
  it('prefers a live window scoped to the thread or project, else the main window', async () => {
    const scoped = win('scoped');
    const dead = win('dead', true);
    const windows = () => [
      { win: dead, projectId: 'p1' },
      { win: win('other'), projectId: 'zzz' },
      { win: scoped, projectId: 'zzz', threadView: { threadId: 't1' } }
    ];
    await expect(make({ windows: { values: windows } }).resolve('t1', 'p1')).resolves.toBe(scoped);
    await expect(make({ windows: { values: () => [{ win: dead, projectId: 'p1' }] } }).resolve('t1', 'p1')).resolves.toBe(main);
    const byProject = win('byProject');
    await expect(make({ windows: { values: () => [{ win: byProject, projectId: 'p1' }] } }).resolve('t1', 'p1')).resolves.toBe(byProject);
  });
});
