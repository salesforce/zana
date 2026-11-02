import { mkdtemp, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const spawnCalls = vi.hoisted(() => [] as Array<{ command: string; options: Record<string, unknown> }>);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options: Record<string, unknown>) => {
      spawnCalls.push({ command, options });
      return actual.spawn(command, args, options);
    }
  };
});

const { runGit, runGitWithNullRecordLimit } = await import('./git.js');
const { runGitClone } = await import('./git-clone-process.js');
const { getPullRequestForCurrentBranch } = await import('./git-host.js');

// The host daemon runs under Electron (a GUI process), so on Windows every git
// and gh child needs windowsHide or it opens a visible console window.
describe('host git and gh spawns hide their console window', () => {
  let base: string;
  let repo: string;

  beforeAll(async () => {
    base = realpathSync(await mkdtemp(join(tmpdir(), 'zcc-git-hide-')));
    repo = join(base, 'repo');
  });
  afterAll(async () => { await rm(base, { recursive: true, force: true }); });

  it('passes windowsHide to git, record-limited git, git clone and gh', async () => {
    await runGit(base, ['init', '-q', '-b', 'main', repo]);
    await runGitWithNullRecordLimit(repo, ['ls-files', '-z', '--others'], 10);
    await runGitClone(repo, join(base, 'clone'));
    // A branch exists (unborn main), so gh runs; with no gh on PATH the spawn
    // errors, which is fine: only the options it was given matter here.
    vi.stubEnv('ZCC_GH_BINARY', process.execPath);
    await getPullRequestForCurrentBranch(repo).catch(() => null);
    vi.unstubAllEnvs();

    expect(spawnCalls.map((call) => call.command)).toContain(process.execPath);
    expect(spawnCalls.length).toBeGreaterThanOrEqual(5);
    expect(spawnCalls.filter((call) => call.options.windowsHide !== true)).toEqual([]);
  });
});
