import { describe, expect, it, vi } from 'vitest';
import { HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS, isRunningThreadRuntimeDisplayStatus, resolveConversationRuntimeState } from './conversation-runtime-display.js';

describe('resolveConversationRuntimeState', () => {
  it('passes durable non-active status through', () => {
    const ctx = {
      db: { sqlite: { prepare: () => ({ get: () => undefined }) } },
      hostHub: { connectedHostIds: () => [] }
    } as never;
    expect(resolveConversationRuntimeState(ctx, { status: 'idle', hostId: 'h1' })).toEqual({
      displayStatus: 'idle',
      hostReconnectGraceExpiresAt: null
    });
    expect(resolveConversationRuntimeState(ctx, { status: 'stopping', hostId: 'h1' }).displayStatus).toBe('stopping');
  });

  it('is active when the host is connected', () => {
    const ctx = {
      db: {},
      hostHub: { connectedHostIds: () => ['h1'] }
    } as never;
    expect(resolveConversationRuntimeState(ctx, { status: 'active', hostId: 'h1' })).toEqual({
      displayStatus: 'active',
      hostReconnectGraceExpiresAt: null
    });
  });

  it('uses host-reconnecting inside the disconnect grace window', () => {
    const now = 50_000;
    const closedAt = now - HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS + 1_000;
    const ctx = {
      db: {
        sqlite: {
          prepare: () => ({
            get: () => ({
              id: 's1',
              host_id: 'h1',
              instance_id: 'i',
              host_name: 'n',
              status: 'closed',
              close_reason: 'socket-closed',
              closed_at: closedAt,
              created_at: 1,
              updated_at: closedAt
            })
          })
        }
      },
      hostHub: { connectedHostIds: () => [] }
    } as never;
    const runtime = resolveConversationRuntimeState(ctx, { status: 'active', hostId: 'h1' }, now);
    expect(runtime.displayStatus).toBe('host-reconnecting');
    expect(runtime.hostReconnectGraceExpiresAt).toBe(closedAt + HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS);
  });

  it('uses waiting-for-host after grace expires', () => {
    const now = 80_000;
    const closedAt = now - HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS - 1;
    const ctx = {
      db: {
        sqlite: {
          prepare: () => ({
            get: () => ({
              id: 's1',
              host_id: 'h1',
              instance_id: 'i',
              host_name: 'n',
              status: 'closed',
              close_reason: 'socket-closed',
              closed_at: closedAt,
              created_at: 1,
              updated_at: closedAt
            })
          })
        }
      },
      hostHub: { connectedHostIds: () => [] }
    } as never;
    expect(resolveConversationRuntimeState(ctx, { status: 'active', hostId: 'h1' }, now)).toEqual({
      displayStatus: 'waiting-for-host',
      hostReconnectGraceExpiresAt: null
    });
  });
});

describe('isRunningThreadRuntimeDisplayStatus', () => {
  it('treats reconnecting as running and waiting-for-host as not', () => {
    expect(isRunningThreadRuntimeDisplayStatus('active')).toBe(true);
    expect(isRunningThreadRuntimeDisplayStatus('host-reconnecting')).toBe(true);
    expect(isRunningThreadRuntimeDisplayStatus('waiting-for-host')).toBe(false);
    expect(isRunningThreadRuntimeDisplayStatus('idle')).toBe(false);
  });
});

void vi;
