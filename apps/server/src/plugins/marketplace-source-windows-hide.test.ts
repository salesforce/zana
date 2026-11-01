import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

const gitCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options: Record<string, unknown>) => {
      if (command === 'git') gitCalls.push(options);
      return actual.spawn(command, args, options);
    }
  };
});

const { materializeMarketplaceIndex } = await import('./marketplace-source.js');
const { spawnSync } = await vi.importActual<typeof import('node:child_process')>('node:child_process');

const repo = mkdtempSync(join(tmpdir(), 'zcc-mp-hide-'));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

// Marketplace discovery runs in the server under Electron (a GUI process), so on
// Windows its git clone needs windowsHide or it opens a visible console window.
it('clones a git catalog with windowsHide', async () => {
  writeFileSync(join(repo, 'marketplace.json'), JSON.stringify({ schemaVersion: 1, name: 'hide', displayName: 'Hide', plugins: [] }));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };
  for (const args of [['init', '-q', '-b', 'main'], ['add', 'marketplace.json'], ['commit', '-q', '-m', 'init']]) {
    expect(spawnSync('git', args, { cwd: repo, env }).status).toBe(0);
  }
  const index = await materializeMarketplaceIndex({ kind: 'git', url: repo, ref: 'HEAD' });
  expect(index.name).toBe('hide');
  expect(gitCalls.length).toBeGreaterThan(0);
  expect(gitCalls.filter((options) => options.windowsHide !== true)).toEqual([]);
});
