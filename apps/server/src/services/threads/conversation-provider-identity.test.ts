import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationThreadRow } from '@zana-ai/zcc-db';
import {
  PROVIDER_IDENTITY_SCAN_CAP,
  providerThreadIdFromPayload,
  recoverConversationProviderThreadId,
  rememberConversationProviderThreadId
} from './conversation-provider-identity.js';

const thread: ConversationThreadRow = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: 'proj-1',
  hostId: 'host-1',
  environmentId: '22222222-2222-4222-8222-222222222222',
  providerId: 'claude-code',
  status: 'idle',
  originKind: null,
  visibility: 'visible',
  title: 'Hello',
  providerThreadId: null,
  parentThreadId: null,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1
};

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(),
  setConversationProviderThreadId: vi.fn(),
  listConversationThreadEventsWindow: vi.fn()
}));

import {
  getConversationThread,
  listConversationThreadEventsWindow,
  setConversationProviderThreadId
} from '@zana-ai/zcc-db';

beforeEach(() => {
  vi.mocked(getConversationThread).mockReset();
  vi.mocked(setConversationProviderThreadId).mockReset();
  vi.mocked(listConversationThreadEventsWindow).mockReset();
});

describe('providerThreadIdFromPayload', () => {
  it('reads a non-empty providerThreadId from an event payload', () => {
    expect(providerThreadIdFromPayload({
      type: 'thread/identity',
      providerThreadId: 'prov-1'
    })).toBe('prov-1');
  });

  it('ignores missing, blank, and non-string identities', () => {
    expect(providerThreadIdFromPayload(null)).toBeUndefined();
    expect(providerThreadIdFromPayload({})).toBeUndefined();
    expect(providerThreadIdFromPayload({ providerThreadId: '  ' })).toBeUndefined();
    expect(providerThreadIdFromPayload({ providerThreadId: null })).toBeUndefined();
  });
});

describe('rememberConversationProviderThreadId', () => {
  it('persists a new identity and skips a no-op rewrite', () => {
    vi.mocked(getConversationThread).mockReturnValue(thread);
    vi.mocked(setConversationProviderThreadId).mockReturnValue({
      ...thread,
      providerThreadId: 'prov-1'
    });
    expect(rememberConversationProviderThreadId({} as never, thread.id, 'prov-1')?.providerThreadId).toBe('prov-1');
    expect(setConversationProviderThreadId).toHaveBeenCalledWith(expect.anything(), thread.id, 'prov-1');

    vi.mocked(getConversationThread).mockReturnValue({ ...thread, providerThreadId: 'prov-1' });
    vi.mocked(setConversationProviderThreadId).mockClear();
    expect(rememberConversationProviderThreadId({} as never, thread.id, 'prov-1')?.providerThreadId).toBe('prov-1');
    expect(setConversationProviderThreadId).not.toHaveBeenCalled();
  });
});

describe('recoverConversationProviderThreadId', () => {
  it('returns the row unchanged when a provider session is already stored', () => {
    const stored = { ...thread, providerThreadId: 'prov-1' };
    expect(recoverConversationProviderThreadId({} as never, stored)).toBe(stored);
    expect(listConversationThreadEventsWindow).not.toHaveBeenCalled();
  });

  it('recovers the newest identity from stored events', () => {
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      { id: 'e1', threadId: thread.id, sequence: 1, type: 'turn/started', payload: { providerThreadId: 'prov-old' }, createdAt: 1 },
      { id: 'e2', threadId: thread.id, sequence: 2, type: 'thread/identity', payload: { providerThreadId: 'prov-new' }, createdAt: 2 }
    ]);
    vi.mocked(getConversationThread).mockReturnValue(thread);
    vi.mocked(setConversationProviderThreadId).mockReturnValue({
      ...thread,
      providerThreadId: 'prov-new'
    });
    expect(recoverConversationProviderThreadId({} as never, thread).providerThreadId).toBe('prov-new');
    expect(listConversationThreadEventsWindow).toHaveBeenCalledWith(
      expect.anything(),
      thread.id,
      { limit: PROVIDER_IDENTITY_SCAN_CAP }
    );
  });
});
