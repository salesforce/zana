import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { sponsorPromptDismissed: true, composerShowModern: true, composerShowCliAgent: true }
});

test('projects drag into Modern and CLI composers while rail reordering still works', async ({ app }) => {
  const { window, home } = app;
  await dismissConsentOverlays(window);
  const paths = ['Drop Alpha', 'Drop Beta'].map((name) => join(home, name));
  for (const path of paths) mkdirSync(path);
  await window.evaluate(async (paths) => {
    for (const path of paths) {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
    }
  }, paths);
  await window.getByTestId('nav-home').click();
  const rail = window.locator('.sidebar-projects');
  const alpha = rail.getByRole('button', { name: 'Open Drop Alpha', exact: true });
  const beta = rail.getByRole('button', { name: 'Open Drop Beta', exact: true });
  const projectOrder = async () => rail.locator('.project-name').allTextContents();
  await expect(alpha).toBeVisible();
  await expect(beta).toBeVisible();
  const before = await projectOrder();

  const modern = window.getByTestId('thread-command-input');
  await modern.fill('Compare this project: ');
  await alpha.dragTo(modern);
  await expect(modern.locator('.prompt-mention-pill')).toHaveText('Project: Drop Alpha');
  await expect(modern).toContainText('Compare this project:');
  await expect(modern).toBeFocused();
  expect(await projectOrder()).toEqual(before);

  // A native mouse drag must still reorder projects, without navigating away
  // from the draft. Keyboard sorting uses the existing dnd-kit path.
  await beta.dragTo(alpha);
  await expect.poll(projectOrder).toEqual(before.map((name) =>
    name === 'Drop Alpha' ? 'Drop Beta' : name === 'Drop Beta' ? 'Drop Alpha' : name));
  await expect(modern.locator('.prompt-mention-pill')).toHaveText('Project: Drop Alpha');

  // Filtering disables sorting, but must not disable mentioning a project.
  await rail.getByRole('textbox', { name: 'Filter projects' }).fill('Drop Beta');
  await window.getByRole('group', { name: 'Launch mode' }).getByRole('button', { name: 'CLI Agent', exact: true }).click();
  const cli = window.getByTestId('legacy-agent-command-input');
  await beta.dragTo(cli);
  await expect(cli.locator('.prompt-mention-pill')).toHaveText('Project: Drop Beta');
  await expect(cli).toBeFocused();
});

test('dropping a project into an existing thread inserts a mention without switching threads', async ({ app }) => {
  const { window, home } = app;
  await dismissConsentOverlays(window);
  const path = join(home, 'Drop Thread Project');
  mkdirSync(path);
  const threadId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Prepare a draft' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, path);
  await window.evaluate((id) => {
    window.history.pushState({}, '', `/threads/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const editor = window.getByTestId('thread-command-input');
  await expect(editor).toBeEditable();
  await editor.fill('Review ');
  const source = window.locator('.sidebar-projects').getByRole('button', { name: 'Open Drop Thread Project', exact: true });
  await source.dragTo(editor);
  await expect(editor.locator('.prompt-mention-pill')).toHaveText('Project: Drop Thread Project');
  await expect(editor).toContainText('Review');
  await expect(editor).toBeFocused();
  await expect(window).toHaveURL(new RegExp(`/threads/${threadId}$`));
});
