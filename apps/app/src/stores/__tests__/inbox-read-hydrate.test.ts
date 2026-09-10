import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const markRead = vi.fn();
const markUnread = vi.fn();
const markAllRead = vi.fn();
const pruneRead = vi.fn();
const getReadState = vi.fn();
const migrateCurrentOriginReadIds = vi.fn();

vi.mock('../../lib/product-client.js', () => ({
  product: {
    inbox: {
      getReadState: (...args: unknown[]) => getReadState(...args),
      markRead: (...args: unknown[]) => markRead(...args),
      markUnread: (...args: unknown[]) => markUnread(...args),
      markAllRead: (...args: unknown[]) => markAllRead(...args),
      pruneRead: (...args: unknown[]) => pruneRead(...args),
      migrateCurrentOriginReadIds: (...args: unknown[]) => migrateCurrentOriginReadIds(...args)
    }
  }
}));

describe('useInboxRead durable hydrate', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => storage.clear(),
      key: () => null,
      length: 0
    } as Storage;
    markRead.mockReset();
    markUnread.mockReset();
    markAllRead.mockReset();
    pruneRead.mockReset();
    getReadState.mockReset();
    migrateCurrentOriginReadIds.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('hydrate replaces empty persist with server ids', async () => {
    getReadState.mockResolvedValue({
      readIds: { a: true },
      migratedFromLocalStorage: true
    });
    const { useInboxRead, hydrateInboxReadFromProduct } = await import('../live.js');
    expect(useInboxRead.getState().readIds).toEqual({});
    await hydrateInboxReadFromProduct();
    expect(useInboxRead.getState().readIds).toEqual({ a: true });
    expect(migrateCurrentOriginReadIds).not.toHaveBeenCalled();
  });

  it('failed markRead rolls back optimistic id', async () => {
    getReadState.mockResolvedValue({ readIds: {}, migratedFromLocalStorage: true });
    markRead.mockRejectedValue(new Error('nope'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useInboxRead } = await import('../live.js');
    useInboxRead.getState().markRead('x');
    expect(useInboxRead.getState().readIds.x).toBe(true);
    await vi.waitFor(() => {
      expect(useInboxRead.getState().readIds.x).toBeUndefined();
    });
    expect(errorSpy).toHaveBeenCalledWith('[inbox] markRead failed', expect.objectContaining({ ids: ['x'] }));
    errorSpy.mockRestore();
  });

  it('failed markRead does not erase a later successful mark', async () => {
    let rejectFirst: ((err: Error) => void) | undefined;
    markRead.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject;
        })
    );
    markRead.mockResolvedValueOnce({
      readIds: { later: true },
      migratedFromLocalStorage: true
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useInboxRead } = await import('../live.js');
    useInboxRead.getState().markRead('first');
    useInboxRead.getState().markRead('later');
    expect(useInboxRead.getState().readIds).toEqual({ first: true, later: true });
    rejectFirst?.(new Error('stale'));
    await vi.waitFor(() => {
      expect(useInboxRead.getState().readIds).toEqual({ later: true });
    });
    errorSpy.mockRestore();
  });

  it('hydrate logs and keeps local cache on failure', async () => {
    getReadState.mockRejectedValue(new Error('offline'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useInboxRead, hydrateInboxReadFromProduct } = await import('../live.js');
    useInboxRead.setState({ readIds: { local: true }, migratedFromLocalStorage: false });
    await hydrateInboxReadFromProduct();
    expect(useInboxRead.getState().readIds).toEqual({ local: true });
    expect(errorSpy).toHaveBeenCalledWith('[inbox] hydrateFromProduct failed', expect.any(Error));
    errorSpy.mockRestore();
  });

  it('migrates current-origin ids once when flag is false', async () => {
    getReadState.mockResolvedValue({ readIds: {}, migratedFromLocalStorage: false });
    migrateCurrentOriginReadIds.mockResolvedValue({
      readIds: { local: true },
      migratedFromLocalStorage: true
    });
    const { useInboxRead, hydrateInboxReadFromProduct } = await import('../live.js');
    useInboxRead.setState({ readIds: { local: true }, migratedFromLocalStorage: false });
    await hydrateInboxReadFromProduct();
    expect(migrateCurrentOriginReadIds).toHaveBeenCalledTimes(1);
    expect(migrateCurrentOriginReadIds).toHaveBeenCalledWith(['local']);
    expect(useInboxRead.getState().readIds).toEqual({ local: true });
    expect(useInboxRead.getState().migratedFromLocalStorage).toBe(true);
  });

  it('markAllRead writes through the product API', async () => {
    markAllRead.mockResolvedValue({
      readIds: { a: true, b: true },
      migratedFromLocalStorage: true
    });
    const { useInboxRead } = await import('../live.js');
    useInboxRead.getState().markAllRead(['a', 'b']);
    expect(useInboxRead.getState().readIds.a).toBe(true);
    await vi.waitFor(() => {
      expect(markAllRead).toHaveBeenCalledWith(['a', 'b']);
    });
  });
});
