import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ resolve: vi.fn(), context: vi.fn() }));
vi.mock('./services/threads/thread-reads.js', () => ({ prepareThreadReads: async () => undefined }));
vi.mock('./services/hosts/pairing-target.js', () => ({ resolvePairingTargetForContext: h.resolve }));
vi.mock('./http/product-context.js', async original => ({ ...await original<typeof import('./http/product-context.js')>(), createProductHttpContext: h.context }));
vi.mock('./runtime-request-boundary.js', () => ({ dispatchRuntimeMessage: async (data: unknown, _reply: unknown, handler: (data: unknown) => Promise<void>) => handler(data) }));
vi.mock('@zana-ai/zcc-process-utils', async original => ({ ...await original<typeof import('@zana-ai/zcc-process-utils')>(), installRuntimeLog() {} }));

it('answers pairing-target from the utility process, falling back to the tunnel when unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'utility-pairing-target-'));
  const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: parent });
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const ask = async (id: string) => {
    parent.emit('message', { data: { type: 'request', protocolVersion: 1, id, operation: 'pairing-target' } });
    await vi.waitFor(() => expect(parent.postMessage.mock.calls.some(([m]) => m.id === id)).toBe(true));
    return parent.postMessage.mock.calls.find(([m]) => m.id === id)![0].value;
  };
  try {
    await import('./utility-entry.js');
    // Other request operations never reach the pairing-target branch.
    parent.emit('message', { data: { type: 'request', protocolVersion: 1, id: 'other', operation: 'thread-live', threadId: 't', projectId: 'p' } });
    await vi.waitFor(() => expect(parent.postMessage.mock.calls.some(([m]) => m.id === 'other')).toBe(true));
    expect(h.resolve).not.toHaveBeenCalled();
    // No product context yet.
    expect(await ask('a')).toEqual({ kind: 'tunnel', reason: 'relay_offline' });

    // Context exists (boot aborts later on the stub, which leaves the context assigned).
    h.context.mockReturnValue({ hub: { subscribe: () => () => undefined }, db: {}, origins: {}, dispose: () => undefined });
    parent.emit('message', { data: { type: 'start', dataDir: root, rendererRoot: root } });
    await vi.waitFor(() => expect(h.context).toHaveBeenCalled());
    await vi.waitFor(() => expect(parent.postMessage.mock.calls.some(([m]) => m.type === 'error' || m.type === 'ready')).toBe(true));

    h.resolve.mockResolvedValueOnce({ kind: 'relay', url: 'http://relay' });
    expect(await ask('b')).toEqual({ kind: 'relay', url: 'http://relay' });
    expect(h.resolve).toHaveBeenCalledWith(expect.objectContaining({ origins: {} }));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.resolve.mockRejectedValueOnce(new Error('probe failed'));
    expect(await ask('c')).toEqual({ kind: 'tunnel', reason: 'relay_offline' });
    expect(warn).toHaveBeenCalledWith('[zcc] pairing target unavailable: probe failed');
    h.resolve.mockRejectedValueOnce('opaque');
    expect(await ask('d')).toEqual({ kind: 'tunnel', reason: 'relay_offline' });
    expect(warn).toHaveBeenCalledWith('[zcc] pairing target unavailable: opaque');
    warn.mockRestore();
  } finally {
    parent.emit('message', { data: { type: 'stop' } });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    exit.mockRestore();
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor); else Reflect.deleteProperty(process, 'parentPort');
    await rm(root, { recursive: true, force: true });
  }
});
