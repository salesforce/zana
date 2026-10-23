import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi, type PluginHandle } from './plugin-api.js';

const routing = vi.hoisted(() => ({
  pluginHarnessDescriptors: vi.fn(async () => [{ id: 'codex' }]),
  readPluginHarnessRouting: vi.fn(() => null),
  writePluginHarnessRouting: vi.fn(async () => undefined),
  checkPluginHarnessRouting: vi.fn(() => ({ ok: true }))
}));
vi.mock('../http/plugin-harness-routing.js', () => routing);
const handles: PluginHandle[] = [], dirs: string[] = [];
function create(productContext?: NonNullable<Parameters<typeof createPluginApi>[2]>['productContext']) {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-harness-routing-'));
  dirs.push(dir);
  const handle = createPluginApi('routing-fixture', dir, { productContext });
  handles.push(handle);
  return handle;
}
afterEach(async () => {
  await Promise.all(handles.splice(0).map(handle => handle.dispose()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('plugin harness routing runtime boundary', () => {
  const scope = { kind: 'global' } as const;
  const value = { schemaVersion: 1 as const, byAdapter: {} };

  it('rejects an unavailable runtime', async () => {
    const sdk = create().api.sdk.harnessRouting;
    await expect(sdk.descriptors()).rejects.toThrow('not available');
    await expect(sdk.read(scope)).rejects.toThrow('not available');
    await expect(sdk.write(scope, null)).rejects.toThrow('not available');
    await expect(sdk.check(scope, value)).rejects.toThrow('not available');
  });

  it('binds the host plugin id and rejects a stale plugin', async () => {
    const context = { db: {} } as never;
    const handle = create(context);
    const sdk = handle.api.sdk.harnessRouting;
    await expect(sdk.descriptors({ projectId: 'p1' })).resolves.toEqual([{ id: 'codex' }]);
    await expect(sdk.descriptors()).resolves.toEqual([{ id: 'codex' }]);
    await expect(sdk.read(scope)).resolves.toBeNull();
    await expect(sdk.write(scope, value)).resolves.toBeUndefined();
    await expect(sdk.check(scope, value)).resolves.toEqual({ ok: true });
    expect(routing.pluginHarnessDescriptors).toHaveBeenNthCalledWith(1, context, { projectId: 'p1' });
    expect(routing.pluginHarnessDescriptors).toHaveBeenNthCalledWith(2, context, {});
    expect(routing.readPluginHarnessRouting).toHaveBeenCalledWith(context, 'routing-fixture', scope);
    expect(routing.writePluginHarnessRouting).toHaveBeenCalledWith(context, 'routing-fixture', scope, value);
    expect(routing.checkPluginHarnessRouting).toHaveBeenCalledWith(context, scope, value);
    await handle.dispose();
    await expect(sdk.read(scope)).rejects.toThrow('stale');
  });
});
