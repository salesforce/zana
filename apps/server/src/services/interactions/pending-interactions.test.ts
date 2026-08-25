import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationThread,
  createEnvironment,
  createPendingInteraction,
  getPendingInteraction,
  openDatabase,
  upsertHost,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { HostUnavailableError } from '../../http/host-hub.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { PendingInteractionLifecycle } from './pending-interactions.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function commandPayload(command = 'git status') {
  return {
    kind: 'approval' as const,
    subject: {
      kind: 'command' as const,
      itemId: 'item-1',
      command,
      cwd: '/tmp/proj',
      actions: [] as const,
      sessionGrant: null
    },
    reason: 'Needs approval',
    availableDecisions: ['allow_once', 'allow_for_session', 'deny'] as const
  };
}

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'zcc-int-'));
  db = openDatabase(join(dir, 'zcc.sqlite'));
  const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
  const environment = createEnvironment(db, {
    projectId: 'proj-1',
    hostId: host.id,
    path: '/tmp/proj'
  });
  const thread = createConversationThread(db, {
    projectId: 'proj-1',
    hostId: host.id,
    environmentId: environment.id,
    providerId: 'claude-code',
    status: 'active'
  });
  const hub = { emit: vi.fn() };
  const callHostOnlineRpc = vi.fn(async () => ({ interactionId: 'ok', delivered: true }));
  const lifecycle = new PendingInteractionLifecycle({
    db,
    hub: hub as never,
    callHostOnlineRpc
  });
  return { host, environment, thread, hub, callHostOnlineRpc, lifecycle };
}

function providerRequest(threadId: string, extras?: { providerRequestId?: string; command?: string }) {
  return {
    threadId,
    turnId: 'turn-1',
    providerId: 'claude-code',
    providerThreadId: 'prov-1',
    providerRequestId: extras?.providerRequestId ?? 'req-1',
    payload: commandPayload(extras?.command)
  };
}

describe('PendingInteractionLifecycle', () => {
  it('registers a provider request and reuses a duplicate payload', () => {
    const { lifecycle, thread } = setup();
    const created = lifecycle.registerPendingInteraction(providerRequest(thread.id));
    expect(created.outcome).toBe('created');
    const reused = lifecycle.registerPendingInteraction(providerRequest(thread.id));
    expect(reused).toEqual({
      outcome: 'existing',
      interactionId: created.interactionId,
      status: 'pending'
    });
  });

  it('rejects a second active interaction on the same thread', () => {
    const { lifecycle, thread } = setup();
    expect(lifecycle.registerPendingInteraction(providerRequest(thread.id)).outcome).toBe('created');
    expect(lifecycle.registerPendingInteraction(providerRequest(thread.id, { providerRequestId: 'req-2' }))).toEqual({
      outcome: 'rejected',
      reason: `Thread ${thread.id} is already awaiting user interaction`
    });
  });

  it('rejects a duplicate identity with a different payload', () => {
    const { lifecycle, thread } = setup();
    lifecycle.registerPendingInteraction(providerRequest(thread.id, { command: 'git status' }));
    expect(lifecycle.registerPendingInteraction(providerRequest(thread.id, { command: 'git push' }))).toMatchObject({
      outcome: 'rejected',
      reason: expect.stringContaining('already awaiting a different interaction payload')
    });
  });

  it('resolves an approval through host RPC and is idempotent', async () => {
    const { lifecycle, thread, callHostOnlineRpc } = setup();
    const registered = lifecycle.registerPendingInteraction(providerRequest(thread.id));
    if (registered.outcome === 'rejected') throw new Error(registered.reason);
    const resolution = { decision: 'allow_once' as const, grantedPermissions: null };
    const first = await lifecycle.resolvePendingInteraction({
      threadId: thread.id,
      interactionId: registered.interactionId,
      resolution
    });
    expect(first.status).toBe('resolved');
    expect(callHostOnlineRpc).toHaveBeenCalledTimes(1);
    const second = await lifecycle.resolvePendingInteraction({
      threadId: thread.id,
      interactionId: registered.interactionId,
      resolution
    });
    expect(second.status).toBe('resolved');
    expect(callHostOnlineRpc).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when resolving after interrupt', async () => {
    const { lifecycle, thread } = setup();
    const registered = lifecycle.registerPendingInteraction(providerRequest(thread.id));
    if (registered.outcome === 'rejected') throw new Error(registered.reason);
    lifecycle.interruptPendingInteractionsForThreadIds({
      threadIds: [thread.id],
      reason: 'thread-stopped'
    });
    await expect(lifecycle.resolvePendingInteraction({
      threadId: thread.id,
      interactionId: registered.interactionId,
      resolution: { decision: 'deny' }
    })).rejects.toMatchObject({ status: 409, code: 'invalid_request' });
  });

  it('marks the row interrupted when host RPC is offline', async () => {
    const { lifecycle, thread, callHostOnlineRpc } = setup();
    callHostOnlineRpc.mockRejectedValueOnce(new HostUnavailableError());
    const registered = lifecycle.registerPendingInteraction(providerRequest(thread.id));
    if (registered.outcome === 'rejected') throw new Error(registered.reason);
    await expect(lifecycle.resolvePendingInteraction({
      threadId: thread.id,
      interactionId: registered.interactionId,
      resolution: { decision: 'deny' }
    })).rejects.toBeInstanceOf(HostUnavailableError);
    expect(getPendingInteraction(db!, registered.interactionId)?.status).toBe('interrupted');
    expect(getPendingInteraction(db!, registered.interactionId)?.statusReason).toBe('host-unavailable');
  });

  it('start() interrupts leftover plugin rows and leaves provider rows pending', () => {
    const { lifecycle, thread, host, environment } = setup();
    const other = createConversationThread(db!, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'active'
    });
    createPendingInteraction(db!, {
      originKind: 'plugin',
      threadId: other.id,
      pluginId: 'ask-user',
      rendererId: 'form',
      payload: JSON.stringify({ kind: 'plugin', title: 'Ask', data: { q: 1 } })
    });
    const provider = lifecycle.registerPendingInteraction(providerRequest(thread.id, { providerRequestId: 'req-keep' }));
    if (provider.outcome === 'rejected') throw new Error(provider.reason);
    lifecycle.start();
    expect(lifecycle.listPendingThreadInteractions(other.id)).toEqual([]);
    expect(lifecycle.listPendingThreadInteractions(thread.id).map((row) => row.id)).toEqual([provider.interactionId]);
  });

  it('plugin requestInput waiters settle on respond and timeout', async () => {
    const { lifecycle, thread } = setup();
    const pending = lifecycle.requestPluginInteraction({
      pluginId: 'ask-user',
      threadId: thread.id,
      rendererId: 'form',
      title: 'Confirm',
      payload: { path: '/tmp' },
      timeoutMs: 20
    });
    const open = lifecycle.listPendingThreadInteractions(thread.id);
    expect(open).toHaveLength(1);
    const submitted = lifecycle.respondToPluginInteraction({
      threadId: thread.id,
      interactionId: open[0]!.id,
      value: { ok: true }
    });
    expect(submitted.status).toBe('resolved');
    await expect(pending).resolves.toEqual({ outcome: 'submitted', value: { ok: true } });

    const timedOut = lifecycle.requestPluginInteraction({
      pluginId: 'ask-user',
      threadId: thread.id,
      rendererId: 'form',
      title: 'Later',
      payload: {},
      timeoutMs: 5
    });
    await expect(timedOut).resolves.toEqual({ outcome: 'cancelled', reason: 'timeout' });
  });

  it('rejects an oversized plugin response', () => {
    const { lifecycle, thread } = setup();
    void lifecycle.requestPluginInteraction({
      pluginId: 'ask-user',
      threadId: thread.id,
      rendererId: 'form',
      title: 'Big',
      payload: {},
      timeoutMs: 1000
    });
    const open = lifecycle.listPendingThreadInteractions(thread.id)[0]!;
    expect(() => lifecycle.respondToPluginInteraction({
      threadId: thread.id,
      interactionId: open.id,
      value: 'x'.repeat(65 * 1024)
    })).toThrow(ThreadCreateError);
  });

  it('cancels a plugin waiter on abort and interruptPluginInteractions', async () => {
    const { lifecycle, thread } = setup();
    const controller = new AbortController();
    const pending = lifecycle.requestPluginInteraction({
      pluginId: 'ask-user',
      threadId: thread.id,
      rendererId: 'form',
      title: 'Abort me',
      payload: {},
      timeoutMs: 10_000,
      signal: controller.signal
    });
    controller.abort();
    await expect(pending).resolves.toEqual({ outcome: 'cancelled', reason: 'request-aborted' });

    void lifecycle.requestPluginInteraction({
      pluginId: 'ask-user',
      threadId: thread.id,
      rendererId: 'form',
      title: 'Dispose',
      payload: {},
      timeoutMs: 10_000
    });
    const interrupted = lifecycle.interruptPluginInteractions('ask-user');
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]?.status).toBe('interrupted');
  });

  it('registers a user question and resolves the answer', async () => {
    const { lifecycle, thread, callHostOnlineRpc } = setup();
    const registered = lifecycle.registerPendingInteraction({
      threadId: thread.id,
      turnId: 'turn-q',
      providerId: 'claude-code',
      providerThreadId: 'prov-1',
      providerRequestId: 'req-q',
      payload: {
        kind: 'user_question',
        questions: [{
          id: 'q1',
          prompt: 'Continue?',
          multiSelect: false,
          allowFreeText: false,
          options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
        }]
      }
    });
    expect(registered.outcome).toBe('created');
    if (registered.outcome === 'rejected') throw new Error(registered.reason);
    const answered = await lifecycle.resolvePendingInteraction({
      threadId: thread.id,
      interactionId: registered.interactionId,
      resolution: { kind: 'user_answer', answers: { q1: { selected: ['yes'] } } }
    });
    expect(answered.status).toBe('resolved');
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ type: 'interactive.resolve' })
    }));
  });

  it('rejects an unavailable approval decision', async () => {
    const { lifecycle, thread } = setup();
    const registered = lifecycle.registerPendingInteraction({
      ...providerRequest(thread.id),
      payload: {
        ...commandPayload(),
        availableDecisions: ['allow_once', 'deny']
      }
    });
    if (registered.outcome === 'rejected') throw new Error(registered.reason);
    await expect(lifecycle.resolvePendingInteraction({
      threadId: thread.id,
      interactionId: registered.interactionId,
      resolution: { decision: 'allow_for_session', grantedPermissions: null }
    })).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('rejects a malformed register payload and a missing thread', () => {
    const { lifecycle } = setup();
    expect(lifecycle.registerPendingInteraction({
      threadId: 'missing',
      turnId: 'turn-1',
      providerId: 'claude-code',
      providerThreadId: 'prov-1',
      providerRequestId: 'req-x',
      payload: commandPayload()
    })).toEqual({ outcome: 'rejected', reason: 'Thread does not exist' });
    expect(lifecycle.registerPendingInteraction({
      threadId: '',
      turnId: 'turn-1',
      providerId: 'claude-code',
      providerThreadId: 'prov-1',
      providerRequestId: 'req-x',
      payload: commandPayload()
    } as never)).toEqual({ outcome: 'rejected', reason: 'Invalid interactive request' });
  });

  it('interrupts leftover rows for a host instance change', () => {
    const { lifecycle, thread, host } = setup();
    const registered = lifecycle.registerPendingInteraction(providerRequest(thread.id));
    if (registered.outcome === 'rejected') throw new Error(registered.reason);
    const interrupted = lifecycle.interruptPendingInteractionsForHost(host.id, 'host-daemon-restarted');
    expect(interrupted.map((row) => row.id)).toEqual([registered.interactionId]);
    expect(lifecycle.listPendingThreadInteractions(thread.id)).toEqual([]);
  });

  it('interrupts matching provider rows and hides mismatched thread lookups', () => {
    const { lifecycle, thread } = setup();
    const registered = lifecycle.registerPendingInteraction(providerRequest(thread.id));
    if (registered.outcome === 'rejected') throw new Error(registered.reason);
    expect(lifecycle.interruptPendingInteractionsForThreads({
      providerId: 'codex',
      threadIds: [thread.id],
      reason: 'wrong-provider'
    })).toEqual([]);
    expect(lifecycle.getThreadInteraction({
      threadId: thread.id,
      interactionId: registered.interactionId
    }).id).toBe(registered.interactionId);
    expect(() => lifecycle.getThreadInteraction({
      threadId: 'missing',
      interactionId: registered.interactionId
    })).toThrow(ThreadCreateError);
    expect(lifecycle.interruptPendingInteractionsForThreads({
      providerId: 'claude-code',
      threadIds: [thread.id],
      reason: 'provider-exited'
    }).map((row) => row.id)).toEqual([registered.interactionId]);
  });
});
