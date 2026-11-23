import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';

// With thread tabs on, a card opens the thread in its own tab. The inspector modal, whose URL has no thread, needs them off.
test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { classicSessionViewEnabled: false, threadTabsEnabled: false, dockableThreadToolsEnabled: true, agentsBoardView: 'board', sponsorPromptDismissed: true }
});

test('a Docs card opens inside its thread inspector when the URL has no thread', async ({ app }) => {
  const { window, home } = app;
  await window.setViewportSize({ width: 1280, height: 800 });
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
  // Timeline rows can arrive before thread metadata. Open the card in that gap.
  let resolveProject!: () => void;
  const projectReady = new Promise<void>(resolve => { resolveProject = resolve; });
  await window.route(url => url.pathname === `/api/v1/threads/${threadId}`, async route => {
    await projectReady;
    await route.continue();
  });
  await window.getByTestId('nav-agents').click();
  await window.locator('.agent-card[data-kind="thread"]').filter({ hasText: 'Docs inspector regression' }).click();
  const modal = window.getByTestId('thread-modal');
  try {
    await expect(modal).toBeVisible();
    await modal.locator('.plugin-directive-card-main').filter({ hasText: 'Inspector document' }).click();
    await expect(modal.getByText('This document link is missing a library path.')).toBeVisible();
  } finally { resolveProject(); }
  const panel = modal.locator('.docs-document-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Owned by the visible conversation.');
  const editor = panel.getByRole('textbox', { name: 'Document content' });
  await expect(editor).toContainText('Second paragraph.');
  await editor.locator('h1').fill('Updated inspector');
  await expect.poll(() => readFileSync(file, 'utf8')).toBe(original.replace('# Inspector document', '# Updated inspector'));
  expect(new URL(window.url()).pathname).toBe('/agents');
  await expect(window.locator('.library-panel')).toHaveCount(0);

  // The same registered action browses the project when launched without a card.
  const add = modal.getByRole('button', { name: 'Add tool to right panel' });
  await add.click();
  await window.getByRole('menuitem', { name: 'Library', exact: true }).click();
  const library = modal.locator('.library-view');
  const note = library.getByRole('button', { name: 'inspector.md' });
  await expect(note).toBeVisible();
  await note.click();
  await expect(library.getByRole('heading', { name: 'Updated inspector' })).toBeVisible();
  await add.click();
  await window.getByRole('menuitem', { name: 'Library', exact: true }).click();
  const closeLibrary = modal.getByRole('button', { name: 'Close Library', exact: true });
  await expect(closeLibrary).toHaveCount(1);
  await library.getByRole('button', { name: 'Back to documents' }).click();
  await expect(note).toBeVisible();
  await closeLibrary.click();
  await openThreadToolLauncher(modal);
  await modal.getByTestId('thread-new-tab-plugin-docs-document').click();
  await expect(note).toBeVisible();
  expect(new URL(window.url()).pathname).toBe('/agents');
});
