import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import type { Page } from '@playwright/test';

test.use({
  e2e: true,
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { classicSessionViewEnabled: false }
});

async function createProjectWithModernThread(app: { home: string; window: Page }) {
  const projectPath = join(app.home, 'modern-flow-project');
  mkdirSync(projectPath, { recursive: true });
  const project = await app.window.evaluate((path) => window.cc.projects.add(path), projectPath);
  if (!project.ok) throw new Error(`Project registration failed: ${project.error}`);
  const thread = await app.window.evaluate(async (projectId) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', title: 'Modern Flow E2E', input: 'Complete this turn' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).value;
  }, project.value.id);
  return { project, thread };
}

async function archiveThread(window: Page, threadId: string) {
  await window.evaluate(async (id) => {
    await fetch(`/api/v1/threads/${id}/archive`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
  }, threadId);
}

test('Modern-only project renders in Squads Overview and opens its thread', async ({ app }) => {
  const { window } = app;
  const { thread } = await createProjectWithModernThread(app);

  try {
    await expect.poll(() => window.evaluate(async (id) => {
      const response = await fetch(`/api/v1/threads/${id}`);
      return (await response.json()).thread.status;
    }, thread.id), { timeout: 30_000 }).toBe('idle');

    const dismissSponsor = window.getByRole('button', { name: 'Dismiss' });
    if (await dismissSponsor.isVisible().catch(() => false)) await dismissSponsor.click();
    await window.getByTestId('nav-agents').click();
    await expect(window.locator('.agents-board')).toBeVisible();
    await window.getByRole('button', { name: 'Squads view' }).click();

    const overview = window.getByRole('region', { name: 'Squads', exact: true });
    await expect(overview.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const row = overview.getByRole('button', { name: /Modern Flow E2E/ });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(overview.locator('.squad-roster-row')).toHaveCount(1);
    const search = overview.getByRole('searchbox', { name: 'Search agents and runs' });
    await search.fill('nothing matching');
    await expect(overview.getByText('No matching agents or Squad runs')).toBeVisible();
    await overview.getByRole('button', { name: 'Clear filters' }).click();
    await overview.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(overview.getByText('No Squad members to map in this selection.')).toBeVisible();
    await expect(row).toBeVisible();
    await row.click();
    const details = overview.getByRole('complementary', { name: 'Agent details' });
    await expect(details.getByRole('heading', { name: 'Modern Flow E2E' })).toBeFocused();
    await details.getByRole('button', { name: 'Open thread' }).click();

    await expect(window.getByRole('heading', { name: 'Modern Flow E2E', exact: true })).toBeVisible();
    await expect(window.getByTestId('thread-timeline')).toContainText('Response to: Complete this turn');
    await expect(window).not.toHaveURL(new RegExp(`/sessions/${thread.id}$`));
  } finally {
    await archiveThread(window, thread.id);
  }
});
