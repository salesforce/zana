import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import type { MainModule, MainModuleContext } from '@zana-ai/zcc-extension-sdk/main';

// registry.ts imports electron's `app`/`shell`; mock them so it loads under
// vitest (mirrors registry-ctx-shape.test.ts).
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  shell: { openExternal: vi.fn() }
}));

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

const { MainModuleHost } = await import('../registry.js');

// Desktop main is a GUI process: on Windows a console child of the built-in
// ctx exec without windowsHide opens a visible console window.
it('runs the built-in ctx exec with the console window hidden', async () => {
  let ctx: MainModuleContext | undefined;
  const probe: MainModule = {
    id: 'probe',
    async setup(c) {
      ctx = c;
      return {};
    }
  };
  await new MainModuleHost({ log: () => {} }).setupAll([probe]);
  const run = ctx!['exec'];
  const result = await run({ bin: process.execPath, args: ['-e', "process.stdout.write('ok')"] });
  expect(result).toMatchObject({ code: 0, stdout: 'ok' });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ windowsHide: true, shell: false });
});
