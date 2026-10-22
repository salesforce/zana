import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

test('failed migrations and interrupted activation restore owned state before old code runs in built Electron', async ({ home }) => {
  test.setTimeout(180_000);
  const repo = join(home, 'source'), owned = join(home, '.zcc/plugins/recovery-fixture');
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, env: gitEnv, timeout: 10_000, stdio: 'pipe' }).toString();
  const publish = (version: string, migration = '') => {
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'zcc-plugin-recovery-fixture', version,
      zcc: { name: 'Recovery fixture', description: 'Activation recovery', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
    writeFileSync(join(repo, 'server.mjs'), `import {writeFileSync} from 'node:fs'; import {join} from 'node:path'; import {homedir} from 'node:os';
      export default async api => {
        const settings=api.settings.define({name:{type:'string',label:'Name'},token:{type:'string',label:'Token',secret:true}});
        const db=api.storage.database(); db.migrate(['CREATE TABLE records(value TEXT)']);
        api.rpc.method('seed',async()=>{db.prepare('INSERT INTO records VALUES (?)').run('before');await api.storage.kv.set('saved','before');await api.storage.kv.set('schedule:job:last','before');});
        api.rpc.method('read',async()=>({version:'${version}',rows:db.prepare('SELECT value FROM records').all(),saved:await api.storage.kv.get('saved'),schedule:await api.storage.kv.get('schedule:job:last'),settings:await settings.get()}));
        ${migration}
      };`);
    if (!existsSync(join(repo, '.git'))) git(['init']);
    git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', version]);
  };
  const mutate = `const owned=join(homedir(),'.zcc/plugins/recovery-fixture');
    db.prepare("UPDATE records SET value='after'").run();
    writeFileSync(join(owned,'settings.json'),'{"name":"after"}'); writeFileSync(join(owned,'secrets/token.txt'),'secret-after');
    await api.storage.kv.set('saved','after');await api.storage.kv.set('schedule:job:last','after');`;
  publish('1.0.0');
  const url = 'https://plugin-fixture.test/recovery';
  const env = { ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off', ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0', ZCC_SKIP_PLUGIN_NPM: '1',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${pathToFileURL(repo).href}.insteadOf`, GIT_CONFIG_VALUE_0: url, GIT_ALLOW_PROTOCOL: 'file' };
  let app = await launchApp(home, { env, initialConfig: { sponsorPromptDismissed: true } });
  try {
    let win = app.window;
    expect(await win.evaluate(url => window.cc.extensions.install({ kind: 'git', url }), url)).toMatchObject({ ok: true });
    await win.evaluate(() => window.cc.pluginApps.callRpc('recovery-fixture', 'seed'));
    await win.evaluate(() => window.cc.pluginApps.setSettings('recovery-fixture', { name: 'before', token: 'secret-before' }));
    const before = await win.evaluate(() => window.cc.pluginApps.callRpc('recovery-fixture', 'read'));
    publish('2.0.0', mutate + `throw Error('failed migration');`);
    await win.evaluate(() => window.cc.pluginApps.checkUpdates());
    const failed = await win.evaluate(() => window.cc.pluginApps.applyUpdate('recovery-fixture'));
    expect(failed).toMatchObject({ ok: false, message: expect.stringContaining('was rolled back') });
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('recovery-fixture', 'read'))).toEqual(before);
    expect(readFileSync(join(owned, 'secrets/token.txt'), 'utf8').trim()).toBe('secret-before');
    expect(readdirSync(join(home, '.zcc/plugin-activations'))).toEqual([]);
    publish('3.0.0', mutate + `await api.storage.kv.set('migration-entered',true);await new Promise(()=>{});`);
    await win.evaluate(() => window.cc.pluginApps.checkUpdates());
    await win.evaluate(() => { (window as any).__pendingPluginUpdate = window.cc.pluginApps.applyUpdate('recovery-fixture').catch(error => String(error)); });
    await expect.poll(() => JSON.parse(readFileSync(join(owned, 'kv.json'), 'utf8'))['migration-entered'], { timeout: 30_000 }).toBe(true);
    expect(readdirSync(join(home, '.zcc/plugin-activations'))).toHaveLength(1);
    await app.electron.evaluate(({ app, dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
      const child = app.getAppMetrics().find(metric => metric.name?.includes('server-runtime.js'));
      if (!child) throw Error('Missing server utility'); process.kill(child.pid, 'SIGKILL');
    });
    await closeApp(app.electron);
    app = await launchApp(home, { env, initialConfig: { sponsorPromptDismissed: true } }); win = app.window;
    await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(row => row.id === 'recovery-fixture')?.status), { timeout: 60_000 }).toBe('running');
    await expect.poll(() => win.evaluate(() => window.cc.pluginApps.callRpc('recovery-fixture', 'read'))).toEqual(before);
    expect(readFileSync(join(owned, 'secrets/token.txt'), 'utf8').trim()).toBe('secret-before');
    expect(readdirSync(join(home, '.zcc/plugin-activations'))).toEqual([]);
    const row = (await win.evaluate(() => window.cc.pluginApps.list())).find(row => row.id === 'recovery-fixture');
    expect(row?.statusDetail).toContain('Interrupted update recovered');
    publish('4.0.0', `await api.storage.kv.set('saved','committed');`);
    await win.evaluate(() => window.cc.pluginApps.checkUpdates());
    expect(await win.evaluate(() => window.cc.pluginApps.applyUpdate('recovery-fixture'))).toMatchObject({ ok: true });
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('recovery-fixture', 'read'))).toMatchObject({ version: '4.0.0', saved: 'committed', rows: [{ value: 'before' }] });
    expect(readdirSync(join(home, '.zcc/plugins/generations'))).toHaveLength(1);
  } finally { await closeApp(app.electron); }
});
