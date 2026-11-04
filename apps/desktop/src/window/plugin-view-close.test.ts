import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindPluginViewCloseLifecycle, createPluginViewCloseGuard, registerPluginViewCloseIpc } from './plugin-view-close.js';
const window = (id = 1) => ({ id, isDestroyed: () => false, close: vi.fn(), webContents: { isDestroyed: () => false, send: vi.fn() } });
afterEach(() => vi.useRealTimers());
describe('plugin window close preflight', () => {
  it('leaves legacy windows alone and waits for an exact sender-bound acknowledgement', () => {
    const guard = createPluginViewCloseGuard(); const a = window(); const b = window(2);
    expect(guard.intercept(a)).toBe(false);
    expect(guard.setReady(a, 'yes')).toBe(false);
    expect(guard.setReady(a, true)).toBe(true);
    expect(guard.intercept(a)).toBe(true);
    expect(guard.intercept(a)).toBe(true);
    expect(a.webContents.send).toHaveBeenCalledTimes(1);
    const requestId = a.webContents.send.mock.calls[0]![1].requestId;
    expect(guard.complete(b, requestId, { ok: true })).toBe(false);
    expect(guard.complete(a, 'wrong', { ok: true })).toBe(false);
    expect(guard.complete(a, requestId, null)).toBe(false);
    expect(guard.complete(a, requestId, { ok: 'yes' })).toBe(false);
    expect(guard.complete(a, requestId, { ok: true })).toBe(true);
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(guard.intercept(a)).toBe(false);
    expect(guard.complete(a, requestId, { ok: true })).toBe(false);
    guard.forget(a.id);
  });
  it('keeps failures and timeouts open, then allows a fresh retry', () => {
    vi.useFakeTimers(); const guard = createPluginViewCloseGuard(50); const a = window();
    guard.setReady(a, true); guard.intercept(a);
    const requestId = a.webContents.send.mock.calls[0]![1].requestId;
    expect(guard.complete(a, requestId, { ok: false, error: 'Offline\nretry' })).toBe(true);
    expect(a.webContents.send).toHaveBeenLastCalledWith(IPC.windows.onPluginViewCloseRequest, { error: 'Offline retry' });
    expect(a.close).not.toHaveBeenCalled();
    guard.intercept(a); vi.advanceTimersByTime(51);
    expect(a.webContents.send.mock.calls.at(-1)![1].error).toContain('too long');
    expect(a.close).not.toHaveBeenCalled();
    guard.intercept(a); guard.setReady(a, false); vi.advanceTimersByTime(100);
    expect(guard.intercept(a)).toBe(false);
  });
  it('releases timers on crash/unregister and fails closed when sending fails', () => {
    vi.useFakeTimers(); const guard = createPluginViewCloseGuard(50); const a = window();
    guard.setReady(a, true); a.webContents.send.mockImplementationOnce(() => { throw Error('gone'); });
    expect(guard.intercept(a)).toBe(true);
    expect(a.close).not.toHaveBeenCalled();
    guard.intercept(a); guard.forget(a.id); vi.advanceTimersByTime(100);
    expect(guard.intercept(a)).toBe(false);
    guard.setReady(a, true); a.isDestroyed = () => true;
    expect(guard.intercept(a)).toBe(false);
    a.isDestroyed = () => false; a.webContents.isDestroyed = () => true;
    expect(guard.intercept(a)).toBe(false);
  });
});


describe('native lifecycle and sender-bound close registration', () => {
  it('prevents close only during an active handoff and invalidates the lease on crash or full navigation', () => {
    const a = window();
    const events = new Map<string, (...args: any[]) => void>();
    const contents = new Map<string, (...args: any[]) => void>();
    const win = Object.assign(a, { on: (name: string, fn: (...args: any[]) => void) => events.set(name, fn) });
    Object.assign(win.webContents, { on: (name: string, fn: (...args: any[]) => void) => contents.set(name, fn) });
    const guard = createPluginViewCloseGuard(); let shutdown = false;
    bindPluginViewCloseLifecycle(win as any, guard, () => shutdown);
    const event = { preventDefault: vi.fn() };
    events.get('close')!(event); expect(event.preventDefault).not.toHaveBeenCalled();
    guard.setReady(win, true); events.get('close')!(event); expect(event.preventDefault).toHaveBeenCalledOnce();
    shutdown = true; events.get('close')!(event); expect(event.preventDefault).toHaveBeenCalledOnce();
    shutdown = false;
    contents.get('did-start-navigation')!({}, '', true, true);
    contents.get('did-start-navigation')!({}, '', false, false);
    expect(guard.intercept(win)).toBe(true);
    contents.get('did-start-navigation')!({}, '', false, true);
    expect(guard.intercept(win)).toBe(false);
    guard.setReady(win, true); guard.intercept(win);
    contents.get('render-process-gone')!(); expect(guard.intercept(win)).toBe(false);
  });
  it('rejects main and unknown windows and only completes the originating plugin view', () => {
    const guard = createPluginViewCloseGuard(); const a = window(); const other = window(2);
    const handlers = new Map<string, (...args: any[]) => boolean>(); const fallback: Array<() => boolean> = [];
    registerPluginViewCloseIpc((channel, handler, failed) => { handlers.set(channel, handler as any); fallback.push(failed as any); }, guard, new Map([[1, { view: {} }], [2, {}]]));
    const ready = handlers.get(IPC.windows.pluginViewCloseReady)!;
    const complete = handlers.get(IPC.windows.pluginViewCloseComplete)!;
    expect(ready(other, true)).toBe(false); expect(ready(window(3), true)).toBe(false);
    expect(complete(other, 'spoofed', { ok: true })).toBe(false);
    expect(ready(a, true)).toBe(true); guard.intercept(a);
    const requestId = a.webContents.send.mock.calls[0]![1].requestId;
    expect(complete(a, requestId, { ok: true })).toBe(true); expect(a.close).toHaveBeenCalledOnce();
    expect(fallback.map(fn => fn())).toEqual([false, false]);
  });
});
