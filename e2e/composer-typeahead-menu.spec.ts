import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

for (const mode of ['Modern', 'CLI Agent'] as const) {
  test(`${mode} launcher keeps the full slash catalogue visible and selectable`, async ({ app }) => {
    const page = app.window;
    await page.setViewportSize({ width: 900, height: 640 });
    await page.route('**/api/v1/plugins/contributions', async route => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ json: { ...body, pluginSkills: [{
        name: 'Test commands', enabled: true,
        skillNames: [...Array.from({ length: 24 }, (_, i) => `sample-command-${i}`), 'slack-bridge-2ff2']
      }] } });
    });
    await page.route('**/native-capabilities?*', route => route.fulfill({ json: { commands: [], skills: [], diagnostics: [] } }));
    await page.getByTestId('nav-agents').click();
    await page.locator('[data-testid="agents-new"], [data-testid="agents-new-empty"], [data-testid="agents-board-new-thread"]').first().click();
    const modal = page.getByTestId('launch-modal');
    await modal.getByRole('button', { name: mode, exact: true }).click();
    const input = modal.getByTestId(mode === 'Modern' ? 'thread-command-input' : 'legacy-agent-command-input');
    await input.click();
    await input.pressSequentially('Review issue /');
    const menu = page.getByTestId('composer-typeahead-menu');
    const target = menu.getByRole('option').filter({ hasText: 'slack-bridge-2ff2' });
    await expect(target).toHaveCount(1);
    expect(await menu.getByRole('option').count()).toBeGreaterThan(24);
    await expect.poll(() => menu.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
    })).toBe(true);
    await input.press('ArrowUp');
    const selected = menu.locator('[aria-selected="true"]');
    await expect.poll(() => selected.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await menu.hover();
    await page.mouse.wheel(0, -3000);
    await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBe(0);
    await input.press('ArrowDown');
    await expect.poll(() => selected.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await input.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(modal).toBeVisible();
    await input.press('Backspace');
    await input.pressSequentially('/s');
    await expect(target).toHaveCount(1);
    // A real click exercises hit testing through the launcher clipping chain.
    await target.click();
    await expect(menu).toHaveCount(0);
    await expect(modal).toBeVisible();
    await expect(input).toContainText('Review issue');
    await expect(input).toContainText('slack-bridge-2ff2');
    await expect(input).toBeFocused();
    await input.pressSequentially(' /slack');
    await expect(target).toHaveCount(1);
    await input.press(mode === 'Modern' ? 'Enter' : 'Tab');
    await expect(menu).toHaveCount(0);
    await expect(modal).toBeVisible();
  });
}

test('home and thread composers keep mention menus reachable after expanding and resizing', async ({ app }) => {
  const page = app.window;
  const { projectId, projectName, threadId } = await page.evaluate(async () => {
    const project = (await window.cc.projects.list())[0]!;
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, providerId: 'fake', input: 'Typeahead regression', environment: { kind: 'personal' } }) });
    if (!response.ok) throw Error(await response.text());
    return { projectId: project.id, projectName: project.name, threadId: (await response.json()).thread.id as string };
  });
  // This checks editor geometry, including a thread whose provider failed;
  // wait for the turn to settle without requiring a successful provider run.
  await expect.poll(() => page.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toMatch(/^(idle|error)$/);
  for (const path of ['/', `/projects/${projectId}/threads/${threadId}`]) {
    await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
    const input = page.getByTestId('thread-command-input');
    await expect(input).toBeVisible();
    await input.click();
    await input.pressSequentially(`@${projectName}`);
    const menu = page.getByTestId('composer-typeahead-menu');
    const project = menu.locator('[role="option"][data-kind="project"]').filter({ hasText: projectName });
    await expect(project).toBeVisible();
    await page.getByTestId('thread-command-expand').click();
    await page.setViewportSize({ width: 780, height: 520 });
    await expect.poll(() => menu.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
    })).toBe(true);
    await project.click();
    await expect(menu).toHaveCount(0);
    await expect(input).toContainText(projectName);
    await expect(input).toBeFocused();
  }
});
