import { beforeEach, expect, it, vi } from 'vitest';
import { setProductConfig } from './product-config.js';
const h = vi.hoisted(() => ({ connected: false, call: vi.fn(), set: vi.fn() }));
vi.mock('./cli-agent-ops.js', () => ({
  productServerHasDesktopCredential: () => h.connected,
  callControlAsProductServer: h.call,
  asControlResult: (result: unknown) => result
}));
const ctx = { dataDir: '/private/config', config: { setConfig: h.set } } as never;
beforeEach(() => { vi.clearAllMocks(); h.connected = false; });
it('uses the standalone config owner without desktop credentials', async () => {
  const patch = { theme: 'light' as const };
  h.set.mockReturnValue({ ...patch, version: 1 });
  expect(await setProductConfig(ctx, patch)).toEqual({ ...patch, version: 1 });
  expect(h.set).toHaveBeenCalledWith(patch);
  expect(h.call).not.toHaveBeenCalled();
});
it('waits for desktop normalization and live effects without a second disk write', async () => {
  h.connected = true;
  const patch = { harnesses: { byId: { claude: { binary: '/new/claude' } } } };
  h.call.mockResolvedValue({ ok: true, value: { ...patch, claudeBinary: '/new/claude' } });
  expect(await setProductConfig(ctx, patch)).toMatchObject({ claudeBinary: '/new/claude' });
  expect(h.call).toHaveBeenCalledWith('/private/config', 'product.invoke', { method: 'config.set', args: [patch] });
  expect(h.set).not.toHaveBeenCalled();
});
it.each([undefined, 'Owner disconnected'])('rejects an unavailable desktop instead of acknowledging a stale write (%s)', async message => {
  h.connected = true;
  h.call.mockResolvedValue({ ok: false, message });
  await expect(setProductConfig(ctx, {})).rejects.toThrow(message ?? 'Desktop config update failed');
  expect(h.set).not.toHaveBeenCalled();
});
