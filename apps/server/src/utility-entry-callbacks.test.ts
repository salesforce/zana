import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock('./services/threads/thread-reads.js', async original => ({ ...await original<typeof import('./services/threads/thread-reads.js')>(), prepareThreadReads: async () => undefined }));
vi.mock('./http/product-context.js', async original => ({ ...await original<typeof import('./http/product-context.js')>(), createProductHttpContext: h.context }));
vi.mock('./runtime-request-boundary.js', () => ({ dispatchRuntimeMessage: async (data: unknown, _reply: unknown, handler: (data: unknown) => Promise<void>) => handler(data) }));
vi.mock('@zana-ai/zcc-process-utils', async original => ({ ...await original<typeof import('@zana-ai/zcc-process-utils')>(), installRuntimeLog() {} }));

it('wires change callbacks and reports non-Error startup failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'utility-callbacks-'));
  const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: parent });
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  try {
    h.context.mockImplementation((options: { onLibraryChanged(): void; onProjectsChanged(): void; peerKeyProvider: unknown; projectSettings: unknown }) => {
      expect(options.peerKeyProvider).toBeTruthy();
      expect(options.projectSettings).toBeTruthy();
      options.onLibraryChanged();
      options.onProjectsChanged();
      throw 'plain-string-failure';
    });
    await import('./utility-entry.js');
    parent.emit('message', { data: { type: 'start', dataDir: root, rendererRoot: root } });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'plain-string-failure' })));
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'library-changed' }));
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'projects-changed' }));
    parent.emit('message', { data: { type: 'stop' } });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  } finally {
    exit.mockRestore();
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor); else Reflect.deleteProperty(process, 'parentPort');
    await rm(root, { recursive: true, force: true });
  }
});
