import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

for (const signedIn of [true, false]) {
  test.describe(signedIn ? 'Cursor with saved credentials' : 'Cursor signed out', () => {
    test.use({
      initialConfig: { harnessCursorEnabled: true },
      launchEnv: async ({ home }, use) => {
        const bin = join(home, 'cursor-bin');
        mkdirSync(bin);
        const log = join(home, 'cursor-requests.jsonl');
        const fixture = new URL('../plugins/provider-acp/src/bridge/fake-acp-agent.mjs', import.meta.url).href;
        writeFileSync(join(bin, 'cursor-agent'), `#!${process.execPath}
if (process.argv.includes('--version') || process.argv.includes('--help')) { console.log('cursor-agent 2026.10.01'); process.exit(0); }
process.env.FAKE_ACP_AUTH_METHODS = 'cursor_login';
process.env.FAKE_ACP_CURSOR_LOGIN_MISSING = ${JSON.stringify(signedIn ? '0' : '1')};
process.env.FAKE_ACP_BROWSER_LOG = ${JSON.stringify(join(home, 'browser-opened'))};
process.env.FAKE_ACP_MODEL_CONFIG = '1';
process.env.FAKE_ACP_REQUEST_LOG = ${JSON.stringify(log)};
await import(${JSON.stringify(fixture)});
`, { mode: 0o700 });
        const shellInit = `export PATH='${bin.replaceAll("'", "'\\''")}':"$PATH"\n`;
        for (const name of ['.zshrc', '.bashrc', '.bash_profile']) writeFileSync(join(home, name), shellInit);
        await use({ PATH: `${bin}:${process.env.PATH ?? ''}`, ZDOTDIR: home, NO_OPEN_BROWSER: '' });
      }
    });

    test('model refresh uses saved credentials without opening a login flow', async ({ app, home }) => {
      const win = app.window;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const options = await win.evaluate(async () => {
          const response = await fetch('/api/v1/system/execution-options?providerId=acp-cursor&refresh=1');
          if (!response.ok) throw new Error(`Model refresh failed: ${response.status}`);
          return response.json();
        });
        if (signedIn) {
          expect(options.modelLoadError).toBeNull();
          expect(options.models).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'fake/default' })]));
        } else {
          expect(options.modelLoadError).toMatchObject({ providerId: 'acp-cursor', code: 'auth_required' });
          expect(options.models).toEqual([]);
        }
      }
      await win.getByTestId('model-reasoning-picker-trigger').click();
      await win.getByTestId('model-reasoning-provider-acp-cursor').click();
      if (signedIn) {
        await expect(win.getByRole('button', { name: 'Fake Default', exact: true })).toBeVisible();
      } else {
        await expect(win.getByTestId('model-reasoning-picker-menu').getByText('Sign in with cursor-agent login', { exact: true })).toBeVisible();
      }
      const log = join(home, 'cursor-requests.jsonl');
      expect(existsSync(log)).toBe(true);
      const methods = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line).method);
      if (signedIn) expect(methods).toContain('session/new');
      else expect(methods).not.toContain('session/new');
      expect(methods).toContain('authenticate');
      expect(existsSync(join(home, 'browser-opened'))).toBe(false);
    });
  });
}
