import { describe, expect, it, vi } from 'vitest';
import { lastAssistantPreview, canCloseThreadWithFollowup } from './thread-close-followup.js';

describe('lastAssistantPreview', () => {
  it('returns the newest assistant preview', () => {
    expect(
      lastAssistantPreview([
        { role: 'user', preview: 'do the thing' },
        { role: 'assistant', preview: 'first pass' },
        { role: 'user', preview: 'keep going' },
        { role: 'assistant', preview: 'shipped the page. tests still missing.' }
      ])
    ).toBe('shipped the page. tests still missing.');
  });

  it('skips blank assistant rows and returns empty when none exist', () => {
    expect(
      lastAssistantPreview([
        { role: 'user', preview: 'hello' },
        { role: 'assistant', preview: '  ' }
      ])
    ).toBe('');
    expect(lastAssistantPreview([{ role: 'user', preview: 'hello' }])).toBe('');
  });
});

describe('canCloseThreadWithFollowup', () => {
  it('allows live threads and rejects already-archived ones', () => {
    expect(canCloseThreadWithFollowup({ archivedAt: null })).toBe(true);
    expect(canCloseThreadWithFollowup({})).toBe(true);
    expect(canCloseThreadWithFollowup({ archivedAt: 1 })).toBe(false);
  });
});

describe('closeConversationWithFollowup failures', () => {
  async function run(paper: unknown) {
    vi.resetModules();
    vi.doMock('@zana-ai/zcc-db', () => ({ getConversationThread: () => ({ id: 't1', projectId: 'p1', title: 'T' }) }));
    vi.doMock('./conversation-lifecycle.js', () => ({ archiveConversation: async () => true }));
    vi.doMock('./conversation-timeline.js', () => ({ conversationOutline: () => ({ items: [{ role: 'assistant', preview: 'done' }] }) }));
    const { closeConversationWithFollowup } = await import('./thread-close-followup.js');
    const ctx = { db: {}, closeSummary: { summarizeAndFollowUpFromLastTurn: async () => paper } };
    return closeConversationWithFollowup(ctx as never, 't1');
  }

  it('passes failures from the close summary through to the route response', async () => {
    const failures = [{ reason: 'write-failed' as const, detail: 'disk full' }];
    expect(await run({ summarized: 1, followedUp: 0, failures })).toEqual({ ok: true, summarized: 1, followedUp: 0, failures });
  });

  it('keeps the old response shape when there are no failures', async () => {
    expect(await run({ summarized: 1, followedUp: 1 })).toEqual({ ok: true, summarized: 1, followedUp: 1 });
    expect(await run({ summarized: 0, followedUp: 0, failures: [] })).toEqual({ ok: true, summarized: 0, followedUp: 0 });
  });
});
