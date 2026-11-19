import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

const respond = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const stopAndFixPlan = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const markAnswered = vi.fn();
const pushToast = vi.fn();

vi.mock('../product-client.js', () => ({
  product: {
    executionBoard: {
      respond: (...args: unknown[]) => respond(...args),
      stopAndFixPlan: (...args: unknown[]) => stopAndFixPlan(...args)
    }
  }
}));

vi.mock('../../store.js', () => ({
  useInboxAnswered: { getState: () => ({ markAnswered }) },
  useUi: { getState: () => ({ pushToast }) }
}));

const { respondToInboxBlocker, isNoRouteBlockerEntry, stopAndFixPlanFromInbox } = await import('../inboxBlockerRespond.js');

function makeEntry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: 'entry-1',
    ts: 0,
    projectId: 'proj-1',
    executionId: 'exec-1',
    blockerId: 'blocker-1',
    ...overrides
  } as InboxEntry;
}

describe('respondToInboxBlocker', () => {
  afterEach(() => {
    respond.mockReset();
    markAnswered.mockReset();
    pushToast.mockReset();
  });

  it('derives a deterministic clientRequestId from executionId+blockerId (no timestamp), stable across calls', async () => {
    respond.mockResolvedValue({ ok: true, value: {} });
    const entry = makeEntry();

    await respondToInboxBlocker(entry, 'first answer');
    await respondToInboxBlocker(entry, 'retry answer');

    expect(respond).toHaveBeenCalledTimes(2);
    const firstArgs = respond.mock.calls[0];
    const secondArgs = respond.mock.calls[1];
    // clientRequestId is the 5th positional arg (projectId, executionId, stateVersion, blockerId, clientRequestId, message)
    expect(firstArgs?.[4]).toBe('exec-1:blocker-1');
    expect(secondArgs?.[4]).toBe('exec-1:blocker-1');
    expect(firstArgs?.[4]).toBe(secondArgs?.[4]);
  });

  it('passes projectId/executionId/blockerId/message through positionally', async () => {
    respond.mockResolvedValue({ ok: true, value: {} });
    const entry = makeEntry({ projectId: 'proj-9', executionId: 'exec-9', blockerId: 'blocker-9' });

    await respondToInboxBlocker(entry, 'hello');

    // 7th positional arg is the explicit `allowLatestVersion` opt-in main now
    // requires to honor the -1 "use latest stateVersion" sentinel (see
    // cc-api.ts / execution-board.ts) — the Inbox reply flow is the one
    // legitimate caller, so it always passes `true` here.
    expect(respond).toHaveBeenCalledWith('proj-9', 'exec-9', -1, 'blocker-9', 'exec-9:blocker-9', 'hello', true);
  });

  it('on success: marks answered, pushes an info toast, returns true', async () => {
    respond.mockResolvedValue({ ok: true, value: {} });
    const entry = makeEntry();

    const ok = await respondToInboxBlocker(entry, 'answer');

    expect(ok).toBe(true);
    expect(markAnswered).toHaveBeenCalledWith('entry-1');
    expect(pushToast).toHaveBeenCalledWith('Response sent', 'info');
  });

  it('on a result.ok=false response: does not mark answered, pushes an error toast, returns false', async () => {
    respond.mockResolvedValue({ ok: false, code: 'STALE', message: 'stale state' });
    const entry = makeEntry();

    const ok = await respondToInboxBlocker(entry, 'answer');

    expect(ok).toBe(false);
    expect(markAnswered).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('stale state', 'error');
  });

  it('on a thrown rejection: does not throw further, does not mark answered, pushes an error toast, returns false', async () => {
    respond.mockRejectedValue(new Error('IPC exploded'));
    const entry = makeEntry();

    await expect(respondToInboxBlocker(entry, 'answer')).resolves.toBe(false);
    expect(markAnswered).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('IPC exploded', 'error');
  });

  it('returns false without calling respond when executionId or blockerId is missing', async () => {
    const entry = makeEntry({ blockerId: undefined });

    const ok = await respondToInboxBlocker(entry, 'answer');

    expect(ok).toBe(false);
    expect(respond).not.toHaveBeenCalled();
  });
});

describe('stop and fix the plan', () => {
  afterEach(() => {
    stopAndFixPlan.mockReset();
    markAnswered.mockReset();
    pushToast.mockReset();
  });

  it('recognises a no-route blocker card by its id prefix', () => {
    expect(isNoRouteBlockerEntry(makeEntry({ blockerId: 'no-route:1:a:1:0' }))).toBe(true);
    expect(isNoRouteBlockerEntry(makeEntry())).toBe(false);
    expect(isNoRouteBlockerEntry(makeEntry({ executionId: undefined, blockerId: 'no-route:1' }))).toBe(false);
  });

  it('sends project, execution and blocker, then marks the card answered and tells the person', async () => {
    stopAndFixPlan.mockResolvedValue({ ok: true, value: {} });
    const entry = makeEntry({ blockerId: 'no-route:1:a:1:0' });
    expect(await stopAndFixPlanFromInbox(entry)).toBe(true);
    expect(stopAndFixPlan).toHaveBeenCalledWith('proj-1', 'exec-1', 'no-route:1:a:1:0');
    expect(markAnswered).toHaveBeenCalledWith('entry-1');
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('Work already done is kept'), 'info');
  });

  it('surfaces a refusal or a thrown IPC error and leaves the card open', async () => {
    stopAndFixPlan.mockResolvedValueOnce({ ok: false, message: 'This run has already ended.' });
    expect(await stopAndFixPlanFromInbox(makeEntry())).toBe(false);
    expect(pushToast).toHaveBeenLastCalledWith('This run has already ended.', 'error');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stopAndFixPlan.mockRejectedValueOnce(new Error('ipc down'));
    expect(await stopAndFixPlanFromInbox(makeEntry())).toBe(false);
    expect(pushToast).toHaveBeenLastCalledWith('ipc down', 'error');
    log.mockRestore();
    expect(await stopAndFixPlanFromInbox(makeEntry({ blockerId: undefined }))).toBe(false);
    expect(markAnswered).not.toHaveBeenCalled();
  });
});
