/**
 * Verifies two Projects-rail improvements end-to-end:
 *
 *  1. The per-project "+" (`.project-spawn`) on a rail row spawns the project's
 *     default agent and jumps into it — a visible, selected tab appears.
 *  2. The inline rail expansion shows only LIVE agents: an exited session drops
 *     out of the `.project-terminals` tree on its own (no manual dismiss).
 *
 * Drives real project registration + terminal IPC, then asserts against the
 * real renderer DOM — same approach as scheduler-open.spec.ts.
 */
import { test, expect } from './fixtures/app';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('projects rail: "+" spawns the default agent; exited agents auto-hide from the tree', async ({
  app,
}) => {
  const { window } = app;

  // A real, registered project the rail can render + spawn into.
  // NOTE: on macOS the app resolves ~/.zcc via app.getPath('home'), which
  // ignores the sandbox HOME — so this project lands in the real projects.json.
  // We remove it in the finally block below to leave no trace.
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-rail-proj-'));
  const projectName = projectDir.split('/').pop()!;
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as any).value : res) as { id: string };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  try {
  // Land on the Projects nav so the rail (ProjectsList) is mounted.
  const projectsNav = window.locator('button.nav-item').filter({ hasText: 'Projects' });
  await projectsNav.first().click();

  // The raw `projects.add` IPC persists in main but doesn't broadcast
  // `projects:onChanged` (only the renderer's own addProject action calls
  // loadProjects). Click the header's Reload to pull the fresh list in.
  await window.locator('button[aria-label="Reload project list"]').click();

  // Isolate our project via the filter box (a real machine's ~/.zcc has many
  // projects; the row would otherwise sort off-screen at the bottom of Local).
  const filter = window.locator('.list-filter input');
  await filter.fill(projectName);

  // The project row for our freshly-added project.
  const row = window.locator('.project-item').filter({ hasText: projectName });
  await expect(row.first()).toBeVisible({ timeout: 15_000 });

  // (1) Click the per-row "+" to spawn the default agent. It's hover-revealed,
  // so force the click (Playwright honors pointer visibility, not CSS
  // visibility:hidden, but hover first to be faithful to a user).
  await row.first().hover();
  const spawnBtn = row.first().locator('button.project-spawn');
  await expect(spawnBtn).toBeVisible({ timeout: 5_000 });
  await spawnBtn.click();

  // A visible, active tab for the new agent must appear in the workspace.
  const tab = window.locator('.tabbar .tab');
  await expect(tab.first()).toBeVisible({ timeout: 15_000 });
  await expect(tab.first()).toHaveClass(/active/, { timeout: 15_000 });

  // Grab the spawned session id from renderer state for the exit step.
  const sessionId = await window.evaluate(async (pid) => {
    const live = await window.cc.terminals.list(pid);
    const sessions = (live && 'ok' in (live as any) ? (live as any).value : live) as Array<{
      id: string;
      status?: string;
    }>;
    return sessions.find((s) => s.status !== 'exited')?.id ?? null;
  }, projectId);
  expect(sessionId).toBeTruthy();

  // Go back to the Projects rail and re-isolate our project (the filter is
  // component-local state that resets when the pane unmounts on nav-away). A
  // project with a live agent auto-expands, so its session tree is visible.
  await projectsNav.first().click();
  await filter.fill(projectName);
  await expect(row.first()).toBeVisible({ timeout: 15_000 });
  const group = row
    .locator('xpath=ancestor::div[contains(@class,"project-group")]')
    .first();
  const tree = group.locator('.project-terminals');
  // The live agent's row should be present in the tree.
  await expect(tree.locator('.project-terminal-row')).toHaveCount(1, { timeout: 15_000 });

  // (2) Kill the session (close = terminate the pty → exited tombstone), then
  // assert the row DROPS OUT of the rail tree — live-only filtering.
  await window.evaluate(async (args) => {
    const { sid } = args as { sid: string };
    await window.cc.terminals.close(sid);
  }, { sid: sessionId });

  // The tree should now be empty (exited row auto-hidden). Since the project has
  // no other live sessions, the disclosure collapses and .project-terminals
  // stops rendering entirely.
  await expect(tree.locator('.project-terminal-row')).toHaveCount(0, { timeout: 15_000 });
  } finally {
    // Leave no trace in the real ~/.zcc/projects.json (macOS home-path leak).
    await window.evaluate(async (pid) => {
      try {
        await window.cc.projects.remove(pid);
      } catch {
        /* best-effort cleanup */
      }
    }, projectId);
  }
});
