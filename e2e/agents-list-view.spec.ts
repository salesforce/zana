import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('Agents List view sections rows by project, filters unread and orders by recent', async ({ app, home }, testInfo) => {
  const { window } = app;
  const roots = ['alpha-app', 'beta-service', 'gamma-tools'].map((name) => {
    const path = join(home, name);
    mkdirSync(path);
    return path;
  });
  const threadIds = await window.evaluate(async (paths) => {
    async function post(url: string, body: unknown) {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }
    const projects: Array<{ id: string }> = [];
    for (const path of paths) projects.push((await post('/api/v1/projects', { path })).project);
    const rows: Array<[number, string]> = [
      [0, 'Investigate why the release build fails on the signing step'],
      [1, 'Draft the migration plan for the billing service database'],
      [0, 'Review the onboarding copy and tighten the empty states'],
      [2, 'Check the lint rules after the toolchain upgrade']
    ];
    const ids: string[] = [];
    for (const [project, title] of rows) {
      const { thread } = await post('/api/v1/threads', { projectId: projects[project]!.id, providerId: 'fake', title, input: 'Hello' });
      ids.push(thread.id);
    }
    return ids;
  }, roots);
  for (const id of threadIds) {
    await expect.poll(() => window.evaluate(async (threadId) =>
      (await (await fetch(`/api/v1/threads/${threadId}`)).json()).thread.status, id), { timeout: 30_000 }).toBe('idle');
  }
  const post = (path: string) => window.evaluate((url) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.ok), path);
  for (const id of threadIds) expect(await post(`/api/v1/threads/${id}/read`)).toBe(true);

  await window.reload();
  await window.locator('[data-testid="nav-agents"]').click();
  await window.getByLabel('List view').click();
  const list = window.locator('.agent-monitor-list');
  await expect(list).toBeVisible({ timeout: 15_000 });

  const idle = list.locator('.agent-monitor-group', { has: window.getByRole('button', { name: /^Idle/ }) });
  await expect(idle.locator('[data-project-section]')).toHaveCount(2);
  await expect(idle.locator('.agent-monitor-project-head').first()).toContainText('alpha-app');
  await expect(idle.locator('.agent-monitor-project-head').nth(1)).toContainText('Other projects');
  const folded = idle.locator('[data-project-section="other-projects"] .agent-monitor-row-project');
  await expect(folded).toHaveCount(2);
  await expect(folded.filter({ hasText: 'beta-service' })).toHaveCount(1);
  await expect(folded.filter({ hasText: 'gamma-tools' })).toHaveCount(1);
  // Rows under a named project header carry no meta line at all.
  await expect(idle.locator('[data-project-section]').first().locator('.agent-monitor-row-meta')).toHaveCount(0);

  // Long titles wrap instead of being cut after a few words.
  const longRow = list.locator('.agent-monitor-row', { hasText: 'signing step' });
  const title = longRow.locator('.agent-monitor-row-title');
  await expect(title).toHaveText('Investigate why the release build fails on the signing step');
  const lineHeight = await title.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect((await title.boundingBox())!.height).toBeGreaterThan(lineHeight * 1.5);
  await expect(longRow.getByTestId('fleet-kind-chip')).toHaveCount(0);

  await window.screenshot({ path: testInfo.outputPath('agents-list-by-project.png') });

  // The desktop monitor auto-selects (and so reads) one row; mark a different
  // one unread while the list is open — it must update live.
  const draft = list.locator('.agent-monitor-row', { hasText: 'migration plan' });
  await expect(draft).not.toHaveClass(/active/);
  expect(await post(`/api/v1/threads/${threadIds[1]}/unread`)).toBe(true);
  await expect(draft).toHaveClass(/is-unread/);
  const unreadChip = list.getByRole('button', { name: /^Unread/ });
  await expect(unreadChip).toContainText('1');
  await unreadChip.click();
  await expect(list.locator('.agent-monitor-row')).toHaveCount(1);
  await expect(list.locator('.agent-monitor-row.is-unread')).toContainText('migration plan');
  await list.getByRole('button', { name: /^All/ }).click();

  await list.getByRole('button', { name: 'Recent' }).click();
  await expect(list.locator('[data-project-section]')).toHaveCount(0);
  await expect(list.locator('.agent-monitor-row-project')).toHaveCount(4);
  await window.screenshot({ path: testInfo.outputPath('agents-list-recent.png') });
});
