import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('Agents List view shows the right panel for a selected thread', async ({ app }) => {
  const { window } = app;
  const title = 'Right panel probe';
  await window.evaluate(async (threadTitle) => {
    const projects = await fetch('/api/v1/projects').then((response) => response.json()) as {
      projects: Array<{ id: string }>;
    };
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: projects.projects[0]!.id,
        providerId: 'fake',
        title: threadTitle,
        input: 'delay:60000 side panel probe'
      })
    });
    if (!response.ok) throw new Error(await response.text());
  }, title);

  await window.locator('[data-testid="nav-agents"]').click();
  await expect(window.locator('.agent-card.is-thread', { hasText: title })).toBeVisible({ timeout: 15_000 });
  await window.getByLabel('List view').click();
  const row = window.locator('.agent-monitor-row.is-thread', { hasText: title });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  const detail = window.getByTestId('agent-monitor-thread').getByTestId('thread-detail');
  await expect(detail).toBeVisible();
  const panel = detail.getByTestId('thread-secondary-panel');
  const show = detail.getByTestId('thread-secondary-show');

  // The panel's open state is persisted per thread, so it may start either way.
  if (!(await panel.isVisible())) await show.click();
  await expect(panel).toBeVisible();
  await expect(detail).toHaveClass(/is-secondary-open/);

  await detail.getByTestId('thread-secondary-hide').click();
  await expect(panel).toBeHidden();
  await expect(show).toBeVisible();
  await show.click();
  await expect(panel).toBeVisible();
});
