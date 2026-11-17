/**
 * Squad worker issues (first half): launch and worker failures are visible and contained.
 *
 * Built-Electron acceptance spec for REQ-1, REQ-2, REQ-4..REQ-6, REQ-8, REQ-10, REQ-11, REQ-14, REQ-16..REQ-21.
 * Fixtures the e2e-fixtures unit provides (names fixed by the plan):
 *   - Job Team scenarios `worker-exit-1`, `spawn-throw-slot-N` (fixture binary that fails to exec slot N)
 *     and `worker-ignores-close` (a worker that survives a close request, for the Cancel check)
 *   - persona-file helper `writePersonaFile(home, name, body)` for the isolated HOME
 *   - launchEnv `ZCC_TEST_FAIL_LAUNCH_COMPLETE=1` (fault injection that makes the launchTeam tail throw)
 * Until those land the scenario tests cannot pass; the spec must still typecheck.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary, type JobTeamScenario } from './sdk/harness.js';
import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';

const exec = promisify(execFile);
const scenario = (name: string) => name as unknown as JobTeamScenario;

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, autoRenameTabs: false, sponsorPromptDismissed: true } });
test.setTimeout(150_000);

interface Run { projectId: string; projectName: string; projectDir: string; cleanup: () => Promise<void> }

async function setup(window: Page, binary: string, opts: { workers: number; teamId?: string }): Promise<Run> {
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-swi-proj-'));
  await window.evaluate((bin) => window.cc.config.set({ teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, defaultHarness: 'claude' }), binary);
  await window.evaluate(() => window.cc.personas.save({ id: 'e2e-orchestrator', name: 'E2E Orchestrator', description: 'coordinator', baseProfile: 'claude', permissionMode: 'default', systemPrompt: '' }));
  await window.evaluate(() => window.cc.personas.save({ id: 'e2e-worker', name: 'E2E Worker', description: 'worker', baseProfile: 'claude', permissionMode: 'default', systemPrompt: '' }));
  await window.evaluate(({ quantity, id }) => window.cc.teams.save({ id, name: 'SWI Team', description: 'swi', slots: [{ personaId: 'e2e-worker', quantity }], orchestratorPersonaId: 'e2e-orchestrator' }),
    { quantity: opts.workers, id: opts.teamId ?? 'swi-team' });
  const projectId = await window.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
    return result.value.id;
  }, projectDir);
  return {
    projectId, projectDir, projectName: basename(projectDir),
    cleanup: async () => {
      await window.evaluate(async (id) => {
        for (const session of await window.cc.terminals.list(id)) { try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ } }
        try { await window.cc.projects.remove(id); } catch { /* best-effort */ }
      }, projectId);
      rmSync(projectDir, { recursive: true, force: true });
    }
  };
}

async function startJob(window: Page, run: Run, mode: 'structured' | 'freeform', teamId = 'swi-team') {
  return window.evaluate(({ projectId, mode, teamId }) => window.cc.teams.startJob({ teamId, projectId, goal: 'swi acceptance run', coordinationMode: mode }), { projectId: run.projectId, mode, teamId });
}

async function snapshotOf(window: Page, projectId: string): Promise<{ executionId: string; state: string; text: string } | null> {
  return window.evaluate(async (id) => {
    const page = await window.cc.executionBoard.listProject(id);
    const execution = page.executions[0];
    if (!execution) return null;
    const snapshot = await window.cc.executionBoard.snapshot(id, execution.executionId, 0);
    return { executionId: execution.executionId, state: execution.state, text: JSON.stringify(snapshot ?? {}) };
  }, projectId);
}

function cliRunner(window: Page, home: string, cwd: string) {
  const copiedCli = join(home, 'cli');
  cpSync(resolve('packages/cli/dist'), copiedCli, { recursive: true, dereference: true });
  const env = { ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'), ZCC_SERVER_URL: new URL(window.url()).origin,
    ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined, NO_COLOR: '1' };
  return async (args: string[]) => {
    try {
      const done = await exec(process.execPath, [join(copiedCli, 'bin/zcc'), ...args], { cwd, env, timeout: 60_000, maxBuffer: 1024 * 1024 });
      return { code: 0, stdout: done.stdout, stderr: done.stderr };
    } catch (error) {
      const failed = error as { code?: number; stdout?: string; stderr?: string };
      return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
  };
}

const GENERIC_PREVIEW = 'Launch preview could not validate the plan or target.';

test('a CLI launch with a bad plan shows the plan error, not the generic preview message (REQ-4, REQ-5)', async ({ app, home }) => {
  const agent = makeJobTeamCoordinatorBinary();
  const run = await setup(app.window, agent.path, { workers: 1 });
  try {
    const zcc = cliRunner(app.window, home, run.projectDir);
    const result = await zcc(['team', 'launch', '--team', 'swi-team', '--project', run.projectId, '--mode', 'structured', '--goal', 'just prose, no executable steps']);
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/plan/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain(GENERIC_PREVIEW);
    expect(`${result.stdout}${result.stderr}`).not.toContain(run.projectDir);
  } finally { await run.cleanup(); agent.cleanup(); }
});

test('a worker spawn throw leaves the other workers launched and failedSlots visible (REQ-6)', async ({ app }) => {
  const agent = makeJobTeamCoordinatorBinary({ scenario: scenario('spawn-throw-slot-2') });
  const run = await setup(app.window, agent.path, { workers: 3 });
  try {
    const started = await startJob(app.window, run, 'freeform');
    expect(started.ok).toBe(true);
    await expect.poll(async () => (await snapshotOf(app.window, run.projectId))?.text ?? '', { timeout: 60_000, intervals: [500] }).toContain('failedSlots');
    const live = await app.window.evaluate(async (id) => (await window.cc.terminals.list(id)).filter((session) => session.status !== 'exited').length, run.projectId);
    expect(live).toBeGreaterThanOrEqual(3); // coordinator + the two workers that did not throw
  } finally { await run.cleanup(); agent.cleanup(); }
});

test.describe('launch tail failure', () => {
  test.use({ launchEnv: { ZCC_TEST_FAIL_LAUNCH_COMPLETE: '1' } });

  test('a forced complete() throw leaves no live sessions (REQ-8)', async ({ app }) => {
    const agent = makeJobTeamCoordinatorBinary();
    const run = await setup(app.window, agent.path, { workers: 2 });
    try {
      const started = await startJob(app.window, run, 'freeform');
      expect(started.ok).toBe(false);
      await expect.poll(async () => app.window.evaluate(async (id) => (await window.cc.terminals.list(id)).filter((session) => session.status !== 'exited').length, run.projectId),
        { timeout: 30_000, intervals: [500] }).toBe(0);
    } finally { await run.cleanup(); agent.cleanup(); }
  });
});

test('a FAILED run shows its reason in the CLI, the Inbox and the run detail (REQ-1, REQ-2, REQ-10)', async ({ app, home }) => {
  const agent = makeJobTeamCoordinatorBinary({ scenario: scenario('spawn-throw-slot-1') });
  const run = await setup(app.window, agent.path, { workers: 2 });
  try {
    await startJob(app.window, run, 'structured');
    await expect.poll(async () => (await snapshotOf(app.window, run.projectId))?.state, { timeout: 60_000, intervals: [500] }).toBe('FAILED');
    const found = (await snapshotOf(app.window, run.projectId))!;
    const zcc = cliRunner(app.window, home, run.projectDir);
    const status = await zcc(['team', 'status', found.executionId]);
    expect(status.stdout).toMatch(/spawn|slot/i);
    expect(status.stdout).not.toContain('no persisted result payload');
    await app.window.getByTestId('nav-agents').click();
    await app.window.locator('.agent-card').filter({ hasText: 'SWI Team' }).first().click();
    await expect(app.window.getByLabel('Squad details').getByText(/spawn|slot/i).first()).toBeVisible();
    await app.window.getByTestId('nav-inbox').click();
    await expect(app.window.getByText(/spawn|slot/i).first()).toBeVisible();
  } finally { await run.cleanup(); agent.cleanup(); }
});

test('a freeform run with a failed slot continues with a warning (REQ-11)', async ({ app }) => {
  const agent = makeJobTeamCoordinatorBinary({ scenario: scenario('spawn-throw-slot-1') });
  const run = await setup(app.window, agent.path, { workers: 2 });
  try {
    const started = await startJob(app.window, run, 'freeform');
    expect(started.ok).toBe(true);
    await expect.poll(async () => (await snapshotOf(app.window, run.projectId))?.text ?? '', { timeout: 60_000, intervals: [500] }).toMatch(/launch-warning|failed slot/i);
    expect((await snapshotOf(app.window, run.projectId))?.state).not.toBe('FAILED');
  } finally { await run.cleanup(); agent.cleanup(); }
});

test('Cancel with a stuck worker reports incomplete (REQ-14)', async ({ app }) => {
  const agent = makeJobTeamCoordinatorBinary({ scenario: scenario('worker-ignores-close') });
  const run = await setup(app.window, agent.path, { workers: 1 });
  try {
    await startJob(app.window, run, 'freeform');
    await expect.poll(async () => (await snapshotOf(app.window, run.projectId))?.state, { timeout: 60_000, intervals: [500] }).toBe('RUNNING');
    const found = (await snapshotOf(app.window, run.projectId))!;
    const stopped = await app.window.evaluate(async ({ projectId, executionId }) => {
      const current = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return window.cc.executionBoard.stop(projectId, executionId, current!.execution.stateVersion ?? 0);
    }, { projectId: run.projectId, executionId: found.executionId });
    expect(stopped.ok).toBe(false);
    expect(JSON.stringify(stopped)).toContain('CANCEL_INCOMPLETE');
  } finally { await run.cleanup(); agent.cleanup(); }
});

test('a broken persona file is reported by zcc personas ls (REQ-16, REQ-17)', async ({ app, home }) => {
  const dir = join(home, '.zcc', 'personas');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'broken-mode.json'), JSON.stringify({ id: 'broken-mode', name: 'Broken', permissionMode: 'wild' }));
  writeFileSync(join(dir, 'broken-json.json'), '{ not json');
  const zcc = cliRunner(app.window, home, home);
  const result = await zcc(['personas', 'ls']);
  const text = `${result.stdout}${result.stderr}`;
  expect(text).toContain('broken-mode.json');
  expect(text).toContain('broken-json.json');
  expect(text).not.toContain('not json');
});

test('an unresolved persona slot warns in the editor and the refuse-all CLI launch refuses (REQ-18, REQ-19)', async ({ app, home }) => {
  const agent = makeJobTeamCoordinatorBinary();
  const run = await setup(app.window, agent.path, { workers: 1 });
  try {
    mkdirSync(join(home, '.zcc', 'teams'), { recursive: true });
    writeFileSync(join(home, '.zcc', 'teams', 'ghost-team.json'), JSON.stringify({
      id: 'ghost-team', name: 'Ghost Team', description: 'unresolved', orchestratorPersonaId: 'e2e-orchestrator', slots: [{ personaId: 'ghost-worker', quantity: 1 }]
    }));
    await app.window.getByRole('link', { name: 'Settings' }).click();
    await app.window.locator('.settings-section-item').filter({ hasText: /Squads/ }).click();
    await app.window.getByText('Ghost Team').first().click();
    await expect(app.window.getByText(/unknown persona: ghost-worker/i).first()).toBeVisible();
    const zcc = cliRunner(app.window, home, run.projectDir);
    const result = await zcc(['team', 'launch', '--team', 'ghost-team', '--project', run.projectId, '--goal', 'go']);
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('unknown persona: ghost-worker');
  } finally { await run.cleanup(); agent.cleanup(); }
});

test('a worker that exits 1 raises a warning and keeps its card until dismissed (REQ-20, REQ-21)', async ({ app }) => {
  const agent = makeJobTeamCoordinatorBinary({ scenario: scenario('worker-exit-1') });
  const run = await setup(app.window, agent.path, { workers: 1 });
  try {
    await startJob(app.window, run, 'freeform');
    await expect.poll(async () => (await snapshotOf(app.window, run.projectId))?.text ?? '', { timeout: 60_000, intervals: [500] }).toMatch(/worker-warning|exited \(1\)/i);
    await app.window.getByTestId('nav-agents').click();
    const card = app.window.locator('.agent-card, .agent-squad-worker').filter({ hasText: /E2E Worker|Exited|spawn-failed/ }).first();
    await expect(card).toBeVisible();
    await app.window.waitForTimeout(65_000); // past the 60 s linger window
    await expect(card).toBeVisible();
    await app.window.getByRole('button', { name: /dismiss/i }).first().click();
    await expect(card).toBeHidden();
  } finally { await run.cleanup(); agent.cleanup(); }
});
