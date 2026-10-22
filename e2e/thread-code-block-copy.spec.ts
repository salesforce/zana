import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import { test, expect, type AppHandle } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

// No trailing spaces: thread messages drop them before rendering
// (extractInlineThreadImages), so the block never shows them.
const CODE = [
  'function greet(name) {',
  '\tconst msg = `Hi ${name} & <friends>`;',
  '    return msg; // it’s fine',
  '}',
  ''
].join('\n');

/** Start a fake-provider thread, which replies "Response to: <input>", and open it. */
async function openThreadEchoing(app: AppHandle, input: string): Promise<void> {
  const page = app.window;
  const path = join(app.home, 'code-copy-project');
  mkdirSync(path, { recursive: true });
  const project = await page.evaluate((path) => window.cc.projects.add(path), path);
  if (!project.ok) throw new Error('Project registration failed');
  const threadId = await page.evaluate(async ({ projectId, input }) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', title: 'Code copy', input })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).value.id as string;
  }, { projectId: project.value.id, input });
  await page.evaluate((threadId) => {
    history.pushState({}, '', `/threads/${threadId}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
}

// The desktop session denies Chromium's clipboard permission, so the copy
// must go through the main-process clipboard IPC. Read and reset the real
// system clipboard from Electron main to prove the exact text arrived.
function systemClipboard(app: AppHandle) {
  return {
    read: () => app.electron.evaluate(({ clipboard }) => clipboard.readText()),
    write: (text: string) => app.electron.evaluate(({ clipboard }, text) => clipboard.writeText(text), text)
  };
}

/** Size, not viewport position: the timeline may still scroll meanwhile. */
async function blockSize(pre: Locator) {
  const box = await pre.boundingBox();
  return box && { width: box.width, height: box.height };
}

test('code block copy button writes the exact fence body to the system clipboard', async ({ app }) => {
  await openThreadEchoing(app, 'Here:\n```js\n' + CODE + '\n```');
  const assistant = app.window.getByTestId('thread-assistant-text').filter({ hasText: 'Response to: Here:' });
  const block = assistant.locator('.inbox-md-codeblock');
  await expect(block).toHaveCount(1);
  const button = block.getByRole('button', { name: 'Copy code' });
  const pre = block.locator('pre');
  const before = await blockSize(pre);
  const clipboard = systemClipboard(app);
  await clipboard.write('');

  // Keyboard: focus reveals the button and Enter activates it.
  await button.focus();
  await expect(button).toHaveCSS('opacity', '1');
  await app.window.keyboard.press('Enter');
  await expect(button).toHaveAttribute('data-state', 'copied');
  await expect(block.getByRole('status')).toHaveText('Copied');
  await expect.poll(clipboard.read).toBe(CODE);
  await expect(button).toHaveAttribute('data-state', 'idle', { timeout: 5_000 });

  // Mouse: a second copy after the clipboard changed elsewhere.
  await clipboard.write('other');
  await block.hover();
  await button.click();
  await expect.poll(clipboard.read).toBe(CODE);
  expect(await blockSize(pre)).toEqual(before);
  await expect(button).not.toHaveAttribute('data-state', 'failed');
});
