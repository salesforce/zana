import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import { test, expect } from './fixtures/app.js';
import { CONVERSATION_READ_RETRIES, CONVERSATION_READ_TIMEOUT_MS } from '../apps/app/src/lib/conversation-read.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

// Gates are released in each test's finally block. Drain their route handlers
// while the page is alive so response reads cannot outlive fixture teardown.
test.afterEach(async ({ app }) => {
  await app.window.unrouteAll({ behavior: 'wait' });
});

async function createLoadingThread(window: Page, home: string) {
  const projectPath = join(home, 'loading-project');
  mkdirSync(projectPath);
  const threadId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Hello from the loading test' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread.id as string;
  }, realpathSync(projectPath));
  // Cold provider-worker startup on a shared CI runner can exceed the normal
  // UI assertion budget. Keep the setup bounded and require actual completion.
  await expect.poll(() => window.evaluate(async (id) => {
    return (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status;
  }, threadId), { timeout: 45_000 }).toBe('idle');
  return threadId;
}

test('thread loading is illustrated, motion-aware, and settles on success, failure, and retry', async ({ app }, testInfo) => {
  const { window, home } = app;
  const threadId = await createLoadingThread(window, home);

  let release = () => {};
  let gate = new Promise<void>((resolve) => { release = resolve; });
  let phase: 'loaded' | 'error' | 'empty' = 'loaded';
  await window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, async (route) => {
    if (phase === 'error') {
      await route.fulfill({ status: 503, json: { error: 'Conversation temporarily unavailable' } });
      return;
    }
    const response = await route.fetch();
    const body = await response.json();
    await gate;
    await route.fulfill({ response, json: phase === 'empty' ? { ...body, rows: [], maxSeq: 0 } : body });
  });
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);

  const detail = window.getByTestId('thread-detail');
  const timeline = detail.getByTestId('thread-timeline');
  const loading = timeline.getByTestId('thread-loading');
  try {
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('role', 'status');
    await expect(timeline).toHaveAttribute('aria-busy', 'true');
    await expect(timeline).not.toContainText('Waiting for the first turn');
    await expect(timeline.locator('.thread-working-indicator')).toHaveCount(0);
    await expect(loading.locator('.pane-empty-loading-lines span').first()).toHaveCSS('animation-name', 'pane-empty-loading-line');

    // Metadata can update the surrounding layout during the entrance animation;
    // measure both centers in the same frame and wait for that layout to settle.
    await expect.poll(() => timeline.evaluate((node) => {
      const pane = node.getBoundingClientRect();
      const art = node.querySelector('.pane-empty-art')!.getBoundingClientRect();
      return Math.abs(art.x + art.width / 2 - (pane.x + pane.width / 2));
    })).toBeLessThan(4);
    const paneBox = await timeline.boundingBox();
    const artBox = await loading.locator('.pane-empty-art').boundingBox();
    expect(paneBox).not.toBeNull();
    expect(artBox).not.toBeNull();
    expect(artBox!.y).toBeGreaterThan(paneBox!.y + paneBox!.height * 0.15);

    for (const theme of ['light', 'dark']) {
      await window.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
      await detail.screenshot({ path: testInfo.outputPath(`thread-loading-${theme}.png`) });
    }
    await window.emulateMedia({ reducedMotion: 'reduce' });
    await expect(loading).toHaveCSS('animation-name', 'none');
    await expect(loading.locator('.pane-empty-loading-lines span').first()).toHaveCSS('animation-name', 'none');
    expect(await loading.locator('.pane-empty-well').evaluate((node) =>
      getComputedStyle(node, '::before').animationName
    )).toBe('none');
  } finally {
    release();
  }
  await expect(loading).toHaveCount(0);
  await expect(timeline).toHaveAttribute('aria-busy', 'false');
  await expect(timeline).toContainText('Response to: Hello from the loading test');

  phase = 'error';
  await window.reload();
  const error = detail.getByTestId('thread-timeline-load-error');
  await expect(error).toBeVisible();
  await expect(loading).toHaveCount(0);
  await expect(timeline).not.toContainText('Waiting for the first turn');

  phase = 'empty';
  gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await error.getByRole('button', { name: 'Retry' }).click();
    await expect(loading).toBeVisible();
    await expect(error).toHaveCount(0);
  } finally {
    release();
  }
  await expect(loading).toHaveCount(0);
  await expect(timeline).toContainText('Waiting for the first turn…');
  await expect(timeline).toHaveAttribute('aria-busy', 'false');
});

for (const outcome of ['success', 'failure'] as const) {
  test(`thread timeline ${outcome} is shown while metadata is still loading`, async ({ app }) => {
    const { window, home } = app;
    const threadId = await createLoadingThread(window, home);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let metadataRequested = false;
    let metadataReleased = false;
    await window.route((url) => url.pathname === `/api/v1/threads/${threadId}`, async (route) => {
      metadataRequested = true;
      const response = await route.fetch();
      const body = await response.json();
      await gate;
      metadataReleased = true;
      await route.fulfill({ response, json: { ...body, thread: { ...body.thread, title: 'Metadata arrived' } } });
    });
    if (outcome === 'failure') {
      await window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, (route) =>
        route.fulfill({ status: 503, json: { error: 'Conversation temporarily unavailable' } }));
    }
    try {
      await window.evaluate((id) => {
        history.pushState({}, '', `/threads/${id}`);
        dispatchEvent(new PopStateEvent('popstate'));
      }, threadId);
      await expect.poll(() => metadataRequested).toBe(true);
      const timeline = window.getByTestId('thread-detail').getByTestId('thread-timeline');
      if (outcome === 'success') {
        await expect(timeline).toContainText('Response to: Hello from the loading test');
      } else {
        await expect(window.getByTestId('thread-detail').getByTestId('thread-timeline-load-error')).toBeVisible();
      }
      await expect(timeline).toHaveAttribute('aria-busy', 'false');
      await expect(timeline.getByTestId('thread-loading')).toHaveCount(0);
      expect(metadataReleased).toBe(false);
    } finally {
      release();
    }
    await expect(window.getByTestId('thread-detail').getByText('Metadata arrived', { exact: true })).toBeVisible();
  });
}

test('unanswered conversation requests time out and Retry recovers without reopening the thread', async ({ app }) => {
  const { window, home } = app;
  const threadId = await createLoadingThread(window, home);
  let recovering = false;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const failedReads: string[] = [];
  window.on('requestfailed', (request) => {
    if (request.url().includes(`/threads/${threadId}`)) failedReads.push(new URL(request.url()).pathname);
  });
  await window.route((url) => [
    `/api/v1/threads/${threadId}`, `/api/v1/threads/${threadId}/timeline`
  ].includes(url.pathname), async (route) => {
    if (recovering) return route.continue();
    const response = await route.fetch();
    await gate;
    // The renderer cancels these requests at its deadline; tolerate cleanup of
    // an already-aborted route after the successful retry has been displayed.
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await window.evaluate((id) => {
      history.pushState({}, '', `/threads/${id}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, threadId);
    const detail = window.getByTestId('thread-detail');
    const timeline = detail.getByTestId('thread-timeline');
    const error = detail.getByTestId('thread-timeline-load-error');
    await expect(timeline.getByTestId('thread-loading')).toBeVisible();
    // Each automatic retry gets its own read deadline before the error appears.
    await expect(error).toContainText('The server is taking too long', {
      timeout: CONVERSATION_READ_TIMEOUT_MS * (CONVERSATION_READ_RETRIES + 1) + 10_000
    });
    await expect(timeline).toHaveAttribute('aria-busy', 'false');
    await expect(timeline.getByTestId('thread-loading')).toHaveCount(0);
    await expect.poll(() => new Set(failedReads).size).toBe(2);
    await expect(detail.locator('.thread-detail-header')).not.toContainText('Working');

    recovering = true;
    await error.getByRole('button', { name: 'Retry' }).click();
    await expect(timeline).toContainText('Response to: Hello from the loading test');
    await expect(error).toHaveCount(0);
  } finally {
    release();
  }
});

test('a background refresh keeps the retryable error visible until the conversation recovers', async ({ app }) => {
  const { window, home } = app;
  const threadId = await createLoadingThread(window, home);
  let refresh = false;
  let refreshRequested = false;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, async (route) => {
    if (!refresh) return route.fulfill({ status: 503, json: { error: 'Conversation temporarily unavailable' } });
    refreshRequested = true;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await window.evaluate((id) => {
      history.pushState({}, '', `/threads/${id}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, threadId);
    const detail = window.getByTestId('thread-detail');
    const error = detail.getByTestId('thread-timeline-load-error');
    await expect(error).toBeVisible();
    refresh = true;
    // A real server event invokes the same coalesced refresh used by streamed
    // conversation updates, while its replacement timeline request is held.
    await window.evaluate(async (id) => {
      await fetch(`/api/v1/threads/${id}/read`, { method: 'POST' });
    }, threadId);
    await expect.poll(() => refreshRequested).toBe(true);
    await expect(error).toBeVisible();
    await expect(detail.getByTestId('thread-loading')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(window.getByTestId('thread-timeline')).toContainText('Response to: Hello from the loading test');
  await expect(window.getByTestId('thread-timeline-load-error')).toHaveCount(0);
});

test('leaving a conversation cancels its pending reads immediately', async ({ app }) => {
  const { window, home } = app;
  const threadId = await createLoadingThread(window, home);
  const timelinePath = `/api/v1/threads/${threadId}/timeline`;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let aborted = false;
  window.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname === timelinePath) aborted = true;
  });
  await window.route((url) => url.pathname === timelinePath, async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await window.evaluate((id) => {
      history.pushState({}, '', `/threads/${id}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, threadId);
    await expect(window.getByTestId('thread-loading')).toBeVisible();
    await window.evaluate(() => {
      history.pushState({}, '', '/');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(window.getByTestId('thread-detail')).toHaveCount(0);
    await expect.poll(() => aborted, { timeout: 3_000 }).toBe(true);
  } finally {
    release();
  }
});

test('opening a tool-heavy thread fetches output only for the expanded row', async ({ app }, testInfo) => {
  const { window, home } = app;
  const threadId = await createLoadingThread(window, home);
  const outputCount = 80;
  const rows: TimelineRow[] = Array.from({ length: outputCount }, (_, index) => ({
    id: `command-${index}`, threadId, turnId: 'large-turn',
    sourceSeqStart: index + 1, sourceSeqEnd: index + 1,
    startedAt: index + 1, createdAt: index + 1, completedAt: index + 2,
    kind: 'work', workKind: 'command', status: 'completed', callId: `call-${index}`,
    command: `npm run check-${index}`, cwd: home, source: null,
    output: 'Preview line\n'.repeat(400), outputPreview: { totalChars: 50_000 },
    exitCode: 0, approvalStatus: null, activityIntents: []
  }));
  rows.push({
    id: 'answer', threadId, turnId: 'large-turn', sourceSeqStart: outputCount + 1, sourceSeqEnd: outputCount + 1,
    startedAt: outputCount + 1, createdAt: outputCount + 1,
    kind: 'conversation', role: 'assistant', text: 'All checks are complete.', attachments: null, turnRequest: null
  });
  await window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, (route) =>
    route.fulfill({ json: { rows, maxSeq: outputCount + 1, status: 'idle', activeThinking: null } }));
  const outputRequests: string[] = [];
  await window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline/turn-summary-details`, (route) => {
    const seq = new URL(route.request().url()).searchParams.get('sourceSeqStart');
    outputRequests.push(seq ?? '');
    const row = rows.find((row) => String(row.sourceSeqStart) === seq);
    return route.fulfill({ json: { rows: row ? [{ ...row, output: `Full output for ${row.id}\n${'Result line\n'.repeat(5_000)}\nOutput complete` }] : [] } });
  });
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const timeline = window.getByTestId('thread-detail').getByTestId('thread-timeline');
  await expect(timeline).toContainText('All checks are complete.');
  // React effects have flushed by the time the row is interactive. The hidden
  // bundle and its 80 preview bodies must not start any detail requests.
  const bundle = timeline.getByTestId('thread-work-row').first();
  await expect(bundle.locator('> button')).toHaveAttribute('aria-expanded', 'false');
  expect(outputRequests).toEqual([]);
  await bundle.locator('> button').click();
  const first = timeline.locator('[data-row-id="command-0"]');
  await expect(first).toBeVisible();
  expect(outputRequests).toEqual([]);
  await first.locator('> button').click();
  await expect(first).toContainText('Full output for command-0');
  await expect(first).toContainText('Output complete');
  expect(outputRequests).toEqual(['1']);
  await first.locator('> button').click();
  await expect(first.locator('> button')).toHaveAttribute('aria-expanded', 'false');
  await first.locator('> button').click();
  await expect(first).toContainText('Output complete');
  expect(outputRequests).toEqual(['1']);
  await testInfo.attach('thread-output-requests', {
    contentType: 'application/json', body: JSON.stringify({ outputCount, requestsOnOpen: 0, requestsAfterExpansion: outputRequests.length })
  });
});
