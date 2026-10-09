import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('thread timeline refreshes throughout continuous provider events and renders the final update', async ({ app }) => {
  test.setTimeout(60_000);
  const { window } = app;
  const id = await window.evaluate(async () => {
    const project = (await window.cc.projects.list())[0];
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, providerId: 'codex', input: 'Refresh fixture ready' }) });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  });
  await expect.poll(() => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id)).toBe('idle');
  await window.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  const detail = window.getByTestId('thread-detail');
  const timeline = detail.getByTestId('thread-timeline');
  await expect(timeline).toContainText('Response to: Refresh fixture ready');
  let reads = 0;
  window.on('request', request => {
    if (new URL(request.url()).pathname === `/api/v1/threads/${id}/timeline`) reads++;
  });
  await detail.getByTestId('thread-command-input').fill('stream_refresh:10000');
  await detail.getByTestId('thread-command-send').click();
  // A trailing-only 100ms debounce shows no progress while these events continue.
  await expect(timeline).toContainText('Refresh progress', { timeout: 4000 });
  const progress = () => timeline.evaluate(node => Math.max(0,
    ...Array.from((node.textContent ?? '').matchAll(/Refresh progress (\d+)/g), match => Number(match[1]))
  ));
  // Verify successive visible updates, rather than a fixed request rate that
  // depends on the runner's response and rendering speed.
  let previous = await progress();
  for (let checkpoint = 0; checkpoint < 3; checkpoint++) {
    await expect.poll(progress, { timeout: 3000 }).toBeGreaterThan(previous);
    previous = await progress();
    expect(await window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id)).toBe('active');
  }
  const duringStream = reads;
  expect(await window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id)).toBe('active');
  await expect(timeline).toContainText('Refresh stream complete', { timeout: 15_000 });
  await expect.poll(() => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id)).toBe('idle');
  // The timer is a maximum wait, not a fixed polling rate. Require further
  // reads after the active-stream checkpoint and the final visible update.
  expect(reads).toBeGreaterThan(duringStream);
  await window.getByTestId('nav-home').click();
  // Unmount cancels pending refresh timers even if a late provider notification arrives.
  await window.waitForTimeout(300);
  const afterUnmount = reads;
  await window.waitForTimeout(500);
  expect(reads).toBe(afterUnmount);
});
