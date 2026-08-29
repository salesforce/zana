import { describe, expect, it } from 'vitest';
import { queuedMessageTextFromUnknown } from './queued-message-text.js';
import { canEditConversationMessage, visibleMessageText } from './MessageActionBar.js';
import { quoteForComposer } from '../secondary-panel/SecondaryPanelSelectionActions.js';
import { previousQueuedIdAfterReorder } from './queued-reorder.js';

describe('queued message text', () => {
  it('joins text parts', () => {
    expect(queuedMessageTextFromUnknown({
      content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'there' }]
    })).toBe('hello\nthere');
    expect(queuedMessageTextFromUnknown(null)).toBe('');
  });
});

describe('message overflow', () => {
  it('clips long messages until expanded', () => {
    const long = 'a'.repeat(2500);
    expect(visibleMessageText(long, false).endsWith('…')).toBe(true);
    expect(visibleMessageText(long, true)).toBe(long);
    expect(visibleMessageText('short', false)).toBe('short');
  });
});

describe('message actions helpers', () => {
  it('quotes selected text for the composer', () => {
    expect(quoteForComposer('hello\nworld')).toBe('> hello\n> world');
  });

  it('computes the previous queued id after a drag reorder', () => {
    expect(previousQueuedIdAfterReorder(['a', 'b', 'c'], 'c', 'a')).toBe(null);
    expect(previousQueuedIdAfterReorder(['a', 'b', 'c'], 'a', 'c')).toBe('c');
    expect(previousQueuedIdAfterReorder(['a', 'b', 'c'], 'a', 'a')).toBeUndefined();
  });

  it('allows editing accepted idle user messages only', () => {
    const request = { kind: 'message', status: 'accepted' };
    expect(canEditConversationMessage({ role: 'user', turnRequest: request }, true)).toBe(true);
    expect(canEditConversationMessage({ role: 'user', turnRequest: request }, false)).toBe(false);
    expect(canEditConversationMessage({ role: 'assistant', turnRequest: request }, true)).toBe(false);
  });
});
