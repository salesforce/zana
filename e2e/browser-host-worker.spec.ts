import { execFile } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

// Uses the real pinned DevBrowser download and installed Chrome. Kept separate
// from deterministic tests so an offline package registry is never a false pass.
test('packaged Browser Automation controls headless and desktop browsers through its host worker', async ({ app }) => {
  test.skip(process.env.ZCC_LIVE_BROWSER_AUTOMATION !== '1', 'requires the pinned runtime download and Chrome');
  test.setTimeout(600_000);
  const { window, home } = app;
  const root = join(home, 'browser-worker-project'); mkdirSync(root);
  const setup = await window.evaluate(async path => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Browser host lifecycle' }) });
    const thread = await response.json(); if (!response.ok) throw new Error(JSON.stringify(thread));
    const hosts = await fetch('/api/v1/hosts').then(r => r.json());
    return { threadId: (thread.thread ?? thread.value).id as string, hostId: hosts.find((h: any) => h.isPrimary).id as string };
  }, root);
  expect(await window.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'browser-automation' }))).toMatchObject({ ok: true });
  const installed = await window.evaluate(async () => {
    const snapshot = await fetch('/api/v1/plugin-apps').then((response) => response.json());
    return snapshot.apps.find((plugin: { id: string }) => plugin.id === 'browser-automation');
  });
  expect(installed?.status, JSON.stringify(installed)).toBe('running');
  const copiedCli = join(home, 'cli');
  cpSync(resolve('packages/cli/dist'), copiedCli, { recursive: true, dereference: true });
  const openSession = async (backend: string, instanceId: string) => {
    const result = await promisify(execFile)(process.execPath, [join(copiedCli, 'bin/zcc'), 'browser-automation', 'open',
      '--backend', backend, '--machine', setup.hostId, '--thread', setup.threadId,
      ...(backend === 'desktop' ? ['--desktop', instanceId] : ['--headless']), '--json'], {
      cwd: root, timeout: 310_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'), ZCC_SERVER_URL: new URL(window.url()).origin,
        ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined, ZCC_THREAD_ID: undefined, ZCC_PROJECT_ID: undefined,
        BB_THREAD_ID: undefined, BB_PROJECT_ID: undefined }
    });
    return JSON.parse(result.stdout);
  };
  const call = async (method: string, args: Record<string, unknown>) => {
    const result = await window.evaluate(async ({ method, args }) => {
      const response = await fetch('/api/v1/plugin-apps/browser-automation/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }) });
      return { status: response.status, body: await response.json() };
    }, { method, args: { threadId: setup.threadId, ...args } });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body.value;
  };
  const { instances } = await window.evaluate(async hostId => {
    const response = await fetch('/api/v1/desktop-browsers/instances', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hostId }) });
    if (!response.ok) throw new Error(await response.text()); return response.json();
  }, setup.hostId);
  expect(instances.length).toBeGreaterThan(0);
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? 'missing');
    const backend = new URL(req.url!, 'http://localhost').searchParams.get('backend') === 'desktop' ? 'desktop' : 'local';
    res.setHeader('content-type', 'text/html'); res.end(`<h1>${backend} worker</h1><iframe srcdoc="<button>frame proof</button>"></iframe>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test HTTP port');
  try {
  for (const backend of ['desktop', 'local']) {
    await test.step(backend, async () => {
    // Exercise the actual CLI/socket deadline through a cold runtime install.
    const session = await openSession(backend, instances[0].instanceId);
    expect(session).toMatchObject({ hostId: setup.hostId, backend, state: 'ready' });
    try {
      const url = `http://127.0.0.1:${address.port}/?backend=${backend}`;
      const result = await call('run', { sessionId: session.id, script: `const p = await browser.getPage('main'); await p.goto(${JSON.stringify(url)}); await p.snapshot()`, timeoutMs: 30_000 });
      if (result.exitCode !== 0) {
        const pages = await call('pages', { sessionId: session.id });
        await test.info().attach('navigation-diagnostic', { body: JSON.stringify({ backend, requests, pages, result }), contentType: 'application/json' });
      }
      expect(result.exitCode, result.text + JSON.stringify(requests)).toBe(0);
      expect(result.text).toContain(`${backend} worker`); expect(result.text).toContain('frame proof');
      for (let iteration = 0; iteration < 3; iteration++) {
        const repeated = await call('run', { sessionId: session.id, script: `await browser.getPage('main'); JSON.stringify(await browser.listPages())`, timeoutMs: 30_000 });
        expect(repeated.exitCode, repeated.text).toBe(0);
        const pages = JSON.parse(repeated.text);
        expect(pages).toHaveLength(1);
        expect(pages[0]).toMatchObject({ name: 'main', url });
      }
      const shot = await call('screenshot', { sessionId: session.id, page: 'main' });
      expect(shot.exitCode, shot.text).toBe(0); expect(shot.images).toHaveLength(1);
      if (backend === 'local') {
        const preview = await call('preview', { sessionId: session.id, afterSequence: 0, size: 'thumbnail' });
        expect(preview.frame?.mimeType).toBe('image/jpeg');
        expect(Buffer.from(preview.frame.data, 'base64').subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      }
    } finally {
      expect(await call('close', { sessionId: session.id })).toMatchObject({ state: 'closed' });
    }
    });
  }
  expect((await call('list', {})).every((s: any) => s.state === 'closed')).toBe(true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
