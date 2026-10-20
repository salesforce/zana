import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });
test('desktop utility enrollment records non-tunnel provenance', async ({ app }) => {
  await expect.poll(() => JSON.parse(readFileSync(join(app.home, '.zcc/auth.json'), 'utf8')).provenance).toBe('non-tunnel');
  const auth = JSON.parse(readFileSync(join(app.home, '.zcc/auth.json'), 'utf8'));
  expect(readFileSync(join(app.home, '.zcc/host.id'), 'utf8').trim()).toBe(auth.hostId);
});
for (const service of ['server', 'host'] as const) {
  test(`${service} crash offers recovery and preserves projects at the Electron boundary`, async ({ app }) => {
    await app.electron.evaluate(({ dialog }) => {
      (globalThis as any).__runtimeDialogs = [];
      dialog.showMessageBox = (async (...args: any[]) => {
        (globalThis as any).__runtimeDialogs.push(args.at(-1));
        return { response: 1, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    });
    const before = await app.window.evaluate(() => (window as any).cc.projects.list());
    expect(before.length).toBeGreaterThan(0);
    await expect.poll(() => readFileSync(join(app.home, '.zcc/logs/desktop.log'), 'utf8')).toContain('sha256=');
    await expect.poll(() => readFileSync(join(app.home, `.zcc/logs/${service === 'host' ? 'host-daemon' : 'server'}.log`), 'utf8')).toContain('sha256=');
    await app.electron.evaluate(({ app }, service) => {
      const child = app.getAppMetrics().find(metric => metric.name?.includes(`${service}-runtime.js`));
      if (!child) throw new Error(`Missing ${service} utility`);
      process.kill(child.pid, 'SIGKILL');
    }, service);
    await expect.poll(() => app.electron.evaluate(() => (globalThis as any).__runtimeDialogs.length)).toBe(1);
    const dialog = await app.electron.evaluate(() => (globalThis as any).__runtimeDialogs[0]);
    expect(dialog.title).toBe('Background service stopped');
    expect(dialog.buttons).toContain('Restart Zana');
    if (service === 'server') {
      const started = Date.now();
      const error = await app.window.evaluate(async () => {
        try { await (window as any).cc.projects.list(); return ''; } catch (error) { return String(error); }
      });
      expect(error).toContain('Restart Zana'); expect(Date.now() - started).toBeLessThan(2000);
    } else {
      expect(await app.window.evaluate(() => (window as any).cc.projects.list())).toEqual(before);
    }
    expect(JSON.parse(readFileSync(join(app.home, '.zcc/projects.json'), 'utf8')).projects.length).toBeGreaterThan(0);
    await expect.poll(() => readFileSync(join(app.home, '.zcc/logs/desktop.log'), 'utf8')).toContain('runtime unavailable');
  });
}

test('the installed host artifact passes an exit-status protocol probe from Electron', async ({ app }) => {
  const origin = new URL(app.window.url()).origin;
  const result = await app.electron.evaluate(async (_electron, origin) => {
    const { spawn } = process.getBuiltinModule('child_process');
    const { mkdir, writeFile, rm } = process.getBuiltinModule('fs').promises;
    const { join } = process.getBuiltinModule('path');
    const { app } = _electron;
    const root = join(app.getPath('home'), 'artifact-probe');
    await mkdir(root, { recursive: true });
    const run = (bin: string, args: string[]) => new Promise<number | null>((resolve, reject) => {
      const child = spawn(bin, args, { cwd: root, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ZCC_DATA_DIR: root } });
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Protocol probe timed out')); }, 20_000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); resolve(code); });
    });
    try {
      const version = await (await fetch(`${origin}/install/version`)).json();
      const response = await fetch(`${origin}/install/zcc-host.tgz`);
      if (!response.ok) throw new Error(`Artifact HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await writeFile(join(root, 'host.tgz'), bytes, { mode: 0o600 });
      if (await run('/usr/bin/tar', ['-xzf', join(root, 'host.tgz'), '-C', root]) !== 0) throw new Error('Cannot unpack artifact');
      const safeEnrollment = await run(process.execPath, [join(root, 'join.mjs'), 'join', '--check-enrollment', '--server-url', origin]);
      await writeFile(join(root, 'auth.json'), JSON.stringify({ hostId: '11111111-1111-4111-8111-111111111111', hostKey: 'saved-key', serverUrl: 'https://old.example' }));
      return {
        accepted: await run(process.execPath, [join(root, 'join.mjs'), '--check-protocol', String(version.protocolVersion)]),
        rejected: await run(process.execPath, [join(root, 'join.mjs'), '--check-protocol', String(version.protocolVersion + 1)]),
        safeEnrollment,
        refusedEnrollment: await run(process.execPath, [join(root, 'join.mjs'), 'join', '--check-enrollment', '--server-url', origin]),
        consentedEnrollment: await run(process.execPath, [join(root, 'join.mjs'), 'join', '--check-enrollment', '--server-url', origin, '--replace-enrollment'])
      };
    } finally { await rm(root, { recursive: true, force: true }); }
  }, origin);
  expect(result).toEqual({ accepted: 0, rejected: 1, safeEnrollment: 0, refusedEnrollment: 1, consentedEnrollment: 0 });
});
