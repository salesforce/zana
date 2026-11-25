import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationThread, createEnvironment, createPendingInteraction,
  getPendingInteraction, insertThreadPluginMetadata, listConversationThreadEvents,
  openDatabase, upsertHost, type ZccDatabase
} from '@zana-ai/zcc-db';
import type { PendingInteractionPayload } from '@zana-ai/zcc-domain/thread-runtime';
import { PluginThreadInteractionError, type PluginRelayedHumanActor, type PluginThreadInteractions } from '@zana-ai/zcc-plugin-sdk/server';
import { PendingInteractionLifecycle } from '../services/interactions/pending-interactions.js';
import { createPluginApi, type PluginHandle } from './plugin-api.js';
import { createPluginWorkerBridge } from './plugin-worker-bridge.js';

const pluginId = 'relay-fixture';
const actor: PluginRelayedHumanActor = { kind: 'plugin-relayed-human', pluginId, externalUser: 'tenant-1/user-42' };
const allow = { decision: 'allow_once', grantedPermissions: null } as const;
const deny = { decision: 'deny' } as const;
const permissions = { network: { enabled: true }, fileSystem: { read: ['/project'], write: ['/project/out'] } };
const dirs: string[] = [], databases: ZccDatabase[] = [], handles: PluginHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map(handle => handle.dispose()));
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(wired = true) {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-thread-interactions-'));
  dirs.push(dir);
  const db = openDatabase(join(dir, 'zcc.sqlite'));
  databases.push(db);
  const host = upsertHost(db, { name: 'fixture', hostKeyHash: 'h'.repeat(64) });
  const environment = createEnvironment(db, { projectId: 'p1', hostId: host.id, path: '/project' });
  const makeThread = (owner: string | null = pluginId, providerId = 'claude-code') => createConversationThread(db, {
    projectId: 'p1', hostId: host.id, environmentId: environment.id, providerId, originPluginId: owner
  });
  const thread = makeThread();
  const hub = { emit: vi.fn() };
  const callHostOnlineRpc = vi.fn(async (_input: unknown) => ({}));
  const lifecycle = new PendingInteractionLifecycle({ db, hub: hub as never, callHostOnlineRpc });
  const handle = createPluginApi(pluginId, join(dir, 'plugin'), wired ? { productContext: {
    db, pendingInteractions: lifecycle, hub
  } as never } : undefined);
  handles.push(handle);
  const interactions = handle.api.sdk.threads.interactions;
  function request(payload: PendingInteractionPayload = command(), target = thread) {
    const registered = lifecycle.registerPendingInteraction({
      threadId: target.id, turnId: 'turn-1', providerId: target.providerId,
      providerThreadId: target.id, providerRequestId: 'request-1', payload
    });
    if (registered.outcome === 'rejected') throw new Error(registered.reason);
    return registered.interactionId;
  }
  const audit = () => listConversationThreadEvents(db, thread.id).map(row => row.payload as Record<string, unknown>)
    .filter(event => event.operation === 'interaction_resolution');
  return { db, thread, makeThread, lifecycle, hub, callHostOnlineRpc, handle, interactions, request, audit };
}

function command(text = 'git status'): PendingInteractionPayload {
  return { kind: 'approval', reason: 'Needs approval', availableDecisions: ['allow_once', 'deny'],
    subject: { kind: 'command', itemId: 'item-1', command: text, cwd: '/project', actions: [], sessionGrant: null } };
}

describe('sdk.threads.interactions', () => {
  it('lists only the requested owned thread, projects safe display fields, then lists no settled rows', async () => {
    const f = setup();
    const id = f.request(command('TOKEN=private-value git status'));
    f.request(command('other thread command'), f.makeThread());
    const [view] = await f.interactions.list({ threadId: f.thread.id });
    expect(view).toEqual({
      id, threadId: f.thread.id, kind: 'approval', subjectKind: 'command',
      summary: 'TOKEN=[REDACTED] git status', summaryTruncated: false, tool: null,
      allowedDecisions: ['allow_once', 'deny'], grantPermissions: null,
      status: 'pending', createdAt: expect.any(Number), resolvedAt: null, resolution: null, refusalReason: null
    });
    expect(view).not.toHaveProperty('payload');
    expect(view).not.toHaveProperty('providerRequestId');
    await f.interactions.resolve({ threadId: f.thread.id, interactionId: id, resolution: deny, actor });
    expect(await f.interactions.list({ threadId: f.thread.id })).toEqual([]);
  });

  it.each([allow, deny])('resolves %j with authoritative status and one durable actor audit; repeat is idempotent', async resolution => {
    const f = setup();
    const interactionId = f.request();
    const args = { threadId: f.thread.id, interactionId, resolution, actor };
    const resolved = await f.interactions.resolve(args);
    expect(resolved).toMatchObject({ id: interactionId, status: 'resolved', resolution, resolvedAt: expect.any(Number) });
    expect(getPendingInteraction(f.db, interactionId)).toMatchObject({ status: 'resolved', resolution: JSON.stringify(resolution) });
    expect(f.callHostOnlineRpc).toHaveBeenCalledWith({ hostId: f.thread.hostId, command: {
      type: 'interactive.resolve', threadId: f.thread.id, interactionId,
      providerId: 'claude-code', providerThreadId: f.thread.id, providerRequestId: 'request-1', resolution
    } });
    expect(f.audit()).toEqual([expect.objectContaining({
      operationId: interactionId, status: 'resolving', metadata: { actor, resolution }
    })]);
    expect(f.hub.emit).toHaveBeenCalledWith('threads:event', expect.objectContaining({
      type: 'system/operation', payload: expect.objectContaining({ metadata: { actor, resolution } })
    }));
    expect(await f.interactions.resolve({ ...args, actor: { ...actor, externalUser: 'second-user' } })).toEqual(resolved);
    expect(f.callHostOnlineRpc).toHaveBeenCalledTimes(1);
    expect(f.audit()).toHaveLength(1);
    await expect(f.interactions.resolve({ ...args, resolution: resolution.decision === 'deny' ? allow : deny }))
      .rejects.toMatchObject({ name: 'PluginThreadInteractionError', code: 'conflict', status: 409 });
    expect(f.audit()).toHaveLength(1);
  });

  it('keeps resolving retries idempotent and conflicting decisions out while host delivery is in flight', async () => {
    const f = setup();
    let finish!: () => void;
    f.callHostOnlineRpc.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}); }));
    const args = { threadId: f.thread.id, interactionId: f.request(), resolution: allow, actor };
    const first = f.interactions.resolve(args);
    expect(await f.interactions.resolve(args)).toMatchObject({ status: 'resolving', resolution: allow });
    expect(await f.interactions.list({ threadId: f.thread.id })).toEqual([expect.objectContaining({ status: 'resolving' })]);
    await expect(f.interactions.resolve({ ...args, resolution: deny })).rejects.toMatchObject({ code: 'conflict' });
    finish();
    await expect(first).resolves.toMatchObject({ status: 'resolved' });
    expect(f.callHostOnlineRpc).toHaveBeenCalledTimes(1);
    expect(f.audit()).toHaveLength(1);
  });

  it.each([null, 'other-plugin'])('denies list and resolve of a thread owned by %s, even with caller plugin metadata', async owner => {
    const f = setup();
    const foreign = f.makeThread(owner);
    insertThreadPluginMetadata(f.db, { threadId: foreign.id, pluginId, metadata: { bound: true } });
    const interactionId = f.request(command(), foreign);
    await expect(f.interactions.list({ threadId: foreign.id })).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    await expect(f.interactions.resolve({ threadId: foreign.id, interactionId, resolution: allow, actor }))
      .rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(getPendingInteraction(f.db, interactionId)?.status).toBe('pending');
    expect(f.callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it('returns typed not-found for unknown threads, unknown interactions and an interaction on another owned thread', async () => {
    const f = setup();
    const interactionId = f.request();
    for (const args of [
      { threadId: 'unknown', interactionId },
      { threadId: f.thread.id, interactionId: 'unknown' },
      { threadId: f.makeThread().id, interactionId }
    ]) {
      await expect(f.interactions.resolve({ ...args, resolution: allow, actor })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    }
    await expect(f.interactions.list({ threadId: 'unknown' })).rejects.toBeInstanceOf(PluginThreadInteractionError);
    expect(f.callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it.each([true, 'native-sheet'] as const)('refuses human/native-only plugin requests (%s) without settling them', async requireHuman => {
    const f = setup();
    const row = createPendingInteraction(f.db, {
      originKind: 'plugin', pluginId: 'confirmation-owner', rendererId: 'confirm', threadId: f.thread.id,
      payload: JSON.stringify({ kind: 'plugin', title: 'Confirm privileged action', data: { secret: 'hidden' }, requireHuman })
    });
    expect(await f.interactions.list({ threadId: f.thread.id })).toEqual([expect.objectContaining({
      summary: 'Confirm privileged action', allowedDecisions: [], refusalReason: 'native_confirmation_required'
    })]);
    await expect(f.interactions.resolve({ threadId: f.thread.id, interactionId: row.id, resolution: allow,
      actor: { ...actor, attestation: 'sheet' } as never })).rejects.toMatchObject({ code: 'native_confirmation_required', status: 403 });
    expect(getPendingInteraction(f.db, row.id)?.status).toBe('pending');
    expect(f.callHostOnlineRpc).not.toHaveBeenCalled();
    expect(f.audit()).toEqual([]);
  });

  it('leaves ordinary plugin forms to their respond path, without projecting plugin data', async () => {
    const f = setup();
    const row = createPendingInteraction(f.db, {
      originKind: 'plugin', pluginId, rendererId: 'form', threadId: f.thread.id,
      payload: JSON.stringify({ kind: 'plugin', title: 'Choose', data: { secret: 'hidden' }, requireHuman: false })
    });
    const listed = await f.interactions.list({ threadId: f.thread.id });
    expect(listed).toEqual([expect.objectContaining({ summary: 'Choose', refusalReason: 'unsupported_interaction', allowedDecisions: [] })]);
    expect(JSON.stringify(listed)).not.toContain('hidden');
    await expect(f.interactions.resolve({ threadId: f.thread.id, interactionId: row.id, resolution: allow, actor }))
      .rejects.toMatchObject({ code: 'unsupported_interaction' });
    expect(getPendingInteraction(f.db, row.id)?.status).toBe('pending');
  });

  it('uses exact command session grants from the projection and forwards the requested scope', async () => {
    const f = setup();
    const interactionId = f.request({ kind: 'approval', reason: null, availableDecisions: ['allow_for_session', 'deny'],
      subject: { kind: 'command', itemId: 'shell', command: 'git status', cwd: '/project', actions: [], sessionGrant: permissions } });
    const [view] = await f.interactions.list({ threadId: f.thread.id });
    const args = { threadId: f.thread.id, interactionId, actor };
    await expect(f.interactions.resolve({ ...args, resolution: { decision: 'allow_for_session', grantedPermissions: null } }))
      .rejects.toMatchObject({ code: 'invalid_request' });
    const resolution = { decision: 'allow_for_session', grantedPermissions: view!.grantPermissions } as const;
    await expect(f.interactions.resolve({ ...args, resolution })).resolves.toMatchObject({ status: 'resolved', resolution });
    expect(f.callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({ resolution }) }));
  });

  it.each([
    undefined, 'human', { ...actor, kind: 'human' }, { ...actor, externalUser: '' },
    { ...actor, externalUser: ' ' }, { ...actor, externalUser: 'x'.repeat(257) }, { ...actor, externalUser: 'user\nspoof' }
  ])('rejects an absent, native-human or invalid relay actor (%j)', async badActor => {
    const f = setup();
    await expect(f.interactions.resolve({ threadId: f.thread.id, interactionId: f.request(), resolution: allow, actor: badActor as never }))
      .rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    expect(f.callHostOnlineRpc).not.toHaveBeenCalled();
    expect(f.audit()).toEqual([]);
  });

  it('binds actor identity to the host plugin and discards attempted native attestation', async () => {
    const f = setup();
    const args = { threadId: f.thread.id, interactionId: f.request(), resolution: allow };
    await expect(f.interactions.resolve({ ...args, actor: { ...actor, pluginId: 'forged' } }))
      .rejects.toMatchObject({ code: 'forbidden' });
    await f.interactions.resolve({ ...args, actor: { ...actor, externalUser: ' tenant-1/user-42 ', attestation: 'sheet' } as never });
    expect(f.audit()[0]?.metadata).toEqual({ actor, resolution: allow });
  });

  it.each([undefined, null, {}, { decision: 'allow' }, { kind: 'user_answer', answers: {} }, { decision: 'allow_once' }])(
    'rejects malformed resolutions (%j) before changing state', async resolution => {
      const f = setup();
      const interactionId = f.request();
      await expect(f.interactions.resolve({ threadId: f.thread.id, interactionId, resolution: resolution as never, actor }))
        .rejects.toMatchObject({ code: 'invalid_request', status: 400 });
      expect(getPendingInteraction(f.db, interactionId)?.status).toBe('pending');
      expect(f.audit()).toEqual([]);
    });

  it('preserves lifecycle validation of available decisions and exact granted permissions', async () => {
    const f = setup();
    const interactionId = f.request({ kind: 'approval', reason: null, availableDecisions: ['allow_once', 'deny'],
      subject: { kind: 'permission_grant', itemId: 'grant', toolName: 'Bash', permissions } });
    const args = { threadId: f.thread.id, interactionId, actor };
    for (const resolution of [allow, { decision: 'allow_for_session', grantedPermissions: permissions },
      { decision: 'allow_once', grantedPermissions: { network: null, fileSystem: null } }] as const) {
      await expect(f.interactions.resolve({ ...args, resolution })).rejects.toMatchObject({ code: 'invalid_request' });
    }
    const [view] = await f.interactions.list({ threadId: f.thread.id });
    expect(view).toMatchObject({ tool: 'Bash', subjectKind: 'permission_grant', grantPermissions: permissions });
    await expect(f.interactions.resolve({ ...args, resolution: { decision: 'allow_once', grantedPermissions: view!.grantPermissions } }))
      .resolves.toMatchObject({ status: 'resolved' });
  });

  it('keeps the actor audit when delivery fails, and conflicts on the interrupted retry', async () => {
    const f = setup();
    const failure = new Error('Host disconnected');
    f.callHostOnlineRpc.mockRejectedValueOnce(failure);
    const args = { threadId: f.thread.id, interactionId: f.request(), resolution: allow, actor };
    await expect(f.interactions.resolve(args)).rejects.toBe(failure);
    expect(getPendingInteraction(f.db, args.interactionId)?.status).toBe('interrupted');
    expect(f.audit()).toHaveLength(1);
    await expect(f.interactions.resolve(args)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rolls back the resolving transition when its audit cannot be recorded/published', async () => {
    const f = setup();
    const args = { threadId: f.thread.id, interactionId: f.request(), resolution: allow, actor };
    f.hub.emit.mockImplementationOnce(() => { throw new Error('Audit unavailable'); });
    await expect(f.interactions.resolve(args)).rejects.toThrow('Audit unavailable');
    expect(getPendingInteraction(f.db, args.interactionId)?.status).toBe('pending');
    expect(f.audit()).toEqual([]);
    expect(f.callHostOnlineRpc).not.toHaveBeenCalled();
    await expect(f.interactions.resolve(args)).resolves.toMatchObject({ status: 'resolved' });
  });

  it('passes list, resolution and typed failures through the real plugin worker transport', async () => {
    const f = setup();
    const args = { threadId: f.thread.id, interactionId: f.request(), resolution: allow, actor };
    const { port1, port2 } = new MessageChannel();
    const host = createPluginWorkerBridge(port1, 'server');
    const worker = createPluginWorkerBridge(port2, 'plugin');
    try {
      const remote = worker.decode(host.encode(f.interactions)) as PluginThreadInteractions;
      expect(await remote.list({ threadId: f.thread.id })).toEqual([expect.objectContaining({ id: args.interactionId })]);
      expect(await remote.resolve(args)).toMatchObject({ status: 'resolved', resolution: allow });
      await expect(remote.resolve({ ...args, resolution: deny })).rejects.toMatchObject({
        name: 'PluginThreadInteractionError', code: 'conflict', status: 409
      });
      await expect(remote.list({ threadId: f.makeThread('other-plugin').id })).rejects.toMatchObject({
        name: 'PluginThreadInteractionError', code: 'forbidden', status: 403
      });
    } finally {
      host.dispose(); worker.dispose(); port1.close(); port2.close();
    }
  });

  it('reports availability from real wiring and thread origin, independently of the provider and pending state', async () => {
    const f = setup();
    for (const [threadId, available] of [[f.thread.id, true], [f.makeThread(pluginId, 'custom-provider').id, true],
      [f.makeThread('other-plugin').id, false], ['unknown', false]] as const) {
      const result = await f.handle.api.sdk.capabilities.forThread({ threadId });
      expect(result.capabilities.find(c => c.id === 'thread-interactions')).toMatchObject({ available });
    }
    expect((await f.handle.api.sdk.capabilities.forExecution({ executionId: 'exec-1' })).capabilities)
      .toContainEqual(expect.objectContaining({ id: 'thread-interactions', available: false }));
    const bare = setup(false);
    expect((await bare.handle.api.sdk.capabilities.forThread({ threadId: bare.thread.id })).capabilities)
      .toContainEqual(expect.objectContaining({ id: 'thread-interactions', available: false, reason: expect.stringContaining('wiring') }));
    await expect(bare.interactions.list({ threadId: bare.thread.id })).rejects.toMatchObject({ code: 'unavailable', status: 503 });
    await expect(bare.interactions.resolve({ threadId: bare.thread.id, interactionId: 'id', resolution: allow, actor }))
      .rejects.toMatchObject({ code: 'unavailable' });
  });

  it('validates ids and refuses calls from a disposed plugin handle', async () => {
    const f = setup();
    for (const threadId of ['', ' ', null, 42, 'x'.repeat(257)]) {
      await expect(f.interactions.list({ threadId } as never)).rejects.toMatchObject({ code: 'invalid_request' });
    }
    await expect(f.interactions.list(undefined as never)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(f.interactions.resolve(undefined as never)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(f.interactions.resolve({ threadId: f.thread.id } as never)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await f.interactions.list({ threadId: ` ${f.thread.id} ` })).toEqual([]);
    await f.handle.dispose();
    await expect(f.interactions.list({ threadId: f.thread.id })).rejects.toThrow('stale');
    await expect(f.interactions.resolve({ threadId: f.thread.id, interactionId: 'id', resolution: allow, actor })).rejects.toThrow('stale');
  });

  it('caps UTF-8 display text, signals truncation and omits raw plan bodies', async () => {
    const f = setup();
    const id = f.request(command('猫'.repeat(5000)));
    const [view] = await f.interactions.list({ threadId: f.thread.id });
    expect(Buffer.byteLength(view!.summary)).toBeLessThanOrEqual(1024);
    expect(view!.summary).not.toContain('\ufffd');
    expect(view!.summaryTruncated).toBe(true);
    await f.interactions.resolve({ threadId: f.thread.id, interactionId: id, resolution: deny, actor });
    const planThread = f.makeThread();
    f.request({ kind: 'approval', reason: null, availableDecisions: ['allow_once', 'deny'], subject: {
      kind: 'plan', itemId: 'plan', plan: 'PRIVATE PLAN', planFilePath: '/private/plan.md'
    } }, planThread);
    const listed = await f.interactions.list({ threadId: planThread.id });
    expect(listed).toEqual([expect.objectContaining({ summary: 'Review plan', subjectKind: 'plan' })]);
    expect(JSON.stringify(listed)).not.toContain('PRIVATE');
  });

  it.each([
    { kind: 'file_change', itemId: 'file', writeScope: '/project/file', sessionGrant: permissions },
    { kind: 'file_change', itemId: 'file', writeScope: null, sessionGrant: null },
    { kind: 'permission_grant', itemId: 'grant', toolName: null, permissions },
    { kind: 'tool_use', itemId: 'tool', tool: 'deploy', presentation: { label: { pending: 'Deploying', completed: 'Deployed' }, icon: { glyph: 'Tool' }, title: 'Deploy project' } },
    { kind: 'tool_use', itemId: 'tool', tool: 'deploy', presentation: { label: { pending: 'Deploying', completed: 'Deployed' }, icon: { glyph: 'Tool' } } }
  ] as const)('projects approval subject $kind', async subject => {
    const f = setup();
    const interactionId = f.request({ kind: 'approval', reason: null, availableDecisions: ['allow_once', 'deny'], subject: subject as never });
    expect(await f.interactions.list({ threadId: f.thread.id })).toEqual([expect.objectContaining({ id: interactionId, subjectKind: subject.kind, refusalReason: null })]);
  });

  it.each([
    { kind: 'user_question', questions: [{ id: 'q1', prompt: 'Which option?', multiSelect: false, allowFreeText: true }] },
    { kind: 'fixture/dialog', title: 'Custom request', data: { secret: 'not-displayed' } }
  ] as const)('lists but refuses non-approval provider requests ($kind)', async payload => {
    const f = setup();
    const interactionId = f.request(payload as never);
    expect(await f.interactions.list({ threadId: f.thread.id })).toEqual([expect.objectContaining({ refusalReason: 'unsupported_interaction', allowedDecisions: [] })]);
    await expect(f.interactions.resolve({ threadId: f.thread.id, interactionId, resolution: allow, actor }))
      .rejects.toMatchObject({ code: 'unsupported_interaction' });
    expect(f.callHostOnlineRpc).not.toHaveBeenCalled();
  });
});
