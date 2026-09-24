import { afterEach, describe, expect, it, vi } from 'vitest';
import { signInWithBrowser } from './org-login-rpc.js';

describe('browser login polling', () => {
  afterEach(() => vi.useRealTimers());
  it('keeps RPCs short while waiting for a slow browser sign-in', async () => {
    vi.useFakeTimers();
    const call = vi.fn().mockResolvedValueOnce({ ok: true, loginId: 'id' }).mockResolvedValueOnce({ ok: true, done: false }).mockResolvedValueOnce({ ok: true, done: true, result: { ok: true, selectedAlias: 'new' } });
    const done = signInWithBrowser(call, { instance: 'sandbox' }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await done).toEqual({ ok: true, selectedAlias: 'new' });
    expect(call.mock.calls).toEqual([['orgs.login.start', { instance: 'sandbox' }], ['orgs.login.status', { loginId: 'id' }], ['orgs.login.status', { loginId: 'id' }]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops polling and clears the timer when the view closes', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const call = vi.fn().mockResolvedValueOnce({ ok: true, loginId: 'id' }).mockResolvedValue({ ok: true, done: false });
    const done = signInWithBrowser(call, {}, controller.signal);
    const assertion = expect(done).rejects.toThrow('view closed');
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('does not poll if closed during the start request', async () => {
    const controller = new AbortController();
    controller.abort();
    const call = vi.fn().mockResolvedValue({ ok: true, loginId: 'id' });
    await expect(signInWithBrowser(call, {}, controller.signal)).rejects.toThrow('view closed');
    expect(call).toHaveBeenCalledOnce();
  });

  it('caps waiting even if the server keeps reporting pending', async () => {
    vi.useFakeTimers();
    const call = vi.fn().mockResolvedValueOnce({ ok: true, loginId: 'id' }).mockResolvedValue({ ok: true, done: false });
    const done = signInWithBrowser(call, {}, new AbortController().signal);
    const assertion = expect(done).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports malformed starts and failed status reads', async () => {
    await expect(signInWithBrowser(vi.fn().mockResolvedValue({ ok: true }), {}, new AbortController().signal)).rejects.toThrow('Reload');
    const call = vi.fn().mockResolvedValueOnce({ ok: true, loginId: 'id' }).mockResolvedValueOnce({ ok: false, error: 'No longer available' });
    await expect(signInWithBrowser(call, {}, new AbortController().signal)).rejects.toThrow('No longer available');
  });
});
