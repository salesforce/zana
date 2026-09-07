import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listConversationThreadEventsWindow } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { LIVE_TURN_COMMAND_TIMEOUT_MS } from '../../http/host-hub.js';
import {
  hasLatestRootTurnCompleted,
  hasTerminalClientTurnRequestEvent,
  startLiveTurnCommand
} from './conversation-turn-settlement.js';

vi.mock('@zana-ai/zcc-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-db')>();
  return {
    ...actual,
    listConversationThreadEventsWindow: vi.fn(() => [])
  };
});

const threadId = '11111111-1111-4111-8111-111111111111';
const requestId = 'creq_23456789ab';

function eventRow(input: {
  type: string;
  payload: Record<string, unknown>;
  sequence?: number;
}) {
  return {
    id: `evt-${input.sequence ?? 1}`,
    threadId,
    sequence: input.sequence ?? 1,
    type: input.type,
    payload: input.payload,
    createdAt: input.sequence ?? 1
  };
}

function ctx(): ProductHttpContext {
  return { db: {} } as ProductHttpContext;
}

describe('conversation turn settlement helpers', () => {
  beforeEach(() => {
    vi.mocked(listConversationThreadEventsWindow).mockReset();
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([]);
  });

  it('treats accepted and rejected events as terminal for a request', () => {
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      eventRow({
        type: 'turn/input/accepted',
        payload: { type: 'turn/input/accepted', clientRequestId: requestId }
      })
    ]);
    expect(hasTerminalClientTurnRequestEvent(ctx(), { threadId, requestId })).toBe(true);

    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      eventRow({
        type: 'client/turn/rejected',
        payload: { type: 'client/turn/rejected', requestId }
      })
    ]);
    expect(hasTerminalClientTurnRequestEvent(ctx(), { threadId, requestId })).toBe(true);

    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      eventRow({
        type: 'turn/input/accepted',
        payload: { type: 'turn/input/accepted', clientRequestId: 'creq_23456789ac' }
      })
    ]);
    expect(hasTerminalClientTurnRequestEvent(ctx(), { threadId, requestId })).toBe(false);
  });

  it('detects when the latest root turn already completed', () => {
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      eventRow({
        sequence: 1,
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          scope: { kind: 'turn', turnId: 'turn-1' }
        }
      }),
      eventRow({
        sequence: 2,
        type: 'turn/completed',
        payload: {
          type: 'turn/completed',
          status: 'completed',
          scope: { kind: 'turn', turnId: 'turn-1' }
        }
      })
    ]);
    expect(hasLatestRootTurnCompleted(ctx(), threadId)).toBe(true);

    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      eventRow({
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          scope: { kind: 'turn', turnId: 'turn-live' }
        }
      })
    ]);
    expect(hasLatestRootTurnCompleted(ctx(), threadId)).toBe(false);
  });

  it('ignores nested completions when deciding the latest root turn', () => {
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      eventRow({
        sequence: 1,
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          parentToolCallId: '   ',
          scope: { kind: 'turn', turnId: 'root' }
        }
      }),
      eventRow({
        sequence: 2,
        type: 'turn/completed',
        payload: {
          type: 'turn/completed',
          parentToolCallId: 'tool-1',
          scope: { kind: 'turn', turnId: 'child' }
        }
      })
    ]);
    expect(hasLatestRootTurnCompleted(ctx(), threadId)).toBe(false);
  });

  it('starts a live host command without waiting for the RPC', async () => {
    let resolveRpc: (value: unknown) => void = () => undefined;
    const callHostOnlineRpc = vi.fn(() => new Promise((resolve) => {
      resolveRpc = resolve;
    }));
    const onSuccess = vi.fn();
    const product = {
      db: {},
      hostHub: { callHostOnlineRpc }
    } as unknown as ProductHttpContext;
    startLiveTurnCommand(product, {
      hostId: 'host-1',
      command: {
        type: 'thread.stop',
        threadId
      },
      onSuccess
    });
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      hostId: 'host-1',
      timeoutMs: LIVE_TURN_COMMAND_TIMEOUT_MS
    }));
    expect(onSuccess).not.toHaveBeenCalled();
    resolveRpc({ stopped: true });
    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ stopped: true });
    });
  });

  it('forwards live command failures to onError', async () => {
    const callHostOnlineRpc = vi.fn(async () => {
      throw new Error('host gone');
    });
    const onError = vi.fn();
    const product = {
      db: {},
      hostHub: { callHostOnlineRpc }
    } as unknown as ProductHttpContext;
    startLiveTurnCommand(product, {
      hostId: 'host-1',
      command: {
        type: 'thread.stop',
        threadId
      },
      onError
    });
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'host gone' }));
    });
  });
});
