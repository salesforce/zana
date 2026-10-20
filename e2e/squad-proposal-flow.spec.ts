/**
 * Start a Squad from a conversation, at the real Electron boundary.
 *
 * A design session (a CLI Agent or a Modern thread) proposes a Squad launch from
 * files it wrote. The proposal lands as a host-owned Inbox card; Review opens the
 * Squad composer pre-filled; Launch starts the run; and the proposer receives a
 * [Squad report] when the Squad needs an answer and when it finishes.
 *
 * Zero model spend: the proposer, orchestrator and workers are the deterministic
 * fake coordinator (e2e/sdk/harness.ts); the Modern proposer is the fake ACP agent.
 */
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import {
  answerJobBlockerThroughUi,
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
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const fixtureBin = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bin');
const TITLE = 'Atlas site build';
const DESIGN = '.zcc/library/designs/e2e-design.md';
const PLAN = '.zcc/library/runbooks/e2e-plan.md';
const GOAL = 'Build the Atlas site exactly as the attached plan describes.';
const FAKE_ACP_PREFIX = 'FAKE_ACP: ';

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

function writeProjectFiles(projectDir: string, planMd = PLAN_MD): void {
  mkdirSync(join(projectDir, '.zcc/library/designs'), { recursive: true });
  mkdirSync(join(projectDir, '.zcc/library/runbooks'), { recursive: true });
  writeFileSync(join(projectDir, DESIGN), '# Atlas design\n\nA two-page site with a navigation label chosen by the owner.\n');
  writeFileSync(join(projectDir, PLAN), planMd);
}

/** Parse the JSON result the fake proposer logged for `label` (`plan_check` or `propose[label]`). */
function loggedResult(log: string, label: string): { ok: boolean; value?: any; error?: string } | null {
  const line = log.split('\n').find((row) => row.includes(` ${label} {`));
  return line ? JSON.parse(line.slice(line.indexOf(`${label} `) + label.length + 1)) : null;
}

/** The proposer's own terminal lingers over the board until closed; its backdrop blocks clicks. */
async function closeAgentModal(window: Page): Promise<void> {
  const modal = window.getByRole('dialog', { name: /^Agent / }).first();
  if (await modal.count()) {
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toBeHidden();
  }
}

async function openInboxCard(window: Page, subject: string) {
  await closeAgentModal(window);
  await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
  const row = window.locator('.inbox-row').filter({ hasText: subject }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  return row;
}

/** Review the open proposal card, check the pre-filled composer, and press Launch. */
async function reviewAndLaunch(
  window: Page,
  outputPath: (name: string) => string,
  electron: Parameters<typeof captureElectronScreenshot>[0],
  proposerTitle?: string
): Promise<void> {
  await window.getByRole('button', { name: 'Review Squad launch' }).click();
  const modal = window.getByTestId('launch-modal');
  await expect(modal).toBeVisible();
  // A CLI Agent proposer is named by its session title; a fallback to the generic name would fail here.
  await expect(modal.locator('.team-composer-origin-banner')).toContainText(proposerTitle ? `Prepared by “${proposerTitle}”` : 'Prepared by');
  await expect(modal.locator('.team-composer-origin-banner')).toContainText('Plan checked: 4 steps.');
  const sources = modal.getByLabel('Attached sources');
  await expect(sources).toContainText('e2e-design.md');
  await expect(sources).toContainText('e2e-plan.md');
  await expect(modal.getByLabel('Squad planning')).toContainText('Plan provided in goal');
  await expect(modal.getByLabel('Squad', { exact: true })).toContainText('E2E Job Team');
  await captureElectronScreenshot(electron, window, outputPath('02-prefilled-composer.png'));
  const send = modal.getByTestId('team-command-send');
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  await expect(modal).toBeHidden();
}

type Electron = Parameters<typeof captureElectronScreenshot>[0];
type OutputPath = (name: string) => string;

const openInbox = (window: Page) => window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();

/** The fake proposer checked the plan and proposed once; returns nothing, asserts both results. */
async function expectPlanCheckedAndProposed(ctx: JobTeamContext): Promise<void> {
  await expect.poll(() => loggedResult(readCoordinatorLog(ctx), 'propose[main]'), { timeout: 30_000, intervals: [500] }).not.toBeNull();
  const log = readCoordinatorLog(ctx);
  const check = loggedResult(log, 'plan_check');
  expect(check?.ok, log).toBe(true);
  expect(check?.value.ok).toBe(true);
  expect(check?.value.steps.map((step: { id: string }) => step.id)).toEqual(['home', 'about', 'navigation-label', 'assemble']);
  const proposed = loggedResult(log, 'propose[main]');
  expect(proposed?.ok, log).toBe(true);
  expect(proposed?.value).toMatchObject({ planning: 'provided', team: { id: 'e2e-job-team' } });
}

/** The host-owned card names the Squad, the planning mode and both documents. */
async function expectProposalCard(window: Page, electron: Electron, outputPath: OutputPath): Promise<void> {
  await openInboxCard(window, `Squad launch ready: ${TITLE}`);
  const detail = window.locator('.inbox-detail');
  await expect(detail.getByText('e2e-design.md').first()).toBeVisible();
  await expect(detail.getByText('e2e-plan.md').first()).toBeVisible();
  await expect(detail.getByText('Squad: E2E Job Team (E2E Orchestrator + 2 workers)')).toBeVisible();
  await expect(detail.getByText(/Planning: Plan provided in goal/)).toBeVisible();
  await expect(window.getByText('Nothing starts until you press Launch.').first()).toBeVisible();
  await captureElectronScreenshot(electron, window, outputPath('01-inbox-card.png'));
}

/** The plan's question reaches the proposer before anyone answers it; then the user answers and the run writes its result. */
async function expectBlockerReportThenAnswer(ctx: JobTeamContext, projectId: string, executionId: string): Promise<void> {
  await expect.poll(() => readCoordinatorLog(ctx), { timeout: 120_000, intervals: [1_000] })
    .toMatch(/\[Squad report\] .*is waiting for an answer in the Inbox: .*Which label should result\.txt use\?/);
  await answerAndExpectResult(ctx.window, ctx.projectDir, projectId, executionId);
}

async function answerAndExpectResult(window: Page, projectDir: string, projectId: string, executionId: string): Promise<void> {
  await answerJobBlockerThroughUi({ window, projectId, executionId, jobTitle: TITLE });
  await expect.poll(() => existsSync(join(projectDir, 'result.txt')), { timeout: 15_000 }).toBe(true);
  expect(readFileSync(join(projectDir, 'result.txt'), 'utf8')).toContain('LABEL: About Atlas');
}

/** The completion report lands in the proposer's terminal and in the Inbox. */
async function expectCompletionReported(ctx: JobTeamContext): Promise<void> {
  await expect.poll(() => readCoordinatorLog(ctx), { timeout: 120_000, intervals: [1_000] })
    .toMatch(/\[Squad report\] .*Atlas site build.* completed/);
  await openInbox(ctx.window);
  await expect(ctx.window.locator('.inbox-row').filter({ hasText: `Squad completed: ${TITLE}` }).first()).toBeVisible({ timeout: 30_000 });
}

/** The proposal card says it was launched (no buttons), and Squad details names where it started. */
async function expectLaunchedCardAndOrigin(window: Page, electron: Electron, outputPath: OutputPath, proposerTitle: string): Promise<void> {
  await window.locator('.inbox-row').filter({ hasText: `Squad launch ready: ${TITLE}` }).first().click();
  await expect(window.getByText(`Launched as "${TITLE}". Open it from the Agents board.`)).toBeVisible({ timeout: 15_000 });
  await expect(window.getByRole('button', { name: 'Review Squad launch' })).toHaveCount(0);
  await window.getByTestId('nav-agents').or(window.getByTestId('project-nav-agents')).click();
  await window.locator('.agent-card').filter({ hasText: TITLE }).first().click();
  const details = window.getByLabel('Squad details');
  await expect(details.getByText('Loading Squad details…')).toHaveCount(0, { timeout: 15_000 });
  await expect(details.getByText('Started from', { exact: true })).toBeVisible();
  await expect(details.locator('dt:text-is("Started from") + dd')).toContainText(proposerTitle);
  await captureElectronScreenshot(electron, window, outputPath('03-squad-details-started-from.png'));
}

/** Personas, a provided-plan Squad, and the project, for a Modern proposer. Returns the project id. */
async function setUpModernProject(window: Page, projectDir: string, agentPath: string): Promise<string> {
  writeProjectFiles(projectDir);
  await window.evaluate((bin) => window.cc.config.set({
    teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, harnessOpenCodeEnabled: true, opencodeBinary: undefined
  }), agentPath);
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-orchestrator', name: 'E2E Orchestrator', description: 'Durable test coordinator',
    baseProfile: 'claude', permissionMode: 'default', systemPrompt: '', deniedTools: ['Write', 'Edit']
  }));
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-worker', name: 'E2E Worker', description: 'Durable test worker',
    baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
  }));
  await window.evaluate(() => window.cc.teams.save({
    id: 'e2e-job-team', name: 'E2E Job Team', description: 'Modern proposer team',
    slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator', defaultPlanning: 'provided'
  }));
  return window.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
    return result.value.id;
  }, projectDir);
}

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
  }, { projectId, input: `${FAKE_ACP_PREFIX}stand by; the Squad proposal is submitted out of band.` });
  // The first turn must finish: a report is queued behind a turn still in progress.
  await expect.poll(async () => window.evaluate(async (id) =>
    ((await (await fetch(`/api/v1/threads/${encodeURIComponent(id)}`)).json()).thread?.status ?? 'missing') as string, threadId),
  { timeout: 30_000, intervals: [500] }).toBe('idle');
  return threadId;
}

/**
 * Calls a thread's dynamic tool through the same host tool-call bridge a real ACP agent uses.
 * Plugin tool policy fails closed until every installed plugin server is up (Salesforce is
 * installed by default), so a call refused as "not ready" is retried; nothing ran for it.
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

async function removeModernProject(window: Page, projectId: string | null): Promise<void> {
  if (!projectId) return;
  await window.evaluate(async (id) => {
    for (const session of await window.cc.terminals.list(id)) {
      try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
    }
    try { await window.cc.projects.remove(id); } catch { /* best-effort */ }
  }, projectId).catch(() => undefined);
}

test.describe('CLI Agent proposer', () => {
  test.use({
    e2e: true,
    initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, sponsorPromptDismissed: true, autoRenameTabs: false },
    launchEnv: process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {}
  });
  test.setTimeout(300_000);

  test('proposes a Squad, launches it from the Inbox card, and gets the reports back', async ({ app }, testInfo) => {
    const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-squad-proposal-', scenario: undefined });
    const outputPath: OutputPath = (name) => testInfo.outputPath(name);
    try {
      writeProjectFiles(ctx.projectDir);
      writeFileSync(join(ctx.projectDir, '.e2e-proposal.json'), JSON.stringify({
        planPath: PLAN,
        proposals: [{ label: 'main', input: {
          teamId: 'e2e-job-team', goal: GOAL, sources: [DESIGN, PLAN], title: TITLE,
          summary: 'Two pages, a navigation label, one assembled result.'
        } }]
      }));
      const projectId = await launchJobTeamCliOwner(ctx, {
        workerQuantity: 2,
        prompt: 'E2E propose Squad',
        // The orchestrator cannot write files, so only a provided plan is possible.
        orchestratorExtra: { deniedTools: ['Write', 'Edit'] },
        teamExtra: { defaultPlanning: 'provided' }
      });

      await expectPlanCheckedAndProposed(ctx);
      await expectProposalCard(ctx.window, app.electron, outputPath);
      // Review opens the pre-filled composer; Launch starts the run.
      await reviewAndLaunch(ctx.window, outputPath, app.electron, 'E2E propose Squad');
      const executionId = await findJobExecutionId(ctx.window, projectId, TITLE);
      await expectBlockerReportThenAnswer(ctx, projectId, executionId);
      await expectCompletionReported(ctx);
      await expectLaunchedCardAndOrigin(ctx.window, app.electron, outputPath, 'E2E propose Squad');
    } catch (error) {
      throw jobTeamFailure(ctx, error);
    } finally {
      await teardownJobTeam(ctx);
    }
  });

  test('rejects unsafe or invalid proposals without creating a card', async ({ app }) => {
    const ctx: JobTeamContext = createJobTeamContext(app, { tmpPrefix: 'zcc-squad-reject-' });
    const { window, projectDir } = ctx;
    // A uniquely named sibling of the project, so the escape attempt never touches shared $TMPDIR files.
    const outsideDir = mkdtempSync(join(dirname(projectDir), 'zcc-squad-outside-'));
    try {
      // A plan whose second step depends on a step that does not exist.
      writeProjectFiles(projectDir);
      writeFileSync(join(projectDir, '.zcc/library/runbooks/broken-plan.md'), [
        '# Broken', '', '### a: A <!-- executable-step -->', '- **Work:** Do a', '- **Depends on:** missing-step', '- **Write scope:** `a.txt`', '- **Verification:** ok', ''
      ].join('\n'));
      writeFileSync(join(projectDir, '.e2e-proposal.json'), JSON.stringify({
        planPath: PLAN,
        proposals: [
          { label: 'infer', input: { teamId: 'e2e-job-team', goal: GOAL, planning: 'infer', title: 'Infer attempt' } },
          { label: 'outside', input: { teamId: 'e2e-job-team', goal: GOAL, planning: 'provided', sources: [`../${basename(outsideDir)}/outside.md`], title: 'Outside attempt' } },
          { label: 'broken', input: { teamId: 'e2e-job-team', goal: GOAL, planning: 'provided', sources: ['.zcc/library/runbooks/broken-plan.md'], title: 'Broken attempt' } }
        ]
      }));
      writeFileSync(join(outsideDir, 'outside.md'), 'outside the project');
      const projectId = await launchJobTeamCliOwner(ctx, {
        workerQuantity: 2, prompt: 'E2E propose Squad', orchestratorExtra: { deniedTools: ['Write', 'Edit'] }
      });

      await expect.poll(() => loggedResult(readCoordinatorLog(ctx), 'propose[broken]'), { timeout: 30_000, intervals: [500] }).not.toBeNull();
      const log = readCoordinatorLog(ctx);
      expect(loggedResult(log, 'propose[infer]')?.error).toContain('ORCHESTRATOR_CANNOT_PLAN');
      expect(loggedResult(log, 'propose[outside]')?.error).toContain('SOURCE_OUTSIDE_PROJECT');
      expect(loggedResult(log, 'propose[broken]')?.error).toContain('INVALID_PLAN');

      // A card is stored before squad_propose answers, so once all three errors are logged
      // the store is authoritative: read it directly instead of racing the Inbox list render.
      const proposalCards = await window.evaluate(async (id) => {
        const { entries } = await window.cc.inbox.history({ limit: 200, projectId: id });
        return entries.filter((entry) => entry.squadProposal).length;
      }, projectId);
      expect(proposalCards).toBe(0);
      await closeAgentModal(window);
      await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
      await expect(window.locator('.inbox-view')).toBeVisible();
      await expect(window.locator('.inbox-row').filter({ hasText: 'Squad launch ready' })).toHaveCount(0);
    } catch (error) {
      throw jobTeamFailure(ctx, error);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
      await teardownJobTeam(ctx);
    }
  });
});

test.describe('Modern proposer', () => {
  test.use({
    e2e: true,
    initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, harnessOpenCodeEnabled: true, sponsorPromptDismissed: true, autoRenameTabs: false },
    // The polyglot fake `opencode` speaks the ACP bridge, so the thread is live with no model call.
    launchEnv: {
      PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_ACP_MODEL_CONFIG: '1',
      FAKE_ACP_MODE_CONFIG: '1',
      FAKE_ACP_MODE_OPTIONS: 'build:Build,plan:Plan',
      // Only prefixed lines script the fake agent. Default plugins (Design Docs, Salesforce)
      // add instructions to the first turn, and words in them such as "change" would match the
      // agent's "hang" command, leave the turn open and hold every queued report behind it.
      FAKE_ACP_PROMPT_PREFIX: FAKE_ACP_PREFIX,
      ...(process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {})
    }
  });
  test.setTimeout(300_000);

  test('a Modern thread proposes a Squad and receives the queued report', async ({ app, home }, testInfo) => {
    const { window } = app;
    const diagnostics: string[] = [];
    window.on('console', (message) => diagnostics.push(`[renderer:${message.type()}] ${message.text()}`));
    app.electron.process()?.stderr?.on('data', (chunk) => diagnostics.push(`[main] ${String(chunk)}`));
    const agent = makeJobTeamCoordinatorBinary();
    const projectDir = mkdtempSync(join(tmpdir(), 'zcc-squad-proposal-modern-'));
    let projectId: string | null = null;
    let threadId: string | null = null;
    try {
      projectId = await setUpModernProject(window, projectDir, agent.path);
      threadId = await startModernThread(window, projectId);
      const callTool = hostToolCaller(window, home, threadId);
      const check = await callTool('squad_plan_check', { path: PLAN });
      expect(check.success, `${check.text}\n${diagnostics.join('\n')}`).toBe(true);
      expect(JSON.parse(check.text)).toMatchObject({ ok: true });
      const proposed = await callTool('squad_propose', { teamId: 'e2e-job-team', goal: GOAL, sources: [DESIGN, PLAN], title: TITLE });
      expect(proposed.success, `${proposed.text}\n${diagnostics.join('\n')}`).toBe(true);

      await openInboxCard(window, `Squad launch ready: ${TITLE}`);
      await reviewAndLaunch(window, (name) => testInfo.outputPath(`modern-${name}`), app.electron);
      await answerAndExpectResult(window, projectDir, projectId, await findJobExecutionId(window, projectId, TITLE));
      await expectThreadCompletionReport(window, threadId);
    } catch (error) {
      const log = existsSync(join(projectDir, '.fake-coordinator.log')) ? readFileSync(join(projectDir, '.fake-coordinator.log'), 'utf8').slice(-8192) : 'no fake coordinator log';
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await threadState(window, threadId)}\n${log}\n${diagnostics.join('\n').slice(-12_000)}`);
    } finally {
      await removeModernProject(window, projectId);
      rmSync(projectDir, { recursive: true, force: true });
      agent.cleanup();
    }
  });
});
