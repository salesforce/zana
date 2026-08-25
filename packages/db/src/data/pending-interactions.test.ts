import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createConversationThread,
  createEnvironment,
  createPendingInteraction,
  getActivePendingInteractionForThread,
  getPendingInteraction,
  getPendingInteractionByProviderRequest,
  hasPendingInteractionForThread,
  interruptPendingInteractionsForPlugin,
  interruptPendingInteractionsForThreadIds,
  interruptPendingInteractionsForThreads,
  listActivePendingInteractionThreadIdsForHost,
  listActivePendingInteractionsForPlugin,
  listActivePluginPendingInteractions,
  listPendingInteractionsByThread,
  openDatabase,
  setPendingInteractionInterrupted,
  setPendingInteractionResolved,
  setPendingInteractionResolving,
  upsertHost,
  type ZccDatabase
} from '../index.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function setupThread() {
  dir = mkdtempSync(join(tmpdir(), 'zcc-pending-'));
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
  return { host, environment, thread };
}

const providerPayload = JSON.stringify({ kind: 'approval', subject: { kind: 'command' } });

describe('pending interactions', () => {
  it('creates a provider row and looks it up by identity', () => {
    const { thread } = setupThread();
    const created = createPendingInteraction(db!, {
      threadId: thread.id,
      turnId: 'turn-1',
      providerId: 'claude-code',
      providerThreadId: 'pt-1',
      providerRequestId: 'req-1',
      payload: providerPayload
    });
    expect(created.id.startsWith('pint_')).toBe(true);
    expect(created.status).toBe('pending');
    expect(getPendingInteraction(db!, created.id)?.id).toBe(created.id);
    expect(
      getPendingInteractionByProviderRequest(db!, {
        providerId: 'claude-code',
        providerThreadId: 'pt-1',
        providerRequestId: 'req-1'
      })?.id
    ).toBe(created.id);
    expect(hasPendingInteractionForThread(db!, thread.id)).toBe(true);
    expect(getActivePendingInteractionForThread(db!, thread.id)?.id).toBe(created.id);
  });

  it('rejects a duplicate provider request identity', () => {
    const { thread } = setupThread();
    const input = {
      threadId: thread.id,
      turnId: 'turn-1',
      providerId: 'claude-code',
      providerThreadId: 'pt-1',
      providerRequestId: 'req-1',
      payload: providerPayload
    };
    createPendingInteraction(db!, input);
    expect(() => createPendingInteraction(db!, input)).toThrow();
  });

  it('moves pending to resolving then resolved', () => {
    const { thread } = setupThread();
    const created = createPendingInteraction(db!, {
      threadId: thread.id,
      turnId: 'turn-1',
      providerId: 'claude-code',
      providerThreadId: 'pt-1',
      providerRequestId: 'req-1',
      payload: providerPayload
    });
    const resolution = JSON.stringify({ decision: 'allow_once', grantedPermissions: null });
    const resolving = setPendingInteractionResolving(db!, { id: created.id, resolution });
    expect(resolving?.status).toBe('resolving');
    expect(hasPendingInteractionForThread(db!, thread.id)).toBe(false);
    expect(getActivePendingInteractionForThread(db!, thread.id)?.status).toBe('resolving');
    const resolved = setPendingInteractionResolved(db!, { id: created.id, resolution });
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolution).toBe(resolution);
    expect(setPendingInteractionResolved(db!, { id: created.id, resolution })).toBeNull();
  });

  it('interrupts pending and resolving rows for a thread', () => {
    const { thread } = setupThread();
    const first = createPendingInteraction(db!, {
      threadId: thread.id,
      turnId: 'turn-1',
      providerId: 'claude-code',
      providerThreadId: 'pt-1',
      providerRequestId: 'req-1',
      payload: providerPayload
    });
    setPendingInteractionResolving(db!, {
      id: first.id,
      resolution: JSON.stringify({ decision: 'deny', grantedPermissions: null })
    });
    const interrupted = interruptPendingInteractionsForThreadIds(db!, {
      threadIds: [thread.id],
      statusReason: 'thread-stopped'
    });
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]?.status).toBe('interrupted');
    expect(getPendingInteraction(db!, first.id)?.statusReason).toBe('thread-stopped');
    expect(interruptPendingInteractionsForThreadIds(db!, {
      threadIds: [thread.id],
      statusReason: 'thread-stopped'
    })).toEqual([]);
  });

  it('interrupts provider rows for one provider only', () => {
    const { thread } = setupThread();
    createPendingInteraction(db!, {
      threadId: thread.id,
      turnId: 'turn-1',
      providerId: 'claude-code',
      providerThreadId: 'pt-1',
      providerRequestId: 'req-1',
      payload: providerPayload
    });
    const other = interruptPendingInteractionsForThreads(db!, {
      providerId: 'codex',
      threadIds: [thread.id],
      statusReason: 'provider-exited'
    });
    expect(other).toEqual([]);
    const matched = interruptPendingInteractionsForThreads(db!, {
      providerId: 'claude-code',
      threadIds: [thread.id],
      statusReason: 'provider-exited'
    });
    expect(matched).toHaveLength(1);
  });

  it('creates plugin rows and interrupts them by plugin id', () => {
    const { thread } = setupThread();
    const created = createPendingInteraction(db!, {
      originKind: 'plugin',
      threadId: thread.id,
      pluginId: 'secrets',
      rendererId: 'ask',
      payload: JSON.stringify({ kind: 'plugin', title: 'Secret', data: {} })
    });
    expect(created.originKind).toBe('plugin');
    expect(listActivePendingInteractionsForPlugin(db!, 'secrets')).toHaveLength(1);
    expect(listActivePluginPendingInteractions(db!)).toHaveLength(1);
    expect(listPendingInteractionsByThread(db!, {
      threadId: thread.id,
      statuses: ['pending', 'resolving']
    })).toHaveLength(1);
    const interrupted = interruptPendingInteractionsForPlugin(db!, {
      pluginId: 'secrets',
      statusReason: 'plugin-disposed'
    });
    expect(interrupted).toHaveLength(1);
    expect(getPendingInteraction(db!, created.id)?.status).toBe('interrupted');
    expect(setPendingInteractionInterrupted(db!, {
      id: created.id,
      statusReason: 'plugin-disposed'
    })).toBeNull();
  });

  it('returns empty interrupt results for empty thread ids', () => {
    setupThread();
    expect(interruptPendingInteractionsForThreadIds(db!, {
      threadIds: [],
      statusReason: 'none'
    })).toEqual([]);
    expect(interruptPendingInteractionsForThreads(db!, {
      providerId: 'claude-code',
      threadIds: [],
      statusReason: 'none'
    })).toEqual([]);
  });

  it('lists active pending thread ids for a host', () => {
    const { host, thread } = setupThread();
    createPendingInteraction(db!, {
      threadId: thread.id,
      turnId: 'turn-1',
      providerId: 'claude-code',
      providerThreadId: 'pt-1',
      providerRequestId: 'req-1',
      payload: providerPayload
    });
    expect(listActivePendingInteractionThreadIdsForHost(db!, host.id)).toEqual([thread.id]);
    expect(listActivePendingInteractionThreadIdsForHost(db!, 'missing-host')).toEqual([]);
  });
});
