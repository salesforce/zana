import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

test('thread review comments render findings and preview their source line in built Electron', async ({ app }, testInfo) => {
  const { window, home } = app;
  const file = 'ui-chatbots-components/modules/agent_authoring/modelManager/agentScriptModel.js';
  mkdirSync(join(home, 'review-project', 'ui-chatbots-components/modules/agent_authoring/modelManager'), { recursive: true });
  const root = realpathSync(join(home, 'review-project'));
  writeFileSync(join(root, file), Array.from({ length: 25 }, (_, index) => index === 16 ? 'const collaboratorEdit = "preserve me";' : `// line ${index + 1}`).join('\n'));
  const title = "Same-line edits: the collaborator's edit is lost without notice";
  const input = `Review findings:\n\n:::comment{id="agent-merge-conflict-silent" file="${file}" lines="17" priority="p1" title="${title}"}\nThe **collaborator edit** disappears.\n\nShow a conflict before saving.\n:::\n\nReview complete.\n\n:::comment{title="Header-only finding" priority="p2"}`;
  const threadId = await window.evaluate(async ({ root, input }) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread.id as string;
  }, { root, input });
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const assistant = window.getByTestId('thread-assistant-text');
  const cards = assistant.getByTestId('thread-review-comment');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText(title);
  await expect(cards.first()).toContainText('P1');
  await expect(cards.first().locator('.inbox-md strong')).toHaveText('collaborator edit');
  await expect(cards.first()).toContainText('Show a conflict before saving.');
  await expect(assistant).toContainText('Review complete.');
  await expect(assistant).not.toContainText(':::comment');
  await cards.first().getByRole('button', { name: `Preview ${file}:17` }).click();
  const preview = window.getByTestId('thread-file-preview');
  await expect(preview).toHaveAttribute('data-focus-line', '17');
  await expect(preview.getByTestId('thread-file-preview-focus-line')).toContainText('preserve me');
  await window.screenshot({ path: testInfo.outputPath('review-comments.png') });
});
