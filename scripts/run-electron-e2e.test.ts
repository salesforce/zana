import { describe, expect, it, vi } from 'vitest';
import { main, parseArgs } from './run-electron-e2e.mjs';

describe('parseArgs', () => {
  it('removes every package-manager separator before forwarding Playwright args', () => {
    expect(parseArgs(['--build', '--', 'e2e/spec.ts', '--', '--headed'])).toEqual({
      build: true,
      playwrightArgs: ['e2e/spec.ts', '--headed']
    });
  });

  it.each([true, false])('runs local Playwright with isolated build mode %s and preserves its failure', async (build) => {
    const run = vi.fn().mockResolvedValue(7);
    expect(await main([...(build ? ['--build'] : []), '--', 'e2e/smoke.spec.ts', '--headed'], run)).toBe(7);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][0]).toBe(process.execPath);
    expect(run.mock.calls[0][1].slice(1)).toEqual(['test', 'e2e/smoke.spec.ts', '--headed']);
    expect(run.mock.calls[0][2].env.ZCC_E2E_BUILD).toBe(build ? '1' : '0');
  });

  it('propagates spawn failure without running any shared ABI restore command', async () => {
    const run = vi.fn().mockRejectedValue(new Error('spawn failed'));
    await expect(main([], run)).rejects.toThrow('spawn failed');
    expect(run).toHaveBeenCalledOnce();
  });
});
