/**
 * `ui.requestInput` reaches a PTY session main owns, at the real Electron
 * boundary. A stub CLI stands in for Claude, the probe plugin raises a
 * human-required request against the session id, and the Agents monitor shows
 * it as a banner. The page cannot answer it over HTTP; the banner's Submit goes
 * through Electron main, which signs the human proof the server checks.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Page } from '@playwright/test';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { buildPluginHost } from '../packages/plugin-build/src/build-plugin-host.js';
import { runtimeShimPlugin } from '../packages/plugin-build/src/build-plugin-app.js';
import { cleanupTmuxEnvironment } from './fixtures/tmux-isolation.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/plugins/platform-hooks-probe', import.meta.url));
const PLUGIN_ID = 'platform-hooks-probe';

// Answers `--version` and otherwise stays alive like an idle interactive CLI.
const CLAUDE_STUB = String.raw`
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.296 (Claude Code)'); process.exit(0); }
console.log('PTY request-input probe ready');
process.stdin.resume();
setInterval(() => undefined, 1000);
`;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test.beforeAll(async () => {
  await buildPluginHost(FIXTURE_DIR, '1.0.0');
  await build({
    entryPoints: [join(FIXTURE_DIR, 'app.tsx')], outfile: join(FIXTURE_DIR, 'dist/app.js'), bundle: true,
    format: 'esm', platform: 'browser', jsx: 'automatic', plugins: [runtimeShimPlugin()]
  });
});

test('a PTY session shows a plugin request in the Agents monitor and only a human answer resolves it', async ({ home }) => {
  test.setTimeout(240_000);
  const stubDir = mkdtempSync(join(tmpdir(), 'zcc-pty-request-input-'));
  writeFileSync(join(stubDir, 'claude-stub.cjs'), `#!${process.execPath}\n${CLAUDE_STUB}`, { mode: 0o700 });
  const pluginStore = join(home, '.zcc/plugins');
  mkdirSync(pluginStore, { recursive: true });
  writeFileSync(join(pluginStore, 'installed.json'), JSON.stringify({
    version: 1,
    plugins: [{
      id: PLUGIN_ID, version: '0.1.0', name: 'Platform Hooks Probe', enabled: true, status: 'running',
      provenance: 'direct', sourceKind: 'path', source: `path:${FIXTURE_DIR}`, rootDir: FIXTURE_DIR,
      serverEntry: './server.ts', appEntry: './dist/app.js', installedAt: Date.now(), updatedAt: Date.now()
    }]
  }));
  const app = await launchApp(home, {
    env: { ZCC_SERVER_PORT: String(await freePort()) },
    initialConfig: { sponsorPromptDismissed: true, tmuxScope: 'off', claudeBinary: join(stubDir, 'claude-stub.cjs') }
  });
  const win: Page = app.window;
  try {
    await expect.poll(async () => win.evaluate(async (id) => (await window.cc.pluginApps.list()).find((row) => row.id === id)?.status, PLUGIN_ID),
      { timeout: 45_000, message: 'plugin startup did not settle' }).toBe('running');
    const projectDir = join(home, 'request-input-project');
    mkdirSync(projectDir, { recursive: true });
    const sessionId = await win.evaluate(async (path) => {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error(project.message);
      const result = await window.cc.terminals.create({ projectId: project.value.id, profile: 'claude', cols: 100, rows: 32, title: 'Request input probe' });
      const session = result && 'ok' in result ? result.value : result;
      if (!session?.id) throw new Error(JSON.stringify(result));
      return session.id as string;
    }, projectDir);
    const origin = new URL(win.url()).origin;
    const rpc = <T,>(method: string, args?: unknown) =>
      win.evaluate(({ id, method, args }) => window.cc.pluginApps.callRpc(id, method, args), { id: PLUGIN_ID, method, args }) as Promise<T>;

    // The registry says PTY interactions are available, with the honest reason.
    await expect.poll(async () => {
      const caps = await rpc<{ capabilities: Array<{ id: string; available: boolean }> }>('capabilitiesForThread', { threadId: sessionId });
      return caps.capabilities.find((row) => row.id === 'interactions')?.available;
    }, { timeout: 30_000 }).toBe(true);

    await win.locator('[data-testid="nav-agents"]').click();
    await win.getByLabel('List view').click();
    await win.locator('.agent-monitor-row', { hasText: 'Request input probe' }).first().click();

    // Start a real plugin waiter without awaiting its answer.
    await win.evaluate(({ id, sessionId }) => {
      (window as any).__ptyResult = undefined;
      void window.cc.pluginApps.callRpc(id, 'requestPendingInteraction', { threadId: sessionId, requireHuman: true })
        .then((value) => { (window as any).__ptyResult = value; }, (error) => { (window as any).__ptyResult = { error: String(error) }; });
    }, { id: PLUGIN_ID, sessionId });
    const result = () => win.evaluate(() => (window as any).__ptyResult);
    let rows: Array<{ id: string }> = [];
    await expect.poll(async () => {
      rows = await (await fetch(`${origin}/api/v1/pty-sessions/${sessionId}/interactions`)).json();
      return rows.length;
    }, { timeout: 30_000 }).toBe(1);

    // The page itself cannot answer: no proof, or a forged one, is refused.
    const respond = (headers: Record<string, string> = {}) => fetch(`${origin}/api/v1/pty-sessions/${sessionId}/interactions/${rows[0]!.id}/respond`,
      { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ value: { confirmed: true }, actor: 'human' }) });
    expect((await respond()).status).toBe(403);
    expect((await respond({ 'x-zcc-caller-session-id': 'agent', 'x-zcc-caller-credential': 'agent-token' })).status).toBe(403);
    expect((await respond({ 'x-zcc-interaction-proof': 'forged' })).status).toBe(403);
    expect(await result()).toBeUndefined();

    const banner = win.getByTestId('pty-interaction-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner.getByRole('heading', { name: 'Platform Hooks Probe: confirm action' })).toBeVisible();
    await banner.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(result, { timeout: 30_000 }).toMatchObject({ outcome: 'submitted', actor: 'human' });
    await expect(banner).toHaveCount(0);
    expect(await (await fetch(`${origin}/api/v1/pty-sessions/${sessionId}/interactions`)).json()).toEqual([]);
  } finally {
    try { await closeApp(app.electron); } finally {
      await cleanupTmuxEnvironment(home);
      rmSync(stubDir, { recursive: true, force: true });
    }
  }
});
