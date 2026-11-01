import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('rendered Markdown and sandboxed HTML copy through the native clipboard into compact saved context', async ({ app, home }) => {
  test.setTimeout(150_000);
  const win = app.window;
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await dismissConsentOverlays(win);
  expect(await win.evaluate(() => window.cc.extensions.install({kind:'bundled',id:'design-docs'}))).toMatchObject({ok:true});
  await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'design-docs')?.status), {timeout:30_000}).toBe('running');
  const projectPath = join(home, 'context-project');
  mkdirSync(projectPath, { recursive: true });
  const markdown = 'Every employee must be accepted in both data orgs. '.repeat(16);
  const html = '  Exact HTML snapshot with spacing. '.repeat(18);
  const {docId} = await win.evaluate(async ({projectPath,markdown,html}) => {
    const project = await window.cc.projects.add(projectPath);
    if (!project.ok) throw Error(project.message);
    const doc = await window.cc.pluginApps.callRpc('design-docs','create',{title:'Context reference fixture',template:'technical',projectId:project.value.id}) as {id:string};
    const readme = await window.cc.pluginApps.callRpc('design-docs','readFile',{doc:doc.id,path:'README.md'}) as {revision:number;fileId:string};
    await window.cc.pluginApps.callRpc('design-docs','writeFile',{doc:doc.id,path:'README.md',content:markdown,baseRevision:readme.revision,baseFileId:readme.fileId});
    await window.cc.pluginApps.callRpc('design-docs','writeFile',{doc:doc.id,path:'passage.html',content:`<!doctype html><html><body><p id="passage" style="white-space:pre-wrap">${html}</p></body></html>`,baseRevision:0,baseFileId:null});
    return {docId:doc.id};
  },{projectPath,markdown,html});
  await win.getByRole('button',{name:/^Design Docs/}).click();
  await win.getByText('Context reference fixture').first().click();
  await expect.poll(()=>win.url()).toContain(docId);
  await win.getByRole('button',{name:/Ask agent/}).first().click();
  await win.getByRole('menuitem',{name:/^Review/}).click();
  const composer = win.getByTestId('panel-agent-tab-composer');
  const input = composer.getByTestId('thread-command-input');
  await expect(input).toBeVisible({timeout:30_000});
  await input.fill('Compare these passages: ');

  const passage = win.locator('.dd-preview-markdown .dd-prose p').first();
  await expect(passage).toContainText('Every employee');
  await passage.click();
  await passage.evaluate(element => {const selection=window.getSelection()!;selection.removeAllRanges();const range=document.createRange();range.selectNodeContents(element);selection.addRange(range);});
  await win.keyboard.press('ControlOrMeta+c');
  await expect.poll(()=>app.electron.evaluate(({clipboard})=>clipboard.readText())).toBe(markdown.trimEnd());
  await input.focus();
  await input.press('ControlOrMeta+End');
  await input.press('ArrowRight');
  await input.press('ControlOrMeta+v');
  await expect(input.getByRole('button',{name:'Inspect README.md (selection)'})).toBeVisible();
  await expect(input).not.toContainText('Every employee');
  await input.getByRole('button',{name:'Inspect README.md (selection)'}).click();
  await expect(win.getByRole('dialog',{name:'Copied selection: README.md (selection)'})).toContainText(markdown.trim());
  await win.keyboard.press('Escape');

  await win.getByRole('button',{name:/files/}).first().click();
  await win.getByRole('button',{name:'passage.html',exact:true}).click();
  const htmlPassage=win.frameLocator('iframe[title="passage.html"]').locator('#passage');
  await expect(htmlPassage).toBeVisible({timeout:30_000});
  await htmlPassage.click();
  await win.locator('iframe[title="passage.html"]').focus();
  await htmlPassage.evaluate(element=>{window.focus();const selection=window.getSelection()!;selection.removeAllRanges();const range=document.createRange();range.selectNodeContents(element);selection.addRange(range);});
  await expect.poll(() => htmlPassage.evaluate(() => document.hasFocus())).toBe(true);
  await expect.poll(() => htmlPassage.evaluate(() => window.getSelection()?.toString())).toBe(html);
  // Route Copy through Electron's native edit command for the focused frame.
  // CDP keyboard dispatch to the top-level page does not consistently reach a sandboxed child on Linux.
  await app.electron.evaluate(({BrowserWindow}, url) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)!.webContents.copy(), win.url());
  await expect.poll(()=>app.electron.evaluate(({clipboard})=>clipboard.readText())).toBe(html);
  await input.focus();await input.press('ControlOrMeta+End');await input.press('ArrowRight');await input.press('ControlOrMeta+v');
  await expect(input.getByRole('button',{name:'Inspect passage.html (selection)'})).toBeVisible();
  await expect(input.getByRole('button',{name:/^Inspect /})).toHaveCount(2);
  await input.press('ArrowRight');
  // Standard paste-as-text remains editable text, with no extra reference.
  // Playwright key events do not invoke Cocoa's paste-and-match-style menu role.
  // Use Electron's native editing command while Shift is held by the renderer.
  await win.keyboard.down('Shift');
  await app.electron.evaluate(({BrowserWindow}, url) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)!.webContents.pasteAndMatchStyle(), win.url());
  await expect(input).toContainText('Exact HTML snapshot');
  await win.keyboard.up('Shift');
  await expect(input.getByRole('button',{name:/^Inspect /})).toHaveCount(2);
  await expect(input).toContainText('Exact HTML snapshot');
  // Remove just that text insertion while retaining both badges.
  await input.press('ControlOrMeta+z');
  await expect(input.getByRole('button',{name:/^Inspect /})).toHaveCount(2);
  await composer.getByTestId('thread-command-send').click();
  const chat=win.getByTestId('panel-agent-tab-chat');
  const saved=chat.getByTestId('thread-user-text').first();
  await expect(saved.getByRole('button',{name:'Inspect passage.html (selection)'})).toBeVisible({timeout:30_000});
  await expect(saved).not.toContainText('Exact HTML snapshot');
  await expect(chat.getByTestId('thread-timeline')).toContainText('Response to:',{timeout:30_000});
  await saved.getByRole('button',{name:'Inspect passage.html (selection)'}).click();
  await expect(win.getByRole('dialog',{name:'Copied selection: passage.html (selection)'})).toContainText(html.trim());
  await win.keyboard.press('Escape');
  await chat.getByTestId('thread-command-input').press('ArrowUp');
  await expect(chat.getByTestId('thread-command-input').getByRole('button',{name:/^Inspect /})).toHaveCount(2);
  await chat.getByRole('button',{name:'Open as thread'}).click();
  await expect.poll(() => win.url()).toContain('/threads/');
  await win.reload();
  await expect(win.getByTestId('thread-user-text').first().getByRole('button',{name:'Inspect passage.html (selection)'})).toBeVisible({timeout:30_000});
});

test('thread channel accepts document selections and scoped Add to thread with inspect, convert, remove and undo', async ({ app, home }, testInfo) => {
  test.setTimeout(150_000);
  const win = app.window;
  await win.setViewportSize({ width: 1440, height: 900 });
  await dismissConsentOverlays(win);
  expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }))).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'design-docs')?.status), { timeout: 30_000 }).toBe('running');
  const projectPath = join(home, 'thread-context-qa');
  mkdirSync(projectPath, { recursive: true });
  const snapshot = 'Sales A and Support B have independent credentials and connection state. Every setup and runtime acceptance scenario must cover both. '.repeat(7).trim();
  const { docId, threadId } = await win.evaluate(async ({ projectPath, snapshot }) => {
    const project = await window.cc.projects.add(projectPath);
    if (!project.ok) throw new Error(project.message);
    const doc = await window.cc.pluginApps.callRpc('design-docs', 'create', { title: 'Shared context: thread QA', template: 'technical', projectId: project.value.id }) as { id: string };
    const file = await window.cc.pluginApps.callRpc('design-docs', 'readFile', { doc: doc.id, path: 'README.md' }) as { revision: number; fileId: string };
    await window.cc.pluginApps.callRpc('design-docs', 'writeFile', { doc: doc.id, path: 'README.md', content: `# Data Org connections\n\n${snapshot}`, baseRevision: file.revision, baseFileId: file.fileId });
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: `Review the architecture in this document.\n\n::design-doc{id="${doc.id}"}` })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return { docId: doc.id, threadId: body.thread.id as string };
  }, { projectPath, snapshot });
  await win.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, threadId);
  await expect(win.getByTestId('thread-timeline')).toContainText('Response to:', { timeout: 30_000 });
  await win.getByTitle('Open Shared context: thread QA beside this conversation', { exact: true }).first().click();
  await expect.poll(() => win.url()).toContain(`/threads/${threadId}`);
  const passage = win.locator('.dd-preview-markdown .dd-prose p').first();
  await expect(passage).toHaveText(snapshot);
  const input = win.getByTestId('thread-command-input').first();
  await input.fill('Explain this passage: ');
  await passage.click();
  await passage.evaluate(element => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range);
  });
  await win.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => app.electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(snapshot);
  await input.focus(); await input.press('ControlOrMeta+End'); await input.press('ArrowRight'); await input.press('ControlOrMeta+v');
  const badges = input.getByRole('button', { name: 'Inspect README.md (selection)' });
  await expect(badges).toHaveCount(1);
  await expect(input).not.toContainText('Sales A');
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('thread-selection-badge.png'));
  await badges.first().click();
  const preview = win.getByRole('dialog', { name: 'Copied selection: README.md (selection)' });
  await expect(preview.locator('pre')).toHaveText(snapshot);
  await expect.poll(() => preview.locator('pre').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(preview).toContainText(docId);
  await win.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('thread-selection-preview.png'));
  await win.keyboard.press('Escape');
  await expect(badges.first()).toBeFocused();

  // The source toolbar inserts into its owning thread without using the clipboard.
  await passage.evaluate(element => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range);
  });
  await passage.dispatchEvent('mouseup');
  await win.getByRole('button', { name: 'Add to thread', exact: true }).click();
  await expect(badges).toHaveCount(2);
  await badges.last().click();
  await preview.getByRole('button', { name: 'Convert to text' }).click();
  await expect(badges).toHaveCount(1);
  await expect(input).toContainText(snapshot);
  await input.press('ControlOrMeta+z');
  await expect(badges).toHaveCount(2);
  await expect(input).not.toContainText('Sales A');
  await input.getByRole('button', { name: 'Remove README.md (selection)' }).last().click();
  await expect(badges).toHaveCount(1);
  await input.press('ControlOrMeta+z');
  await expect(badges).toHaveCount(2);

  await app.electron.evaluate(({ clipboard }) => clipboard.writeText(' Ordinary external text.'));
  await input.focus(); await input.press('ControlOrMeta+End'); await input.press('ArrowRight'); await input.press('ControlOrMeta+v');
  await expect(input).toContainText('Ordinary external text.');
  await expect(badges).toHaveCount(2);
  await win.getByTestId('thread-command-send').first().click();
  const message = win.getByTestId('thread-user-text').filter({ hasText: 'Explain this passage:' });
  await expect(message.getByRole('button', { name: 'Inspect README.md (selection)' })).toHaveCount(2);
  await expect(message).not.toContainText('Sales A');
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('thread-selection-sent.png'));
  await win.reload();
  await expect(message.getByRole('button', { name: 'Inspect README.md (selection)' })).toHaveCount(2);
  await expect(passage).toHaveText(snapshot, { timeout: 30_000 });
  await message.getByRole('button', { name: 'Inspect README.md (selection)' }).first().click();
  await expect(preview.locator('pre')).toHaveText(snapshot);
  await win.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('thread-selection-restored.png'));
});
