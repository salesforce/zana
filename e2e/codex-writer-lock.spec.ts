import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';
import { stubNativeDialogs } from './sdk/native-dialog.js';

// Exceed Electron's historical 8192-byte pipe truncation boundary and assert
// the entire response reaches the UI both before and after writer recovery.
const REPLY = `Codex output start ${'x'.repeat(20_000)} Codex output end`;

test.use({
  initialConfig: { sponsorPromptDismissed: true },
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'fixture-bin');
    mkdirSync(bin);
    // The production runtime refreshes PATH from a login shell. Seed only this
    // fixture HOME so that refresh continues to select the hermetic executable.
    const shellInit = `export PATH='${bin.replaceAll("'", "'\\''")}':"$PATH"\n`;
    for (const name of ['.zshrc', '.bashrc', '.bash_profile']) writeFileSync(join(home, name), shellInit);
    const fixture = fileURLToPath(new URL('../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs', import.meta.url));
    const script = join(home, 'codex-script.json');
    writeFileSync(script, JSON.stringify({
      processLogPath: join(home, 'codex-process.log'),
      requestLogPath: join(home, 'codex-requests.log'),
      writerLockPath: join(home, 'writer.lock'),
      strictTurnIds: true,
      messageText: REPLY
    }));
    writeFileSync(join(bin, 'codex'), `#!${process.execPath}\n
if (process.argv.includes('--version')) { console.log('codex-cli 0.153.4'); process.exit(0); }
if (!process.argv.includes('app-server')) process.exit(64);
process.argv = [process.execPath, ${JSON.stringify(fixture)}, ${JSON.stringify(script)}];
import(${JSON.stringify(new URL('../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs', import.meta.url).href)});
`, { mode: 0o700 });
    await use({ PATH: `${bin}:${process.env.PATH ?? ''}`, ZDOTDIR: home });
  }
});

test.afterEach(async ({ app }, info) => {
  if (info.status === info.expectedStatus) return;
  const data = await app.window.evaluate(async () => {
    const { threads } = await (await fetch('/api/v1/threads')).json();
    return Promise.all((threads ?? []).slice(0, 5).map(async (thread: { id: string }) => ({ thread,
      events: await (await fetch(`/api/v1/threads/${thread.id}/events?limit=30`)).json()
    })));
  }).catch(() => null);
  await info.attach('thread-state', { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
});

test('Codex writer contention retries through the built provider and composer', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  const root = join(home, 'codex-project');
  mkdirSync(root);
  const threadId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'codex', input: 'First turn', permissionMode: 'full' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, root);
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const timeline = window.getByTestId('thread-timeline');
  await timeline.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(timeline).toContainText(REPLY, { timeout: 30_000 });
  await window.evaluate(async (id) => {
    const response = await fetch(`/api/v1/threads/${id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error(await response.text());
  }, threadId);

  const lock = join(home, 'writer.lock');
  writeFileSync(lock, String(process.pid));
  try {
    const composer = window.getByTestId('thread-command-input');
    await composer.fill('Follow up after writer handoff');
    await composer.press('Enter');
    await expect.poll(() => {
      const log = join(home, 'codex-process.log');
      return existsSync(log) ? readFileSync(log, 'utf8') : '';
    }).toContain('writer-conflict:');
    unlinkSync(lock);
    await timeline.getByRole('button', { name: 'Show more', exact: true }).click();
    await expect(timeline.getByText(REPLY, { exact: true })).toHaveCount(2, { timeout: 30_000 });
    const requests = readFileSync(join(home, 'codex-requests.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(requests.filter((entry) => entry.method === 'thread/resume').length).toBeGreaterThanOrEqual(2);
    // Omitting a model in product HTTP must preserve Codex's configured default,
    // including after recovery. The host's internal "default" is not a model id.
    for (const method of ['thread/start', 'thread/resume', 'turn/start']) {
      const nativeRequests = requests.filter(entry => entry.method === method);
      expect(nativeRequests.length).toBeGreaterThan(0);
      for (const request of nativeRequests) expect(request.params.model).not.toBe('default');
    }
    expect(requests.find(entry => entry.method === 'thread/start').params).not.toHaveProperty('model');
    await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);
  } finally {
    if (existsSync(lock)) unlinkSync(lock);
  }
});


test('Codex Send now and Stop translate the active turn id through the built bridge', async ({ app }) => {
  await stubNativeDialogs(app.electron, [1]);
  const { window, home } = app;
  const root = join(home, 'queued-codex-project');
  mkdirSync(root);
  const threadId = await window.evaluate(async path => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'codex', input: '/wait-for-interrupt', permissionMode: 'full' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread.id as string;
  }, root);
  await expect.poll(() => window.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${id}`);
    const body = await response.json();
    return body.thread?.providerThreadId ?? null;
  }, threadId)).not.toBeNull();
  await window.evaluate(id => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const detail = window.getByTestId('thread-detail');
  const composer = detail.locator('.thread-command-composer');
  await expect(composer.getByTestId('thread-command-send')).toHaveAttribute('aria-label', 'Queue');
  const queued = detail.getByTestId('thread-queued-messages');
  for (const message of ['Keep this queued', 'Send this into the active Codex turn']) {
    await composer.getByTestId('thread-command-input').fill(message);
    await expect(composer.getByTestId('thread-command-input')).toHaveText(message);
    await composer.getByTestId('thread-command-send').click();
    await expect(queued).toContainText(message);
  }
  const selected = queued.locator('.thread-queued-ghost').filter({ hasText: 'Send this into the active Codex turn' });
  const forged = await window.evaluate(async id => {
    const queue = await fetch(`/api/v1/threads/${id}/next-turn`).then(response => response.json());
    const item = queue.items.find((row: { text?: string }) =>
      row.text === 'Send this into the active Codex turn');
    if (!item) throw new Error('Selected queued message missing');
    return fetch(`/api/v1/threads/${id}/next-turn/${item.id}/send`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-zcc-app-surface': 'desktop' }, body: '{}'
    }).then(response => response.status);
  }, threadId);
  expect(forged).toBe(403);
  await selected.getByRole('button', { name: 'Send now', exact: true }).click();
  await expect(queued.locator('.thread-queued-item-text')).toHaveText(['Keep this queued']);
  await expect(detail.getByTestId('thread-timeline').getByTestId('thread-user-text')
    .filter({ hasText: 'Send this into the active Codex turn' })).toBeVisible();
  await expect(queued.getByRole('alert')).toHaveCount(0);

  const requests = () => readFileSync(join(home, 'codex-requests.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(requests().filter(row => row.method === 'turn/steer')).toMatchObject([
    { params: { expectedTurnId: 'turn-fx-1' } }
  ]);
  await window.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(queued.getByTestId('thread-queued-paused')).toBeVisible();
  await expect(composer.getByTestId('thread-command-send')).toHaveAttribute('aria-label', 'Send');
  expect(requests().filter(row => row.method === 'turn/interrupt')).toMatchObject([
    { params: { turnId: 'turn-fx-1' } }
  ]);
  await expect(detail.locator('.thread-status-badge.is-error')).toHaveCount(0);
});

test('fresh skill snapshots reach the built Codex bridge without changing existing sessions', async ({ app }) => {
  const { window, home } = app;
  const projectPath = join(home, 'skill-snapshot-project');
  const source = join(home, '.zcc', 'skills-generated', 'snapshot-probe');
  mkdirSync(projectPath);
  mkdirSync(source, { recursive: true });
  const skill = join(source, 'SKILL.md');
  writeFileSync(skill, '---\nname: snapshot-probe\ndescription: stable description\n---\nfirst revision');
  const projectId = await window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, projectPath);
  const start = () => window.evaluate(async id => {
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: id, providerId: 'codex', input: 'Snapshot probe', permissionMode: 'full' }) });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, projectId);
  const roots = () => {
    const file = join(home, 'codex-requests.log');
    if (!existsSync(file)) return [] as string[];
    return readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
      .filter(row => row.method === 'skills/extraRoots/set').flatMap(row => row.params.extraRoots as string[])
      .filter(path => path.includes('runtime-skill-snapshots') && existsSync(join(path, 'snapshot-probe', 'SKILL.md')));
  };
  await start();
  await expect.poll(() => roots().length).toBeGreaterThan(0);
  const first = roots()[0];
  expect(first).toContain('runtime-skill-snapshots');
  writeFileSync(skill, '---\nname: snapshot-probe\ndescription: stable description\n---\nsecond revision');
  await start();
  await expect.poll(() => new Set(roots()).size).toBe(2);
  const last = roots().at(-1)!;
  expect(readFileSync(join(first, 'snapshot-probe', 'SKILL.md'), 'utf8')).toContain('first revision');
  expect(readFileSync(join(last, 'snapshot-probe', 'SKILL.md'), 'utf8')).toContain('second revision');
});
