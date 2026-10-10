import { beforeEach, expect, it, vi } from 'vitest';
import { machineTerminals, streamsOverProductSocket } from './machine-terminals.js';
const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('./fetch-with-app-surface.js', () => ({ fetchWithAppSurface: fetch }));
function backend(id: string) {
  return { create: vi.fn().mockResolvedValue({ ok: true, value: { id } }), list: vi.fn().mockResolvedValue([{ id }]), write: vi.fn(), close: vi.fn(), resize: vi.fn(), reply: vi.fn(), backlog: vi.fn().mockResolvedValue(id), onData: vi.fn().mockReturnValue(vi.fn()), onExit: vi.fn().mockReturnValue(vi.fn()), onUpdated: vi.fn().mockReturnValue(vi.fn()) };
}
beforeEach(() => fetch.mockReset());
it('routes explicit machine shells and merges both rosters without duplicate IDs', async () => {
  const owner = Object.freeze(backend('local')), host = backend('remote'), api = machineTerminals(owner as any, host as any);
  await api.create({ projectId: 'p1', profile: 'shell', hostId: 'h2' });
  await api.write('remote', 'pwd\r'); expect(host.write).toHaveBeenCalledWith('remote', 'pwd\r'); expect(owner.write).not.toHaveBeenCalled();
  await api.create({ projectId: 'p1', profile: 'codex' }); await api.close('local'); expect(owner.close).toHaveBeenCalledWith('local');
  expect(await api.list('p1')).toEqual([{ id: 'local' }, { id: 'remote' }]);
  host.list.mockResolvedValue([{ id: 'local' }]); expect(await api.list('p1')).toEqual([{ id: 'local' }]); expect(fetch).not.toHaveBeenCalled();
});
it('recovers transport from an authoritative read after client restart, without mutation fallback', async () => {
  const owner = Object.freeze(backend('local')), host = backend('remote'), api = machineTerminals(owner as any, host as any);
  fetch.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, status: 404 });
  await api.resize('remote', 100, 40); expect(host.resize).toHaveBeenCalledWith('remote', 100, 40);
  expect(await api.backlog('local')).toBe('local');
  host.write.mockRejectedValue(new Error('offline'));
  await expect(api.write('remote', 'run')).rejects.toThrow('offline'); expect(owner.write).not.toHaveBeenCalled();
});
it('refuses to guess transport after a failed ownership lookup', async () => {
  const owner = Object.freeze(backend('local')), host = backend('remote'), api = machineTerminals(owner as any, host as any);
  fetch.mockResolvedValue({ ok: false, status: 503 });
  await expect(api.close('unknown')).rejects.toThrow('Cannot determine');
  expect(owner.close).not.toHaveBeenCalled(); expect(host.close).not.toHaveBeenCalled();
});
it('subscribes to both streams and releases both subscriptions', () => {
  const owner = Object.freeze(backend('local')), host = backend('remote'), api = machineTerminals(owner as any, host as any), cb = vi.fn();
  for (const key of ['onData', 'onExit', 'onUpdated'] as const) {
    const stop = api[key](cb); owner[key].mock.calls[0]![0]('local', 'a'); host[key].mock.calls[0]![0]('remote', 'b'); stop();
    expect(owner[key].mock.results[0]!.value).toHaveBeenCalledOnce(); expect(host[key].mock.results[0]!.value).toHaveBeenCalledOnce();
  }
  expect(cb).toHaveBeenCalledTimes(6);
});
it('reads a cursor snapshot only from the recorded host, preserving legacy owner output', async () => {
  const owner = Object.freeze(backend('local')), host = { ...backend('remote'), backlogSnapshot: vi.fn().mockResolvedValue({ text: 'x', startOffset: 7, endOffset: 8 }) };
  const api = machineTerminals(owner as any, host as any);
  await api.list('p1');
  expect(await api.backlogSnapshot!('remote')).toEqual({ text: 'x', startOffset: 7, endOffset: 8 });
  expect(await api.backlogSnapshot!('local')).toBe('local');
  expect(host.backlog).not.toHaveBeenCalled();
});

it('reports whether a session streams over the product socket', async () => {
  const owner = Object.freeze(backend('local')), host = backend('remote'), api = machineTerminals(owner as any, host as any);
  await api.create({ projectId: 'p1', profile: 'shell', hostId: 'h2' }); await api.create({ projectId: 'p1', profile: 'codex' });
  vi.stubGlobal('window', { cc: {} });
  try {
    expect(await streamsOverProductSocket(api, 'remote')).toBe(true);
    expect(await streamsOverProductSocket(api, 'local')).toBe(false);
    fetch.mockResolvedValue({ ok: false, status: 503 });
    expect(await streamsOverProductSocket(api, 'unknown')).toBe(true);
    expect(await streamsOverProductSocket(owner as any, 'local')).toBe(true);
  } finally { vi.unstubAllGlobals(); }
  expect(await streamsOverProductSocket(api, 'local')).toBe(true);
});
