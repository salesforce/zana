import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      bin: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void
    ) => {
      if (args[0] === 'auth') {
        cb(null, 'ok\n', '');
        return;
      }
      if (args[0] === 'missing') {
        const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
        cb(err, '', '');
        return;
      }
      const err = Object.assign(new Error('failed'), { status: 2 });
      cb(err, 'out', 'err');
    }
  )
}));

import { createGhExec, isGhBin } from '../lib/gh-exec.js';

describe('createGhExec', () => {
  it('rejects non-gh bins and maps a non-zero gh status', async () => {
    expect(isGhBin('gh')).toBe(true);
    expect(isGhBin('rm')).toBe(false);
    const exec = createGhExec();
    await expect(exec({ bin: 'curl', args: ['https://example.invalid'] })).rejects.toThrow(/only executes gh/);
    await expect(exec({ bin: 'gh', args: ['auth', 'status'] })).resolves.toEqual({
      code: 0,
      stdout: 'ok\n',
      stderr: ''
    });
    await expect(exec({ bin: 'gh', args: ['missing'] })).resolves.toMatchObject({
      code: 127
    });
    await expect(exec({ bin: 'gh', args: ['pr', 'view'] })).resolves.toMatchObject({
      code: 2,
      stdout: 'out',
      stderr: 'err'
    });
  });
});
