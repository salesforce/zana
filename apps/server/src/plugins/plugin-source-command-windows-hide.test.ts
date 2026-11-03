import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';

const spawnCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options: Record<string, unknown>) => {
      spawnCalls.push(options);
      return actual.spawn(command, args, options);
    }
  };
});

const { runPluginSourceCommand } = await import('./plugin-source-command.js');

// Plugin update checks and git/npm installs run here, in the server under
// Electron (a GUI process). On Windows each console child needs windowsHide or
// it opens a visible console window, and it must not be detached there.
it('hides the console window of plugin source commands, detached only where process groups exist', async () => {
  const result = await runPluginSourceCommand(process.execPath, ['-e', "process.stdout.write('ok')"], tmpdir());
  expect(result).toMatchObject({ code: 0, stdout: 'ok' });
  expect(spawnCalls).toHaveLength(1);
  expect(spawnCalls[0]).toMatchObject({ windowsHide: true, detached: process.platform !== 'win32' });
});
