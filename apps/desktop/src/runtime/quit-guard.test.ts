import { describe, expect, it, vi } from 'vitest';
import { createQuitGuard, readQuitThreadCount } from './quit-guard.js';

function setup(threads = 1, terminals = 0) {
  let confirmed = false;
  const deps = {
    isConfirmed: () => confirmed,
    setConfirmed: vi.fn(() => { confirmed = true; }),
    shouldConfirm: vi.fn(() => true),
    terminalCount: vi.fn(() => terminals),
    threadCount: vi.fn(async () => threads),
    confirm: vi.fn(async () => false),
    quit: vi.fn(), log: vi.fn()
  };
  return { deps, guard: createQuitGuard(deps), event: { preventDefault: vi.fn() } };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

describe('quit guard', () => {
  it('keeps Modern work alive on cancel and allows a later confirmed quit', async () => {
    const { deps, guard, event } = setup();
    expect(guard.allowQuit(event)).toBe(false);
    await settle();
    expect(deps.confirm).toHaveBeenCalledWith(1, false);
    expect(deps.quit).not.toHaveBeenCalled();
    deps.confirm.mockResolvedValue(true);
    guard.allowQuit(event);
    await settle();
    expect(deps.quit).toHaveBeenCalledOnce();
    expect(guard.allowQuit(event)).toBe(true);
    expect(deps.confirm).toHaveBeenCalledTimes(2);
  });
  it('counts PTYs and Modern threads together', async () => {
    const { deps, guard, event } = setup(3, 2);
    guard.allowQuit(event); await settle();
    expect(deps.confirm).toHaveBeenCalledWith(5, false);
  });
  it('quits without a dialog when no work is running', async () => {
    const { deps, guard, event } = setup(0);
    guard.allowQuit(event); await settle();
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.quit).toHaveBeenCalledOnce();
  });
  it('honors the opt-out without probing', () => {
    const { deps, guard, event } = setup();
    deps.shouldConfirm.mockReturnValue(false);
    expect(guard.allowQuit(event)).toBe(true);
    expect(deps.threadCount).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it('coalesces repeated quits and honors update consent during the probe', async () => {
    const { deps, guard, event } = setup();
    let resolve!: (n: number) => void;
    deps.threadCount.mockImplementation(() => new Promise(r => { resolve = r; }));
    guard.allowQuit(event); guard.allowQuit(event);
    expect(deps.threadCount).toHaveBeenCalledOnce();
    deps.setConfirmed(); resolve(1); await settle();
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.quit).toHaveBeenCalledOnce();
  });
  it('requires consent when the activity probe fails', async () => {
    const { deps, guard, event } = setup();
    deps.threadCount.mockRejectedValue(new Error('timeout'));
    guard.allowQuit(event); await settle();
    expect(deps.confirm).toHaveBeenCalledWith(0, true);
    expect(deps.quit).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledOnce();
  });
  it('recovers after a dialog failure', async () => {
    const { deps, guard, event } = setup();
    deps.confirm.mockRejectedValueOnce(new Error('dialog unavailable'));
    guard.allowQuit(event); await settle();
    guard.allowQuit(event); await settle();
    expect(deps.confirm).toHaveBeenCalledTimes(2);
    expect(deps.quit).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledOnce();
  });
});

describe('quit-state fetch', () => {
  it('uses a bounded probe and accepts zero', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ activeThreads: 0 })));
    expect(await readQuitThreadCount('http://127.0.0.1:8780/', fetcher)).toBe(0);
    expect(String(fetcher.mock.calls[0][0])).toBe('http://127.0.0.1:8780/api/v1/system/quit-state');
    expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([-1, 1.5, '2', null, undefined, Number.MAX_SAFE_INTEGER + 1])('rejects invalid counts %s', async count => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ activeThreads: count })));
    await expect(readQuitThreadCount('http://localhost/', fetcher)).rejects.toThrow('Invalid quit state');
  });
  it('rejects HTTP and transport failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 })).mockRejectedValueOnce(new Error('offline'));
    await expect(readQuitThreadCount('http://localhost/', fetcher)).rejects.toThrow('HTTP 503');
    await expect(readQuitThreadCount('http://localhost/', fetcher)).rejects.toThrow('offline');
  });
});
