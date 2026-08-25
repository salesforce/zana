import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationThread,
  createEnvironment,
  listConversationThreadEvents,
  openDatabase,
  upsertHost,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import type { PendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import { appendPendingInteractionTimelineEvent } from './pending-interaction-timeline.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'zcc-pint-tl-'));
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
  return { thread, hub: { emit: vi.fn() } };
}

function base(threadId: string): Omit<PendingInteraction, 'payload' | 'origin'> {
  return {
    id: 'pint_1',
    threadId,
    turnId: 'turn-1',
    providerId: 'claude-code',
    providerThreadId: 'prov-1',
    providerRequestId: 'req-1',
    status: 'pending',
    resolution: null,
    statusReason: null,
    createdAt: 1,
    resolvedAt: null
  };
}

describe('appendPendingInteractionTimelineEvent', () => {
  it('writes permission-grant, question, plugin, and file-change events', () => {
    const { thread, hub } = setup();
    const grant: PendingInteraction = {
      ...base(thread.id),
      origin: {
        kind: 'provider',
        providerId: 'claude-code',
        providerThreadId: 'prov-1',
        providerRequestId: 'req-1'
      },
      payload: {
        kind: 'approval',
        reason: 'grant',
        availableDecisions: ['allow_once', 'deny'],
        subject: {
          kind: 'permission_grant',
          itemId: 'item-g',
          toolName: 'Bash',
          permissions: { network: { enabled: true }, fileSystem: null }
        }
      }
    };
    appendPendingInteractionTimelineEvent(db!, hub as never, grant);
    appendPendingInteractionTimelineEvent(db!, hub as never, {
      ...grant,
      payload: {
        kind: 'user_question',
        questions: [{
          id: 'q1',
          prompt: 'Go?',
          multiSelect: false,
          allowFreeText: true,
          options: []
        }]
      }
    });
    appendPendingInteractionTimelineEvent(db!, hub as never, {
      ...grant,
      origin: { kind: 'plugin', pluginId: 'ask-user', rendererId: 'form' },
      payload: { kind: 'plugin', title: 'Ask', data: {} }
    });
    appendPendingInteractionTimelineEvent(db!, hub as never, {
      ...grant,
      payload: {
        kind: 'approval',
        reason: 'edit',
        availableDecisions: ['allow_once', 'deny'],
        subject: {
          kind: 'file_change',
          itemId: 'item-f',
          writeScope: '/tmp',
          sessionGrant: null
        }
      }
    });
    appendPendingInteractionTimelineEvent(db!, hub as never, {
      ...grant,
      payload: {
        kind: 'approval',
        reason: 'plan',
        availableDecisions: ['allow_once', 'deny'],
        subject: { kind: 'plan', itemId: 'item-p', plan: 'Ship it', planFilePath: '/tmp/plan.md' }
      }
    });
    const types = listConversationThreadEvents(db!, thread.id).map((row) => row.type);
    expect(types).toEqual(expect.arrayContaining([
      'system/permissionGrant/lifecycle',
      'system/userQuestion/lifecycle',
      'system/operation',
      'item/started'
    ]));
    expect(types).not.toContain('item/completed');
  });
});
