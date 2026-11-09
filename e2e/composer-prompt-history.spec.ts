import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Editor } from '@tiptap/react';
import type { Locator } from '@playwright/test';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  isolateBundledCatalog: true,
  initialConfig: { sponsorPromptDismissed: true }
});

type PromptElement = HTMLElement & { editor: Editor };
async function caret(input: Locator) {
  return input.evaluate(element => {
    const editor = (element as PromptElement).editor;
    const { from, to, head } = editor.state.selection;
    return { from, to, top: editor.view.coordsAtPos(head).top, text: editor.getText({ blockSeparator: '\n' }) };
  });
}
async function placeCaret(input: Locator, position: 'start' | 'end' | number) {
  await input.evaluate((element, position) => {
    const editor = (element as PromptElement).editor;
    editor.commands.setTextSelection(position === 'start' ? 1 : position === 'end' ? editor.state.doc.content.size - 1 : position);
    editor.commands.focus();
  }, position);
}

test.beforeEach(async ({ app }) => {
  const win = app.window;
  await dismissConsentOverlays(win);
  await win.route('**/api/v1/projects/*/commands', route => route.fulfill({ json: { commands: [
    { name: 'first', description: 'First test command' },
    { name: 'second', description: 'Second test command' }
  ] } }));
  const path = join(app.home, 'prompt-history-project');
  mkdirSync(path);
  const threadId = await win.evaluate(async path => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Previous prompt' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, path);
  const historyLoaded = win.waitForResponse(response => response.url().endsWith(`/threads/${threadId}/prompt-history`) && response.ok());
  await win.evaluate(id => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  await historyLoaded;
  await expect(win.getByTestId('thread-assistant-text')).toContainText('Response to: Previous prompt');
});

test('arrows edit a multiline draft and recall history only at the first and last lines', async ({ app }) => {
  const input = app.window.getByTestId('thread-command-input');
  const lines = ['one alpha', 'two bravo', 'tri charl', 'for delta'];
  await input.fill(lines[0]);
  for (const line of lines.slice(1)) {
    await input.press('Shift+Enter');
    await input.pressSequentially(line);
  }
  const draft = lines.join('\n');
  const last = await caret(input);
  expect(last.text).toBe(draft);
  await input.press('ArrowUp');
  expect((await caret(input)).top).toBeLessThan(last.top);
  expect((await caret(input)).text).toBe(draft);
  await input.press('ArrowDown');
  expect((await caret(input)).top).toBe(last.top);
  expect((await caret(input)).text).toBe(draft);
  await input.press('ArrowDown');
  expect((await caret(input)).text).toBe(draft);
  await input.press('ArrowUp');
  await input.press('ArrowUp');
  await input.press('ArrowUp');
  expect((await caret(input)).text).toBe(draft);
  await input.press('ArrowUp');
  await expect(input).toHaveText('Previous prompt');
  await input.press('ArrowDown');
  expect((await caret(input)).text).toBe(draft);
});

test('soft-wrapped lines retain native navigation and the first visual line can recall history', async ({ app }) => {
  const input = app.window.getByTestId('thread-command-input');
  await input.evaluate(element => { (element as HTMLElement).style.width = '260px'; });
  const draft = 'A long prompt that wraps over several visual lines. '.repeat(12).trim();
  await input.fill(draft);
  await placeCaret(input, 'end');
  const last = await caret(input);
  await input.press('ArrowUp');
  expect((await caret(input)).top).toBeLessThan(last.top);
  expect((await caret(input)).text).toBe(draft);
  await input.press('ArrowDown');
  expect((await caret(input)).top).toBe(last.top);
  expect((await caret(input)).text).toBe(draft);
  await placeCaret(input, 4);
  await input.press('ArrowUp');
  await expect(input).toHaveText('Previous prompt');
  await input.press('ArrowDown');
  expect((await caret(input)).text).toBe(draft);
});

test('paragraphs and list items navigate as one prompt, including while browsing history', async ({ app }) => {
  const input = app.window.getByTestId('thread-command-input');
  await input.fill('Live draft');
  await input.press('ArrowUp');
  await expect(input).toHaveText('Previous prompt');
  await input.evaluate(element => {
    const editor = (element as PromptElement).editor;
    const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    editor.commands.setContent({ type: 'doc', content: [
      paragraph('First paragraph'),
      { type: 'bulletList', content: ['First item', 'Last item'].map(text => ({ type: 'listItem', content: [paragraph(text)] })) },
      paragraph('Last paragraph')
    ] });
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => { if (node.isTextblock) positions.push(pos + 1); });
    editor.commands.setTextSelection(positions[1] + 2);
  });
  const middle = await caret(input);
  await input.press('ArrowUp');
  expect((await caret(input)).top).toBeLessThan(middle.top);
  expect((await caret(input)).text).toBe(middle.text);
  await placeCaret(input, middle.from);
  await input.press('ArrowDown');
  expect((await caret(input)).top).toBeGreaterThan(middle.top);
  expect((await caret(input)).text).toBe(middle.text);
  await placeCaret(input, 'end');
  await input.press('ArrowDown');
  await expect(input).toHaveText('Live draft');
});

test('autocomplete, selection shortcuts, toolbar keys and copied-context drafts retain their behavior', async ({ app }) => {
  const win = app.window;
  const input = win.getByTestId('thread-command-input');
  await input.fill('/');
  const options = win.getByRole('option');
  await expect(options.first()).toBeVisible();
  const before = await options.evaluateAll(elements => elements.findIndex(element => element.getAttribute('aria-selected') === 'true'));
  await input.press('ArrowDown');
  await expect.poll(() => options.evaluateAll(elements => elements.findIndex(element => element.getAttribute('aria-selected') === 'true'))).not.toBe(before);
  await input.press('ArrowUp');
  expect((await caret(input)).text).toBe('/');
  await input.press('Escape');
  await input.fill('Select this draft');
  await placeCaret(input, 'end');
  await input.press('Shift+ArrowUp');
  const selection = await caret(input);
  expect(selection.from).not.toBe(selection.to);
  expect(selection.text).toBe('Select this draft');
  await input.press('ArrowUp');
  expect((await caret(input)).text).toBe('Select this draft');
  const send = win.getByTestId('thread-command-send');
  await send.focus();
  await win.keyboard.press('ArrowUp');
  expect((await caret(input)).text).toBe('Select this draft');

  await input.evaluate(element => {
    const editor = (element as PromptElement).editor;
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Review ' },
      { type: 'editorSelection', attrs: { reference: { version: 1, label: 'Saved context', text: 'first\nsecond\nthird' } } }
    ] }] });
  });
  await placeCaret(input, 2);
  await input.press('ArrowUp');
  await expect(input).toHaveText('Previous prompt');
  await input.press('ArrowDown');
  await expect(input.getByRole('button', { name: 'Inspect Saved context' })).toBeVisible();
  expect((await caret(input)).text).toContain('Review');
});
