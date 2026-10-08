import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1', ZCC_GH_BINARY: '/nonexistent/zcc-test-gh' }, isolateBundledCatalog: true });

const LINK_URL = 'https://example.com/zcc-link-click';

test('thread links open the OS browser on click and the side panel on Cmd/Ctrl-click', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, electron, home } = app;
  mkdirSync(join(home, 'link-thread'));
  const root = realpathSync(join(home, 'link-thread'));

  await electron.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as any).__linkClickOpened = opened;
    shell.openExternal = async (url) => { opened.push(url); };
  });
  const externallyOpened = () => electron.evaluate(() => (globalThis as any).__linkClickOpened as string[]);

  const thread = await window.evaluate(async (root) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Link click' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread ?? body.value;
  }, root);

  await window.route((url) => url.pathname === `/api/v1/threads/${thread.id}/timeline`, async (route) => {
    const rows = [{
      id: 'link-response', threadId: thread.id, turnId: 'link-turn', sourceSeqStart: 1, sourceSeqEnd: 1,
      startedAt: Date.now(), createdAt: Date.now(), completedAt: Date.now(),
      kind: 'conversation', role: 'assistant', attachments: null, turnRequest: null,
      text: `I opened [PR #38984](${LINK_URL}) for you.`
    }];
    await route.fulfill({ json: { rows, maxSeq: 1, status: 'idle', activeThinking: null } });
  });
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, thread.id);

  const link = window.getByTestId('thread-assistant-text').getByRole('link', { name: 'PR #38984', exact: true });
  await expect(link).toBeVisible({ timeout: 15_000 });

  // Plain click → system browser, no in-app tab.
  await link.click();
  await expect.poll(externallyOpened).toEqual([LINK_URL]);
  await expect(window.getByTestId('thread-browser-tab')).toHaveCount(0);

  // Cmd/Ctrl-click → in-app side panel, system browser untouched.
  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect(window.getByTestId('thread-secondary-panel')).toBeVisible();
  await expect(window.getByTestId('thread-browser-tab')).toBeVisible();
  await expect(window.getByTestId('thread-browser-address')).toHaveValue(/example\.com\/zcc-link-click/);
  expect(await externallyOpened()).toEqual([LINK_URL]);
});
