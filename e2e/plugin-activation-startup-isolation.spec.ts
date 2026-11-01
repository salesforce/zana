import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import type { InstalledPluginRow } from '../apps/server/src/plugins/plugin-store.js';

for (const damagedJournal of [false, true]) {
  test(`built Electron starts and manages providers with OS metadata${damagedJournal ? ' and an unreadable activation journal' : ''}`, async ({ home }) => {
    test.setTimeout(120_000);
    const source = process.env.ZCC_E2E_APP_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
    const bundle = join(home, 'runtime-plugins'); mkdirSync(bundle);
    const ids = ['provider-codex', 'provider-claude-code', 'provider-acp', 'provider-pi'];
    for (const id of ids) cpSync(join(source, 'plugins', id), join(bundle, id), {
      recursive: true, filter: path => !path.split(sep).includes('node_modules')
    });
    const activations = join(home, '.zcc/plugin-activations'); mkdirSync(activations, { recursive: true });
    writeFileSync(join(activations, '.DS_Store'), 'Finder metadata');
    const damaged = join(activations, randomUUID());
    if (damagedJournal) { mkdirSync(damaged); writeFileSync(join(damaged, 'journal.json'), 'damaged journal'); }
    const app = await launchApp(home, { env: {
      ZCC_BUNDLED_PLUGINS_DIR: bundle, ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0',
      ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off'
    }, initialConfig: { sponsorPromptDismissed: true } });
    try {
      const win = app.window;
      const states = () => win.evaluate(async ids => {
        const plugins = await window.cc.pluginApps.list();
        return ids.map(id => ({ id, status: plugins.find(row => row.id === id)?.status }));
      }, ids);
      await expect.poll(states, { timeout: 60_000 }).toEqual(ids.map(id => ({ id, status: 'running' })));
      await win.getByTestId('nav-extensions').click();
      await win.getByTestId('extensions-nav-installed').click();
      await win.getByRole('button', { name: /^Coding agents/ }).click();
      for (const id of ['provider-claude-code', 'provider-acp']) {
        await expect(win.getByTestId(`plugin-row-${id}`)).toBeVisible();
        expect(await win.evaluate(id => window.cc.pluginApps.setEnabled(id, false), id)).toMatchObject({ ok: true });
        expect(await win.evaluate(id => window.cc.pluginApps.setEnabled(id, true), id)).toMatchObject({ ok: true });
        expect(await win.evaluate(id => window.cc.pluginApps.reload(id), id)).toMatchObject({ ok: true });
      }
      await expect.poll(states).toEqual(ids.map(id => ({ id, status: 'running' })));
      const registered = await win.evaluate(async () => {
        const response = await fetch('/api/v1/threads/providers');
        if (!response.ok) throw Error(`Provider catalog failed: ${response.status}`);
        const body = await response.json(); return body.providers.map((row: { id: string }) => row.id);
      });
      expect(registered).toEqual(expect.arrayContaining(['codex', 'claude-code', 'acp-opencode', 'pi']));
      expect(readFileSync(join(activations, '.DS_Store'), 'utf8')).toBe('Finder metadata');
      if (damagedJournal) expect(readFileSync(join(damaged, 'journal.json'), 'utf8')).toBe('damaged journal');
    } finally { await closeApp(app.electron); }
  });
}

test('an unreadable journal blocks a recovered builtin until its pending activation can be restored', async ({ home }, testInfo) => {
  test.setTimeout(180_000);
  const build = process.env.ZCC_E2E_APP_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
  const version = JSON.parse(readFileSync(join(build, 'package.json'), 'utf8')).version;
  const bundle = join(home, 'runtime-plugins');
  const ids = ['provider-acp', 'provider-codex'];
  for (const id of ids) cpSync(join(build, 'plugins', id), join(bundle, id), {
    recursive: true, filter: path => !path.split(sep).includes('node_modules')
  });
  const options = { env: {
    ZCC_BUNDLED_PLUGINS_DIR: bundle, ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0',
    ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off'
  }, initialConfig: { sponsorPromptDismissed: true } };
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, options);
    await expect.poll(() => app!.window.evaluate(async ids => {
      const plugins = await window.cc.pluginApps.list();
      return ids.map(id => ({ id, status: plugins.find(row => row.id === id)?.status }));
    }, ids), { timeout: 60_000 }).toEqual(ids.map(id => ({ id, status: 'running' })));
    await closeApp(app.electron); app = undefined;

    const data = join(home, '.zcc'), registryFile = join(data, 'plugins/installed.json');
    const registry = JSON.parse(readFileSync(registryFile, 'utf8')) as { version: 1; plugins: InstalledPluginRow[] };
    const installed = registry.plugins.find(row => row.id === 'provider-acp');
    if (!installed?.serverEntry) throw Error('Missing installed ACP builtin runtime');
    const previousRoot = join(data, 'plugins/generations', randomUUID(), 'builtin');
    const candidateRoot = join(data, 'plugins/generations', randomUUID(), 'builtin');
    cpSync(installed.rootDir, previousRoot, { recursive: true });
    cpSync(installed.rootDir, candidateRoot, { recursive: true });
    const previous = { ...installed, rootDir: previousRoot, bundledRecoveryVersion: version };
    const candidate = { ...previous, rootDir: candidateRoot };
    const marker = join(home, 'candidate-executed');
    writeFileSync(join(candidateRoot, installed.serverEntry), `import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(marker)}, 'candidate code executed');
      export default () => {};
    `);

    const owned = join(data, 'plugins/provider-acp'); mkdirSync(owned, { recursive: true });
    const before = JSON.stringify({ saved: 'before' }), live = JSON.stringify({ saved: 'candidate' });
    writeFileSync(join(owned, 'kv.json'), live);
    const activations = join(data, 'plugin-activations'), journalId = randomUUID();
    const journalRoot = join(activations, journalId), snapshot = join(journalRoot, 'snapshot');
    mkdirSync(snapshot, { recursive: true }); writeFileSync(join(snapshot, 'kv.json'), before);
    writeFileSync(join(journalRoot, 'journal.json'), JSON.stringify({
      version: 1, id: journalId, phase: 'activating', previous, candidate, createdAt: Date.now(),
      files: [{ path: 'kv.json', size: Buffer.byteLength(before), digest: createHash('sha256').update(before).digest('hex') }]
    }));
    const damagedId = randomUUID(), damagedRoot = join(activations, damagedId);
    mkdirSync(damagedRoot); writeFileSync(join(damagedRoot, 'journal.json'), 'damaged journal');
    registry.plugins = registry.plugins.map(row => row.id === candidate.id ? candidate : row);
    writeFileSync(registryFile, JSON.stringify(registry));

    app = await launchApp(home, options);
    const win = app.window;
    const plugin = (id: string) => win.evaluate(async id => (await window.cc.pluginApps.list()).find(row => row.id === id), id);
    await expect.poll(() => plugin('provider-acp'), { timeout: 60_000 }).toMatchObject({
      status: 'degraded', statusDetail: expect.stringContaining(damagedId)
    });
    await expect.poll(() => plugin('provider-codex')).toMatchObject({ status: 'running' });
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(join(owned, 'kv.json'), 'utf8')).toBe(live);
    expect(readFileSync(join(damagedRoot, 'journal.json'), 'utf8')).toBe('damaged journal');
    expect(await win.evaluate(() => window.cc.pluginApps.setEnabled('provider-acp', true))).toMatchObject({
      ok: false, message: expect.stringContaining('Repair the journal directory')
    });
    const providers = await win.evaluate(async () => (await (await fetch('/api/v1/threads/providers')).json()).providers);
    expect(providers.some((row: { id: string; available: boolean }) => row.id === 'acp-opencode' && row.available !== false)).toBe(false);

    // Repair the unrelated malformed entry; the intact transaction can now replay.
    rmSync(damagedRoot, { recursive: true });
    expect(await win.evaluate(() => window.cc.pluginApps.setEnabled('provider-acp', true))).toMatchObject({ ok: true });
    await expect.poll(() => plugin('provider-acp'), { timeout: 60_000 }).toMatchObject({ status: 'running' });
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(join(owned, 'kv.json'), 'utf8')).toBe(before);
    expect(existsSync(candidateRoot)).toBe(false);
    expect(readdirSync(activations)).toEqual([]);
    const restored = JSON.parse(readFileSync(registryFile, 'utf8')).plugins.find((row: InstalledPluginRow) => row.id === 'provider-acp');
    expect(restored.rootDir).toBe(previousRoot);
    const proof = testInfo.outputPath('recovered-builtin-journal-proof.json');
    writeFileSync(proof, JSON.stringify({ journalId, damagedId, candidateExecuted: false, restoredPreviousGeneration: true, restoredOwnedState: true }, null, 2));
    await testInfo.attach('recovered-builtin-journal-proof', { path: proof, contentType: 'application/json' });
  } finally { if (app) await closeApp(app.electron); }
});
