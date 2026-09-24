import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { adaptPluginApi, defineRpcContract, normalizeThread } from './server';

describe('BB Tasks host adapter', () => {
  it('validates RPC defaults and failures at the Zana boundary', async () => {
    const { zcc, harness } = createFakePluginHost(); const api = adaptPluginApi(zcc);
    expect(adaptPluginApi(api as unknown as typeof zcc)).toBe(api);
    const contract = defineRpcContract({ echo: { input: z.object({ title: z.string().default('default') }), output: z.string() } });
    api.rpc.register(contract, { echo: input => (input as { title: string }).title });
    await expect(harness.callRpc('echo', {})).resolves.toBe('default');
    await expect(harness.callRpc('echo', { title: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    api.rpc.register(contract, { echo: () => { throw new Error('failure'); } });
    await expect(harness.callRpc('echo', {})).rejects.toMatchObject({ code: 'handler_error', message: 'failure' });
    api.rpc.register(contract, { echo: () => 1 });
    await expect(harness.callRpc('echo', {})).rejects.toThrow();
    await harness.dispose();
  });

  it('maps managed worktrees, default projects, service tiers and steering', async () => {
    const spawnThread = vi.fn(async () => ({ id: 'worker' })); const sendThread = vi.fn(async () => ({}));
    const { zcc, harness } = createFakePluginHost({ spawnThread, sendThread }); const api = adaptPluginApi(zcc);
    const base = { projectId: 'project', prompt: 'work', providerId: 'provider', model: 'model', serviceTier: 'fast' as const };
    await api.sdk.threads.spawn({ ...base, environment: { type: 'project-default' } });
    await api.sdk.threads.spawn({ ...base, environment: { type: 'host', hostId: 'host', workspace: { type: 'managed-worktree', baseBranch: { kind: 'named', name: 'main' } } } });
    await api.sdk.threads.spawn({ ...base, environment: { type: 'host', hostId: 'host', workspace: { type: 'managed-worktree', baseBranch: { kind: 'default' } } } });
    expect(spawnThread.mock.calls).toEqual([[base], [{ ...base, hostId: 'host', environment: { kind: 'worktree', baseBranch: 'main' } }], [{ ...base, hostId: 'host', environment: { kind: 'worktree' } }]]);
    await api.sdk.threads.send({ threadId: 'thread', mode: 'steer-if-active', input: [{ type: 'text', text: 'one', mentions: [] }, { type: 'text', text: 'two', mentions: [] }] });
    expect(sendThread.mock.calls[0]).toEqual([{ threadId: 'thread', mode: 'steer-if-active', prompt: 'one\ntwo' }]);
    await harness.dispose();
  });

  it('preserves binary bodies, headers and query parameters in both directions', async () => {
    const { zcc, harness } = createFakePluginHost(); const api = adaptPluginApi(zcc);
    const bytes = Uint8Array.from({ length: 27000 }, (_, i) => i % 251);
    api.http.route('POST', '/upload', async ctx => {
      expect(ctx.req.query()).toEqual({ name: 'file' }); expect(ctx.req.query('name')).toBe('file');
      expect(ctx.req.header('content-type')).toBe('application/octet-stream'); expect(ctx.req.header('missing')).toBeUndefined();
      expect(new Uint8Array(await ctx.req.raw.arrayBuffer())).toEqual(bytes);
      return new Response(bytes, { status: 201, headers: { 'content-type': 'application/octet-stream' } });
    });
    const result = await harness.httpRoutes[0]!.handler({ query: { name: 'file' }, headers: { 'content-type': 'application/octet-stream' }, rawBody: bytes, body: undefined });
    expect(result).toMatchObject({ status: 201, body: bytes });
    api.http.route('GET', '/status', ctx => ctx.json({ ok: true }));
    const status = await harness.httpRoutes[1]!.handler({ query: {}, body: undefined });
    expect(JSON.parse(new TextDecoder().decode(status.body as Uint8Array))).toEqual({ ok: true });
    await harness.dispose();
  });

  it('normalizes threads and routes lifecycle updates without inventing completion', async () => {
    const { zcc, harness } = createFakePluginHost(); const api = adaptPluginApi(zcc);
    const row = { id: 'thread', projectId: 'project', status: 'idle', createdAt: 123 };
    harness.sdk.stub('threads.get', () => row);
    const archived = { ...row, id: 'archived', archivedAt: 12, title: 'Thread archive' };
    const search = vi.fn((args: { archived?: boolean }) => args.archived === undefined ? [row, archived] : args.archived ? [archived] : [row]);
    harness.sdk.stub('threads.search', search);
    expect(await api.sdk.threads.get({ threadId: 'thread' })).toMatchObject({ status: 'idle', updatedAt: 123, title: null });
    expect(await api.sdk.threads.list()).toHaveLength(2);
    const found = await api.sdk.threads.search({ query: 'THREAD', limitPerGroup: '3' });
    expect(found.active.results).toHaveLength(1); expect(found.archived.results).toHaveLength(1);
    expect(search.mock.calls).toEqual([[{ query: '', limit: undefined }], [{ query: 'THREAD', archived: false, limit: 3 }], [{ query: 'THREAD', archived: true, limit: 3 }]]);
    const listener = vi.fn(); api.events.on('thread.idle', listener);
    await harness.events[0]!.handler({ name: 'thread.idle', threadId: 'thread' });
    expect(listener).toHaveBeenCalledWith({ thread: expect.objectContaining({ status: 'idle' }) });
    harness.sdk.stub('threads.get', () => null);
    await harness.events[0]!.handler({ name: 'thread.idle', threadId: 'missing' });
    expect(listener).toHaveBeenCalledTimes(1);
    await expect(api.sdk.threads.get({ threadId: 'missing' })).rejects.toMatchObject({ code: 'thread_not_found' });
    expect(normalizeThread({ ...row, status: 'unknown' })).toMatchObject({ status: 'error' });
    await harness.dispose();
  });

  it('maps provider capabilities, project hosts, PR outcomes and mentions', async () => {
    const listProviders = vi.fn(); const listProjects = vi.fn(async () => []);
    const { zcc, harness } = createFakePluginHost({ listProviders, listProjects }); const api = adaptPluginApi(zcc);
    expect(await api.sdk.system.config()).toEqual({ primaryHostId: null });
    harness.sdk.stub('system.defaultHost', () => ({ id: 'host' }));
    expect(await api.sdk.system.config()).toEqual({ primaryHostId: 'host' });
    listProviders.mockResolvedValue([{ id: 'plain' }, { id: 'full', displayName: 'Full', logoUrl: '/logo', icon: 'Code', strings: { iconTint: 'red' } }]);
    expect(await api.sdk.providers.list()).toMatchObject([{ displayName: 'plain', icon: null }, { displayName: 'Full', icon: { glyph: 'Code' }, strings: { iconTint: { light: 'red', dark: 'red' } } }]);
    await api.sdk.projects.list({ includePersonal: true });
    expect(listProjects).toHaveBeenCalledOnce();
    for (const [result, expected] of [[{ unavailableReason: 'offline' }, { outcome: 'unavailable' }], [{ pullRequest: null }, { outcome: 'absent' }], ...['OPEN', 'CLOSED', 'MERGED'].map(state => [{ pullRequest: { state } }, { outcome: 'found', pullRequest: { state: state.toLowerCase(), updatedAt: '' } }]), [{ pullRequest: { state: 'OPEN', isDraft: true } }, { outcome: 'found', pullRequest: { state: 'draft' } }]] as const) {
      harness.sdk.stub('environments.pullRequest', () => result);
      expect(await api.sdk.environments.pullRequest({ environmentId: 'env' })).toMatchObject(expected);
    }
    const search = vi.fn(() => [{ id: 'task', title: 'Title', subtitle: 'KEY-1' }]);
    api.ui.registerMentionProvider({ id: 'tasks', label: 'Tasks', search, resolve: () => ({ context: 'task' }) });
    expect(await harness.mentionProviders[0]!.search({ query: 'key', projectId: 'project' })).toEqual([{ id: 'task', label: 'Title · KEY-1' }]);
    expect(search).toHaveBeenCalledWith({ query: 'key', projectId: 'project' });
    await harness.dispose();
  });

  it('aborts background services on disposal and logs failures', async () => {
    const { zcc, harness } = createFakePluginHost(); const api = adaptPluginApi(zcc);
    const error = vi.spyOn(zcc.log, 'error'); let signal: AbortSignal | undefined;
    api.background.service('worker', { async start(value) { signal = value; throw new Error('offline'); } });
    await Promise.resolve();
    expect(error).toHaveBeenCalledWith('Error: offline'); expect(signal?.aborted).toBe(false);
    await harness.dispose(); expect(signal?.aborted).toBe(true);
  });
});
