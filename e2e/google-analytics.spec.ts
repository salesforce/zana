import { createServer } from 'node:http';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { preparePluginRuntime } from '../packages/plugin-build/src/prepare-plugin-runtime.js';
import { writeReleaseDefaults } from '../plugins/google-analytics/build.mjs';
import { test, expect, launchApp } from './fixtures/app.js';

test('Google Analytics auto-installs, tracks visible use, disconnects, and respects removal', async ({ home }) => {
  test.setTimeout(180_000);
  const captures: Array<{ url: string; body: { client_id: string; events: Array<{ name: string; params: Record<string, unknown> }> } }> = [];
  const collector = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) request.destroy();
    });
    request.on('end', () => {
      captures.push({ url: request.url || '', body: JSON.parse(body) });
      response.writeHead(204).end();
    });
  });
  await new Promise<void>(resolve => collector.listen(0, '127.0.0.1', resolve));
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('No collector port');
  const env = {
    ZCC_GA4_MEASUREMENT_ID: 'G-E2ETEST', ZCC_GA4_API_SECRET: 'e2e-fake-secret',
    ZCC_GA4_TEST_ENDPOINT: `http://127.0.0.1:${address.port}/mp/collect`,
    ZCC_POSTHOG_API_KEY: ''
  };
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  const events = () => captures.flatMap(capture => capture.body.events);
  try {
    app = await launchApp(home, { e2e: true, env, initialConfig: { sponsorPromptDismissed: true } });
    const win = app.window;
    await expect.poll(() => win.evaluate(async () => {
      const rows = await window.cc.pluginApps.list();
      return rows.filter(row => ['google-analytics', 'posthog-analytics'].includes(row.id))
        .map(row => `${row.id}:${row.enabled}:${row.status}`).sort();
    })).toEqual(['google-analytics:true:running', 'posthog-analytics:true:running']);
    await expect.poll(() => events().map(event => event.name)).toContain('app_open');
    await expect.poll(() => events().filter(event => event.name === 'page_view').length).toBeGreaterThan(0);
    const clientId = captures[0].body.client_id;
    expect(clientId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(captures[0].url).toContain('measurement_id=G-E2ETEST');
    expect(captures[0].url).toContain('api_secret=e2e-fake-secret');

    // Inspect real RPC calls without replacing their implementation.
    await win.evaluate(() => {
      const global = globalThis as unknown as { __ZCC_PLUGIN_HOST__: { callRpc: (...args: unknown[]) => unknown }; __gaCalls: number };
      const original = global.__ZCC_PLUGIN_HOST__.callRpc;
      global.__gaCalls = 0;
      global.__ZCC_PLUGIN_HOST__.callRpc = function (...args) {
        if (args[0] === 'google-analytics' && args[1] === 'track') global.__gaCalls++;
        return original.apply(this, args);
      };
    });
    await win.clock.install();
    await win.evaluate(() => {
      history.pushState({}, '', '/inbox?private-query=secret#private-fragment');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await win.clock.runFor(1100);
    await expect.poll(() => events().some(event => event.params.page_title === 'Inbox')).toBe(true);
    await win.clock.fastForward(60000);
    await expect.poll(() => events().some(event => event.name === 'user_engagement')).toBe(true);
    for (const event of events()) {
      expect(event.params.session_id).toEqual(expect.any(Number));
      expect(Number(event.params.engagement_time_msec)).toBeGreaterThan(0);
    }
    expect(captures.every(capture => capture.body.client_id === clientId)).toBe(true);
    expect(JSON.stringify(captures.map(capture => capture.body))).not.toMatch(/private-query|private-fragment|secret|threadId|projectId/);

    // Presence-only mode keeps activity working without page events.
    await win.evaluate(async () => { await window.cc.pluginApps.setSettings('google-analytics', { trackPageViews: false }); });
    const beforePresenceOnly = events().filter(event => event.name === 'page_view').length;
    await win.evaluate(() => { history.pushState({}, '', '/settings'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await win.clock.runFor(1100);
    expect(events().filter(event => event.name === 'page_view')).toHaveLength(beforePresenceOnly);

    // User-facing disconnect goes through the real Settings form and IPC.
    await win.evaluate(() => { history.pushState({}, '', '/extensions/plugins/google-analytics?view=installed'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await win.clock.runFor(1100);
    const disconnect = win.getByRole('switch', { name: 'Connect Google Analytics', exact: true });
    await expect(disconnect).toBeVisible();
    await disconnect.click();
    await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.getSettings('google-analytics')).values.enabled)).toBe(false);
    const disconnectedCount = captures.length;
    await win.clock.fastForward(60000);
    expect(captures).toHaveLength(disconnectedCount);

    // Host disable unloads the content script itself, including its timer.
    const disabled = await win.evaluate(async () => window.cc.pluginApps.setEnabled('google-analytics', false));
    expect(disabled.ok).toBe(true);
    await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(row => row.id === 'google-analytics')?.enabled)).toBe(false);
    await win.clock.runFor(1000);
    const callsAtDisable = await win.evaluate(() => (globalThis as unknown as { __gaCalls: number }).__gaCalls);
    await win.clock.fastForward(60000);
    expect(await win.evaluate(() => (globalThis as unknown as { __gaCalls: number }).__gaCalls)).toBe(callsAtDisable);
    expect(captures).toHaveLength(disconnectedCount);

    const removed = await win.evaluate(async () => window.cc.pluginApps.remove('google-analytics'));
    expect(removed.ok).toBe(true);
    await app.electron.close();
    app = undefined;
    app = await launchApp(home, { e2e: true, env, initialConfig: { sponsorPromptDismissed: true } });
    await expect.poll(() => app!.window.evaluate(async () => (await window.cc.pluginApps.list()).some(row => row.id === 'google-analytics'))).toBe(false);
    expect(captures).toHaveLength(disconnectedCount);
  } finally {
    await app?.electron.close();
    await new Promise<void>((resolve, reject) => collector.close(error => error ? reject(error) : resolve()));
  }
});

test('Google Analytics packaged defaults collect in built Electron without user setup', async ({ home }) => {
  test.setTimeout(120_000);
  const source = join(home, 'analytics-source');
  cpSync(join(process.env.ZCC_E2E_APP_ROOT || process.cwd(), 'plugins/google-analytics'), source, { recursive: true });
  writeReleaseDefaults(source, { ZCC_GA4_MEASUREMENT_ID: 'G-RELEASETEST', ZCC_GA4_API_SECRET: 'fake-release-secret' });
  const bundled = join(home, 'bundled');
  await preparePluginRuntime(source, join(bundled, 'google-analytics'), '2.3.3');
  const captures: Array<{ url: string; body: string }> = [];
  const collector = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 8192) request.destroy(); });
    request.on('end', () => { captures.push({ url: request.url || '', body }); response.writeHead(204).end(); });
  });
  await new Promise<void>(resolve => collector.listen(0, '127.0.0.1', resolve));
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('No collector port');
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  const inheritedCredentials = new Map(['ZCC_GA4_MEASUREMENT_ID', 'ZCC_GA4_API_SECRET'].map(key => [key, process.env[key]]));
  for (const key of inheritedCredentials.keys()) delete process.env[key];
  try {
    // Remove any inherited runtime credentials so only the release asset can configure collection.
    app = await launchApp(home, { e2e: true, env: {
      ZCC_BUNDLED_PLUGINS_DIR: bundled,
      ZCC_GA4_TEST_ENDPOINT: `http://127.0.0.1:${address.port}/mp/collect`
    }, initialConfig: { sponsorPromptDismissed: true } });
    await expect.poll(() => captures.length).toBeGreaterThan(0);
    expect(captures[0].url).toContain('measurement_id=G-RELEASETEST');
    expect(captures[0].url).toContain('api_secret=fake-release-secret');
    expect(JSON.parse(captures[0].body).events.map((event: { name: string }) => event.name)).toEqual(['app_open', 'page_view']);
    const settings = await app.window.evaluate(async () => window.cc.pluginApps.getSettings('google-analytics'));
    expect(settings.values.enabled).toBe(true);
    expect(settings.values.measurementId).toBe('G-RELEASETEST');
  } finally {
    await app?.electron.close();
    await new Promise<void>((resolve, reject) => collector.close(error => error ? reject(error) : resolve()));
    for (const [key, value] of inheritedCredentials) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
