import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => vi.fn());
vi.mock('./fetch-with-app-surface.js', () => ({ apiJson: api }));
import { nativeCapabilities } from './native-capabilities.js';
beforeEach(() => {
  api.mockReset().mockResolvedValue({ skills: [], commands: [], diagnostics: [] });
});
it('uses the provider’s recorded host/environment and encodes the project handle', async () => {
  await nativeCapabilities({
    projectId: 'p/a',
    providerId: 'acp-cursor',
    hostId: 'h',
    environmentId: 'e'
  });
  expect(api).toHaveBeenCalledWith(
    '/projects/p%2Fa/native-capabilities?providerId=acp-cursor&hostId=h&environmentId=e'
  );
});
it('supports global discovery and surfaces failures', async () => {
  await nativeCapabilities({});
  expect(api).toHaveBeenCalledWith('/skills/native-capabilities');
  api.mockRejectedValue(new Error('Offline'));
  await expect(nativeCapabilities({ projectId: 'p' })).rejects.toThrow('Offline');
});
