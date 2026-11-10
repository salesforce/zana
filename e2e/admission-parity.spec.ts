/**
 * Electron production-boundary: a plugin dispatch-admission handler sees, and can
 * refuse, input that does not go through a Modern send. The fixture plugin is
 * set to reject; a CLI Agent spawn with a prompt (PTY surface, admitted in main)
 * and a Modern thread create (Modern surface, admitted in the server) are both
 * refused and spawn nothing, then proceed once the fixture allows them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { buildPluginHost } from '../packages/plugin-build/src/build-plugin-host.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/plugins/platform-hooks-probe', import.meta.url));
const PLUGIN_ID = 'platform-hooks-probe';
const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
const PRODUCT_PORT = 30_000 + (process.pid % 10_000);
const PRODUCT_URL = `http://127.0.0.1:${PRODUCT_PORT}`;

test.use({
  e2e: true,
  launchEnv: { ZCC_SERVER_PORT: String(PRODUCT_PORT), ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { claudeBinary: agent.path, defaultHarness: 'claude', sponsorPromptDismissed: true }
});

test.beforeAll(async () => { await buildPluginHost(FIXTURE_DIR, '1.0.0'); });
test.afterAll(() => agent.cleanup());

async function waitForProduct(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${PRODUCT_URL}/api/v1/health`);
      if (response.ok && (await response.json() as { ok?: boolean }).ok === true) return;
    } catch { /* still booting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`product HTTP did not become ready on ${PRODUCT_PORT}`);
}

const post = (path: string, body: unknown) => fetch(`${PRODUCT_URL}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});

test('a rejecting plugin refuses a CLI Agent spawn and a Modern create, and both proceed when it allows', async ({ app, home }) => {
  test.setTimeout(150_000);
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-admission-parity-'));
  try {
    const pluginStore = join(home, '.zcc/plugins');
    mkdirSync(pluginStore, { recursive: true });
    writeFileSync(join(pluginStore, 'installed.json'), JSON.stringify({
      version: 1,
      plugins: [{
        id: PLUGIN_ID, version: '0.1.0', name: 'Platform Hooks Probe', enabled: true, status: 'running',
        provenance: 'direct', sourceKind: 'path', source: `path:${FIXTURE_DIR}`, rootDir: FIXTURE_DIR,
        serverEntry: './server.ts', appEntry: null, installedAt: Date.now(), updatedAt: Date.now()
      }]
    }));
    // The running app discovers the plugin store entry; wait for it to report running below.
    const { window } = app;
    await expect(window.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 20_000 });
    await waitForProduct();
    await expect.poll(async () => window.evaluate(async (id) => {
      const rows = await window.cc.pluginApps.list();
      return rows.find((p) => p.id === id)?.status;
    }, PLUGIN_ID), { timeout: 45_000 }).toBe('running');

    const created = await post('/api/v1/projects', { path: projectDir });
    expect(created.ok).toBe(true);
    const projectId = ((await created.json()) as { project: { id: string } }).project.id;
    const rpc = <T,>(method: string, args: unknown) =>
      window.evaluate(({ id, method, args }) => window.cc.pluginApps.callRpc(id, method, args), { id: PLUGIN_ID, method, args }) as Promise<T>;

    await rpc('setDispatchSelection', { kind: 'reject', message: 'parity-blocked' });

    // PTY surface: CLI Agent spawn with an opening prompt is admitted in main.
    const spawn = await post('/api/v1/cli-agents', { projectId, profile: 'claude', prompt: 'say hi', title: '[zcc-live:e2e] parity' });
    const spawnBody = await spawn.json() as { message?: string; session?: unknown };
    expect(spawn.status, JSON.stringify(spawnBody)).toBe(409);
    expect(spawnBody.message).toContain('parity-blocked');
    expect(spawnBody.session).toBeUndefined();

    // Modern surface: a create is admitted before anything is provisioned.
    const thread = await post('/api/v1/threads', { projectId, providerId: 'fake', title: 'parity', input: 'Hello' });
    const threadBody = await thread.json() as { code?: string; message?: string };
    expect(thread.status, JSON.stringify(threadBody)).toBe(409);
    expect(threadBody.code).toBe('dispatch_rejected');
    expect(threadBody.message).toContain('parity-blocked');

    const events = await rpc<Array<{ surface?: string; entry?: string; origin?: string; decision: { action: string } }>>('dispatchEventsList', undefined);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: 'pty', entry: 'initial', decision: { action: 'reject', message: 'parity-blocked' } }),
      expect.objectContaining({ surface: 'modern', entry: 'initial', origin: 'user', decision: { action: 'reject', message: 'parity-blocked' } })
    ]));

    // Allowed again: the same two inputs go through.
    await rpc('setDispatchSelection', { kind: 'proceed' });
    const spawned = await post('/api/v1/cli-agents', { projectId, profile: 'claude', prompt: 'say hi', title: '[zcc-live:e2e] parity ok' });
    expect(spawned.status, JSON.stringify(await spawned.clone().json())).toBe(201);
    const allowed = await post('/api/v1/threads', { projectId, providerId: 'fake', title: 'parity ok', input: 'Hello' });
    expect(allowed.ok, JSON.stringify(await allowed.clone().json())).toBe(true);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
