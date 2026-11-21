import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('Markdown preview searches, edits rich content, checks tasks and safely merges an external save', async ({ app, home }, info) => {
  test.setTimeout(120_000);
  const root = join(realpathSync(home), 'markdown-project'); mkdirSync(root);
  const file = join(root, 'guide.md');
  const original = '\uFEFF---\r\ntitle: "Keep  exactly"\r\n---\r\n\r\n# Guide\r\n\r\nA **bold** phrase.\r\n\r\n- [ ] Same task\r\n- [ ] Same task\r\n\r\n<!-- preserve me -->\r\n\r\n```txt\r\n- [ ] example\r\n```\r\n\r\n```mermaid\r\ngraph TD; A-->B\r\n```\r\n';
  writeFileSync(file, original);
  const page = app.window;
  const projectId = await page.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw new Error(result.message);
    history.pushState({}, '', `/projects/${result.value.id}/explorer`); dispatchEvent(new PopStateEvent('popstate')); return result.value.id;
  }, root);
  await page.locator('.tree-row.file').filter({ hasText: 'guide.md' }).click();
  const document = page.locator('.explorer-viewer .md-document');
  await expect(document.getByRole('heading', { name: 'Guide' })).toBeVisible();
  await expect(document.locator('.inbox-mermaid-frame svg')).toBeVisible();
  const diagram = document.locator('.inbox-mermaid-frame');
  expect((await diagram.boundingBox())!.height).toBeLessThanOrEqual(480);
  await expect(document.getByRole('button', { name: 'Copy code', exact: true })).toBeVisible();
  await document.getByRole('button', { name: 'Find', exact: true }).click();
  await document.getByRole('textbox', { name: 'Find in document' }).fill('A bold phrase');
  await expect(document).toContainText('1 of 1');
  await document.getByRole('textbox', { name: 'Find in document' }).press('Escape');
  const keyboardTask = document.getByRole('checkbox').first();
  await keyboardTask.focus();
  await page.keyboard.press('Space');
  await expect(keyboardTask).toBeChecked();
  await expect(keyboardTask).toBeFocused();
  await page.keyboard.press('Space');
  await expect(keyboardTask).not.toBeChecked();
  await document.getByRole('checkbox').nth(1).check();
  expect(readFileSync(file, 'utf8')).toBe(original);
  await document.getByRole('group', { name: 'Markdown view' }).getByRole('button', { name: 'Source', exact: true }).click();
  await expect(document.locator('.monaco-editor')).toContainText('[x] Same task');
  await document.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(document.getByRole('checkbox').nth(1)).toBeChecked();
  await document.getByRole('button', { name: 'Undo document change' }).click();
  await expect(document.getByRole('checkbox').nth(1)).not.toBeChecked();
  await document.getByRole('button', { name: 'Redo document change' }).click();
  await document.getByRole('button', { name: 'Save', exact: true }).click();
  const checked = original.replace('- [ ] Same task\r\n\r\n<!--', '- [x] Same task\r\n\r\n<!--');
  await expect.poll(() => readFileSync(file, 'utf8')).toBe(checked);
  await document.getByRole('button', { name: 'Edit', exact: true }).click();
  await document.getByRole('textbox', { name: 'Document content' }).locator('h1').fill('Edited guide');
  await document.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(document.getByRole('heading', { name: 'Edited guide' })).toBeVisible();
  await document.getByRole('button', { name: 'Save', exact: true }).click();
  const edited = checked.replace('# Guide', '# Edited guide');
  await expect.poll(() => readFileSync(file, 'utf8')).toBe(edited);

  // The disk edit wins until the human has explicitly reviewed its revision.
  await document.getByRole('checkbox').first().check();
  const external = edited.replace('A **bold** phrase.', 'Agent added context.'); writeFileSync(file, external);
  await document.getByRole('button', { name: 'Save', exact: true }).click();
  const recovery = page.getByRole('region', { name: 'Markdown save recovery' });
  await expect(recovery).toBeVisible(); expect(readFileSync(file, 'utf8')).toBe(external);
  await recovery.getByRole('button', { name: 'Review latest version' }).click();
  await expect(recovery.getByLabel('Latest saved version')).toContainText('Agent added context.');
  await document.getByRole('group', { name: 'Markdown view' }).getByRole('button', { name: 'Source', exact: true }).click();
  const merged = external.replace('- [ ] Same task', '- [x] Same task');
  await document.locator('.monaco-editor').click();
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(merged);
  await recovery.getByRole('button', { name: 'Use reviewed revision for next save' }).click();
  await document.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => readFileSync(file, 'utf8')).toBe(merged);
  await document.getByRole('button', { name: 'Read', exact: true }).click();
  await captureElectronScreenshot(app.electron, page, info.outputPath('markdown-explorer.png'));

  // Library uses its own scoped writer, with the same interactive preview.
  await page.evaluate(async projectId => {
    await window.cc.library.add({ scope: 'project', projectId, relPath: 'note.md', title: 'Note', content: '# Note\n\n- [ ] Library task\n' });
    history.pushState({}, '', `/projects/${projectId}/docs`); dispatchEvent(new PopStateEvent('popstate'));
  }, projectId);
  await page.getByRole('button', { name: 'note.md', exact: true }).click();
  const library = page.locator('.library-md-pane .md-document');
  await library.getByRole('checkbox').check();
  await library.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => readFileSync(join(root, '.zcc/library/note.md'), 'utf8')).toContain('- [x] Library task');

  // Ordinary thread files use the checkout recorded for that thread.
  const threadId = await page.evaluate(async projectId => {
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, providerId: 'fake', input: 'Markdown verification' }) });
    const body = await response.json(); if (!response.ok) throw new Error(JSON.stringify(body));
    const id = (body.thread ?? body.value).id as string;
    history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); return id;
  }, projectId);
  await expect(page.getByTestId('thread-detail')).toBeVisible();
  await page.evaluate(async ({ threadId }) => {
    const response = await fetch(`/api/v1/threads/${threadId}/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: { source: 'workspace', path: 'guide.md', lineNumber: null } }) });
    if (!response.ok) throw new Error(await response.text());
  }, { threadId });
  const thread = page.getByTestId('thread-secondary-panel').locator('.md-document');
  await expect(thread.getByRole('heading', { name: 'Edited guide' })).toBeVisible();
  await expect(thread.getByRole('checkbox').first()).toBeEnabled();
  await thread.getByRole('checkbox').first().uncheck(); await thread.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => readFileSync(file, 'utf8')).toBe(merged.replace('- [x] Same task', '- [ ] Same task'));

  const outside = join(home, 'outside.md'); writeFileSync(outside, 'PRIVATE'); symlinkSync(outside, join(root, 'escape.md'));
  const denied = await page.evaluate(async ({ threadId, projectId }) => Promise.all(['../outside.md', 'escape.md'].map(async path => {
    const response = await fetch(`/api/v1/threads/${threadId}/markdown?${new URLSearchParams({ path, projectId })}`); return { status: response.status, text: await response.text() };
  })), { threadId, projectId });
  expect(denied.every(result => result.status >= 400 && !result.text.includes('PRIVATE'))).toBe(true);
  for (const path of ['../outside.md', 'escape.md']) {
    const status = await page.evaluate(async ({ threadId, path }) => {
      const response = await fetch(`/api/v1/threads/${threadId}/markdown`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, content: 'Overwrite', expectedSha256: 'a'.repeat(64) }) });
      return response.status;
    }, { threadId, path });
    expect(status).toBeGreaterThanOrEqual(400);
  }
  expect(readFileSync(outside, 'utf8')).toBe('PRIVATE');
});

for (const theme of ['light', 'dark'] as const) {
  test(`Markdown stays usable in ${theme} and narrow panels`, async ({ app, home }, info) => {
    const root = join(realpathSync(home), 'visual-review'); mkdirSync(root);
    writeFileSync(join(root, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const original = '# Release checklist\n\nA **formatted release plan** that stays readable while you work.\n\n## Ready for review\n\n- [x] Build the shared Markdown viewer\n- [ ] Verify the interactive checklist\n\n## Run locally\n\n```js\nconst command = "' + 'x'.repeat(400) + '";\n```\n\n```mermaid\ngraph TD; Review-->Ship\n```\n';
    writeFileSync(join(root, 'release-plan.md'), original);
    writeFileSync(join(root, 'image.md'), '# Image\n\n![Local image](pixel.png)');
    const page = app.window;
    const projectId = await page.evaluate(async ({ root, theme }) => {
      await window.cc.config.set({ theme });
      const result = await window.cc.projects.add(root); if (!result.ok) throw new Error(result.message);
      history.pushState({}, '', `/projects/${result.value.id}/explorer`); dispatchEvent(new PopStateEvent('popstate')); return result.value.id;
    }, { root, theme });
    await page.locator('.tree-row.file').filter({ hasText: 'release-plan.md' }).click();
    const document = page.locator('.explorer-viewer .md-document');
    await expect(document.getByRole('heading', { name: 'Release checklist', exact: true })).toBeVisible();
    await expect(document.locator('.inbox-mermaid-frame svg')).toBeVisible();
    const code = document.locator('.inbox-md-codeblock pre');
    expect(await code.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    const copy = document.getByRole('button', { name: 'Copy code', exact: true });
    await document.locator('.inbox-md-codeblock').hover();
    const copyLeft = (await copy.boundingBox())!.x;
    await code.evaluate(el => { el.scrollLeft = 120; });
    expect((await copy.boundingBox())!.x).toBe(copyLeft);
    await captureElectronScreenshot(app.electron, page, info.outputPath(`markdown-${theme}-read.png`));
    await document.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(document.getByRole('textbox', { name: 'Document content' })).toBeVisible();
    await expect(document.getByRole('textbox', { name: 'Document content' })).toContainText('Release checklist');
    const richCode = document.getByRole('textbox', { name: 'Document content' }).locator('pre').first();
    const contrast = await richCode.evaluate(el => {
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
          const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
      };
      const foreground = luminance(getComputedStyle(el.querySelector('code')!).color);
      const background = luminance(getComputedStyle(el).backgroundColor);
      return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    expect(await richCode.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await captureElectronScreenshot(app.electron, page, info.outputPath(`markdown-${theme}-edit.png`));
    await document.evaluate(el => { el.style.width = '300px'; });
    await document.getByRole('button', { name: 'Find', exact: true }).click();
    await document.getByRole('textbox', { name: 'Find in document' }).fill('release plan');
    await expect(document).toContainText('1 of 1');
    const tools = document.getByRole('toolbar', { name: 'Markdown tools' });
    expect(await tools.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(document.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await captureElectronScreenshot(app.electron, page, info.outputPath(`markdown-${theme}-narrow.png`), document);
    expect(readFileSync(join(root, 'release-plan.md'), 'utf8')).toBe(original);
    const imageRequest = page.waitForRequest(request => request.url().endsWith('/api/v1/fs/image') && request.method() === 'POST');
    await page.locator('.tree-row.file').filter({ hasText: 'image.md' }).click();
    expect((await imageRequest).postDataJSON()).toMatchObject({ scope: { projectId, hostId: expect.any(String) } });
    await expect(document.getByRole('img', { name: 'Local image' })).toBeVisible();
    expect(await document.getByRole('img', { name: 'Local image' }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  });
}


test('continuous rich editing selects across paragraphs and keeps native history and source', async ({ app, home }, info) => {
  const root = join(realpathSync(home), 'continuous-markdown'); mkdirSync(root);
  const file = join(root, 'writing.md');
  writeFileSync(join(root, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  const original = '\uFEFF---\r\ntitle: "Keep  this"\r\n---\r\n\r\n# Writing\r\n\r\nFirst paragraph.\r\n\r\nSecond paragraph.\r\n\r\n<!-- keep this comment -->\r\n\r\n![Local image](pixel.png)\r\n\r\n- [ ] Verify editor\r\n\r\n| a | b |\r\n|---|:-:|\r\n| one | two |\r\n\r\n[ref]: https://example.com "Keep"\r\n';
  writeFileSync(file, original);
  const page = app.window;
  await page.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw new Error(result.message);
    history.pushState({}, '', `/projects/${result.value.id}/explorer`); dispatchEvent(new PopStateEvent('popstate'));
  }, root);
  await page.locator('.tree-row.file').filter({ hasText: 'writing.md' }).click();
  const document = page.locator('.explorer-viewer .md-document');
  await document.getByRole('button', { name: 'Edit', exact: true }).click();
  const rich = document.getByRole('textbox', { name: 'Document content' });
  await expect(rich).toContainText('Second paragraph.');
  await expect(rich).toBeFocused();
  await expect(document.getByRole('textbox', { name: 'Document content' })).toHaveCount(1);
  await expect(document.getByRole('button', { name: 'Edit block', exact: true })).toHaveCount(0);
  await expect(rich.getByRole('img', { name: 'Local image' })).toBeVisible();
  await expect.poll(() => rich.getByRole('img', { name: 'Local image' }).evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(1);
  expect(readFileSync(file, 'utf8')).toBe(original);
  await rich.evaluate(el => {
    const paragraphs = Array.from(el.querySelectorAll('p'));
    const first = paragraphs.find(p => p.textContent === 'First paragraph.')!.firstChild!;
    const second = paragraphs.find(p => p.textContent === 'Second paragraph.')!.firstChild!;
    (el as HTMLElement).focus();
    const range = document.createRange(); range.setStart(first, 6); range.setEnd(second, 6);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.insertText('joined');
  await expect(rich).toContainText('First joined paragraph.');
  await expect(rich).not.toContainText('Second paragraph.');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rich).toContainText('Second paragraph.');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(rich).toContainText('First joined paragraph.');
  await document.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(document).toContainText('First joined paragraph.');
  await document.getByRole('button', { name: 'Edit', exact: true }).click();
  await document.getByRole('button', { name: 'Undo document change' }).click();
  await expect(rich).toContainText('Second paragraph.');
  await document.getByRole('button', { name: 'Redo document change' }).click();
  await expect(rich).toContainText('First joined paragraph.');
  await document.getByRole('button', { name: 'Save', exact: true }).click();
  const expected = original.replace('First paragraph.\r\n\r\nSecond paragraph.', 'First joined paragraph.');
  await expect.poll(() => readFileSync(file, 'utf8')).toBe(expected);
  await rich.locator('p').filter({ hasText: 'First joined paragraph.' }).evaluate(el => {
    const range = document.createRange(); range.setStart(el.firstChild!, 6); range.setEnd(el.firstChild!, 12);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('toolbar', { name: 'Formatting', exact: true }).getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(rich.locator('strong')).toHaveText('joined');
  await document.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => readFileSync(file, 'utf8')).toBe(expected.replace('joined', '**joined**'));
  await captureElectronScreenshot(app.electron, page, info.outputPath('continuous-markdown-editor.png'));
});
