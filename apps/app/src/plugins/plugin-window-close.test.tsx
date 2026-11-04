/** @vitest-environment happy-dom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ callback: undefined as ((request: {requestId?: string; error?: string}) => void) | undefined, ready: vi.fn(async () => true), complete: vi.fn(async () => true), off: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: { windows: {
  onPluginViewCloseRequest: (callback: typeof h.callback) => { h.callback = callback; return h.off; },
  pluginViewCloseReady: h.ready, pluginViewCloseComplete: h.complete
} } }));
import { registerPluginWindowCloseHandler, usePluginWindowCloseState } from './plugin-window-close.js';
function Status() { const state = usePluginWindowCloseState(); return <output>{state.error ?? String(state.pending)}</output>; }
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('awaits all mounted handlers, publishes pending state and unregisters once', async () => {
  let release!: () => void;
  const first = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const second = vi.fn();
  const off1 = registerPluginWindowCloseHandler(first); const off2 = registerPluginWindowCloseHandler(second);
  render(<Status />);
  act(() => h.callback!({ requestId: 'r1' }));
  expect(screen.getByText('true')).toBeTruthy();
  expect(h.complete).not.toHaveBeenCalled();
  act(() => h.callback!({ requestId: 'r1-retry' }));
  expect(first).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
  expect(second).toHaveBeenCalledTimes(1);
  expect(h.complete).toHaveBeenCalledWith('r1-retry', { ok: true });
  off1(); expect(h.off).not.toHaveBeenCalled(); off2();
  expect(h.off).toHaveBeenCalledTimes(1);
  expect(h.ready).toHaveBeenLastCalledWith(false);
});
it('reports rejection and main timeouts without approving close', async () => {
  const off = registerPluginWindowCloseHandler(() => { throw Error('Offline'); });
  render(<Status />);
  await act(async () => h.callback!({ requestId: 'r2' }));
  expect(screen.getByText('Offline')).toBeTruthy();
  expect(h.complete).toHaveBeenCalledWith('r2', { ok: false, error: 'Offline' });
  act(() => h.callback!({ error: 'Closing took too long' }));
  expect(screen.getByText('Closing took too long')).toBeTruthy();
  act(() => h.callback!({}));
  expect(h.complete).toHaveBeenCalledTimes(1);
  off();
});
it('aborts a timed-out handler and refuses a late success acknowledgement', async () => {
  let signal!: AbortSignal; let release!: () => void;
  const off = registerPluginWindowCloseHandler(value => { signal = value; return new Promise<void>(resolve => { release = resolve; }); });
  act(() => h.callback!({ requestId: 'slow' }));
  expect(signal.aborted).toBe(false);
  act(() => h.callback!({ error: 'Closing took too long' }));
  expect(signal.aborted).toBe(true);
  await act(async () => release());
  expect(h.complete).not.toHaveBeenCalledWith('slow', { ok: true });
  expect(h.complete).toHaveBeenCalledWith('slow', expect.objectContaining({ ok: false }));
  off();
});
it('handles bridge failures and non-Error rejections without an unhandled promise', async () => {
  h.ready.mockRejectedValueOnce(Error('bridge unavailable'));
  h.complete.mockRejectedValueOnce(Error('ack failed')).mockRejectedValueOnce(Error('ack retry failed'));
  const off = registerPluginWindowCloseHandler(() => undefined);
  await act(async () => h.callback!({ requestId: 'ack-fail' }));
  expect(h.complete).toHaveBeenCalledWith('ack-fail', expect.objectContaining({ ok: false }));
  h.ready.mockRejectedValueOnce(Error('already gone'));
  await act(async () => off());
  h.complete.mockResolvedValue(true);
  const reject = registerPluginWindowCloseHandler(() => { throw 'failed'; });
  await act(async () => h.callback!({ requestId: 'bad' }));
  expect(h.complete).toHaveBeenLastCalledWith('bad', { ok: false, error: 'Could not prepare this window to close.' });
  reject();
});
it('detaches abandoned work on plugin unmount without letting its late completion affect the new plugin', async () => {
  let finishOld!: () => void; let finishNew!: () => void;
  const offOld = registerPluginWindowCloseHandler(() => new Promise<void>(resolve => { finishOld = resolve; }));
  act(() => h.callback!({ requestId: 'old-plugin' }));
  offOld();
  const newHandler = vi.fn(() => new Promise<void>(resolve => { finishNew = resolve; }));
  const offNew = registerPluginWindowCloseHandler(newHandler);
  act(() => h.callback!({ requestId: 'new-plugin' }));
  expect(newHandler).toHaveBeenCalledTimes(1);
  await act(async () => finishOld());
  expect(h.complete).not.toHaveBeenCalled();
  act(() => h.callback!({ requestId: 'new-retry' }));
  expect(newHandler).toHaveBeenCalledTimes(1);
  await act(async () => finishNew());
  expect(h.complete).toHaveBeenCalledExactlyOnceWith('new-retry', { ok: true });
  offNew();
});
