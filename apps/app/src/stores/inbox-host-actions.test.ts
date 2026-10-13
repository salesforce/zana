import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());

vi.mock('../lib/product-client.js', () => ({
  product: { inbox: { hostActions: { get, list: vi.fn() } } }
}));

import { resolveInboxHostAction, useInboxHostActions } from './live.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('inbox host-action ownership resolution', () => {
  afterEach(() => {
    get.mockReset();
    useInboxHostActions.setState({ byEntryId: {}, resolutionByEntryId: {} });
  });

  it('keeps selected entry fail-closed when ownership lookup rejects', async () => {
    get.mockRejectedValueOnce(new Error('registry read failed'));

    await resolveInboxHostAction({ id: 'selected' });

    expect(useInboxHostActions.getState().byEntryId.selected).toBeUndefined();
    expect(useInboxHostActions.getState().resolutionByEntryId.selected).toMatchObject({
      loading: false,
      error: true,
      resolved: false
    });
  });

  it('keeps newer selected-entry resolution when action refresh overlaps it', async () => {
    const first = deferred<{ resolved: boolean; action: null | { entryId: string; kind: string; status: 'pending' } }>();
    const second = deferred<{ resolved: boolean; action: null | { entryId: string; kind: string; status: 'pending' } }>();
    get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const selected = resolveInboxHostAction({ id: 'entry' });
    const actionRefresh = resolveInboxHostAction({ id: 'entry' });
    second.resolve({ resolved: true, action: { entryId: 'entry', kind: 'worktree', status: 'pending' } });
    await actionRefresh;
    first.resolve({ resolved: true, action: null });
    await selected;

    expect(useInboxHostActions.getState().byEntryId.entry).toMatchObject({ kind: 'worktree', status: 'pending' });
    expect(useInboxHostActions.getState().resolutionByEntryId.entry).toMatchObject({
      loading: false,
      error: false,
      resolved: true
    });
  });

  it('does not let entry A completion clear entry B loading gate', async () => {
    const a = deferred<{ resolved: boolean; action: null }>();
    const b = deferred<{ resolved: boolean; action: null }>();
    get.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

    const lookupA = resolveInboxHostAction({ id: 'A' });
    const lookupB = resolveInboxHostAction({ id: 'B' });
    a.resolve({ resolved: true, action: null });
    await lookupA;

    expect(useInboxHostActions.getState().resolutionByEntryId.B).toMatchObject({ loading: true, resolved: false });
    b.resolve({ resolved: true, action: null });
    await lookupB;
    expect(useInboxHostActions.getState().resolutionByEntryId.B).toMatchObject({ loading: false, error: false, resolved: true });
  });

  it('confirms unmarked browser entries as non-host without a desktop lookup', async () => {
    vi.mocked(get).mockReset();
    const original = (await import('../lib/product-client.js')).product.inbox.hostActions;
    Object.assign((await import('../lib/product-client.js')).product.inbox, { hostActions: undefined });

    await resolveInboxHostAction({ id: 'browser-entry' });

    expect(useInboxHostActions.getState().resolutionByEntryId['browser-entry']).toMatchObject({
      loading: false, error: false, resolved: true
    });
    Object.assign((await import('../lib/product-client.js')).product.inbox, { hostActions: original });
  });

  it('keeps browser host-only entries fail-closed without a desktop lookup', async () => {
    const product = (await import('../lib/product-client.js')).product;
    const original = product.inbox.hostActions;
    Object.assign(product.inbox, { hostActions: undefined });

    await resolveInboxHostAction({ id: 'host-entry', hostActionRequired: true });

    expect(useInboxHostActions.getState().resolutionByEntryId['host-entry']).toMatchObject({
      loading: false, error: true, resolved: false
    });
    Object.assign(product.inbox, { hostActions: original });
  });
});
