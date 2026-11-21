import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

// With thread tabs on, a card opens the thread in its own tab. The inspector modal, whose URL has no thread, needs them off.
test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { classicSessionViewEnabled: false, threadTabsEnabled: false, agentsBoardView: 'board', sponsorPromptDismissed: true }
});

test('a Docs card opens inside its thread inspector when the URL has no thread', async ({ app }) => {
  const { window, home } = app;
  const projectPath = join(home, 'docs-inspector-project');
  mkdirSync(join(projectPath, '.zcc', 'library'), { recursive: true });
  const original = '---\ntitle: \"Keep  exactly\"\n---\n\n# Inspector document\n\nOwned by the visible conversation.\n\nSecond paragraph.\n\n<!-- preserve me -->\n';
  const file = join(projectPath, '.zcc', 'library', 'inspector.md');
  writeFileSync(file, original);
  const threadId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', title: 'Docs inspector regression', input: 'Hello' })
    });
    if (!response.ok) throw new Error(await response.text());
    const body = await response.json();
    return (body.value ?? body.thread).id as string;
  }, projectPath);
  await expect.poll(() => window.evaluate(async (id) =>
    (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId
  )).toBe('idle');
  await window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: {
      ...body,
      rows: body.rows.map((row: { kind: string; role?: string }) => row.kind === 'conversation' && row.role === 'assistant'
        ? { ...row, text: '::doc{path="inspector.md" title="Inspector document"}' }
        : row)
    } });
  });
  await window.getByTestId('nav-agents').click();
  await window.locator('.agent-card[data-kind="thread"]').filter({ hasText: 'Docs inspector regression' }).click();
  const modal = window.getByTestId('thread-modal');
  await expect(modal).toBeVisible();
  await modal.locator('.plugin-directive-card-main').filter({ hasText: 'Inspector document' }).click();
  const panel = modal.locator('.docs-document-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Owned by the visible conversation.');
  const editor = panel.getByRole('textbox', { name: 'Document content' });
  await expect(editor).toContainText('Second paragraph.');
  await editor.locator('h1').fill('Updated inspector');
  await expect.poll(() => readFileSync(file, 'utf8')).toBe(original.replace('# Inspector document', '# Updated inspector'));
  expect(new URL(window.url()).pathname).toBe('/agents');
  await expect(window.locator('.library-panel')).toHaveCount(0);
});
