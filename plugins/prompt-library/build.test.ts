import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, it, vi } from 'vitest';

const build = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../packages/plugin-build/src/build-plugin.js', () => ({ buildPlugin: build }));
beforeEach(() => { vi.resetModules(); build.mockReset().mockResolvedValue(undefined); });

it('packages Prompt Library with the host version and its own plugin root', async () => {
  await import('./build.js');
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(build).toHaveBeenCalledExactlyOnceWith(fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, ''), version);
});

it('propagates packaging failures', async () => {
  build.mockRejectedValueOnce(new Error('plugin compilation failed'));
  await expect(import('./build.js')).rejects.toThrow('plugin compilation failed');
});
