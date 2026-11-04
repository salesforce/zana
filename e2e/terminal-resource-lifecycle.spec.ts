import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true, inAppAgentTerminalsEnabled: true } });

test('closing side-panel terminal tabs stops and removes their shells', async ({ app }) => {
  const { window: page, home } = app;
  const root = join(home, 'close-tab-analysis');
  mkdirSync(root);
  const { projectId, threadId } = await page.evaluate(async (root) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Closed shell analysis' }) });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return { projectId: project.value.id, threadId: (body.thread ?? body.value).id as string };
  }, root);
  await page.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, threadId);
  await expect(page.getByRole('heading', { name: 'Closed shell analysis', exact: true })).toBeVisible();
  const show = page.getByTestId('thread-secondary-show');
  if (await show.isVisible()) await show.click();
  const ids: string[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      await openThreadToolLauncher(page);
      await page.getByTestId('thread-new-tab-terminal').click();
      await expect(page.getByTestId('thread-terminal-tab').locator('.xterm:visible')).toHaveCount(1, { timeout: 15000 });
      const id = await page.evaluate(async ({ projectId, previous }) => {
        const { sessions } = await (await fetch('/api/v1/terminals')).json();
        const shell = sessions.find((s: any) => s.profile === 'shell' && s.projectId === projectId && !previous.includes(s.id));
        if (!shell) throw new Error('Missing new shell');
        return shell.id as string;
      }, { projectId, previous: ids });
      ids.push(id);
      await page.getByRole('button', { name: 'Close Terminal', exact: true }).click();
      await expect(page.getByTestId('thread-terminal-tab')).toHaveCount(0);
    }
    const sessions = await page.evaluate(async () => (await (await fetch('/api/v1/terminals')).json()).sessions);
    expect(sessions.filter((s: any) => ids.includes(s.id) && s.status !== 'exited')).toHaveLength(0);
    await expect.poll(() => page.locator('.xterm').count()).toBe(0);
  } finally {
    await page.evaluate(async ids => { for (const id of ids) await fetch(`/api/v1/terminals/${id}/close`, { method: 'POST' }); }, ids);
  }
});

test('six concurrent agent opens reuse three shells and main also enforces the owner budget', async ({ app }) => {
  const { window: page, home } = app;
  const root = join(home, 'bounded-opens'); mkdirSync(root);
  const { projectId, threadId } = await page.evaluate(async root => {
    const project = await window.cc.projects.add(root); if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Bounded shell opens' }) });
    const body = await response.json(); if (!response.ok) throw new Error(JSON.stringify(body));
    return { projectId: project.value.id, threadId: body.thread.id as string };
  }, root);
  await page.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, threadId);
  await expect(page.getByRole('heading', { name: 'Bounded shell opens', exact: true })).toBeVisible();
  const open = (title: string) => page.evaluate(async ({ id, title }) => {
    const response = await fetch(`/api/v1/threads/${id}/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ terminal: { title } }) });
    if (!response.ok) throw new Error(await response.text());
  }, { id: threadId, title });
  try {
    await Promise.all(Array.from({ length: 6 }, (_, i) => open(`Burst ${i}`)));
    await expect(page.getByRole('button', { name: /^Close Burst \d$/ })).toHaveCount(3, { timeout: 30000 });
    const live = await page.evaluate(async id => (await window.cc.terminals.list(id)).filter(s => s.title.startsWith('Burst ') && s.status !== 'exited'), projectId);
    expect(live).toHaveLength(3);
    const denied = await page.evaluate(async ({ projectId, threadId }) => Promise.all(Array.from({ length: 6 }, () => window.cc.terminals.create({ projectId, agentOwnerId: threadId, profile: 'shell', cols: 80, rows: 24 }))), { projectId, threadId });
    expect(denied.every(result => !result.ok && result.code === 'DENIED' && result.message.includes('three terminals'))).toBe(true);
    await page.getByRole('button', { name: 'Close Burst 0', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Close Burst \d$/ })).toHaveCount(2);
    await open('Replacement'); await expect(page.getByRole('button', { name: 'Close Replacement', exact: true })).toBeVisible();
    const invalid = await page.evaluate(id => window.cc.terminals.create({ projectId: id, agentOwnerId: 'not-a-registered-owner', profile: 'shell', cols: 80, rows: 24 }), projectId);
    expect(invalid.ok).toBe(false);
  } finally {
    await page.evaluate(async id => { for (const session of await window.cc.terminals.list(id)) await window.cc.terminals.close(session.id); }, projectId);
  }
});

test('pathological regex and slow tmux verification leave Electron main responsive', async ({ app }) => {
  const { window: page, electron, home } = app;
  const root = join(home, 'bounded-search'); mkdirSync(root);
  writeFileSync(join(root, 'pathological.txt'), 'a'.repeat(32) + '!');
  const bin = join(home, 'slow-probe-bin'); mkdirSync(bin);
  const tmux = join(bin, 'tmux'); writeFileSync(tmux, "#!/bin/sh\nsleep 0.3\nprintf 'tmux 3.6\\n'\n"); chmodSync(tmux, 0o700);
  await page.evaluate(async root => { const project = await window.cc.projects.add(root); if (!project.ok) throw new Error(project.message); }, root);
  await electron.evaluate(() => {
    const probe = globalThis as any; probe.freezeTicks = 0;
    probe.freezeTickTimer = setInterval(() => probe.freezeTicks++, 10);
  });
  let originalPath = '';
  try {
    const result = await page.evaluate(root => window.cc.fs.searchFiles(root, '(a+)+$', { regex: true }), root);
    expect(result).toMatchObject({ hits: [], truncated: true });
    expect(await electron.evaluate(() => (globalThis as any).freezeTicks)).toBeGreaterThan(5);
    originalPath = await electron.evaluate((_electron, bin) => { const original = process.env.PATH ?? ''; process.env.PATH = `${bin}:${original}`; (globalThis as any).freezeTicks = 0; return original; }, bin);
    const verified = await page.evaluate(() => window.cc.terminals.verifyTmux());
    expect(verified).toMatchObject({ installed: true, version: 'tmux 3.6' });
    expect(await electron.evaluate(() => (globalThis as any).freezeTicks)).toBeGreaterThan(5);
  } finally {
    await electron.evaluate((_electron, path) => { clearInterval((globalThis as any).freezeTickTimer); if (path) process.env.PATH = path; }, originalPath);
  }
});

test('multiple noisy panel shells keep the renderer responsive and hidden parsing bounded', async ({ app }, testInfo) => {
  const { window: page, home } = app;
  const root = join(home, 'noisy-panels'); mkdirSync(root);
  const { projectId, threadId } = await page.evaluate(async root => {
    const project = await window.cc.projects.add(root); if (!project.ok) throw new Error(project.message);
    const body = await (await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Noisy panels' }) })).json();
    return { projectId: project.value.id, threadId: body.thread.id as string };
  }, root);
  await page.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, threadId);
  await expect(page.getByRole('heading', { name: 'Noisy panels', exact: true })).toBeVisible();
  const show = page.getByTestId('thread-secondary-show'); if (await show.isVisible()) await show.click();
  const profiler = await page.context().newCDPSession(page);
  await profiler.send('Profiler.enable');
  await profiler.send('Profiler.start');
  try {
    for (let i = 0; i < 4; i++) {
      await openThreadToolLauncher(page); await page.getByTestId('thread-new-tab-terminal').click();
      await expect(page.getByTestId('thread-terminal-tab').locator('.xterm:visible')).toHaveCount(1);
    }
    const ids = await page.evaluate(async id => (await (await fetch('/api/v1/terminals')).json()).sessions.filter((s: any) => s.projectId === id && s.profile === 'shell').map((s: any) => s.id as string), projectId);
    expect(ids).toHaveLength(4);
    await page.evaluate(async ids => {
      const state = window as any; let previous = performance.now(); state.maxTerminalLag = 0; state.terminalTicks = 0;
      state.terminalTimer = setInterval(() => { const now = performance.now(); state.maxTerminalLag = Math.max(state.maxTerminalLag, now - previous); previous = now; state.terminalTicks++; }, 10);
      state.terminalLongTasks = [];
      state.terminalObserver = new PerformanceObserver(list => { state.terminalLongTasks.push(...list.getEntries().map(entry => ({ duration: entry.duration, startTime: entry.startTime }))); });
      state.terminalObserver.observe({ entryTypes: ['longtask'] });
      await Promise.all(ids.map(id => fetch(`/api/v1/terminals/${id}/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: "printf 'MULTI-STREAM-%s\\n' {1..100000}; echo MULTI_STREAM_READY\r" }) })));
    }, ids);
    // Isolate renderer scheduling from CDP's scroll-into-view/compositor wait
    // during profiling. Normal mouse navigation is covered by the panel spec.
    await page.getByTestId('thread-info-pin').evaluate((button: HTMLElement) => button.click());
    await expect(page.getByTestId('thread-info-storage')).toBeVisible();
    for (const id of ids) await expect.poll(() => page.evaluate(async id => (await (await fetch(`/api/v1/terminals/${id}/output`)).json()).text as string, id), { timeout: 30000 }).toContain('MULTI_STREAM_READY\r\n');
    const metrics = await page.evaluate(() => { const state = window as any; clearInterval(state.terminalTimer); return { maxLag: state.maxTerminalLag as number, ticks: state.terminalTicks as number }; });
    expect(metrics.ticks).toBeGreaterThan(5); expect(metrics.maxLag).toBeLessThan(1500);
    console.log('TERMINAL_STREAM_RESPONSIVENESS', JSON.stringify(metrics));
    await page.getByRole('button', { name: 'Terminal', exact: true }).last().evaluate((button: HTMLElement) => button.click());
    await expect(page.getByTestId('thread-terminal-tab').locator('.xterm:visible')).toHaveCount(1);
  } finally {
    console.log('TERMINAL_STREAM_FINAL_METRICS', await page.evaluate(() => ({ maxLag: (window as any).maxTerminalLag, ticks: (window as any).terminalTicks, longTasks: (window as any).terminalLongTasks })));
    const { profile } = await profiler.send('Profiler.stop');
    await testInfo.attach('renderer.cpuprofile.json', { body: Buffer.from(JSON.stringify(profile)), contentType: 'application/json' });
    await profiler.detach();
    await page.evaluate(() => (window as any).terminalObserver?.disconnect());
    await page.evaluate(async id => { clearInterval((window as any).terminalTimer); for (const session of (await (await fetch('/api/v1/terminals')).json()).sessions) if (session.projectId === id) await fetch(`/api/v1/terminals/${session.id}/close`, { method: 'POST' }); }, projectId);
  }
});
