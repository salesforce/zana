import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

test('message content stays behind pinned prompts when scrolling between turns', async ({ app }, testInfo) => {
  const { window } = app;
  // Electron's renderer zoom makes CDP's clip coordinates differ from DOM
  // coordinates. Capture the compositor with bounds converted to native DIPs.
  const capture = async (clip: { x: number; y: number; width: number; height: number }) => {
    const nativeWindow = await app.electron.browserWindow(window);
    try {
      const encoded = await nativeWindow.evaluate(async (win, clip) => {
        const zoom = win.webContents.getZoomFactor();
        const x = Math.ceil(clip.x * zoom);
        const y = Math.ceil(clip.y * zoom);
        const image = await win.webContents.capturePage({ x, y,
          width: Math.floor((clip.x + clip.width) * zoom) - x,
          height: Math.floor((clip.y + clip.height) * zoom) - y
        }, { stayHidden: true, stayAwake: true });
        return image.toPNG().toString('base64');
      }, clip);
      return Buffer.from(encoded, 'base64');
    } finally { await nativeWindow.dispose(); }
  };
  await window.setViewportSize({ width: 1100, height: 750 });
  await window.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  const root = join(app.home, 'text-overlap-project');
  mkdirSync(root);
  const threadId = await window.evaluate(async (root) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Initial turn' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, realpathSync(root));
  await expect.poll(() => window.evaluate(async id =>
    (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toBe('idle');

  const reply = 'The broader suite has reported failures in the portable-provider guard and the Design Docs peer-group tests. Neither file was changed for this fix. I’ll inspect those results separately from the plugin recovery checks before reporting the final verification status.';
  const rows = Array.from({ length: 3 }, (_, turn) => ['user', 'assistant'].map((role, part) => ({
    id: `${role}-${turn}`, threadId, turnId: `turn-${turn}`,
    sourceSeqStart: turn * 2 + part + 1, sourceSeqEnd: turn * 2 + part + 1,
    createdAt: 1, startedAt: 1, completedAt: 1, kind: 'conversation', role,
    text: role === 'user' ? `Implement and fix this ${turn}` : Array(10).fill(reply).join('\n\n'),
    attachments: null,
    ...(role === 'user' ? {
      initiator: 'user', senderThreadId: null, systemMessageKind: 'unlabeled', systemMessageSubject: null,
      mentions: [], turnRequest: { isGrouped: false, kind: 'message', status: 'accepted' }
    } : { turnRequest: null })
  }))).flat();
  await window.route(url => url.pathname === `/api/v1/threads/${threadId}/timeline`, route =>
    route.fulfill({ json: { rows, maxSeq: 6, status: 'idle', activeThinking: null } }));
  await window.evaluate(id => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const timeline = window.getByTestId('thread-timeline');
  await expect(timeline.getByTestId('thread-user-text')).toHaveCount(3);
  // Plugin markdown renderers may create their own stacking layers. Their
  // prose must stay inside the message's layer even when it is not hovered.
  await timeline.locator('.is-assistant .inbox-md').evaluateAll(nodes => {
    nodes.forEach(node => Object.assign((node as HTMLElement).style, { position: 'relative', zIndex: '10' }));
  });

  for (const theme of ['light', 'dark'] as const) {
    await window.evaluate(theme => window.cc.config.set({ theme }), theme);
    await expect(window.locator('html')).toHaveAttribute('data-theme', theme);
    for (const turn of [0, 1]) {
      const prompt = timeline.locator(`[data-row-id="user-${turn}"]`);
      const item = prompt.locator('..');
      const assistant = timeline.locator(`[data-row-id="assistant-${turn}"]`);
      // Place the reply behind the pinned prompt, including the end of a turn
      // where the next prompt pushes the old one out of the scrollport.
      for (const fraction of [0.3, 0.9]) {
        await item.evaluate((node, fraction) => {
          const pane = node.closest<HTMLElement>('[data-testid="thread-timeline"]')!;
          const turn = node.parentElement!;
          pane.scrollTop = 0;
          pane.scrollTop = turn.getBoundingClientRect().top - pane.getBoundingClientRect().top
            + turn.clientHeight * fraction;
        }, fraction);
        await expect(item).toHaveCSS('position', 'sticky');
        await window.mouse.move(10, 10);
        for (const interaction of ['rest', 'focus'] as const) {
          if (interaction === 'focus') {
            await assistant.locator('.thread-message-action').first().evaluate(node => node.focus({ preventScroll: true }));
          } else {
            await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          }
          await expect.poll(() => item.evaluate(node => {
            const pane = node.closest('[data-testid="thread-timeline"]')!.getBoundingClientRect();
            const rect = node.getBoundingClientRect();
            const y = Math.max(rect.top, pane.top) + 16;
            if (y >= Math.min(rect.bottom, pane.bottom)) return true;
            return node.contains(document.elementFromPoint(rect.left + 30, y));
          })).toBe(true);
          // Hit-testing alone misses translucent or incorrectly composited text.
          // Removing the reply's paint must leave the pinned prompt identical.
          const clip = await item.evaluate(node => {
            const pane = node.closest('[data-testid="thread-timeline"]')!.getBoundingClientRect();
            const rect = node.getBoundingClientRect();
            const y = Math.max(rect.top, pane.top);
            return { x: rect.left, y, width: rect.width, height: Math.min(rect.bottom, pane.bottom) - y };
          });
          if (clip.height > 0) {
            const before = await capture(clip);
            await timeline.getByTestId('thread-assistant-text').evaluateAll(nodes => {
              nodes.forEach(node => (node as HTMLElement).style.visibility = 'hidden');
            });
            const withoutReplies = await capture(clip);
            await timeline.getByTestId('thread-assistant-text').evaluateAll(nodes => {
              nodes.forEach(node => (node as HTMLElement).style.removeProperty('visibility'));
            });
            if (!before.equals(withoutReplies)) {
              await testInfo.attach('prompt-with-replies', { body: before, contentType: 'image/png' });
              await testInfo.attach('prompt-without-replies', { body: withoutReplies, contentType: 'image/png' });
            }
            expect(before.equals(withoutReplies), `${theme} ${interaction} turn ${turn} at ${fraction}: ${JSON.stringify(clip)}`).toBe(true);
          }
        }
      }
      // The reply's controls extend into the next prompt. They must retain
      // their hit area without raising the reply's prose along with them.
      await assistant.evaluate(reply => {
        const pane = reply.closest<HTMLElement>('[data-testid="thread-timeline"]')!;
        pane.scrollTop += reply.getBoundingClientRect().bottom - pane.getBoundingClientRect().top - 180;
      });
      const action = assistant.locator('.thread-message-action').first();
      await action.evaluate(node => node.focus({ preventScroll: true }));
      await expect.poll(() => action.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      })).toBe(true);
    }
  }
  await window.screenshot({ path: testInfo.outputPath('thread-text-layering.png') });
});
