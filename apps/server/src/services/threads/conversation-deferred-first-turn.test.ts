import { describe, expect, it, vi } from 'vitest';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(() => ({ id: 'thr-1', status: 'starting' })),
  listConversationThreadEventsWindow: vi.fn(() => [
    {
      sequence: 1,
      type: 'client/turn/requested',
      payload: {
        source: 'spawn',
        target: { kind: 'thread-start' },
        input: [
          { type: 'text', text: 'seed', visibility: 'agent-only' },
          { type: 'text', text: 'hello' }
        ]
      }
    }
  ])
}));

import {
  getLeadingAgentOnlyInput,
  prependDeferredFirstTurnContext,
  resolveDeferredFirstTurnContext
} from './conversation-deferred-first-turn.js';
import type { ProductHttpContext } from '../../http/product-context.js';

describe('deferred first-turn context', () => {
  it('takes leading agent-only parts and leaves visible input', () => {
    expect(getLeadingAgentOnlyInput([
      { type: 'text', text: 'seed', visibility: 'agent-only' },
      { type: 'text', text: 'hello' }
    ])).toEqual([{ type: 'text', text: 'seed', visibility: 'agent-only' }]);
  });

  it('resolves leftover seed context when no turn has started', () => {
    expect(resolveDeferredFirstTurnContext({ db: {} } as ProductHttpContext, 'thr-1')).toEqual({
      input: [{ type: 'text', text: 'seed', visibility: 'agent-only' }],
      requestSequence: 1
    });
  });

  it('prepends context onto the next prompt array', () => {
    expect(prependDeferredFirstTurnContext(
      [{ type: 'text', text: 'follow-up' }],
      { input: [{ type: 'text', text: 'seed' }], requestSequence: 1 }
    )).toEqual([
      { type: 'text', text: 'seed' },
      { type: 'text', text: 'follow-up' }
    ]);
  });
});
