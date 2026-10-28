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
    const ctx = { db: {}, config: { getConfig: () => ({}) }, closeSummary: { summarizeAndFollowUpFromLastTurn: async () => paper } };
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

describe('closeConversationWithFollowup wrap-up', () => {
  async function run(opts: { enabled: boolean; wrapUp?: 'wrapping-up' | 'kept-open' | 'fallback' | 'throws' | 'throws-plain'; thread?: unknown }) {
    vi.resetModules();
    const request = vi.fn(async () => {
      if (opts.wrapUp === 'throws') throw new Error('registry broke');
      if (opts.wrapUp === 'throws-plain') throw 'plain';
      return opts.wrapUp ?? 'wrapping-up';
    });
    const archive = vi.fn(async () => true);
    const summarize = vi.fn(async () => ({ summarized: 1, followedUp: 0 }));
    vi.doMock('@zana-ai/zcc-db', () => ({
      getConversationThread: () => (opts.thread === undefined ? { id: 't1', projectId: 'p1', title: 'T' } : opts.thread)
    }));
    vi.doMock('./conversation-lifecycle.js', () => ({ archiveConversation: archive }));
    vi.doMock('./conversation-timeline.js', () => ({ conversationOutline: () => ({ items: [] }) }));
    vi.doMock('./thread-wrap-up.js', () => ({ threadWrapUps: () => ({ request }) }));
    const { closeConversationWithFollowup } = await import('./thread-close-followup.js');
    const ctx = { db: {}, config: { getConfig: () => ({ closeWrapUpEnabled: opts.enabled }) }, closeSummary: { summarizeAndFollowUpFromLastTurn: summarize } };
    const result = await closeConversationWithFollowup(ctx as never, 't1').catch((e) => e);
    return { result, request, archive, summarize };
  }

  it('returns at once with wrappingUp when on, without the paper trail or archive', async () => {
    const { result, request, archive, summarize } = await run({ enabled: true });
    expect(result).toEqual({ ok: true, summarized: 0, followedUp: 0, wrappingUp: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(summarize).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });

  it('falls back to today\'s close when the job cannot ask the thread', async () => {
    const { result, summarize, archive } = await run({ enabled: true, wrapUp: 'fallback' });
    expect(result).toEqual({ ok: true, summarized: 1, followedUp: 0 });
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it('answers keptOpen when the thread already waits on the user, without the paper trail or archive', async () => {
    const { result, summarize, archive } = await run({ enabled: true, wrapUp: 'kept-open' });
    expect(result).toEqual({ ok: true, summarized: 0, followedUp: 0, keptOpen: 'asks-you' });
    expect(summarize).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });

  it('falls back to today\'s close when starting the wrap-up throws, and logs why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result, summarize, archive } = await run({ enabled: true, wrapUp: 'throws' });
      expect(result).toEqual({ ok: true, summarized: 1, followedUp: 0 });
      expect(summarize).toHaveBeenCalledTimes(1);
      expect(archive).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('thread=t1 wrap-up could not start, closing now: registry broke'));
      await run({ enabled: true, wrapUp: 'throws-plain' });
      expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('closing now: plain'));
    } finally {
      warn.mockRestore();
    }
  });

  it('is unchanged when off', async () => {
    const { result, request, summarize } = await run({ enabled: false });
    expect(result).toEqual({ ok: true, summarized: 1, followedUp: 0 });
    expect(request).not.toHaveBeenCalled();
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it('still answers 404 and 409 first', async () => {
    const missing = await run({ enabled: true, thread: null });
    expect(missing.result).toMatchObject({ status: 404 });
    expect(missing.request).not.toHaveBeenCalled();
    const archived = await run({ enabled: true, thread: { id: 't1', projectId: 'p1', archivedAt: 5 } });
    expect(archived.result).toMatchObject({ status: 409 });
    expect(archived.request).not.toHaveBeenCalled();
  });
});
