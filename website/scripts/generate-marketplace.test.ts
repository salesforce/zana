import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runOfficialMarketplaceBuild } from './generate-marketplace.mjs';

vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

const originalArgv = process.argv;
afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('website marketplace build', () => {
  it('keeps the generated catalog in a website-only Docker context', () => {
    vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(runOfficialMarketplaceBuild()).toContain('keeping committed content/marketplace/');
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('rebuilds from source in a full checkout', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'built catalog\n' } as never);
    expect(runOfficialMarketplaceBuild()).toBe('built catalog');
    expect(spawnSync).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringMatching(/marketplace\/scripts\/build\.mjs$/)],
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('fails when both source and the generated catalog are missing', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stderr: 'missing build script' } as never);
    expect(() => runOfficialMarketplaceBuild()).toThrow('missing build script');
  });

  it.each([
    [{ status: 1, stderr: 'invalid catalog', stdout: 'build failed' }, 'invalid catalog'],
    [{ status: 1, stderr: '', stdout: 'build failed' }, 'build failed'],
    [{ status: 2 }, 'marketplace build exited 2']
  ])('surfaces build failures: %j', (result, message) => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(spawnSync).mockReturnValue(result as never);
    expect(() => runOfficialMarketplaceBuild()).toThrow(message);
  });

  it('accepts a successful build with no output', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as never);
    expect(runOfficialMarketplaceBuild()).toBe('');
  });

  it('runs the Docker fallback through the CLI entry point', async () => {
    vi.resetModules();
    process.argv = [process.execPath, fileURLToPath(new URL('./generate-marketplace.mjs', import.meta.url))];
    vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('./generate-marketplace.mjs');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('keeping committed'));
  });

  it('reports a failed CLI build with a nonzero exit', async () => {
    vi.resetModules();
    process.argv = [process.execPath, fileURLToPath(new URL('./generate-marketplace.mjs', import.meta.url))];
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stderr: 'invalid catalog' } as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    await import('./generate-marketplace.mjs');
    expect(error).toHaveBeenCalledWith('invalid catalog');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
