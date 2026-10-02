import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({
  e2e: true,
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { classicSessionViewEnabled: false }
});

test('Modern-only project renders in Agents Flow and opens thread inspector', async ({ app }) => {
  const { window } = app;
  const projectPath = join(app.home, 'modern-flow-project');
  mkdirSync(projectPath, { recursive: true });
  const project = await window.evaluate((path) => window.cc.projects.add(path), projectPath);
  if (!project.ok) throw new Error(`Project registration failed: ${project.error}`);

  const thread = await window.evaluate(async (projectId) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        providerId: 'fake',
        title: 'Modern Flow E2E',
        input: 'Complete this turn'
      })
    });
    if (!response.ok) throw new Error(await response.text());
    const body = await response.json();
    return body.value;
  }, project.value.id);

  try {
    await expect.poll(() => window.evaluate(async (id) => {
      const response = await fetch(`/api/v1/threads/${id}`);
      return (await response.json()).thread.status;
    }, thread.id), { timeout: 30_000 }).toBe('idle');

    const dismissSponsor = window.getByRole('button', { name: 'Dismiss' });
    if (await dismissSponsor.isVisible().catch(() => false)) await dismissSponsor.click();
    await window.getByTestId('nav-agents').click();
    await expect(window.locator('.agents-board')).toBeVisible();
    await window.getByRole('button', { name: 'Flow view' }).click();

    const node = window.locator('.squad-flow-node').filter({ hasText: 'Modern Flow E2E' });
    await expect(node).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('.squad-flow-node')).toHaveCount(1);
    await node.click();

    const inspector = window.getByTestId('thread-modal');
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('Modern Flow E2E');
    await expect(window).not.toHaveURL(new RegExp(`/sessions/${thread.id}$`));
  } finally {
    await window.evaluate(async (id) => {
      await fetch(`/api/v1/threads/${id}/archive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
    }, thread.id);
  }
});
