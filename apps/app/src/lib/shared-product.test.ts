import { beforeEach, expect, it, vi } from 'vitest';
const { api, subscribe, reconnect } = vi.hoisted(() => ({ api: vi.fn(), subscribe: vi.fn(), reconnect: vi.fn() }));
vi.mock('./fetch-with-app-surface.js', () => ({ apiJson: api }));
vi.mock('./product-ws.js', () => ({ subscribeProductEvent: subscribe, subscribeProductReconnect: reconnect }));
beforeEach(() => { vi.resetModules(); api.mockReset(); subscribe.mockReset(); reconnect.mockReset(); });
it('uses the selected origin service and never falls back after a failed mutation', async () => {
  api.mockResolvedValueOnce({ sharedProductServices: true }).mockResolvedValueOnce({ ok: true, value: { theme: 'dark' } }).mockRejectedValueOnce(new Error('offline'));
  const fallback = vi.fn();
  const { sharedProductFamily } = await import('./shared-product.js');
  const config = sharedProductFamily('config', { set: fallback }) as any;
  expect(await config.set({ theme: 'dark' })).toEqual({ theme: 'dark' });
  expect(api).toHaveBeenLastCalledWith('/shared-product', expect.objectContaining({ body: JSON.stringify({ method: 'config.set', args: [{ theme: 'dark' }] }) }));
  await expect(config.set({ theme: 'light' })).rejects.toThrow('offline');
  expect(fallback).not.toHaveBeenCalled();
});
it('advertises only closed remote capabilities through the outer product adapter', async () => {
  api.mockResolvedValueOnce({ sharedProductServices: true }).mockResolvedValueOnce({ ok: true, value: { ok: true, value: { id: 'goal' } } }).mockResolvedValueOnce({ ok: true, value: ['team'] });
  const { sharedProductFamily } = await import('./shared-product.js');
  const goals = sharedProductFamily('goals');
  expect('create' in goals).toBe(true); expect('onChanged' in goals).toBe(true); expect('arbitrary' in goals).toBe(false);
  expect(Symbol.iterator in goals).toBe(false); expect('groups' in sharedProductFamily('scheduler')).toBe(true);
  const { product } = await import('./product-client.js');
  expect(await product.goals.create({ title: 'Shared', projectId: 'p', statement: 'Work' })).toMatchObject({ ok: true, value: { id: 'goal' } });
  expect(await product.teams.list()).toEqual(['team']);
  expect(api).toHaveBeenLastCalledWith('/shared-product', expect.objectContaining({ body: JSON.stringify({ method: 'teams.list', args: [] }) }));
});
it('uses existing same-origin HTTP only when a standalone server advertises that capability', async () => {
  api.mockResolvedValue({ sharedProductServices: false });
  const { sharedProductFamily } = await import('./shared-product.js');
  const list = vi.fn(async () => ['existing']);
  expect(await (sharedProductFamily('scheduler', { list }) as any).list()).toEqual(['existing']);
  await expect((sharedProductFamily('goals') as any).create({})).rejects.toThrow('authoritative');
});
it('routes nested groups and filters events; disposal fences an unfinished capability request', async () => {
  api.mockResolvedValue({ sharedProductServices: true });
  const { sharedProductFamily } = await import('./shared-product.js');
  const callback = vi.fn(), stop = vi.fn();
  subscribe.mockReturnValue(stop);
  const scheduler = sharedProductFamily('scheduler') as any;
  const unsubscribe = scheduler.groups.onChanged(callback);
  await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
  const handler = subscribe.mock.calls[0]![1];
  handler({ channel: 'config:onChanged', args: ['wrong'] });
  handler({ channel: 'scheduler:groups:onChanged', args: [['one']] });
  expect(callback).toHaveBeenCalledExactlyOnceWith(['one']);
  unsubscribe(); expect(stop).toHaveBeenCalledOnce();
  const canceled = scheduler.onChanged(callback); canceled();
  await Promise.resolve(); expect(subscribe).toHaveBeenCalledOnce();
});
it('rejects a service error and retries failed capability discovery', async () => {
  api.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ sharedProductServices: true }).mockResolvedValueOnce({ ok: false, message: 'write rejected' });
  const { sharedProductFamily } = await import('./shared-product.js');
  const config = sharedProductFamily('config') as any;
  await expect(config.get()).rejects.toThrow('network');
  await expect(config.set({})).rejects.toThrow('write rejected');
  expect(config.nativeOperation).toBeUndefined();
});
it('reads a fresh snapshot after reconnect and fences it behind newer events or disposal', async () => {
  api.mockResolvedValueOnce({ sharedProductServices: true });
  const { sharedProductFamily } = await import('./shared-product.js');
  const callback = vi.fn(), stopReconnect = vi.fn(); reconnect.mockReturnValue(stopReconnect);
  const stop = (sharedProductFamily('config') as any).onChanged(callback);
  await vi.waitFor(() => expect(reconnect).toHaveBeenCalledOnce());
  const refresh = reconnect.mock.calls[0]![0];
  api.mockResolvedValueOnce({ ok: true, value: { theme: 'dark' } }); await refresh();
  expect(callback).toHaveBeenCalledWith({ theme: 'dark' });
  let resolve!: (value: unknown) => void;
  api.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const stale = refresh(); await Promise.resolve();
  subscribe.mock.calls[0]![1]({ channel: 'config:onChanged', args: [{ theme: 'light' }] });
  resolve({ ok: true, value: { theme: 'stale' } }); await stale;
  expect(callback).toHaveBeenLastCalledWith({ theme: 'light' });
  stop(); expect(stopReconnect).toHaveBeenCalledOnce();
});
it.each(['get', 'reload'] as const)('routes scheduler %s to the selected instance owner', async method => {
  api.mockResolvedValueOnce({ sharedProductServices: true }).mockResolvedValueOnce({ ok: true, value: { ok: true, value: { id: 'task' } } });
  const { product } = await import('./product-client.js');
  expect(await product.scheduler[method]('task')).toMatchObject({ ok: true, value: { id: 'task' } });
  expect(api).toHaveBeenLastCalledWith('/shared-product', expect.objectContaining({ body: JSON.stringify({ method: `scheduler.${method}`, args: ['task'] }) }));
});
it.each(['get', 'reload'] as const)('returns explicit unavailability for scheduler %s without an owner', async method => {
  api.mockResolvedValueOnce({ sharedProductServices: false });
  const { product } = await import('./product-client.js');
  expect(await product.scheduler[method]('task')).toMatchObject({ ok: false, code: 'unavailable', message: expect.stringContaining('owner') });
});
