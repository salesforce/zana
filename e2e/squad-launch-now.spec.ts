/**
 * squad_launch mode 'now' at the real Electron boundary: an agent that was asked to run a Squad
 * immediately starts it with no Inbox card and no click, and becomes its owner (answers its
 * blockers, reads its snapshots, gets owner-worded [Squad report]s).
 *
 * Zero model spend: the launcher, orchestrator and workers are the deterministic fake
 * coordinator (e2e/sdk/harness.ts, role 'E2E launch Squad'); the Modern launcher is the
 * fake ACP agent driven through the host tool-call bridge.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import {
  createJobTeamContext,
  findJobExecutionId,
  jobTeamFailure,
  launchJobTeamCliOwner,
  readCoordinatorLog,
  teardownJobTeam,
  type JobTeamContext
} from './sdk/job-team-scenario.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const fixtureBin = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bin');
const TITLE = 'Atlas site build';
const DESIGN = '.zcc/library/designs/e2e-design.md';
const PLAN = '.zcc/library/runbooks/e2e-plan.md';
const GOAL = 'Build the Atlas site exactly as the attached plan describes.';
const FAKE_ACP_PREFIX = 'FAKE_ACP: ';
const LAUNCHER_PROMPT = 'E2E launch Squad';

// Portable plan whose step ids match the fake cohort's SUCCESS_PLAN, so a seeded DAG runs end to end.
const PLAN_MD = [
  '# Atlas Plan',
  '',
  '### home: Write Home <!-- executable-step -->',
  '- **Work:** Create home.txt containing HOME: ready',
  '- **Depends on:** None',
  '- **Write scope:** `home.txt`',
  '- **Verification:** home.txt present',
  '',
  '### about: Write About <!-- executable-step -->',
  '- **Work:** Create about.txt containing ABOUT: ready',
  '- **Depends on:** None',
  '- **Write scope:** `about.txt`',
  '- **Verification:** about.txt present',
  '',
  '### navigation-label: Ask Navigation Label <!-- executable-step -->',
  '- **Work:** Raise a durable human question with two label choices',
  '- **Depends on:** home, about',
  '- **Mode:** read-only',
  '- **Verification:** durable question answered',
  '',
  '### assemble: Assemble Result <!-- executable-step -->',
  '- **Work:** Write result.txt from both worker outputs and the chosen label',
  '- **Depends on:** navigation-label',
  '- **Write scope:** `result.txt`',
  '- **Verification:** cat result.txt',
  ''
].join('\n');

function writeProjectFiles(projectDir: string): void {
  mkdirSync(join(projectDir, '.zcc/library/designs'), { recursive: true });
  mkdirSync(join(projectDir, '.zcc/library/runbooks'), { recursive: true });
  writeFileSync(join(projectDir, DESIGN), '# Atlas design\n\nA two-page site with a navigation label chosen by the owner.\n');
  writeFileSync(join(projectDir, PLAN), PLAN_MD);
}

const NOW_INPUT = { teamId: 'e2e-job-team', goal: GOAL, planning: 'provided', sources: [DESIGN, PLAN], title: TITLE, mode: 'now' } as const;

/** Parse the JSON result the fake launcher logged for `label` (`plan_check` or `propose[label]`). */
function loggedResult(log: string, label: string): { ok: boolean; value?: any; error?: string } | null {
  const line = log.split('\n').find((row) => row.includes(` ${label} {`));
  return line ? JSON.parse(line.slice(line.indexOf(`${label} `) + label.length + 1)) : null;
}

/** Every Squad execution on the project's board, by title. */
async function boardTitles(window: Page, projectId: string): Promise<string[]> {
  return window.evaluate(async (id) => (await window.cc.executionBoard.listProject(id)).executions.map((execution) => execution.jobTitle ?? ''), projectId);
}

async function inboxEntries(window: Page, projectId: string) {
  return window.evaluate(async (id) => (await window.cc.inbox.history({ limit: 200, projectId: id })).entries
    .map((entry) => ({ subject: entry.subject ?? '', comments: entry.comments ?? '', squadProposal: !!entry.squadProposal })), projectId);
}

/** Launch the fake launcher (a CLI Agent that calls squad_launch for every entry in `.e2e-proposal.json`). */
async function startLauncher(ctx: JobTeamContext, proposals: Array<{ label: string; input: Record<string, unknown> }>, opts: {
  answerReports?: boolean;
  teamExtra?: Record<string, unknown>;
}): Promise<string> {
  writeProjectFiles(ctx.projectDir);
  writeFileSync(join(ctx.projectDir, '.e2e-proposal.json'), JSON.stringify({
    planPath: PLAN,
    answerReports: opts.answerReports === true,
    proposals: proposals.map((entry) => ({ ...entry, tool: 'squad_launch' }))
  }));
  return launchJobTeamCliOwner(ctx, {
    workerQuantity: 2,
    prompt: LAUNCHER_PROMPT,
    // The orchestrator cannot write files, so only a provided plan is possible.
    orchestratorExtra: { deniedTools: ['Write', 'Edit'] },
    teamExtra: { defaultPlanning: 'provided', ...opts.teamExtra }
  });
}

test.describe('CLI Agent launcher', () => {
  test.use({
    e2e: true,
    initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, sponsorPromptDismissed: true, autoRenameTabs: false },
    launchEnv: process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {}
  });
  test.setTimeout(300_000);

  test('starts with no click, owns the run, answers its blocker, and a repeat is deduped', async ({ app }) => {
    const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-squad-now-' });
    const { window } = ctx;
    try {
      const projectId = await startLauncher(ctx, [
        { label: 'now-1', input: { ...NOW_INPUT } },
        { label: 'now-2', input: { ...NOW_INPUT } }
      ], { answerReports: true });

      await expect.poll(() => loggedResult(readCoordinatorLog(ctx), 'propose[now-2]'), { timeout: 60_000, intervals: [500] }).not.toBeNull();
      const log = readCoordinatorLog(ctx);
      const first = loggedResult(log, 'propose[now-1]');
      const repeat = loggedResult(log, 'propose[now-2]');
      expect(first?.ok, log).toBe(true);
      expect(first?.value).toMatchObject({ planning: 'provided', team: { id: 'e2e-job-team' } });
      expect(first?.value.executionId).toBeTruthy();
      expect(first?.value.deduped).toBeFalsy();
      // An identical repeat returns the run it already started.
      expect(repeat?.ok, log).toBe(true);
      expect(repeat?.value).toMatchObject({ executionId: first?.value.executionId, deduped: true });
      // The launching session is the owner principal: execution.snapshot succeeds for it.
      expect(log).toMatch(/snapshot\[now-1\] \{"ok":true,"state":"[A-Z_]+"\}/);

      // Exactly one run, started without any Inbox proposal card or Launch click.
      const executionId = await findJobExecutionId(window, projectId, TITLE);
      expect(executionId).toBe(first?.value.executionId);
      expect((await boardTitles(window, projectId)).filter((title) => title === TITLE)).toHaveLength(1);

      // Owner wording for the waiting question, and the launcher answers it itself with execution.respond.
      await expect.poll(() => readCoordinatorLog(ctx), { timeout: 120_000, intervals: [1_000] })
        .toMatch(/\[Squad report\] .*Atlas site build.* is waiting for an answer: .*Which label should result\.txt use\?.*\(execution [^,]+, blocker blk-navigation-label\)\. You own this run: answer with execution\.respond/);
      await expect.poll(() => readCoordinatorLog(ctx), { timeout: 30_000, intervals: [500] }).toMatch(/owner respond \{"ok":true/);
      await expect.poll(() => existsSync(join(ctx.projectDir, 'result.txt')), { timeout: 30_000 }).toBe(true);
      expect(readFileSync(join(ctx.projectDir, 'result.txt'), 'utf8')).toContain('LABEL: About Atlas');

      // The completion report reaches the owner's terminal in owner wording.
      await expect.poll(() => readCoordinatorLog(ctx), { timeout: 120_000, intervals: [1_000] })
        .toMatch(/\[Squad report\] .*Atlas site build.* completed after/);

      // The owner has the run on its board: no proposal card and no "Squad completed" result entry.
      const entries = await inboxEntries(window, projectId);
      expect(entries.filter((entry) => entry.squadProposal)).toEqual([]);
      expect(entries.filter((entry) => entry.subject.startsWith(`Squad completed: ${TITLE}`))).toEqual([]);
    } catch (error) {
      throw jobTeamFailure(ctx, error);
    } finally {
      await teardownJobTeam(ctx);
    }
  });

  test('refuses outside, protected and review-required launches without starting anything', async ({ app, home }) => {
    const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-squad-now-refuse-' });
    try {
      mkdirSync(join(home, '.ssh'), { recursive: true });
      writeFileSync(join(home, '.ssh', 'config'), 'Host e2e\n  HostName example.invalid\n');
      const projectId = await startLauncher(ctx, [
        { label: 'secret', input: { ...NOW_INPUT, sources: [join(home, '.ssh', 'config')] } },
        { label: 'review', input: { ...NOW_INPUT } }
      ], { teamExtra: { launchApproval: 'review' } });
      await expect.poll(() => loggedResult(readCoordinatorLog(ctx), 'propose[review]'), { timeout: 60_000, intervals: [500] }).not.toBeNull();
      const log = readCoordinatorLog(ctx);
      expect(loggedResult(log, 'propose[secret]')?.error, log).toMatch(/SOURCE_NOT_ALLOWED: .*protected location/);
      expect(loggedResult(log, 'propose[review]')?.error, log).toContain('LAUNCH_REVIEW_REQUIRED');
      expect(log).not.toContain('snapshot[');
      expect(await boardTitles(ctx.window, projectId)).toEqual([]);
      expect((await inboxEntries(ctx.window, projectId)).filter((entry) => entry.squadProposal)).toEqual([]);
    } catch (error) {
      throw jobTeamFailure(ctx, error);
    } finally {
      await teardownJobTeam(ctx);
    }
  });

  test('a launcher that is gone leaves the owner question in the Project Inbox', async ({ app }) => {
    const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-squad-now-gone-' });
    const { window } = ctx;
    try {
      const projectId = await startLauncher(ctx, [{ label: 'now', input: { ...NOW_INPUT } }], {});
      await expect.poll(() => readCoordinatorLog(ctx), { timeout: 60_000, intervals: [500] }).toMatch(/snapshot\[now\] \{"ok":true/);
      expect(loggedResult(readCoordinatorLog(ctx), 'propose[now]')?.ok).toBe(true);
      const closed = await window.evaluate(async ({ id, prompt }) => {
        const sessions = (await window.cc.terminals.list(id)).filter((session) => session.title.includes(prompt));
        for (const session of sessions) await window.cc.terminals.close(session.id);
        return sessions.length;
      }, { id: projectId, prompt: LAUNCHER_PROMPT });
      expect(closed).toBe(1);

      // The blocker's report has no live owner left, so it lands in the Inbox instead of being dropped.
      await expect.poll(async () => (await inboxEntries(window, projectId))
        .filter((entry) => entry.subject === `Squad needs an answer: ${TITLE}` && entry.comments.includes('Which label should result.txt use?')).length,
      { timeout: 120_000, intervals: [1_000] }).toBe(1);
    } catch (error) {
      throw jobTeamFailure(ctx, error);
    } finally {
      await teardownJobTeam(ctx);
    }
  });
});

test.describe('Modern launcher', () => {
  test.use({
    e2e: true,
    initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, harnessOpenCodeEnabled: true, sponsorPromptDismissed: true, autoRenameTabs: false },
    // The polyglot fake `opencode` speaks the ACP bridge, so the thread is live with no model call.
    launchEnv: {
      PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_ACP_MODEL_CONFIG: '1',
      FAKE_ACP_MODE_CONFIG: '1',
      FAKE_ACP_MODE_OPTIONS: 'build:Build,plan:Plan',
      // Only prefixed lines script the fake agent (see squad-proposal-flow.spec.ts).
      FAKE_ACP_PROMPT_PREFIX: FAKE_ACP_PREFIX,
      ...(process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {})
    }
  });
  test.setTimeout(300_000);

  test('a Modern thread starts a Squad now, owns it, and receives the owner reports as thread turns', async ({ app, home }) => {
    const { window } = app;
    const diagnostics: string[] = [];
    window.on('console', (message) => diagnostics.push(`[renderer:${message.type()}] ${message.text()}`));
    app.electron.process()?.stderr?.on('data', (chunk) => diagnostics.push(`[main] ${String(chunk)}`));
    const agent = makeJobTeamCoordinatorBinary();
    const projectDir = mkdtempSync(join(tmpdir(), 'zcc-squad-now-modern-'));
    let projectId: string | null = null;
    let threadId: string | null = null;
    try {
      writeProjectFiles(projectDir);
      await window.evaluate((bin) => window.cc.config.set({
        teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, harnessOpenCodeEnabled: true, opencodeBinary: undefined
      }), agent.path);
      await window.evaluate(() => window.cc.personas.save({
        id: 'e2e-orchestrator', name: 'E2E Orchestrator', description: 'Durable test coordinator',
        baseProfile: 'claude', permissionMode: 'default', systemPrompt: '', deniedTools: ['Write', 'Edit']
      }));
      await window.evaluate(() => window.cc.personas.save({
        id: 'e2e-worker', name: 'E2E Worker', description: 'Durable test worker',
        baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
      }));
      await window.evaluate(() => window.cc.teams.save({
        id: 'e2e-job-team', name: 'E2E Job Team', description: 'Modern launcher team',
        slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator', defaultPlanning: 'provided'
      }));
      projectId = await window.evaluate(async (path) => {
        const result = await window.cc.projects.add(path);
        if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
        return result.value.id;
      }, projectDir);
      threadId = await startModernThread(window, projectId);
      const callTool = hostToolCaller(window, home, threadId);

      const launched = await callTool('squad_launch', { ...NOW_INPUT });
      expect(launched.success, `${launched.text}\n${diagnostics.join('\n')}`).toBe(true);
      const { executionId } = JSON.parse(launched.text) as { executionId: string };
      expect(executionId).toBeTruthy();

      // The thread is the owner principal: it can read the run, and the run reports back to a thread.
      const status = await callTool('execution_status', { executionId });
      expect(status.success, status.text).toBe(true);
      expect(status.text).toMatch(/"reportTo":\{[^}]*"kind":"thread"[^}]*"role":"owner"|"reportTo":\{[^}]*"role":"owner"[^}]*"kind":"thread"/);
      const snapshot = await callTool('execution_snapshot', { executionId, after: 0 });
      expect(snapshot.success, snapshot.text).toBe(true);

      // The waiting question arrives as a queued thread turn with owner wording; the thread answers it.
      const reportRe = /\[Squad report\][^\n]*is waiting for an answer: [^\n]*\(execution ([^,]+), blocker ([^)\\]+)\)\. You own this run: answer with execution\.respond/;
      let blockerReport: RegExpMatchArray | null = null;
      await expect.poll(async () => {
        const events = await window.evaluate(async (id) =>
          JSON.stringify(await (await fetch(`/api/v1/threads/${id}/events?limit=200`)).json()), threadId!);
        blockerReport = events.replace(/\\"/g, '"').match(reportRe);
        return blockerReport !== null;
      }, { timeout: 120_000, intervals: [1_000] }).toBe(true);
      expect(blockerReport![1]).toBe(executionId);
      const answered = await callTool('execution_respond', { executionId, blockerId: blockerReport![2], message: 'About Atlas' });
      expect(answered.success, answered.text).toBe(true);

      await expect.poll(() => existsSync(join(projectDir, 'result.txt')), { timeout: 60_000 }).toBe(true);
      expect(readFileSync(join(projectDir, 'result.txt'), 'utf8')).toContain('LABEL: About Atlas');
      await expectThreadCompletionReport(window, threadId);

      // No Inbox proposal card: the thread owns the run.
      expect((await inboxEntries(window, projectId)).filter((entry) => entry.squadProposal)).toEqual([]);
    } catch (error) {
      const log = existsSync(join(projectDir, '.fake-coordinator.log')) ? readFileSync(join(projectDir, '.fake-coordinator.log'), 'utf8').slice(-8192) : 'no fake coordinator log';
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await threadState(window, threadId)}\n${log}\n${diagnostics.join('\n').slice(-12_000)}`);
    } finally {
      if (projectId) {
        await window.evaluate(async (id) => {
          for (const session of await window.cc.terminals.list(id)) {
            try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
          }
          try { await window.cc.projects.remove(id); } catch { /* best-effort */ }
        }, projectId).catch(() => undefined);
      }
      rmSync(projectDir, { recursive: true, force: true });
      agent.cleanup();
    }
  });
});

/** A live Modern thread on the fake ACP agent. Returns the thread id. */
async function startModernThread(window: Page, projectId: string): Promise<string> {
  await expect.poll(async () => window.evaluate(async () => {
    const response = await fetch('/api/v1/threads/providers');
    return (await response.json()).providers.map((provider: { id: string }) => provider.id);
  }), { timeout: 30_000, intervals: [500] }).toContain('acp-opencode');
  const threadId = await window.evaluate(async ({ projectId, input }) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'acp-opencode', model: 'fake/default', acpMode: 'plan', permissionMode: 'full', input })
    });
    const body = await response.json();
    if (!response.ok || !body?.ok) throw new Error(JSON.stringify(body));
    return body.value.id as string;
  }, { projectId, input: `${FAKE_ACP_PREFIX}stand by; the Squad is started out of band.` });
  // The first turn must finish: a report is queued behind a turn still in progress.
  await expect.poll(async () => window.evaluate(async (id) =>
    ((await (await fetch(`/api/v1/threads/${encodeURIComponent(id)}`)).json()).thread?.status ?? 'missing') as string, threadId),
  { timeout: 30_000, intervals: [500] }).toBe('idle');
  return threadId;
}

/**
 * Calls a thread's dynamic tool through the same host tool-call bridge a real ACP agent uses.
 * Plugin tool policy fails closed until every installed plugin server is up, so a call refused
 * as "not ready" is retried; nothing ran for it.
 */
function hostToolCaller(window: Page, home: string, threadId: string) {
  const origin = new URL(window.url()).origin;
  const auth = JSON.parse(readFileSync(join(home, '.zcc', 'auth.json'), 'utf8')) as { hostId: string; hostKey: string };
  let n = 0;
  const call = async (tool: string, args: Record<string, unknown>) => {
    n += 1;
    const response = await fetch(`${origin}/internal/hosts/tool-call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.hostKey}`, 'x-zcc-host-id': auth.hostId },
      body: JSON.stringify({
        sessionId: threadId, threadId, providerThreadId: threadId, turnId: `e2e-turn-${n}`, callId: `e2e-call-${n}`, tool, arguments: args
      })
    });
    const body = await response.json() as { success?: boolean; contentItems?: Array<{ text?: string }> };
    return { status: response.status, success: body.success, text: (body.contentItems ?? []).map((item) => item.text ?? '').join('\n') };
  };
  return async (tool: string, args: Record<string, unknown>) => {
    const deadline = Date.now() + 90_000;
    for (;;) {
      const result = await call(tool, args);
      if (!result.text.includes('plugin tool policy not ready') || Date.now() > deadline) return result;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  };
}

/**
 * The thread received the COMPLETION report as a queued/sent turn. The blocker report also
 * starts with "[Squad report]" and arrives first, so match the completion text. Events are
 * JSON-stringified, so the quotes around the title arrive escaped.
 */
async function expectThreadCompletionReport(window: Page, threadId: string): Promise<void> {
  await expect.poll(async () => window.evaluate(async (id) =>
    JSON.stringify(await (await fetch(`/api/v1/threads/${id}/events?limit=200`)).json()), threadId),
  { timeout: 90_000, intervals: [1_000] }).toMatch(/\[Squad report\] \\*"Atlas site build\\*" completed after/);
}

/** The thread's status and its latest event types, for a failure message. */
async function threadState(window: Page, threadId: string | null): Promise<string> {
  if (!threadId) return 'no thread';
  return window.evaluate(async (id) => {
    const thread = (await (await fetch(`/api/v1/threads/${encodeURIComponent(id)}`)).json()).thread;
    const { events } = await (await fetch(`/api/v1/threads/${encodeURIComponent(id)}/events?limit=60`)).json();
    const types = (events as Array<{ sequence: number; type: string }>).map((event) => `${event.sequence}:${event.type}`).join(' ');
    return `thread status=${thread?.status ?? 'missing'} events: ${types}`;
  }, threadId).catch((error: unknown) => `thread state unavailable: ${String(error)}`);
}
