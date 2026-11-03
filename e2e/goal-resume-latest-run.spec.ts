/**
 * Resume latest run for a Goal (#553): a finished Goal iteration's agent is reopened
 * from the Goals view in a new tab, with its own conversation (`--resume <id>`),
 * nothing sent and no new iteration recorded. A second click switches to the same tab.
 *
 * The fake `claude` appends `{ session, argv }` to a file for every real launch. The goal
 * worker pings the Stop hook and exits (like a finished turn); a `--resume` launch stays alive.
 */
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// An automated Claude launch is refused without auth (#561).
test.use({ launchEnv: { ANTHROPIC_API_KEY: 'goal-resume-latest-run-e2e-key' } });

interface Launch { session: string; argv: string[] }
interface GoalFile { iteration: number; history: { iterations: Array<{ id: string; sessionId?: string; finishedAt?: string; conversation?: { id?: string; profile?: string } }> } }

test('Resume reopens the finished goal run\'s conversation in a new tab, sends nothing and records no iteration', async ({ app }) => {
  test.setTimeout(240_000);
  const { window, electron } = app;
  const root = join(app.home, 'goal-resume-project'); mkdirSync(root);
  const log = join(app.home, 'goal-resume-launches.jsonl');
  const agent = makeFakeAgentBinary({ script: `
if [ "$1" = "--version" ]; then echo '2.1.220 (Claude Code)'; exit 0; fi
if [ -n "$ZCC_SESSION_ID" ]; then
  node - --arg-start "$@" <<'NODE'
const fs = require('node:fs');
const argv = process.argv.slice(process.argv.indexOf('--arg-start') + 1);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ session: process.env.ZCC_SESSION_ID, argv }) + '\\n');
NODE
fi
case " $* " in
  *" --resume "*) exec cat ;;
esac
sleep 1
[ -n "$ZCC_HOOK_URL" ] && curl -s -m 5 -X POST "$ZCC_HOOK_URL" >/dev/null
sleep 1
exit 0
` });
  // The goal's evaluator also runs the fake binary (`claude --print`); only agent sessions count here.
  const launches = (): Launch[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Launch) : [])
    .filter(launch => !launch.argv.includes('--print'));
  const screenshots = process.env.ZCC_E2E_SCREENSHOTS === '1' ? process.env.ZCC_E2E_SCREENSHOT_DIR : undefined;
  // The global Goals route, as pending-worker-recovery.spec.ts opens it.
  const openGoals = () => window.evaluate(() => { history.pushState({}, '', '/goals'); dispatchEvent(new PopStateEvent('popstate')); });
  let goalId: string | undefined, projectId: string | undefined;
  try {
    await window.evaluate(binary => window.cc.config.set({ claudeBinary: binary, defaultHarness: 'claude', tmuxScope: 'off' }), agent.path);
    const project = await window.evaluate(path => window.cc.projects.add(path), root);
    if (!project.ok) throw new Error(`Project registration failed: ${project.message}`);
    projectId = project.value.id;
    const created = await window.evaluate(id => window.cc.goals.create({
      projectId: id, scope: { projectId: id }, title: 'Resumable goal', statement: 'Do one thing', successCriteria: ['done'], maxIterations: 1, activate: true
    }), projectId);
    if (!created.ok) throw new Error(`Goal creation failed: ${created.message}`);
    goalId = created.value.id;
    const file = join(root, '.zcc/goals', `${goalId}.json`);
    const read = (): GoalFile => JSON.parse(readFileSync(file, 'utf8'));

    // 1. One iteration runs to the end and records its conversation.
    await expect.poll(() => {
      const it = read().history.iterations[0];
      return !!it?.finishedAt && !!it.conversation?.id;
    }, { message: 'the iteration finishes and keeps its conversation', timeout: 90_000 }).toBe(true);
    const before = read();
    const conversationId = before.history.iterations[0]!.conversation!.id!;
    expect(before.history.iterations, 'one iteration so far').toHaveLength(1);
    expect(launches(), 'only the worker has launched').toHaveLength(1);
    await expect.poll(async () => (await window.evaluate(id => window.cc.terminals.list(id), projectId!)).length, { message: 'the worker tab has closed' }).toBe(0);

    // 2. The Goals view offers Resume; clicking it reopens the conversation.
    if (screenshots) await window.setViewportSize({ width: 1440, height: 900 });
    await openGoals();
    const row = window.locator('.scheduler-card').filter({ hasText: 'Resumable goal' });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator('.scheduler-card-main').first().click();
    const resume = row.getByRole('button', { name: /^Resume/ });
    await expect(resume, 'Resume is offered on the finished run').toBeVisible();
    if (screenshots) await captureElectronScreenshot(electron, window, join(screenshots, '01-goal-row-resume.png'));
    await resume.click();

    await expect.poll(() => launches().length, { message: 'the resume launches the agent once more', timeout: 30_000 }).toBe(2);
    const reopened = launches()[1]!;
    const at = reopened.argv.indexOf('--resume');
    expect(at, `--resume is passed (argv: ${reopened.argv.join(' ')})`).toBeGreaterThanOrEqual(0);
    expect(reopened.argv[at + 1], 'it resumes the run\'s own conversation').toBe(conversationId);
    expect(reopened.argv, 'it is not an unattended run').not.toContain('--dangerously-skip-permissions');
    expect(reopened.argv.join(' '), 'it sends no prompt').not.toContain('Do one thing');
    expect(reopened.session, 'a fresh terminal').not.toBe(before.history.iterations[0]!.sessionId);
    await expect(window.getByTestId('agent-session-view')).toBeVisible({ timeout: 15_000 });
    expect(window.url()).toContain(encodeURIComponent(reopened.session));
    expect(read().history.iterations, 'no new iteration').toEqual(before.history.iterations);
    expect(read().iteration, 'the iteration counter did not move').toBe(before.iteration);
    if (screenshots) await captureElectronScreenshot(electron, window, join(screenshots, '02-reopened-tab.png'));

    // 3. A second click switches to the same tab.
    await openGoals();
    const again = window.locator('.scheduler-card').filter({ hasText: 'Resumable goal' });
    await again.locator('.scheduler-card-main').first().click();
    await again.getByRole('button', { name: /^Resume/ }).click();
    await expect.poll(() => window.url(), { message: 'the same session is shown' }).toContain(encodeURIComponent(reopened.session));
    expect(launches(), 'no second copy is launched').toHaveLength(2);
    expect(read().history.iterations, 'still no new iteration').toEqual(before.history.iterations);
  } finally {
    if (goalId) await window.evaluate(id => window.cc.goals.setStatus(id, 'paused'), goalId).catch(() => undefined);
    if (projectId) {
      await window.evaluate(async id => {
        const sessions = await window.cc.terminals.list(id);
        await Promise.all(sessions.map(session => window.cc.terminals.close(session.id)));
      }, projectId).catch(() => undefined);
    }
    agent.cleanup();
  }
});
