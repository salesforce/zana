import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { test, expect, type AppHandle } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

function createLinkedFiles(home: string) {
  const projectPath = join(home, 'markdown-links');
  mkdirSync(join(projectPath, 'docs'), { recursive: true });
  const root = realpathSync(projectPath);
  const nativePath = join(root, 'docs', 'report one.md');
  writeFileSync(nativePath, '# Local link report\n\nThird line\nFourth line\n');
  const outside = join(home, 'private.md');
  writeFileSync(outside, 'PRIVATE OUTSIDE CONTENT');
  const absolute = nativePath.replace(/\\/gu, '/');
  const prefixed = process.platform === 'win32' ? `/${absolute}` : absolute;
  return { root, nativePath, absolute, prefixed, outside };
}

function linkedResponse({ root, nativePath, absolute, prefixed, outside }: ReturnType<typeof createLinkedFiles>) {
  const link = (label: string, path: string) => `[${label}](<${path}>)`;
  return [
    link('Absolute file', absolute),
    link('Slash-prefixed file', prefixed),
    link('Native separators', nativePath),
    link('File URL', pathToFileURL(nativePath).href),
    link('Encoded spaces', absolute.replace(/ /gu, '%20')),
    link('Third line', `${absolute}:3`),
    link('Fourth line', `${prefixed}#L4`),
    link('Relative file', './docs/report%20one.md'),
    link('Missing file', `${root.replace(/\\/gu, '/')}/missing.md`),
    link('Denied file', outside.replace(/\\/gu, '/')),
    link('Invalid file', 'D:relative.md'),
    '[Web link](https://example.com/local-link-regression)',
    '[Network web link](//example.com/report.md)',
    '[Settings route](/settings)',
    '[Thread route](/threads/abc)',
    '[Bare domain](example.com)',
    '[Bare docs domain](www.github.io)',
    '[Unsafe link](<java&#x09;script:alert(1)//x.md>)'
  ].join('\n\n');
}

async function captureExternalUrls({ electron }: AppHandle) {
  await electron.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as any).__fileLinkExternalUrls = opened;
    shell.openExternal = async (url) => { opened.push(url); };
  });
  return () => electron.evaluate(() => (globalThis as any).__fileLinkExternalUrls as string[]);
}

async function createPreviewThread(window: Page, root: string): Promise<string> {
  return window.evaluate(async (root) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Preview linked files' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id;
  }, root);
}

async function showAssistantLinks(window: Page, threadId: string, text: string) {
  await window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, async (route) => {
    await route.fulfill({ json: {
      rows: [{
        id: 'file-links-response', threadId, turnId: 'links-turn', sourceSeqStart: 1, sourceSeqEnd: 1,
        startedAt: Date.now(), createdAt: Date.now(), completedAt: Date.now(),
        kind: 'conversation', role: 'assistant', attachments: null, turnRequest: null, text
      }], maxSeq: 1, status: 'idle', activeThinking: null
    } });
  });
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
}

async function expectWholeFileLinks(window: Page, threadId: string, message: Locator, panel: Locator) {
  for (const label of ['Absolute file', 'Slash-prefixed file', 'Native separators', 'File URL', 'Encoded spaces', 'Relative file']) {
    const resolution = window.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v1/threads/${threadId}/preview-path/resolve`);
    await message.getByText(label, { exact: true }).click();
    const response = await resolution;
    expect(response.ok(), label).toBe(true);
    expect(await response.json(), label).toEqual({ kind: 'resolved', path: 'docs/report one.md' });
    await expect(panel.getByRole('heading', { name: 'Local link report', exact: true })).toBeVisible();
  }
}

async function expectLineFocusAndModifiedClicks(message: Locator, panel: Locator) {
  await message.getByText('Third line', { exact: true }).click();
  await expect(panel.getByTestId('thread-file-preview-focus-line')).toContainText('Third line');
  await message.getByText('Fourth line', { exact: true }).click();
  await expect(panel.getByTestId('thread-file-preview-focus-line')).toContainText('Fourth line');
  await message.getByText('Absolute file', { exact: true }).click({ button: 'middle' });
  await expect(panel.getByRole('heading', { name: 'Local link report', exact: true })).toBeVisible();
  await expect(panel.getByTestId('thread-file-preview-focus-line')).toHaveCount(0);
  await message.getByText('Absolute file', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
  await expect(panel.getByRole('heading', { name: 'Local link report', exact: true })).toBeVisible();

}

async function expectUnavailableLinks(message: Locator, panel: Locator) {
  for (const [label, error] of [
    ['Missing file', /could not find/i],
    ['Denied file', /path|workspace|access/i],
    ['Invalid file', /invalid or unsupported/i]
  ] as const) {
    const anchor = message.getByText(label, { exact: true });
    await anchor.click();
    await expect(anchor.locator('..').getByRole('status')).toContainText(error);
  }
  await expect(panel).not.toContainText('PRIVATE OUTSIDE CONTENT');
  await expect(message.getByText('Unsafe link', { exact: true })).not.toHaveAttribute('href');
}

async function expectWebNavigation(message: Locator, externalUrls: () => Promise<string[]>) {
  await message.getByRole('link', { name: 'Web link', exact: true }).click();
  await expect.poll(externalUrls).toEqual(['https://example.com/local-link-regression']);
  for (const [label, href] of [
    ['Network web link', '//example.com/report.md'],
    ['Settings route', '/settings'],
    ['Thread route', '/threads/abc'],
    ['Bare domain', 'example.com'],
    ['Bare docs domain', 'www.github.io']
  ]) {
    const anchor = message.getByRole('link', { name: label, exact: true });
    await expect(anchor).toHaveAttribute('href', href);
    const destination = await anchor.evaluate((node: HTMLAnchorElement) => node.href);
    await anchor.click();
    await expect.poll(async () => (await externalUrls()).at(-1)).toBe(destination);
    await expect(anchor.locator('..').getByRole('status')).toHaveCount(0);
  }
}

test('assistant file links open confined previews without native navigation', async ({ app }) => {
  const files = createLinkedFiles(app.home);
  const externalUrls = await captureExternalUrls(app);
  const threadId = await createPreviewThread(app.window, files.root);
  await showAssistantLinks(app.window, threadId, linkedResponse(files));
  const initialUrl = app.window.url();
  const message = app.window.getByTestId('thread-assistant-text');
  const panel = app.window.getByTestId('thread-secondary-panel');
  await expectWholeFileLinks(app.window, threadId, message, panel);
  await expectLineFocusAndModifiedClicks(message, panel);
  await expectUnavailableLinks(message, panel);
  expect(app.window.url()).toBe(initialUrl);
  expect(await externalUrls()).toEqual([]);
  await expectWebNavigation(message, externalUrls);
  expect(app.window.url()).toBe(initialUrl);
});
