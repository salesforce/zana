import { describe, expect, it } from 'vitest';
import { spawn } from './pty-pipe-shim.js';

describe('pty-pipe-shim', () => {
  it('pipes stdout to onData and reports exit', async () => {
    const handle = spawn(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(3);'], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>
    });
    const chunks: string[] = [];
    const exited = new Promise<{ exitCode: number }>((resolve) => {
      handle.onExit(resolve);
    });
    handle.onData((data) => {
      chunks.push(data);
    });
    await expect(exited).resolves.toMatchObject({ exitCode: 3 });
    expect(chunks.join('')).toContain('hi');
  });
});
