import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostActions = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() as ReturnType<typeof vi.fn> | undefined, run: vi.fn() }));
vi.mock('../lib/product-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/product-client.js')>();
  return { ...actual, product: new Proxy(actual.product as object, {
    get: (target, key) => key === 'inbox' ? { ...(Reflect.get(target, key) as object), hostActions } : Reflect.get(target, key)
  }) };
});

import {
  pruneInboxMarkers, refreshInboxHostActions, resolveInboxHostAction, runInboxHostAction, useInboxHostActions
} from './live';

const action = (entryId: string) => ({ entryId, actionId: `act-${entryId}` }) as never;
const state = () => useInboxHostActions.getState();

beforeEach(() => {
  hostActions.list.mockReset(); hostActions.run.mockReset();
  hostActions.get = vi.fn();
  useInboxHostActions.setState({ byEntryId: {}, resolutionByEntryId: {} });
});

describe('inbox host actions store', () => {
  it('indexes actions by entry id and replaces the previous set', () => {
    state().setActions([action('a'), action('b')]);
    state().setActions([action('c')]);
    expect(Object.keys(state().byEntryId)).toEqual(['c']);
  });

  it('refresh loads the list; a missing registry or failure leaves an empty/previous set', async () => {
    hostActions.list.mockResolvedValueOnce([action('a')]);
    await refreshInboxHostActions();
    expect(Object.keys(state().byEntryId)).toEqual(['a']);
    hostActions.list.mockResolvedValueOnce(undefined);
    await refreshInboxHostActions();
    expect(state().byEntryId).toEqual({});
    state().setActions([action('keep')]);
    hostActions.list.mockRejectedValueOnce(new Error('ipc'));
    await expect(refreshInboxHostActions()).resolves.toBeUndefined();
    expect(Object.keys(state().byEntryId)).toEqual(['keep']);
  });

  it('beginResolution bumps the generation and marks loading', () => {
    expect(state().beginResolution('a')).toBe(1);
    expect(state().beginResolution('a')).toBe(2);
    expect(state().resolutionByEntryId.a).toEqual({ generation: 2, loading: true, error: false, resolved: false });
  });

  it('resolveEntry stores or removes the action and ignores stale generations', () => {
    const g1 = state().beginResolution('a');
    state().resolveEntry('a', g1, { resolved: true, action: action('a') });
    expect(state().byEntryId.a).toBeTruthy();
    expect(state().resolutionByEntryId.a).toMatchObject({ loading: false, error: false, resolved: true });
    const g2 = state().beginResolution('a');
    state().resolveEntry('a', g1, { resolved: true, action: null });
    expect(state().byEntryId.a).toBeTruthy();
    state().resolveEntry('a', g2, { resolved: true, action: null });
    expect(state().byEntryId.a).toBeUndefined();
    const g3 = state().beginResolution('a');
    state().resolveEntry('a', g3, { resolved: false, action: null });
    expect(state().resolutionByEntryId.a).toMatchObject({ error: true, resolved: false });
  });

  it('failResolution only applies to the current generation', () => {
    const g1 = state().beginResolution('a');
    const g2 = state().beginResolution('a');
    state().failResolution('a', g1);
    expect(state().resolutionByEntryId.a).toMatchObject({ generation: g2, loading: true, error: false });
    state().failResolution('a', g2);
    expect(state().resolutionByEntryId.a).toMatchObject({ loading: false, error: true, resolved: false });
  });

  it('resolveInboxHostAction uses the host lookup', async () => {
    hostActions.get!.mockResolvedValue({ resolved: true, action: action('a') });
    await resolveInboxHostAction({ id: 'a' });
    expect(hostActions.get).toHaveBeenCalledWith('a');
    expect(state().byEntryId.a).toBeTruthy();
  });

  it('resolveInboxHostAction records an error when the lookup throws', async () => {
    hostActions.get!.mockRejectedValue(new Error('ipc'));
    await resolveInboxHostAction({ id: 'a' });
    expect(state().resolutionByEntryId.a).toMatchObject({ loading: false, error: true });
  });

  it('without a host lookup, unmarked entries resolve clean and marked entries fail closed', async () => {
    hostActions.get = undefined;
    await resolveInboxHostAction({ id: 'plain' });
    expect(state().resolutionByEntryId.plain).toMatchObject({ resolved: true, error: false });
    await resolveInboxHostAction({ id: 'marked', hostActionRequired: true } as never);
    expect(state().resolutionByEntryId.marked).toMatchObject({ resolved: false, error: true });
  });

  it('runInboxHostAction refuses ids main has not allowlisted', async () => {
    await expect(runInboxHostAction('nope')).resolves.toBe(false);
    expect(hostActions.run).not.toHaveBeenCalled();
  });

  it('runInboxHostAction runs, re-resolves ownership and reports ok', async () => {
    state().setActions([action('a')]);
    hostActions.run.mockResolvedValue({ ok: true });
    hostActions.get!.mockResolvedValue({ resolved: true, action: null });
    await expect(runInboxHostAction('a', { kind: 'x' } as never)).resolves.toBe(true);
    expect(hostActions.run).toHaveBeenCalledWith('a', { kind: 'x' });
    expect(state().byEntryId.a).toBeUndefined();
  });

  it('runInboxHostAction reports false for a non-ok result or a throw', async () => {
    state().setActions([action('a')]);
    hostActions.run.mockResolvedValueOnce({ ok: false });
    hostActions.get!.mockResolvedValue({ resolved: true, action: action('a') });
    await expect(runInboxHostAction('a')).resolves.toBe(false);
    hostActions.run.mockRejectedValueOnce(new Error('ipc'));
    await expect(runInboxHostAction('a')).resolves.toBe(false);
  });

  it('pruneInboxMarkers drops host-action state for removed ids only', () => {
    state().setActions([action('a'), action('b')]);
    state().beginResolution('a'); state().beginResolution('c');
    pruneInboxMarkers(['a', 'c']);
    expect(Object.keys(state().byEntryId)).toEqual(['b']);
    expect(state().resolutionByEntryId).toEqual({});
  });

  it('pruneInboxMarkers leaves host-action state untouched when no removed id is tracked', () => {
    state().setActions([action('b')]);
    const before = state().byEntryId;
    pruneInboxMarkers(['zzz']);
    expect(state().byEntryId).toBe(before);
  });
});
