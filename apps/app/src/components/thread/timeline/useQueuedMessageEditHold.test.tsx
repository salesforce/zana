// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EDIT_HOLD_RETRY_MS, isQueuedEditConflict, queuedEditRejection, useQueuedMessageEditHold } from './useQueuedMessageEditHold.js';

const api = vi.hoisted(() => ({ holdNextTurnForEdit: vi.fn(), releaseNextTurnEditHold: vi.fn() }));
const toast = vi.hoisted(() => ({ pushToast: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({ product: { threads: api } }));
vi.mock('../../../store.js', () => ({ useUi: { getState: () => toast } }));

const LEASE_MS = 120_000;
const RENEW_MS = LEASE_MS / 4;
const httpError = (status: number, code?: string) => Object.assign(new Error(`http ${status}`), { status, code });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

let onRejected: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  onRejected = vi.fn();
  api.holdNextTurnForEdit.mockResolvedValue({ ok: true, leaseMs: LEASE_MS, heldUntil: Date.now() + LEASE_MS });
  api.releaseNextTurnEditHold.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function mount(itemId: string | null = 'one', threadId = 'thread-1') {
  return renderHook((props: { itemId: string | null; threadId: string }) =>
    useQueuedMessageEditHold({ ...props, onRejected }), { initialProps: { itemId, threadId } });
}

it('does nothing while no message is being edited', async () => {
  const { unmount } = mount(null);
  await advance(RENEW_MS * 3);
  unmount();
  await flush();
  expect(api.holdNextTurnForEdit).not.toHaveBeenCalled();
  expect(api.releaseNextTurnEditHold).not.toHaveBeenCalled();
});

it('takes the lease when the editor opens and renews it every quarter of the lease the server granted', async () => {
  mount();
  await flush();
  expect(api.holdNextTurnForEdit).toHaveBeenCalledExactlyOnceWith('thread-1', 'one');
  await advance(RENEW_MS - 1);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(2);
  await advance(RENEW_MS * 2);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(4);
  expect(onRejected).not.toHaveBeenCalled();
  expect(toast.pushToast).not.toHaveBeenCalled();
});

it('follows a shorter lease and falls back to the default when the server omits it', async () => {
  api.holdNextTurnForEdit.mockResolvedValueOnce({ ok: true, leaseMs: 8_000, heldUntil: 0 });
  mount();
  await flush();
  await advance(1_999);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(2);

  api.holdNextTurnForEdit.mockResolvedValue({ ok: true });
  await advance(RENEW_MS);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(3);
  await advance(RENEW_MS);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(4);
});

it('does not renew faster than once a second even for a tiny lease', async () => {
  api.holdNextTurnForEdit.mockResolvedValue({ ok: true, leaseMs: 100, heldUntil: 0 });
  mount();
  await flush();
  await advance(999);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(2);
});

it.each([404, 409])('closes the editor with one toast and stops renewing when the server answers %s', async (status) => {
  api.holdNextTurnForEdit.mockRejectedValueOnce(httpError(status));
  const { unmount } = mount();
  await flush();
  expect(onRejected).toHaveBeenCalledOnce();
  expect(toast.pushToast).toHaveBeenCalledOnce();
  expect(toast.pushToast).toHaveBeenCalledWith(expect.stringMatching(/queued message/i), 'error');
  await advance(LEASE_MS * 2);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(1);
  unmount();
  await flush();
  // The row is gone or already claimed: there is nothing left to release.
  expect(api.releaseNextTurnEditHold).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('closes the editor when a renewal is the request that learns the row was claimed', async () => {
  mount();
  await flush();
  api.holdNextTurnForEdit.mockRejectedValueOnce(httpError(409));
  await advance(RENEW_MS);
  expect(onRejected).toHaveBeenCalledOnce();
  expect(toast.pushToast).toHaveBeenCalledOnce();
  await advance(LEASE_MS);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(2);
});

it('keeps the editor open and retries soon after a transient failure, without a toast', async () => {
  api.holdNextTurnForEdit.mockRejectedValueOnce(httpError(503)).mockRejectedValueOnce(new Error('offline'));
  mount();
  await flush();
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(1);
  await advance(EDIT_HOLD_RETRY_MS);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(2);
  await advance(EDIT_HOLD_RETRY_MS);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(3);
  expect(EDIT_HOLD_RETRY_MS).toBeLessThan(RENEW_MS);
  await advance(RENEW_MS);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(4);
  expect(onRejected).not.toHaveBeenCalled();
  expect(toast.pushToast).not.toHaveBeenCalled();
});

it('releases the lease and drops every timer when the editor unmounts', async () => {
  const { unmount } = mount();
  await flush();
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  await flush();
  expect(api.releaseNextTurnEditHold).toHaveBeenCalledExactlyOnceWith('thread-1', 'one');
  expect(vi.getTimerCount()).toBe(0);
  await advance(LEASE_MS * 2);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(1);
});

it('waits for an in-flight hold before releasing so a late grant cannot outlive the editor', async () => {
  let grant!: (value: unknown) => void;
  api.holdNextTurnForEdit.mockImplementationOnce(() => new Promise((resolve) => { grant = resolve; }));
  const { unmount } = mount();
  await flush();
  unmount();
  await flush();
  expect(api.releaseNextTurnEditHold).not.toHaveBeenCalled();
  grant({ ok: true, leaseMs: LEASE_MS, heldUntil: 0 });
  await flush();
  expect(api.releaseNextTurnEditHold).toHaveBeenCalledExactlyOnceWith('thread-1', 'one');
  // The late grant must not schedule another renewal after the editor is gone.
  expect(vi.getTimerCount()).toBe(0);
  await advance(LEASE_MS);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(1);
});

it('does not toast for a rejection that arrives after the editor closed', async () => {
  let fail!: (error: unknown) => void;
  api.holdNextTurnForEdit.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const { unmount } = mount();
  await flush();
  unmount();
  fail(httpError(409));
  await flush();
  expect(toast.pushToast).not.toHaveBeenCalled();
  expect(onRejected).not.toHaveBeenCalled();
});

it('swallows a failing release because the lease expires by itself', async () => {
  api.releaseNextTurnEditHold.mockRejectedValue(httpError(500));
  const { unmount } = mount();
  await flush();
  unmount();
  await flush();
  expect(api.releaseNextTurnEditHold).toHaveBeenCalledOnce();
  expect(toast.pushToast).not.toHaveBeenCalled();
});

it('skips the release after the caller reports the edit was saved', async () => {
  const { result, unmount } = mount();
  await flush();
  result.current.finish();
  unmount();
  await flush();
  expect(api.releaseNextTurnEditHold).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('moves the lease when the edited message or thread changes, and arms the next editor normally', async () => {
  const { rerender, result, unmount } = mount('one');
  await flush();
  result.current.finish();
  rerender({ itemId: 'two', threadId: 'thread-1' });
  await flush();
  // A finished editor does not release; the next one still holds and releases as usual.
  expect(api.releaseNextTurnEditHold).not.toHaveBeenCalled();
  expect(api.holdNextTurnForEdit).toHaveBeenLastCalledWith('thread-1', 'two');
  rerender({ itemId: 'two', threadId: 'thread-2' });
  await flush();
  expect(api.releaseNextTurnEditHold).toHaveBeenCalledExactlyOnceWith('thread-1', 'two');
  expect(api.holdNextTurnForEdit).toHaveBeenLastCalledWith('thread-2', 'two');
  unmount();
  await flush();
  expect(api.releaseNextTurnEditHold).toHaveBeenLastCalledWith('thread-2', 'two');
  expect(vi.getTimerCount()).toBe(0);
});

it('uses the latest rejection handler without restarting the lease', async () => {
  const { rerender } = renderHook(({ handler }: { handler: () => void }) =>
    useQueuedMessageEditHold({ threadId: 'thread-1', itemId: 'one', onRejected: handler }), { initialProps: { handler: onRejected as () => void } });
  await flush();
  const latest = vi.fn();
  rerender({ handler: latest });
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(1);
  api.holdNextTurnForEdit.mockRejectedValueOnce(httpError(404));
  await advance(RENEW_MS);
  expect(latest).toHaveBeenCalledOnce();
  expect(onRejected).not.toHaveBeenCalled();
});

it('tells a stale revision apart from a claimed or missing row', () => {
  const changed = httpError(409, 'queued-send-changed');
  expect(queuedEditRejection(changed)).toBeNull();
  expect(isQueuedEditConflict(changed)).toBe(true);
  expect(queuedEditRejection(httpError(409, 'queued-send-dispatching'))).toMatch(/already being sent/);
  expect(queuedEditRejection(httpError(409))).toMatch(/already being sent/);
  expect(queuedEditRejection(httpError(404))).toMatch(/sent or removed/);
  for (const error of [httpError(409), httpError(404), httpError(500, 'queued-send-changed'), null, undefined, 'x']) {
    expect(isQueuedEditConflict(error)).toBe(false);
  }
  expect(queuedEditRejection(null)).toBeNull();
});

it('pauses renewals until resumed, then renews at once and keeps the normal schedule', async () => {
  const { result } = mount();
  await flush();
  let paused = false;
  await act(async () => { paused = await result.current.pause(); });
  expect(paused).toBe(true);
  await advance(RENEW_MS * 3);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  act(() => result.current.resume());
  await flush();
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(2);
  await advance(RENEW_MS);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(3);
  // Resuming an editor that is not paused does not send an extra hold.
  act(() => result.current.resume());
  await flush();
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(3);
});

it('waits for an in-flight hold before pause resolves and does not re-arm the renewal', async () => {
  let grant!: (value: unknown) => void;
  api.holdNextTurnForEdit.mockImplementationOnce(() => new Promise((done) => { grant = done; }));
  const { result } = mount();
  await flush();
  let settled = false;
  let pausing!: Promise<boolean>;
  act(() => { pausing = result.current.pause().then((value) => { settled = true; return value; }); });
  await flush();
  expect(settled).toBe(false);
  await act(async () => grant({ ok: true, leaseMs: LEASE_MS, heldUntil: 0 }));
  await expect(pausing).resolves.toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not retry a failed hold while paused', async () => {
  let fail!: (error: unknown) => void;
  api.holdNextTurnForEdit.mockImplementationOnce(() => new Promise((_done, reject) => { fail = reject; }));
  const { result } = mount();
  await flush();
  let pausing!: Promise<boolean>;
  act(() => { pausing = result.current.pause(); });
  await act(async () => fail(httpError(503)));
  await expect(pausing).resolves.toBe(true);
  await advance(EDIT_HOLD_RETRY_MS * 2);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(1);
  expect(onRejected).not.toHaveBeenCalled();
});

it('resolves pause false when the in-flight hold learns the row is gone', async () => {
  let fail!: (error: unknown) => void;
  api.holdNextTurnForEdit.mockImplementationOnce(() => new Promise((_done, reject) => { fail = reject; }));
  const { result } = mount();
  await flush();
  let pausing!: Promise<boolean>;
  act(() => { pausing = result.current.pause(); });
  await act(async () => fail(httpError(404)));
  await expect(pausing).resolves.toBe(false);
  expect(onRejected).toHaveBeenCalledOnce();
  act(() => result.current.resume());
  await flush();
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(1);
});

it('keeps renewing after a renewal reports a stale revision, since the row is still waiting', async () => {
  mount();
  await flush();
  api.holdNextTurnForEdit.mockRejectedValueOnce(httpError(409, 'queued-send-changed'));
  await advance(RENEW_MS);
  expect(onRejected).not.toHaveBeenCalled();
  await advance(EDIT_HOLD_RETRY_MS);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(3);
});

it('lets pause and resume run without an open editor', async () => {
  const { result } = mount(null);
  await expect(result.current.pause()).resolves.toBe(true);
  act(() => result.current.resume());
  await flush();
  expect(api.holdNextTurnForEdit).not.toHaveBeenCalled();
});
