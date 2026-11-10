import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

test('plugin RPC survives a suspended server and retires a bridge whose API times out', async ({ home }) => {
  test.skip(process.platform === 'win32', 'Process suspension uses POSIX signals');
  test.setTimeout(120_000);
  const rootDir = join(home, 'resume-probe');
  const registry = join(home, '.zcc/plugins');
  const bundle = join(home, 'empty-bundle');
  for (const dir of [rootDir, registry, bundle]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: 'zcc-plugin-resume-probe', version: '1.0.0',
    zcc: { name: 'Resume probe', description: 'Worker liveness regression', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(rootDir, 'server.mjs'), `import { randomUUID } from 'node:crypto';
    export default api => {
      const generation = randomUUID();
      api.rpc.method('ping', () => generation);
      api.rpc.method('timeout', () => {
        // Inject the deadline result at the real worker's synchronous API boundary.
        // Catching it must still retire this generation in the parent process.
        const wait = Atomics.wait;
        Atomics.wait = () => 'timed-out';
        try { api.log.info('timeout probe'); } catch {} finally { Atomics.wait = wait; }
      });
    };`);
  writeFileSync(join(registry, 'installed.json'), JSON.stringify({ version: 1, plugins: [{
    id: 'resume-probe', rootDir, name: 'Resume probe', version: '1.0.0', description: 'Worker liveness regression',
    icon: 'Puzzle', enabled: true, status: 'running', statusDetail: null, provenance: 'direct',
    sourceKind: 'path', source: `path:${rootDir}`, serverEntry: './server.mjs', appEntry: null,
    installedAt: Date.now(), updatedAt: Date.now()
  }] }));
  const app = await launchApp(home, { initialConfig: { sponsorPromptDismissed: true }, env: {
    ZCC_BUNDLED_PLUGINS_DIR: bundle, ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0',
    ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off', ZCC_SKIP_PLUGIN_NPM: '1'
  } });
  let suspendedPid: number | undefined;
  try {
    const win = app.window;
    const state = () => win.evaluate(async () => (await window.cc.pluginApps.list()).find(row => row.id === 'resume-probe'));
    const ping = () => win.evaluate(() => window.cc.pluginApps.callRpc('resume-probe', 'ping'));
    await expect.poll(state, { timeout: 40_000 }).toMatchObject({ status: 'running' });
    const generation = await ping();
    suspendedPid = await app.electron.evaluate(({ app }) => {
      const child = app.getAppMetrics().find(metric => metric.name?.includes('server-runtime.js'));
      if (!child) throw Error('Missing server utility');
      return child.pid;
    });
    process.kill(suspendedPid, 'SIGSTOP');
    await new Promise(resolve => setTimeout(resolve, 21_000));
    process.kill(suspendedPid, 'SIGCONT');
    suspendedPid = undefined;
    // Allow the watchdog and queued heartbeats to run before checking identity.
    await win.waitForTimeout(1_000);
    expect(await ping()).toBe(generation);
    expect(await state()).toMatchObject({ status: 'running' });

    const failure = await win.evaluate(async () => {
      try { await window.cc.pluginApps.callRpc('resume-probe', 'timeout'); return null; }
      catch (error) { return error instanceof Error ? error.message : String(error); }
    });
    expect(failure).toContain('Plugin API call timed out');
    await expect.poll(state).toMatchObject({ status: 'degraded', statusDetail: 'Plugin API call timed out' });
    await expect.poll(state, { timeout: 30_000 }).toMatchObject({ status: 'running' });
    expect(await ping()).not.toBe(generation);
  } finally {
    if (suspendedPid) process.kill(suspendedPid, 'SIGCONT');
    await closeApp(app.electron);
  }
});
