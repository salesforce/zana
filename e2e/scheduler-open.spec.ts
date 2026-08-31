/**
 * Verifies the scheduler's "open a running session" affordance end-to-end:
 * a fired schedule spawns a HEADLESS background pty (hidden from the tab strip);
 * clicking the Overview row's open button must peek it in the agent-inspector
 * modal without yanking the user onto a project terminal tab.
 *
 * Both the "Running now" and "Finished · session open" rows call the identical
 * onOpenTerminal → openScheduledLive → openAgentModal path, so a live `shell`
 * fire (stays alive, never stamps finishedAt) exercises the shared mechanism.
 * We drive schedule creation + fire via the real window.cc IPC, then click the
 * real DOM button and assert the inspector modal is on screen.
 */
import { test, expect } from './fixtures/app.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test('scheduler: clicking "open" on a running scheduled session peeks the inspector modal', async ({
  app,
}) => {
  const { window } = app;

  // A real, registered project the schedule can target (fires cwd into it).
  // NOTE: on macOS the app resolves ~/.zcc via app.getPath('home'), which
  // ignores the sandbox HOME — so this project lands in the real projects.json.
  // We remove it in the finally block below to leave no trace.
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-sched-proj-'));
  const projectName = basename(projectDir);
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    // projects.add returns Result<Project> or Project depending on channel.
    const proj = (res && 'ok' in res ? (res as any).value : res) as { id: string };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  try {
  // The raw `projects.add` IPC persists in main but doesn't broadcast
  // `projects:onChanged` (only the renderer's own addProject action calls
  // loadProjects). Land on the Projects rail and click the header Reload so the
  // RENDERER STORE learns about the project. This matters: ListPane's focus
  // guard calls exitProjectFocus() if the focused project id isn't yet in the
  // store's project list, which would silently undo the open we're testing.
  // The global sidebar's "Workspaces" section renders the live project list
  // (in-app projects.add broadcasts projects:onChanged). Expand it if collapsed,
  // then assert the row rendered before we rely on focus.
  const workspaces = window.locator('[data-testid="sidebar-projects-heading"]');
  if ((await workspaces.getAttribute('aria-expanded')) === 'false') {
    await workspaces.click();
  }
  await expect(
    window.locator('.project-item').filter({ hasText: projectName }).first()
  ).toBeVisible({ timeout: 15_000 });

  // Create a shell schedule (disabled so the timer never re-fires under us) and
  // fire it once manually — runNow spawns the headless session immediately.
  const sessionId = await window.evaluate(async (pid) => {
    const created = await window.cc.scheduler.create({
      name: 'E2E open-me',
      projectId: pid,
      profile: 'shell',
      // Keep the fired shell ALIVE for the duration of the test: a bare login
      // shell in a headless pty exits immediately (no tty stdin to read), which
      // would tear the session down before we click "open". `cat` holds the
      // pty open and exits cleanly when the pty is destroyed, leaving no orphans.
      extraArgs: ['-c', 'cat'],
      every: '1h',
      enabled: false,
      inboxLevel: 'silent',
      autoCloseOnFinish: false,
    });
    const task = (created && 'ok' in created ? (created as any).value : created) as {
      id: string;
    };
    const fired = await window.cc.scheduler.runNow(task.id);
    if (fired && 'ok' in fired && !(fired as any).ok) {
      throw new Error('runNow failed: ' + JSON.stringify(fired));
    }
    // Read the freshly-recorded run's sessionId back from the scheduler list.
    for (let i = 0; i < 40; i++) {
      const list = await window.cc.scheduler.list();
      const tasks = (list && 'ok' in list ? (list as any).value : list) as Array<{
        id: string;
        status?: { runs?: Array<{ sessionId?: string }> };
      }>;
      const mine = tasks.find((t) => t.id === task.id);
      const sid = mine?.status?.runs?.find((r) => r.sessionId)?.sessionId;
      if (sid) return sid;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('scheduled run never recorded a sessionId');
  }, projectId);
  expect(sessionId).toBeTruthy();

  // The spawned session is headless → NOT a visible tab: no tab titled
  // "Scheduled: …" should exist before (or after) we click.
  await expect(
    window.locator('.tabbar .tab').filter({ hasText: 'E2E open-me' })
  ).toHaveCount(0);

  // Open the Scheduler view via its sidebar/nav control.
  const schedNav = window.locator('.nav-item').filter({ hasText: 'Scheduler' });
  await schedNav.first().click();

  // The Overview "Running now" card renders one row per live scheduled session,
  // each with an ExternalLink icon button labelled "Open running terminal".
  // Scope strictly to the Running-now card AND to OUR schedule's row (the
  // Overview aggregates every schedule; the same name may appear in Recent
  // Activity / the full schedule list too).
  const runningCard = window
    .locator('section.overview-card')
    .filter({ has: window.locator('h3', { hasText: 'Running now' }) });
  await expect(runningCard).toBeVisible({ timeout: 15_000 });
  const myRow = runningCard.locator('li.overview-item').filter({ hasText: 'E2E open-me' });
  await expect(myRow.first()).toBeVisible({ timeout: 15_000 });
  const openBtn = myRow.first().locator('button[aria-label="Open running terminal"]');
  await expect(openBtn).toBeVisible({ timeout: 15_000 });
  await openBtn.click();

  // Peek stays on Scheduler: the inspector modal hosts the live session, and
  // the headless pty is NOT promoted into the tab strip.
  const agentModal = window.locator('[data-testid="agent-terminal-modal"]');
  await expect(agentModal).toBeVisible({ timeout: 15_000 });
  await expect(agentModal.getByTestId('agent-modal-header')).toBeVisible();
  await expect(
    window.locator('.tabbar .tab').filter({ hasText: 'E2E open-me' })
  ).toHaveCount(0);

  await expect
    .poll(
      async () =>
        window.evaluate(
          async (args) => {
            const { pid, sid } = args as { pid: string; sid: string };
            const live = await window.cc.terminals.list(pid);
            const sessions = (
              live && 'ok' in (live as any) ? (live as any).value : live
            ) as Array<{ id: string; headless?: boolean }>;
            const mine = sessions.find((s) => s.id === sid);
            if (!mine) return 'gone';
            return mine.headless ? 'headless' : 'visible';
          },
          { pid: projectId, sid: sessionId }
        ),
      { timeout: 15_000 }
    )
    .toBe('headless');
  } finally {
    // Leave no trace in the real ~/.zcc (macOS home-path leak): remove the
    // project and the schedule we created above.
    await window.evaluate(async (pid) => {
      try {
        const list = await window.cc.scheduler.list();
        const tasks = (list && 'ok' in list ? (list as any).value : list) as Array<{
          id: string;
          name?: string;
          projectId?: string;
        }>;
        for (const t of tasks) {
          if (t.name === 'E2E open-me' && t.projectId === pid) {
            await window.cc.scheduler.delete(t.id);
          }
        }
      } catch {
        /* best-effort cleanup */
      }
      try {
        await window.cc.projects.remove(pid);
      } catch {
        /* best-effort cleanup */
      }
    }, projectId);
  }
});
