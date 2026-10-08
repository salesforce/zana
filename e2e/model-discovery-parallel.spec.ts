import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';

// Hold four real child processes at the production boundary. Codex must still
// reach the picker; a renderer queue of two or host lane of three deadlocks here.
test.use({
  initialConfig: { harnessCursorEnabled: true, harnessOpenCodeEnabled: true,
    harnessGrokEnabled: true, harnessMastracodeEnabled: true, harnessCodexEnabled: true },
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'parallel-bin');
    mkdirSync(bin);
    const shellInit = `export PATH='${bin.replaceAll("'", "'\\''")}':"$PATH"\n`;
    for (const name of ['.zshrc', '.bashrc', '.bash_profile']) writeFileSync(join(home, name), shellInit);
    for (const name of ['cursor-agent', 'opencode', 'grok', 'mastracode']) {
      writeFileSync(join(bin, name), `#!${process.execPath}
if (process.argv.includes('--version') || process.argv.includes('--help')) { console.log(${JSON.stringify(`${name} 2026.09.28`)}); process.exit(0); }
const { existsSync, appendFileSync } = await import('node:fs');
appendFileSync(${JSON.stringify(join(home, 'parallel-started.log'))}, ${JSON.stringify(`${name}\n`)});
const deadline = Date.now() + 60000;
while (!existsSync(${JSON.stringify(join(home, 'parallel-release'))}) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
if (process.argv.includes('models')) { console.log('fake/default'); process.exit(0); }
process.env.FAKE_ACP_MODEL_CONFIG = '1';
process.env.FAKE_ACP_MODEL_COUNT = '500';
await import(${JSON.stringify(new URL('../plugins/provider-acp/src/bridge/fake-acp-agent.mjs', import.meta.url).href)});
`, { mode: 0o700 });
    }
    const fixture = fileURLToPath(new URL('../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs', import.meta.url));
    writeFileSync(join(bin, 'codex'), `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('codex-cli 0.159.3'); process.exit(0); }
if (!process.argv.includes('app-server')) process.exit(64);
process.argv = [process.execPath, ${JSON.stringify(fixture)}];
await import(${JSON.stringify(new URL('../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs', import.meta.url).href)});
`, { mode: 0o700 });
    await use({ PATH: `${bin}:${process.env.PATH ?? ''}`, ZDOTDIR: home });
  }
});

test('Codex models reach the picker while four other provider processes are still discovering', async ({ app, home }, testInfo) => {
  const win = app.window;
  const streams: string[][] = [];
  const discoveryEvents: string[] = [];
  const startedAt = Date.now();
  win.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/execution-options')) discoveryEvents.push(`${Date.now() - startedAt} request ${url.search}`);
    if (url.searchParams.get('stream') === '1') streams.push(url.searchParams.getAll('providerId'));
  });
  win.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.endsWith('/execution-options')) discoveryEvents.push(`${Date.now() - startedAt} response ${response.status()} ${url.search}`);
  });
  try {
    await win.reload();
    await win.getByTestId('model-reasoning-picker-trigger').click();
    await win.getByTestId('model-reasoning-provider-codex').click();
    await expect(win.getByRole('button', { name: 'Fake model', exact: true })).toBeVisible({ timeout: 20_000 });
    expect(existsSync(join(home, 'parallel-release'))).toBe(false);
    await expect.poll(() => {
      const path = join(home, 'parallel-started.log');
      return existsSync(path) ? [...new Set(readFileSync(path, 'utf8').trim().split('\n'))].sort() : [];
    }).toEqual(['cursor-agent', 'grok', 'mastracode', 'opencode']);
    expect(streams.some(ids => ids.length >= 4)).toBe(true);
    appendFileSync(join(home, 'parallel-release'), 'done');
    await win.getByTestId('model-reasoning-provider-acp-opencode').click();
    await expect(win.getByTestId('model-reasoning-picker-menu').getByText('Loading models', { exact: true })).toHaveCount(0);
    await expect(win.getByTestId('model-reasoning-picker-menu').getByRole('button').first()).toBeVisible();

    // A cached roster can outlive a plugin registration during an upgrade.
    // Exercise the real API, host discovery and Electron renderer together.
    const discovery = await win.evaluate(async () => {
      const response = await fetch('/api/v1/system/execution-options?stream=1&providerId=codex&providerId=removed-provider');
      return { status: response.status, rows: (await response.text()).trim().split('\n').map(line => JSON.parse(line)) };
    });
    expect(discovery.status).toBe(200);
    expect(discovery.rows.find(row => row.providerId === 'removed-provider').options.modelLoadError.code).toBe('provider_unavailable');
    const codex = discovery.rows.find(row => row.providerId === 'codex').options;
    expect(codex.modelLoadError).toBeNull();
    expect(codex.models.some((model: { displayName: string }) => model.displayName === 'Fake model')).toBe(true);
  } finally {
    writeFileSync(join(home, 'parallel-release'), 'cleanup');
    await testInfo.attach('model-discovery-events', { body: discoveryEvents.join('\n'), contentType: 'text/plain' });
  }
});
