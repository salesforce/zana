import { afterEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as Array<{ fn: string; options: Record<string, unknown> }>);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      calls.push({ fn: 'spawn', options: args[2] as Record<string, unknown> });
      return actual.spawn(...args);
    },
    execFile: (...args: Parameters<typeof actual.execFile>) => {
      calls.push({ fn: 'execFile', options: args[2] as Record<string, unknown> });
      return actual.execFile(...args);
    }
  };
});

const { discoverCodexModels } = await import('../codex-model-catalog.js');
const { discoverCursorModels } = await import('../cursor-model-catalog.js');
const { readSessionStatsOpenCodeExport } = await import('../opencode/transcript-reader.js');

afterEach(() => {
  calls.length = 0;
});

function hidden() {
  return calls.map((call) => [call.fn, call.options.windowsHide]);
}

// The host daemon runs under Electron (a GUI process): on Windows each discovery
// probe without windowsHide opens a visible console window. Node rejects the
// probe arguments and exits, which drives the real spawn path on every platform.
it('discovers Codex models with the console window hidden', async () => {
  await expect(discoverCodexModels(process.execPath, `codex-hide-${Date.now()}`)).resolves.toEqual([]);
  expect(hidden()).toEqual([['spawn', true]]);
});

it('discovers Cursor models with the console window hidden', async () => {
  await expect(discoverCursorModels(process.execPath, `cursor-hide-${Date.now()}`)).resolves.toEqual([]);
  expect(hidden()).toEqual([['spawn', true]]);
});

it('reads OpenCode export stats with the console window hidden', async () => {
  await expect(readSessionStatsOpenCodeExport('ses_hide', { binary: process.execPath })).resolves.toBeNull();
  expect(hidden()).toEqual([['execFile', true]]);
});
