// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

const api = vi.hoisted(() => ({
  hostActions: { get: vi.fn(), run: vi.fn() } as { get?: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> }
}));
vi.mock('../../lib/product-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/product-client.js')>();
  return { ...actual, product: new Proxy(actual.product, {
    get: (target, prop, receiver) => prop === 'inbox'
      ? { ...(target as { inbox: object }).inbox, hostActions: api.hostActions }
      : Reflect.get(target, prop, receiver)
  }) };
});
import { resolveInboxHostAction, runInboxHostAction, useInboxHostActions } from '../../stores/live.js';

const entry = (over: Partial<InboxEntry> = {}) => ({ id: 'e1', ts: 1, ...over }) as InboxEntry;
const action = { entryId: 'e1', kind: 'worktree', status: 'pending' } as const;
const resolution = () => useInboxHostActions.getState().resolutionByEntryId['e1'];

describe('Inbox host action store routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.hostActions = { get: vi.fn(), run: vi.fn() };
    useInboxHostActions.setState({ byEntryId: {}, resolutionByEntryId: {} });
  });

  it('records main-listed ownership from the per-entry lookup', async () => {
    api.hostActions.get!.mockResolvedValue({ resolved: true, action });
    await resolveInboxHostAction(entry());
    expect(api.hostActions.get).toHaveBeenCalledWith('e1');
    expect(useInboxHostActions.getState().byEntryId['e1']).toEqual(action);
    expect(resolution()).toMatchObject({ loading: false, error: false, resolved: true });
  });

  it('does not derive host authority from entry fields', async () => {
    api.hostActions.get!.mockResolvedValue({ resolved: true, action: null });
    await resolveInboxHostAction(entry({ hostAction: { kind: 'worktree' } } as Partial<InboxEntry>));
    expect(useInboxHostActions.getState().byEntryId['e1']).toBeUndefined();
    expect(resolution()).toMatchObject({ resolved: true, error: false });
  });

  it('fails closed when the lookup throws or is unresolved', async () => {
    api.hostActions.get!.mockRejectedValue(new Error('ipc down'));
    await resolveInboxHostAction(entry());
    expect(resolution()).toMatchObject({ loading: false, error: true, resolved: false });

    api.hostActions.get!.mockResolvedValue({ resolved: false, action: null });
    await resolveInboxHostAction(entry());
    expect(resolution()).toMatchObject({ loading: false, error: true, resolved: false });
  });

  it('without a desktop lookup, only unmarked entries resolve as not host-owned', async () => {
    api.hostActions = { run: vi.fn() };
    await resolveInboxHostAction(entry());
    expect(resolution()).toMatchObject({ resolved: true, error: false });

    await resolveInboxHostAction(entry({ hostActionRequired: true }));
    expect(resolution()).toMatchObject({ resolved: false, error: true });
  });

  it('runs only ids previously supplied by main, then re-resolves ownership', async () => {
    expect(await runInboxHostAction('e1', { optionId: 'delete' })).toBe(false);
    expect(api.hostActions.run).not.toHaveBeenCalled();

    useInboxHostActions.getState().setActions([action]);
    api.hostActions.run.mockResolvedValue({ ok: true });
    api.hostActions.get!.mockResolvedValue({ resolved: true, action: null });
    expect(await runInboxHostAction('e1', { optionId: 'delete' })).toBe(true);
    expect(api.hostActions.run).toHaveBeenCalledWith('e1', { optionId: 'delete' });
    expect(api.hostActions.get).toHaveBeenCalledWith('e1');
    expect(useInboxHostActions.getState().byEntryId['e1']).toBeUndefined();
  });

  it('reports failure when the host run is rejected or throws', async () => {
    useInboxHostActions.getState().setActions([action]);
    api.hostActions.get!.mockResolvedValue({ resolved: true, action });
    api.hostActions.run.mockResolvedValueOnce({ ok: false });
    expect(await runInboxHostAction('e1')).toBe(false);
    api.hostActions.run.mockRejectedValueOnce(new Error('boom'));
    expect(await runInboxHostAction('e1')).toBe(false);
  });
});
