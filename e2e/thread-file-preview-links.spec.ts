import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, type AppHandle } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

function fileFixtures(home: string) {
  const canonicalHome = realpathSync.native ? realpathSync.native(home) : realpathSync(home);
  const root = join(canonicalHome, 'markdown-link-project');
  const outside = join(canonicalHome, 'private-files');
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  const report = join(root, 'docs', 'report.md');
  const spaced = join(root, 'docs', 'שלום report.md');
  const posixColon = process.platform === 'win32' ? null : join(root, 'docs', 'report.v1:2026.md');
  writeFileSync(report, '# File link regression\n\nLine three\nLine four\n');
  writeFileSync(spaced, '# Unicode report\n\nSpaced file content\n');
  if (posixColon) writeFileSync(posixColon, '# POSIX colon filename\n\nLiteral colon content\n');
  writeFileSync(join(outside, 'secret.md'), 'PRIVATE CONTENT MUST NOT APPEAR');
  symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  return { root, report, spaced, outside, posixColon };
}

function assistantMarkdown(files: ReturnType<typeof fileFixtures>) {
  const absolute = files.report.replace(/\\/gu, '/');
  const links: [string, string][] = [
    ['Absolute', absolute], ['Relative', 'docs/report.md'],
    ['File URL', pathToFileURL(files.report).href],
    ['Heading fragment', `${absolute}#List`],
    ['Colon line', `${absolute}:3`], ['Hash line', `${pathToFileURL(files.report).href}#L4`],
    ['Encoded space', pathToFileURL(files.spaced).href],
    ['Angle space', `<${files.spaced.replace(/\\/gu, '/')}>`],
    ['Missing', 'docs/missing.md'], ['Outside', `${files.outside.replace(/\\/gu, '/')}/secret.md`],
    ['Symlink escape', 'escape/secret.md'], ['Invalid', `${absolute}:0`],
    ['Traversal', 'docs/../docs/report.md'], ['Encoded separator', 'docs/a%2fb.md'],
    ['Web', 'https://example.com/file-link-regression'], ['Domain', 'example.com'],
    ['Protocol relative', '//example.com/report.md'], ['App route', '/threads/other-thread'],
    ['Protocol relative workspace', '//workspace/volumes/repo/guide.md']
  ];
  if (process.platform === 'win32') links.push(['Slash drive', `/${absolute}`]);
  if (files.posixColon) links.push(['POSIX colon', files.posixColon], ['POSIX colon URL', pathToFileURL(files.posixColon).href]);
  return links.map(([label, href]) => `[${label}](${href})`).join('\n\n');
}

async function showAssistantLinks(app: AppHandle, root: string, text: string) {
  const threadId = await app.window.evaluate(async (root) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'File link regression' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, root);
  await app.window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, async (route) => {
    await route.fulfill({ json: {
      rows: [{
        id: 'file-links', threadId, turnId: 'file-links-turn', sourceSeqStart: 1, sourceSeqEnd: 1,
        startedAt: Date.now(), createdAt: Date.now(), completedAt: Date.now(), kind: 'conversation',
        role: 'assistant', attachments: null, turnRequest: null, text
      }], maxSeq: 1, status: 'idle', activeThinking: null
    } });
  });
  await app.window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
}

function link(app: AppHandle, label: string) {
  return app.window.getByTestId('thread-assistant-text').getByText(label, { exact: true });
}

async function checkPreviews(app: AppHandle) {
  const { window } = app;
  const panel = window.getByTestId('thread-secondary-panel');
  const labels = ['Absolute', 'Relative', 'File URL', 'Heading fragment'];
  if (process.platform === 'win32') labels.push('Slash drive');
  for (const label of labels) {
    await link(app, label).click();
    await expect(panel.getByRole('heading', { name: 'File link regression', exact: true })).toBeVisible();
  }
  for (const [label, line] of [['Colon line', 'Line three'], ['Hash line', 'Line four']] as const) {
    await link(app, label).click();
    await expect(panel.getByTestId('thread-file-preview-focus-line')).toContainText(line);
  }
  await link(app, 'Absolute').click({ modifiers: ['ControlOrMeta'] });
  await expect(panel.getByTestId('thread-file-preview-focus-line')).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'File link regression', exact: true })).toBeVisible();
  await link(app, 'Relative').click({ button: 'middle' });
  await expect(panel.getByRole('heading', { name: 'File link regression', exact: true })).toBeVisible();
  await link(app, 'File URL').focus();
  await link(app, 'File URL').press('Enter');
  for (const label of ['Encoded space', 'Angle space']) {
    await link(app, label).click();
    await expect(panel.getByRole('heading', { name: 'Unicode report', exact: true })).toBeVisible();
  }
  if (process.platform !== 'win32') {
    for (const label of ['POSIX colon', 'POSIX colon URL']) {
      await link(app, label).click();
      await expect(panel.getByRole('heading', { name: 'POSIX colon filename', exact: true })).toBeVisible();
    }
  }
}

async function checkErrors(app: AppHandle) {
  for (const label of ['Missing', 'Outside', 'Symlink escape', 'Invalid', 'Traversal', 'Encoded separator']) {
    const target = link(app, label);
    await target.click();
    const status = target.locator('..').getByRole('status');
    await expect(status).toBeVisible();
    await expect(status).toContainText(/could not|cannot|outside|denied|allowed|invalid|not found|not inside/iu);
  }
  await expect(app.window.getByTestId('thread-secondary-panel')).not.toContainText('PRIVATE CONTENT MUST NOT APPEAR');
}

test('assistant file links use authorized thread previews on the native desktop OS', async ({ app }) => {
  test.setTimeout(120_000);
  const files = fileFixtures(app.home);
  await app.electron.evaluate(({ shell }) => {
    (globalThis as any).__fileLinkExternal = [];
    shell.openExternal = async (url) => { (globalThis as any).__fileLinkExternal.push(url); };
  });
  const external = () => app.electron.evaluate(() => (globalThis as any).__fileLinkExternal as string[]);
  await showAssistantLinks(app, files.root, assistantMarkdown(files));
  const location = app.window.url();
  await checkPreviews(app);
  await checkErrors(app);
  expect(app.window.url()).toBe(location);
  expect(await external()).toEqual([]);
  for (const label of ['Web', 'Domain', 'Protocol relative', 'App route', 'Protocol relative workspace']) {
    const target = link(app, label);
    const expectedUrl = await target.evaluate((node: HTMLAnchorElement) => node.href);
    await target.click();
    await expect.poll(async () => (await external()).at(-1)).toBe(expectedUrl);
  }
});
