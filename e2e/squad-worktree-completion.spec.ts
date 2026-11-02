/**
 * Built-Electron proof that a Squad run in an isolated git worktree honours the Squad's
 * `worktreeOnComplete` choice when it reaches a terminal state. Real Squad launch through the
 * CLI-owner path, fake claude workers, real git repo. Zero model spend.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import {
  createJobTeamContext,
  findJobExecutionId,
  jobTeamFailure,
  launchJobTeamCliOwner,
  teardownJobTeam,
  type JobTeamContext
} from './sdk/job-team-scenario.js';
import type { JobTeamScenario } from './sdk/harness.js';

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true } });
test.setTimeout(180_000);

const JOB_TITLE = 'CLI Agent durable job';
const WORKER_FILE = 'home.txt';
const ZANA_FILE = '.zana/e2e-handoff.txt';

type Choice = 'merge' | 'delete' | 'leave';

function makeGit(cwd: string) {
  return (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** A real repository with one commit on `main`, a local identity and signing off. */
function initRepo(projectDir: string): { git: (...args: string[]) => string; baseHead: string } {
  const git = makeGit(projectDir);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Squad Worktree E2E');
  git('config', 'user.email', 'squad-worktree@example.test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(projectDir, 'README.md'), 'Squad worktree completion fixture\n');
  // .zcc/ is deliberately NOT ignored: the app writes .zcc/activity.jsonl into the project root,
  // and merge must still treat that base checkout as clean.
  writeFileSync(join(projectDir, '.gitignore'), '.fake-coordinator.log\n.worktrees/\n');
  git('add', 'README.md', '.gitignore');
  git('commit', '-m', 'Fixture setup');
  return { git, baseHead: git('rev-parse', 'HEAD') };
}

interface Seen { path: string; branch: string }

/** Parse `git worktree list --porcelain` into the non-main worktrees. */
function extraWorktrees(git: (...args: string[]) => string): Seen[] {
  const out = git('worktree', 'list', '--porcelain').split('\n\n').map((block) => {
    const path = /^worktree (.+)$/m.exec(block)?.[1] ?? '';
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? '';
    return { path, branch };
  });
  return out.slice(1).filter((entry) => entry.path);
}

async function runState(ctx: JobTeamContext, projectId: string, executionId: string): Promise<string> {
  return ctx.window.evaluate(async ({ projectId, executionId }) =>
    (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.state ?? 'missing',
  { projectId, executionId });
}

/** Launch a worktree-isolated Squad and sample its worktree until the run is terminal. */
async function runSquad(ctx: JobTeamContext, choice: Choice) {
  const { git, baseHead } = initRepo(ctx.projectDir);
  const projectId = await launchJobTeamCliOwner(ctx, {
    workerQuantity: 2,
    teamExtra: { worktreeIsolation: true, worktreeOnComplete: choice }
  });
  const executionId = await findJobExecutionId(ctx.window, projectId, JOB_TITLE);
  let seen: Seen | undefined;
  let state = '';
  await expect.poll(async () => {
    seen ??= extraWorktrees(git)[0];
    state = await runState(ctx, projectId, executionId);
    return state;
  }, { timeout: 120_000, intervals: [200] }).toMatch(/^(COMPLETED|FAILED|STOPPED)$/);
  expect(seen, 'the run created an isolated squad worktree').toBeTruthy();
  expect(seen!.branch).not.toBe('main');
  return { git, baseHead, seen: seen!, state };
}

const tracked = (git: (...args: string[]) => string, ref: string) => git('ls-tree', '-r', '--name-only', ref).split('\n');
const branches = (git: (...args: string[]) => string) => git('branch', '--list', '--format=%(refname:short)').split('\n').filter(Boolean);

async function withSquad(app: Parameters<typeof createJobTeamContext>[0], prefix: string, scenario: JobTeamScenario, body: (ctx: JobTeamContext) => Promise<void>) {
  const ctx = createJobTeamContext(app, { tmpPrefix: prefix, scenario });
  try {
    await body(ctx);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
}

test('merge: a completed Squad commits its worktree work to base and removes worktree and branch', async ({ app }) => {
  await withSquad(app, 'zcc-wt-merge-', 'unattended', async (ctx) => {
    const { git, baseHead, seen, state } = await runSquad(ctx, 'merge');
    expect(state).toBe('COMPLETED');
    try {
      await expect.poll(() => existsSync(seen.path), { timeout: 60_000, intervals: [250] }).toBe(false);
    } catch (error) {
      const inbox = await ctx.window.evaluate(async (id) => (await window.cc.inbox.history({ limit: 20, projectId: id })).entries.map((e) => `${e.subject}: ${e.comments}`), ctx.projectId!).catch(() => []);
      throw new Error(`${String(error)}\nbase status:\n${git('status', '--porcelain', '--untracked-files=all')}\nwt status:\n${makeGit(seen.path)('status', '--porcelain', '--untracked-files=all')}\nlog:\n${git('log', '--all', '--oneline')}\ninbox:\n${inbox.join('\n')}`);
    }
    await expect.poll(() => extraWorktrees(git), { timeout: 30_000 }).toEqual([]);
    await expect.poll(() => branches(git).includes(seen.branch), { timeout: 30_000 }).toBe(false);

    expect(git('branch', '--show-current')).toBe('main');
    expect(tracked(git, 'main')).toEqual(expect.arrayContaining([WORKER_FILE, 'about.txt', 'result.txt']));
    expect(git('show', `main:${WORKER_FILE}`)).toBe('HOME: ready');
    // Nothing under .zana/ ever reaches base history.
    expect(tracked(git, 'main').filter((name) => name.startsWith('.zana/'))).toEqual([]);
    expect(git('log', 'main', '--name-only', '--format=', '--', '.zana')).toBe('');
    expect(git('log', '-1', '--format=%s', '--no-merges', 'main')).toContain('final changes');
    expect(git('rev-list', '--count', `${baseHead}..main`)).not.toBe('0');
    // Only Zana's own untracked .zcc/ activity files may remain in the base checkout.
    expect(git('status', '--porcelain', '--', '.', ':(exclude).zcc')).toBe('');
  });
});

test('delete: a completed Squad discards its worktree and branch without touching base', async ({ app }) => {
  await withSquad(app, 'zcc-wt-delete-', 'unattended', async (ctx) => {
    const { git, baseHead, seen, state } = await runSquad(ctx, 'delete');
    expect(state).toBe('COMPLETED');
    await expect.poll(() => existsSync(seen.path), { timeout: 60_000, intervals: [250] }).toBe(false);
    await expect.poll(() => extraWorktrees(git), { timeout: 30_000 }).toEqual([]);
    await expect.poll(() => branches(git).includes(seen.branch), { timeout: 30_000 }).toBe(false);

    expect(git('branch', '--show-current')).toBe('main');
    expect(git('rev-parse', 'HEAD')).toBe(baseHead);
    expect(tracked(git, 'main')).not.toContain(WORKER_FILE);
    expect(existsSync(join(ctx.projectDir, WORKER_FILE))).toBe(false);
    expect(branches(git)).toEqual(['main']);
  });
});

test('leave (default): a completed Squad keeps its worktree, branch and uncommitted work', async ({ app }) => {
  await withSquad(app, 'zcc-wt-leave-', 'unattended', async (ctx) => {
    const { git, baseHead, seen, state } = await runSquad(ctx, 'leave');
    expect(state).toBe('COMPLETED');
    // Give terminal effects time to run (they record a durable marker) before asserting nothing happened.
    await expect.poll(async () => ctx.window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions[0]?.state;
    }, ctx.projectId!), { timeout: 30_000 }).toBe('COMPLETED');
    expect(existsSync(seen.path)).toBe(true);
    expect(realpathSync(extraWorktrees(git)[0]!.path)).toBe(realpathSync(seen.path));
    expect(branches(git)).toContain(seen.branch);
    expect(existsSync(join(seen.path, WORKER_FILE))).toBe(true);
    expect(existsSync(join(seen.path, ZANA_FILE))).toBe(true);
    expect(git('rev-parse', 'main')).toBe(baseHead);
    expect(tracked(git, 'main')).not.toContain(WORKER_FILE);
  });
});

test('merge is not applied to a failed run: the worktree and branch are kept', async ({ app }) => {
  await withSquad(app, 'zcc-wt-failed-', 'failed-dag', async (ctx) => {
    const { git, baseHead, seen, state } = await runSquad(ctx, 'merge');
    expect(state).toBe('FAILED');
    // Terminal effects are async; a kept worktree is stable, so assert it holds across a settle window.
    await expect.poll(() => existsSync(join(seen.path, 'independent.txt')), { timeout: 30_000 }).toBe(true);
    expect(existsSync(seen.path)).toBe(true);
    expect(extraWorktrees(git)).toHaveLength(1);
    expect(branches(git)).toContain(seen.branch);
    expect(git('rev-parse', 'main')).toBe(baseHead);
    expect(tracked(git, 'main')).not.toContain('independent.txt');
  });
});
