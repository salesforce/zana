import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { runtimeShimPlugin } from '../packages/plugin-build/src/build-plugin-app.js';

const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('./fixtures/plugins/platform-hooks-probe', import.meta.url));
const pluginId = 'platform-hooks-probe';

test('human-required gates reject HTTP/agent CLI; real UI and operator CLI record human actors', async ({ home }) => {
  test.setTimeout(180_000);
  await build({ entryPoints: [join(fixture, 'app.tsx')], outfile: join(fixture, 'dist/app.js'), bundle: true,
    format: 'esm', platform: 'browser', jsx: 'automatic', plugins: [runtimeShimPlugin()] });
  const store = join(home, '.zcc/plugins');
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, 'installed.json'), JSON.stringify({ version: 1, plugins: [{
    id: pluginId, version: '0.1.0', name: 'Platform Hooks Probe', enabled: true,
    status: 'running', provenance: 'direct', sourceKind: 'path', source: `path:${fixture}`,
    rootDir: fixture, serverEntry: './server.ts', appEntry: './dist/app.js', installedAt: Date.now(), updatedAt: Date.now()
  }] }));
  const app = await launchApp(home, { env: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });
  try {
    const win = app.window;
    await expect.poll(() => win.evaluate(async id => (await window.cc.pluginApps.list()).find(p => p.id === id)?.status, pluginId), { timeout: 30_000 }).toBe('running');
    const path = join(home, 'interaction-project');
    mkdirSync(path);
    const threadId = await win.evaluate(async path => {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error(project.message);
      const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Actor proof test' }) });
      const result = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(result));
      return result.thread.id as string;
    }, path);
    const url = new URL(win.url()).origin;
    const ask = async (requireHuman: boolean) => {
      // Start a real plugin waiter without awaiting its answer.
      await win.evaluate(({ pluginId, threadId, requireHuman }) => {
        (window as any).__actorResult = undefined;
        void window.cc.pluginApps.callRpc(pluginId, 'requestPendingInteraction', { threadId, requireHuman }).then(value => { (window as any).__actorResult = value; });
      }, { pluginId, threadId, requireHuman });
      let rows: Array<{ id: string }> = [];
      await expect.poll(async () => {
        rows = await (await fetch(`${url}/api/v1/threads/${threadId}/interactions`)).json();
        return rows.length;
      }).toBe(1);
      return rows[0]!.id;
    };
    const result = () => win.evaluate(() => (window as any).__actorResult);
    const respond = (id: string, headers: Record<string, string> = {}) => fetch(`${url}/api/v1/threads/${threadId}/interactions/${id}/respond`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ value: { confirmed: true }, actor: 'human' }) });
    let id = await ask(true);
    expect((await respond(id)).status).toBe(403);
    expect((await respond(id, { 'x-zcc-caller-session-id': 'agent', 'x-zcc-caller-credential': 'agent-token' })).status).toBe(403);

    await win.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, threadId);
    const banner = win.getByTestId('thread-pending-banner');
    await expect(banner.getByRole('button', { name: 'Submit', exact: true })).toBeVisible({ timeout: 30_000 });
    await banner.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(result).toMatchObject({ outcome: 'submitted', actor: 'human', value: { confirmed: true } });
    expect((await (await fetch(`${url}/api/v1/threads/${threadId}/interactions/${id}`)).json()).resolution.actor).toBe('human');

    const cliDir = join(home, 'cli');
    cpSync(resolve('packages/cli/dist'), cliDir, { recursive: true, dereference: true });
    const cli = async (id: string, agent: boolean) => {
      try {
        const out = await exec(process.execPath, [join(cliDir, 'bin/zcc'), 'thread', 'interactions', threadId, 'respond', id, '--value', '{"confirmed":true}', '--json'], {
          env: { ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'), ZCC_SESSION_ID: agent ? 'agent-session' : undefined, ZCC_SESSION_TOKEN: agent ? 'agent-token' : undefined }, timeout: 15_000
        });
        return { code: 0, ...out };
      } catch (error) { const out = error as { code: number; stdout: string; stderr: string }; return out; }
    };
    id = await ask(true);
    const refused = await cli(id, true);
    expect(refused.code, refused.stderr).toBe(5);
    expect(refused.stderr).toContain('Human proof required');
    const accepted = await cli(id, false);
    expect(accepted.code, accepted.stderr).toBe(0);
    await expect.poll(result).toMatchObject({ actor: 'human' });
    for (const actor of ['agent', 'unknown']) {
      id = await ask(false);
      expect((await respond(id, actor === 'agent' ? { 'x-zcc-caller-credential': 'agent-token' } : {})).status).toBe(200);
      await expect.poll(result).toMatchObject({ actor });
    }
  } finally { await closeApp(app.electron); }
});
