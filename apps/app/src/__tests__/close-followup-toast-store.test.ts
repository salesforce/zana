import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ closeFollowup: vi.fn() }));

vi.mock('../lib/product-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/product-client.js')>()),
  product: { terminals: { closeFollowup: h.closeFollowup } }
}));

const { useData, useUi } = await import('../store.js');

describe('Close with follow-up toast from the store', () => {
  afterEach(() => { h.closeFollowup.mockReset(); useData.setState({ closeWrapUpEnabled: false } as never); });

  async function close(result: unknown) {
    h.closeFollowup.mockResolvedValueOnce(result);
    const pushToast = vi.fn(() => 'toast-id');
    useUi.setState({ pushToast, dismissToast: vi.fn() } as never);
    useData.setState({ closeTerminal: vi.fn(async () => undefined), closingFollowupIds: new Set() } as never);
    await useData.getState().closeIdleAgents('p1', ['s1'], true, { force: true });
    return pushToast.mock.calls.at(-1);
  }

  it('names the failed step as an error when nothing was summarised', async () => {
    expect(await close({ summarized: 0, followedUp: 0, failures: [{ reason: 'summary-failed', detail: 'spawn / EACCES' }] }))
      .toEqual(['Closed 1 agent · the AI summary failed (details in the log).', 'error']);
  });

  it('reports a summary as info', async () => {
    expect(await close({ summarized: 1, followedUp: 1 })).toEqual(['Closed 1 agent · 1 summarized to inbox · 1 follow-up filed.', 'info']);
  });

  it('shows the progress toast with wrap-up wording only when on', async () => {
    for (const on of [true, false]) {
      useData.setState({ closeWrapUpEnabled: on } as never);
      h.closeFollowup.mockResolvedValueOnce({ summarized: 1, followedUp: 0 });
      const pushToast = vi.fn(() => 'toast-id');
      useUi.setState({ pushToast, dismissToast: vi.fn() } as never);
      useData.setState({ closeTerminal: vi.fn(async () => undefined), closingFollowupIds: new Set() } as never);
      await useData.getState().closeIdleAgents('p1', ['s1'], true, { force: true });
      expect(pushToast.mock.calls[0]).toEqual([
        on ? 'Wrapping up… the agent saves what it learnt, then closes.' : 'Closing… filing a follow-up if work is left.',
        'info',
        { persist: true }
      ]);
    }
  });

  it('toasts a kept-open agent as info, and as the only line when nothing closed', async () => {
    useData.setState({ closeWrapUpEnabled: true } as never);
    expect(await close({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'timeout' }] }))
      .toEqual(['Kept 1 agent open (see your inbox).', 'info']);
    expect(await close({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] }))
      .toEqual(['Kept 1 agent open.', 'info']);
  });
});
