import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

// The desktop session denies Chromium's clipboard permission, so the copy
// must go through the main-process clipboard IPC. Read the real system
// clipboard from Electron main to prove the exact text arrived.
test('code block copy button writes the exact fence body to the system clipboard', async ({ app }) => {
  const { window } = app;
  // No trailing spaces: thread messages drop them before rendering
  // (extractInlineThreadImages), so the block never shows them.
  const code = [
    'function greet(name) {',
    '\tconst msg = `Hi ${name} & <friends>`;',
    '    return msg; // it’s fine',
    '}',
    ''
  ].join('\n');
  const path = join(app.home, 'code-copy-project');
  mkdirSync(path, { recursive: true });
  const project = await window.evaluate((path) => window.cc.projects.add(path), path);
  if (!project.ok) throw new Error('Project registration failed');
  // The fake provider replies "Response to: <input>", so the assistant
  // message carries the same fenced block.
  const threadId = await window.evaluate(async ({ projectId, input }) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', title: 'Code copy', input })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).value.id as string;
  }, { projectId: project.value.id, input: 'Here:\n```js\n' + code + '\n```' });
  await window.evaluate((threadId) => {
    history.pushState({}, '', `/threads/${threadId}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);

  const assistant = window.getByTestId('thread-assistant-text').filter({ hasText: 'Response to: Here:' });
  const block = assistant.locator('.inbox-md-codeblock');
  await expect(block).toHaveCount(1);
  const button = block.getByRole('button', { name: 'Copy code' });
  const pre = block.locator('pre');
  // Size, not viewport position: the timeline may still scroll meanwhile.
  const size = async () => {
    const box = await pre.boundingBox();
    return box && { width: box.width, height: box.height };
  };
  const before = await size();

  const clipboard = () => app.electron.evaluate(({ clipboard }) => clipboard.readText());
  await app.electron.evaluate(({ clipboard }) => clipboard.writeText(''));

  // Keyboard: focus reveals the button and Enter activates it.
  await button.focus();
  await expect(button).toHaveCSS('opacity', '1');
  await window.keyboard.press('Enter');
  await expect(block.getByRole('button', { name: 'Copied' })).toBeVisible();
  await expect.poll(clipboard).toBe(code);
  await expect(block.getByRole('button', { name: 'Copy code' })).toBeVisible({ timeout: 5_000 });

  // Mouse: a second copy after the clipboard changed elsewhere.
  await app.electron.evaluate(({ clipboard }) => clipboard.writeText('other'));
  await block.hover();
  await button.click();
  await expect.poll(clipboard).toBe(code);
  expect(await size()).toEqual(before);
  await expect(block.getByRole('button', { name: 'Copy failed' })).toHaveCount(0);
});
