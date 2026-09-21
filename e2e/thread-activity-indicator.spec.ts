import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

test('live activity is compact, singular, keyboard accessible and motion-aware', async ({ app }, testInfo) => {
  const { window, home } = app;
  mkdirSync(join(home, 'activity-project'));
  const threadId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'delay:60000 review the activity indicator' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, realpathSync(join(home, 'activity-project')));

  // Replay deterministic presentation states through the real timeline renderer.
  let phase: 'compaction' | 'thinking' | 'working' | 'stopped' = 'compaction';
  await window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, async (route) => {
    // Let the real interruption confirmation settle the optimistic Stop row.
    if (phase === 'stopped') { await route.continue(); return; }
    const response = await route.fetch();
    const body = await response.json();
    const now = Date.now();
    body.rows = [{
      id: 'activity-operation', threadId, turnId: null, sourceSeqStart: 1, sourceSeqEnd: 1,
      startedAt: now - 5000, createdAt: now - 5000,
      kind: 'system', systemKind: 'operation', operationKind: 'compaction',
      title: phase === 'compaction' ? 'Compacting context' : 'Context compacted',
      detail: null, status: phase === 'compaction' ? 'pending' : 'completed',
      completedAt: phase === 'compaction' ? null : now
    }];
    body.activeThinking = phase === 'thinking'
      ? { id: 'thinking', text: 'Reviewing the files before making changes.', startedAt: now, updatedAt: now }
      : null;
    await route.fulfill({ response, json: body });
  });
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const detail = window.getByTestId('thread-detail');
  const timeline = detail.getByTestId('thread-timeline');
  const activity = timeline.locator('.thread-activity-label');
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveText('Compacting context');
  await expect(timeline.getByTestId('thread-thinking')).toHaveCount(0);
  await expect(timeline.getByRole('status')).toHaveText('Compacting context');
  expect(await activity.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThanOrEqual(34);
  const dot = activity.locator('.thread-activity-dot');
  await expect(dot).toHaveAttribute('aria-hidden', 'true');
  await expect(dot).toHaveCSS('animation-name', 'thread-activity-pulse');

  for (const theme of ['light', 'dark']) {
    await window.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), theme);
    await detail.screenshot({ path: testInfo.outputPath(`activity-${theme}.png`) });
  }
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await expect(dot).toHaveCSS('animation-name', 'none');
  await expect(activity).toHaveText('Compacting context');

  phase = 'thinking';
  await window.reload();
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveText('Thinking…');
  const disclosure = timeline.locator('.thread-working-indicator > summary');
  await disclosure.focus();
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveCSS('outline-style', 'solid');
  await window.keyboard.press('Enter');
  await expect(timeline.locator('.thread-thinking-details')).toBeVisible();
  await expect(timeline.locator('.thread-thinking-details')).toHaveText('Reviewing the files before making changes.');
  await detail.screenshot({ path: testInfo.outputPath('activity-thinking.png') });
  await window.keyboard.press('Enter');
  await expect(timeline.locator('.thread-thinking-details')).toBeHidden();

  phase = 'working';
  await window.reload();
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveText('Planning next move…');
  await expect(disclosure).toHaveCount(0);
  phase = 'stopped';
  await window.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(activity).toHaveCount(0);
});
