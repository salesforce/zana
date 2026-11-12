import { afterEach, describe, expect, it, vi } from 'vitest';

const runCli = vi.fn();
vi.mock('../lib/run-cli.js', () => ({ runCli }));

const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.resetModules();
  runCli.mockReset();
});

describe('zcc bin', () => {
  it('relays direct stderr, result output, and exit code', async () => {
    runCli.mockImplementation(async (_argv, { onStderr }) => {
      onStderr('direct error\n');
      return { stdout: 'standard output\n', stderr: 'result error\n', exitCode: 7 };
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await import('../bin/zcc.ts');
    await vi.waitFor(() => expect(process.exitCode).toBe(7));

    expect(stdout).toHaveBeenCalledWith('standard output\n');
    expect(stderr).toHaveBeenNthCalledWith(1, 'direct error\n');
    expect(stderr).toHaveBeenNthCalledWith(2, 'result error\n');
  });

  it('writes a fatal error and exits one when runCli rejects', async () => {
    runCli.mockRejectedValue(new Error('broken command'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await import('../bin/zcc.ts');
    await vi.waitFor(() => expect(process.exitCode).toBe(1));

    expect(stderr).toHaveBeenCalledWith('Fatal error: broken command\n');
  });
});
