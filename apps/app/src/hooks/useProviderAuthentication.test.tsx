// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProviderAuthentication } from './useProviderAuthentication.js';
const fixture = vi.hoisted(() => ({ api: vi.fn(), close: vi.fn(), off: vi.fn(), exit: null as null | ((sessionId: string, code: number) => void) }));
vi.mock('../lib/fetch-with-app-surface.js', () => ({ apiJson: fixture.api }));
vi.mock('../lib/app-surface.js', () => ({ hasDesktopBridge: () => true }));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: { close: fixture.close, onExit: (cb: typeof fixture.exit) => { fixture.exit = cb; return fixture.off; } } } }));
const body = (status = 'unauthenticated', hostId = 'h1', providerId = 'fixture') => ({ hostId, providerId, result: { supported: true, health: { status, loginCommand: 'fixture login' } } });
const terminal = { id: 'login', hostId: 'h1', status: 'running' };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  vi.clearAllMocks();
  fixture.api.mockImplementation(async (path: string) => path.endsWith('/sign-in') ? { ok: true, value: terminal } : body());
  fixture.close.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('guided provider sign-in', () => {
  it('checks the chosen host, coalesces refreshes, and never auto-starts login', async () => {
    const gate = deferred<ReturnType<typeof body>>(); fixture.api.mockReturnValue(gate.promise);
    const { result } = renderHook(() => useProviderAuthentication('fixture', 'h1', vi.fn()));
    expect(result.current.checking).toBe(true);
    act(() => { void result.current.check(); void result.current.check(); });
    expect(fixture.api).toHaveBeenCalledOnce();
    expect(fixture.api.mock.calls[0][0]).toBe('/system/providers/fixture/health?hostId=h1');
    await act(async () => { gate.resolve(body()); });
    expect(result.current.result).toMatchObject({ health: { status: 'unauthenticated' } });
    expect(fixture.close).not.toHaveBeenCalled();
  });
  it('polls after user login, closes on verified readiness, and refreshes models only on a ready transition', async () => {
    const ready = vi.fn();
    const { result } = renderHook(() => useProviderAuthentication('fixture', 'h1', ready));
    await waitFor(() => expect(result.current.checking).toBe(false));
    await act(async () => { await result.current.start(); });
    expect(result.current.session?.id).toBe('login');
    expect(JSON.parse(fixture.api.mock.calls.find(([path]) => path.endsWith('/sign-in'))![1].body)).toEqual({ hostId: 'h1', localBrowser: true });
    fixture.api.mockResolvedValue(body('ready'));
    await act(async () => { await result.current.check(); });
    expect(fixture.close).toHaveBeenCalledWith('login');
    expect(result.current.session).toBeNull(); expect(ready).toHaveBeenCalledOnce();
    await act(async () => { await result.current.check(); }); expect(ready).toHaveBeenCalledOnce();
  });
  it('never treats a zero terminal exit as successful login and stops automatic polling after exit', async () => {
    const ready = vi.fn();
    const { result } = renderHook(() => useProviderAuthentication('fixture', 'h1', ready));
    await waitFor(() => expect(result.current.checking).toBe(false));
    await act(async () => { await result.current.start(); });
    await act(async () => { fixture.exit!('other', 0); fixture.exit!('login', 0); });
    expect(result.current.session?.status).toBe('exited'); expect(ready).not.toHaveBeenCalled();
    await act(async () => { await result.current.cancel(); }); expect(result.current.session).toBeNull();
  });
  it('closes a late terminal after cancellation during startup, without launching twice', async () => {
    const { result } = renderHook(() => useProviderAuthentication('fixture', 'h1', vi.fn()));
    await waitFor(() => expect(result.current.checking).toBe(false));
    const gate = deferred<unknown>(); fixture.api.mockReturnValue(gate.promise);
    let start: Promise<void> | undefined;
    act(() => { start = result.current.start(); void result.current.start(); });
    expect(result.current.starting).toBe(true);
    await act(async () => { await result.current.cancel(); });
    await act(async () => { gate.resolve({ ok: true, value: terminal }); await start; });
    expect(result.current.session).toBeNull(); expect(fixture.close).toHaveBeenCalledWith('login');
    expect(fixture.api.mock.calls.filter(([path]) => path.endsWith('/sign-in'))).toHaveLength(1);
  });
  it('retains an exit delivered before the start acknowledgement', async () => {
    const { result } = renderHook(() => useProviderAuthentication('fixture', 'h1', vi.fn()));
    await waitFor(() => expect(result.current.checking).toBe(false));
    const gate = deferred<unknown>();
    fixture.api.mockImplementation(async (path) => path.endsWith('/sign-in') ? gate.promise : body());
    let start: Promise<void> | undefined;
    act(() => { start = result.current.start(); });
    act(() => { fixture.exit!('login', 0); });
    await act(async () => { gate.resolve({ ok: true, value: terminal }); await start; });
    expect(result.current.session?.status).toBe('exited');
  });
  it('rechecks after an in-flight pre-login probe when the terminal exits', async () => {
    const { result } = renderHook(() => useProviderAuthentication('fixture', 'h1', vi.fn()));
    await waitFor(() => expect(result.current.checking).toBe(false));
    await act(async () => { await result.current.start(); });
    const gate = deferred<unknown>(); fixture.api.mockReturnValueOnce(gate.promise).mockResolvedValue(body('ready'));
    act(() => { void result.current.check(); });
    act(() => { fixture.exit!('login', 0); });
    await act(async () => { gate.resolve(body()); });
    await waitFor(() => expect(result.current.result).toMatchObject({ health: { status: 'ready' } }));
    expect(result.current.session).toBeNull();
  });
  it('does not notify a newly selected host when old readiness cleanup finishes late', async () => {
    const onReady = vi.fn();
    const { result, rerender } = renderHook(({ host }) => useProviderAuthentication('fixture', host, onReady), { initialProps: { host: 'h1' } });
    await waitFor(() => expect(result.current.checking).toBe(false));
    await act(async () => { await result.current.start(); });
    const gate = deferred<boolean>(); fixture.close.mockReturnValue(gate.promise); fixture.api.mockResolvedValue(body('ready'));
    let check: Promise<void> | undefined;
    act(() => { check = result.current.check(); });
    await waitFor(() => expect(fixture.close).toHaveBeenCalled());
    fixture.api.mockResolvedValue(body('unauthenticated', 'h2'));
    rerender({ host: 'h2' });
    await act(async () => { gate.resolve(true); await check; });
    expect(onReady).not.toHaveBeenCalled();
  });
  it('ignores stale host responses and closes late starts when the host changes', async () => {
    const { result, rerender } = renderHook(({ host }) => useProviderAuthentication('fixture', host, vi.fn()), { initialProps: { host: 'h1' } });
    await waitFor(() => expect(result.current.checking).toBe(false));
    const gate = deferred<unknown>(); fixture.api.mockImplementation(async (path) => path.endsWith('/sign-in') ? gate.promise : body('ready', 'h2'));
    let start: Promise<void> | undefined;
    act(() => { start = result.current.start(); });
    rerender({ host: 'h2' });
    await waitFor(() => expect(result.current.result).toMatchObject({ health: { status: 'ready' } }));
    await act(async () => { gate.resolve({ ok: true, value: terminal }); await start; });
    expect(fixture.close).toHaveBeenCalledWith('login'); expect(result.current.session).toBeNull();
  });
  it('reports failures, supports retry, and retains a terminal when close fails', async () => {
    fixture.api.mockRejectedValue(new Error('private-error'));
    const { result } = renderHook(() => useProviderAuthentication('fixture', 'h1', vi.fn()));
    await waitFor(() => expect(result.current.error).toContain('Could not check'));
    expect(result.current.error).not.toContain('private-error');
    await act(async () => { await result.current.start(); }); expect(result.current.error).toContain('Could not start');
    fixture.api.mockImplementation(async (path) => path.endsWith('/sign-in') ? { ok: true, value: terminal } : body());
    await act(async () => { await result.current.start(); });
    fixture.close.mockResolvedValue(false);
    await act(async () => { await result.current.cancel(); });
    expect(result.current.session?.id).toBe('login'); expect(result.current.error).toContain('Could not close');
    fixture.close.mockResolvedValue(true);
    await act(async () => { await result.current.cancel(); }); expect(result.current.session).toBeNull();
  });
  it('uses a bounded non-overlapping polling interval and releases subscriptions and the terminal on unmount', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useProviderAuthentication('fixture', 'h1', vi.fn()));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.start(); });
    const before = fixture.api.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fixture.api).toHaveBeenCalledTimes(before + 1);
    unmount();
    expect(fixture.off).toHaveBeenCalledOnce(); expect(fixture.close).toHaveBeenCalledWith('login');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does no work while disconnected and rejects mismatched health scopes', async () => {
    const { result, rerender } = renderHook(({ host }) => useProviderAuthentication('fixture', host, vi.fn()), { initialProps: { host: undefined as string | undefined } });
    await act(async () => { await result.current.check(); await result.current.start(); });
    expect(fixture.api).not.toHaveBeenCalled();
    fixture.api.mockResolvedValue(body('ready', 'another-host'));
    rerender({ host: 'h1' });
    await waitFor(() => expect(result.current.error).toContain('Could not check'));
    expect(result.current.result).toBeNull();
  });
});
