import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

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
