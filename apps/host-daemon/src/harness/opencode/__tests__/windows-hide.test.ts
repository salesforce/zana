import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const spawnCalls = vi.hoisted(() => [] as Array<{ args: readonly string[]; options: Record<string, unknown> }>);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options: Record<string, unknown>) => {
      spawnCalls.push({ args, options });
      return actual.spawn(command, args, options);
    }
  };
});

const { OpenCodeProvider } = await import('../provider.js');

const dirs: string[] = [];
afterEach(() => {
  spawnCalls.length = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function context() {
  // A fresh cwd per test keeps the module-level discovery caches from answering.
  const cwd = mkdtempSync(join(tmpdir(), 'zcc-oc-hide-'));
  dirs.push(cwd);
  // Node rejects `models` / `agent list` as a missing script and exits non-zero,
  // which is enough to drive the real capture path on every platform.
  const config: AppConfig = {
    version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13,
    lastProjectId: null, opencodeBinary: process.execPath
  };
  return { cwd, config };
}

// The daemon runs under Electron, a GUI process: on Windows each discovery
// command without windowsHide opens its own visible console window.
describe('OpenCode discovery spawns', () => {
  it('hides the console window for `opencode models`', async () => {
    await expect(new OpenCodeProvider().discoverModelTargets(context())).resolves.toBeUndefined();
    expect(spawnCalls.map((call) => call.args)).toEqual([['models']]);
    expect(spawnCalls[0].options.windowsHide).toBe(true);
  });

  it('hides the console window for `opencode agent list`', async () => {
    await expect(new OpenCodeProvider().discoverAgentDescriptors(context(), { bypassCache: true }))
      .resolves.toMatchObject({ status: 'failure' });
    expect(spawnCalls.map((call) => call.args)).toEqual([['agent', 'list']]);
    expect(spawnCalls[0].options.windowsHide).toBe(true);
  });
});
