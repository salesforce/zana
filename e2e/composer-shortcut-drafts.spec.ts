import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('a project thread draft survives Ctrl+B and Ctrl+O round trips', async ({ app }) => {
  const page = app.window;
  const { projectId, threadId } = await page.evaluate(async () => {
    const project = (await window.cc.projects.list())[0]!;
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id, providerId: 'fake', input: 'Shortcut draft', title: 'Shortcut draft', environment: { kind: 'personal' } }) });
    if (!response.ok) throw Error(await response.text());
    return { projectId: project.id, threadId: (await response.json()).thread.id as string };
  });
  await expect.poll(() => page.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toBe('idle');
  const threadPath = `/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}`;
  const navigate = async (path: string) => {
    await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
  };
  await navigate(threadPath);
  const input = page.getByTestId('thread-detail').getByTestId('thread-command-input');
  await expect(input).toBeVisible();
  await input.click();
  await page.keyboard.type('Unsent shortcut draft');
  for (const chord of ['Control+b', 'Control+o']) {
    await page.keyboard.press(chord);
    await expect(input).toBeHidden();
    await navigate(threadPath);
    await expect(input).toHaveText('Unsent shortcut draft');
    await input.click();
  }
});
