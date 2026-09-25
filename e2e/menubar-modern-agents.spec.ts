import { test, expect } from './fixtures/app.js';

test.use({
  e2e: true,
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  isolateBundledCatalog: true,
  initialConfig: { menubarPopoverEnabled: true }
});

test('modern thread appears in popover and opens through authoritative route', async ({ app }) => {
  test.skip(process.platform !== 'darwin', 'macOS menu-bar popover');

  const project = await app.window.evaluate(async () => {
    const response = await fetch('/api/v1/projects');
    return (await response.json()).projects[0] as { id: string };
  });
  const thread = await app.window.evaluate(async (projectId) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', title: 'Popover modern agent', input: 'delay:60000 popover' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread as { id: string };
  }, project.id);

  await expect.poll(() => app.window.evaluate(async (id) => {
    return (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status;
  }, thread.id)).toBe('active');
  await expect.poll(() => app.window.evaluate(async (id) => {
    const snapshot = await window.cc.menubar.request();
    if (snapshot.agents.some((agent) => agent.kind === 'thread' && agent.agentId === id)) return true;
    const tap = await (window as any).__zccTest?.drainEvents(0);
    const error = tap?.entries?.find((entry: any) => entry.kind === 'log' && JSON.stringify(entry.args).includes('refreshThreads'));
    if (error) throw new Error(JSON.stringify(error.args));
    return false;
  }, thread.id), { timeout: 20_000 }).toBe(true);

  await app.window.setViewportSize({ width: 380, height: 560 });
  await app.window.goto(new URL('?surface=popover', app.window.url()).href);
  const row = app.window.locator('.mbp-row', { hasText: 'Popover modern agent' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.locator('.mbp-fav')).toHaveCount(0);
  await expect(app.window.locator('.mbp-stat').filter({ hasText: 'working' }).locator('.mbp-stat-value')).not.toHaveText('0');

  await app.window.goto(new URL('/', app.window.url()).href);
  await expect(app.window.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect.poll(async () => {
    await app.window.evaluate(({ id, projectId }) => window.cc.menubar.focusAgent('thread', id, projectId), {
      id: thread.id,
      projectId: project.id
    });
    return app.window.evaluate(() => window.location.href);
  }).toContain(thread.id);
});
