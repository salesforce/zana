import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock('./project-store.js', async original => ({ ...await original<typeof import('./project-store.js')>(), createProjectStore: () => null }));
vi.mock('./project-settings-store.js', async original => ({ ...await original<typeof import('./project-settings-store.js')>(), createProjectSettingsStore: () => null }));
vi.mock('./services/threads/thread-reads.js', async original => ({ ...await original<typeof import('./services/threads/thread-reads.js')>(), prepareThreadReads: async () => undefined }));
vi.mock('./http/product-context.js', async original => ({ ...await original<typeof import('./http/product-context.js')>(), createProductHttpContext: h.context }));
vi.mock('./runtime-request-boundary.js', () => ({ dispatchRuntimeMessage: async (data: unknown, _reply: unknown, handler: (data: unknown) => Promise<void>) => handler(data) }));
vi.mock('@zana-ai/zcc-process-utils', async original => ({ ...await original<typeof import('@zana-ai/zcc-process-utils')>(), installRuntimeLog() {} }));

it('passes undefined stores to the product context when store factories yield nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'utility-null-stores-'));
  const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: parent });
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  try {
    h.context.mockImplementation((options: { projects: unknown; projectSettings: unknown }) => {
      expect(options.projects).toBeUndefined();
      expect(options.projectSettings).toBeUndefined();
      throw new Error('boom');
    });
    await import('./utility-entry.js');
    parent.emit('message', { data: { type: 'start', dataDir: root, rendererRoot: root } });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'boom' })));
    parent.emit('message', { data: { type: 'stop' } });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  } finally {
    exit.mockRestore();
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor); else Reflect.deleteProperty(process, 'parentPort');
    await rm(root, { recursive: true, force: true });
  }
});
