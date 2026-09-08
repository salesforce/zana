import { describe, expect, it, vi } from 'vitest';
import { ThreadCreateError } from '../../http/thread-create.js';
import {
  ensureConversationThreadIsWritable,
  resolveConversationSendMode,
  shouldQueueGhostActiveSend
} from './conversation-send-request.js';

const idle = {
  id: 't1',
  projectId: 'p',
  hostId: 'h1',
  environmentId: 'e',
  providerId: 'claude-code',
  status: 'idle' as const,
  originKind: null,
  visibility: 'visible' as const,
  title: 't',
  providerThreadId: null,
  parentThreadId: null,
  archivedAt: null,
  pinnedAt: null,
  pinOrder: null,
  createdAt: 1,
  updatedAt: 1
};

describe('ensureConversationThreadIsWritable', () => {
  it('rejects archived and stopping threads', () => {
    expect(() => ensureConversationThreadIsWritable({ ...idle, archivedAt: 9 })).toThrow(ThreadCreateError);
    expect(() => ensureConversationThreadIsWritable({ ...idle, status: 'stopping' })).toThrow(ThreadCreateError);
    expect(() => ensureConversationThreadIsWritable(idle)).not.toThrow();
    expect(() => ensureConversationThreadIsWritable({ ...idle, status: 'error' })).not.toThrow();
  });
});

describe('resolveConversationSendMode', () => {
  it('maps requested modes onto start/auto/steer', () => {
    expect(resolveConversationSendMode(idle, 'start')).toBe('start');
    expect(resolveConversationSendMode({ ...idle, status: 'active' }, 'auto')).toBe('auto');
    expect(resolveConversationSendMode({ ...idle, status: 'active' }, 'steer')).toBe('steer');
    expect(resolveConversationSendMode(idle, 'steer-if-active')).toBe('start');
    expect(resolveConversationSendMode(idle, 'queue-if-active')).toBe('start');
  });

  it('rejects start on an already active thread', () => {
    expect(() => resolveConversationSendMode({ ...idle, status: 'active' }, 'start')).toThrow(ThreadCreateError);
  });

  it('drains queue-if-active onto an active thread as auto', () => {
    expect(resolveConversationSendMode({ ...idle, status: 'active' }, 'queue-if-active')).toBe('auto');
    expect(resolveConversationSendMode({ ...idle, status: 'starting' }, 'queue-if-active')).toBe('auto');
  });
});

describe('shouldQueueGhostActiveSend', () => {
  it('queues auto sends when the display status is waiting-for-host', () => {
    const ctx = {
      db: {
        sqlite: {
          prepare: () => ({
            get: () => undefined
          })
        }
      },
      hostHub: { connectedHostIds: () => [] }
    } as never;
    expect(shouldQueueGhostActiveSend(ctx, { ...idle, status: 'active' }, 'auto')).toBe(true);
    expect(shouldQueueGhostActiveSend(ctx, { ...idle, status: 'active' }, 'steer')).toBe(false);
    expect(shouldQueueGhostActiveSend(ctx, idle, 'auto')).toBe(false);
  });
});

void vi;
