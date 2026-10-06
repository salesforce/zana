import { afterEach, expect, it, vi } from 'vitest';
import { callControlAsProductServer } from './cli-agent-ops.js';
import { productRegisterPersonas, productRegisterTeams } from './product-plugins.js';

vi.mock('./cli-agent-ops.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./cli-agent-ops.js')>(),
  callControlAsProductServer: vi.fn()
}));

afterEach(() => vi.restoreAllMocks());

it('logs rejected persona and team control calls without unhandled rejections', async () => {
  const error = new Error('control connection failed');
  vi.mocked(callControlAsProductServer).mockRejectedValue(error);
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const ctx = { dataDir: '/unavailable' };

  expect(productRegisterPersonas(ctx, 'fixture', [])).toBeUndefined();
  expect(productRegisterTeams(ctx, 'fixture', [])).toBeUndefined();
  await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2));
  expect(log).toHaveBeenCalledWith('[plugin:fixture] registerPersonas failed:', error);
  expect(log).toHaveBeenCalledWith('[plugin:fixture] registerTeams failed:', error);
});
