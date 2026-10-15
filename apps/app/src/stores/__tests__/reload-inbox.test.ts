import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const history = vi.fn();
const getReadState = vi.fn();
const scope = vi.hoisted(() => ({ projectId: null as string | null }));

vi.mock('../../lib/product-client.js', () => ({
  product: {
    inbox: {
      history: (...args: unknown[]) => history(...args),
      getReadState: (...args: unknown[]) => getReadState(...args)
    }
  }
}));
vi.mock('../../lib/windowScope.js', () => ({
  getScopedProjectId: () => scope.projectId,
  isScopedWindow: () => scope.projectId !== null
}));

const entry = (id: string, ts: number) => ({ id, ts, projectId: 'p1' });

describe('reloadInbox', () => {
  beforeEach(() => {
    history.mockReset();
    getReadState.mockReset().mockResolvedValue({ readIds: [], migratedFromLocalStorage: true });
    scope.projectId = null;
  });
  afterEach(() => vi.resetModules());

  it('replaces the feed with the newest 100 and hydrates read state', async () => {
    const { reloadInbox, useInbox } = await import('../live.js');
    useInbox.setState({ entries: [entry('stale', 5)] as never[], loading: true });
    history.mockResolvedValue({ entries: [entry('b', 20), entry('a', 10)], hasMore: false });
    await expect(reloadInbox()).resolves.toBe(true);
    expect(history).toHaveBeenCalledWith({ limit: 100 });
    expect(getReadState).toHaveBeenCalledOnce();
    expect(useInbox.getState()).toMatchObject({ loading: false, entries: [entry('b', 20), entry('a', 10)] });
  });

  it('scopes a project window and keeps a push that landed during the read', async () => {
    scope.projectId = 'p1';
    const { reloadInbox, useInbox } = await import('../live.js');
    useInbox.setState({ entries: [entry('pushed', 30), entry('b', 20)] as never[] });
    history.mockResolvedValue({ entries: [entry('b', 20)], hasMore: false });
    await reloadInbox();
    expect(history).toHaveBeenCalledWith({ limit: 100, projectId: 'p1' });
    expect(useInbox.getState().entries.map((e) => e.id)).toEqual(['pushed', 'b']);
  });

  it('keeps the list and only toasts a failed manual refresh', async () => {
    const { reloadInbox, useInbox } = await import('../live.js');
    const { useUi } = await import('../../store.js');
    const pushToast = vi.spyOn(useUi.getState(), 'pushToast');
    useInbox.setState({ entries: [entry('a', 10)] as never[], loading: true });
    history.mockRejectedValue(new Error('offline'));
    await expect(reloadInbox()).resolves.toBe(false);
    expect(pushToast).not.toHaveBeenCalled();
    expect(useInbox.getState()).toMatchObject({ loading: false, entries: [entry('a', 10)] });
    await expect(reloadInbox({ notify: true })).resolves.toBe(false);
    expect(pushToast).toHaveBeenCalledOnce();
    expect(String(pushToast.mock.calls[0]?.[0])).toContain('offline');
  });
});
