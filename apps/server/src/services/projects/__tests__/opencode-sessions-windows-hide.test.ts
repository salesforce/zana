import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (...args: Parameters<typeof actual.execFile>) => {
      calls.push(args[2] as Record<string, unknown>);
      return actual.execFile(...args);
    }
  };
});

const { listOpenCodeSessions } = await import('../opencode-sessions.js');

// The server runs under Electron (a GUI process): on Windows a console child
// without windowsHide opens a visible console window.
it('lists OpenCode sessions with the console window hidden', async () => {
  // Node treats `session` as a missing script and exits non-zero, so the real
  // execFile path runs and the listing degrades to empty.
  await expect(listOpenCodeSessions(tmpdir(), { binary: process.execPath })).resolves.toEqual([]);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ windowsHide: true });
});
