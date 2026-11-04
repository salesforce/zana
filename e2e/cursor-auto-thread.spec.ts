import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';

test.use({
  initialConfig: { sponsorPromptDismissed: true },
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'cursor-bin');
    mkdirSync(bin);
    const shellInit = `export PATH='${bin.replaceAll("'", "'\\''")}':"$PATH"\n`;
    for (const name of ['.zshrc', '.bashrc', '.bash_profile']) writeFileSync(join(home, name), shellInit);
    writeFileSync(join(bin, 'cursor-agent'), `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('2026.09.28-64d2043'); process.exit(0); }
process.env.FAKE_ACP_CURSOR_PARAMETERIZED_MODELS = '1';
process.env.FAKE_ACP_AUTH_METHODS = 'cursor_login';
process.env.FAKE_ACP_PROMPT_PREFIX = 'cursor-probe:';
process.env.FAKE_ACP_REQUEST_LOG = ${JSON.stringify(join(home, 'cursor-requests.jsonl'))};
await import(${JSON.stringify(new URL('../plugins/provider-acp/src/bridge/fake-acp-agent.mjs', import.meta.url).href)});
`, { mode: 0o700 });
    await use({ PATH: `${bin}:${process.env.PATH ?? ''}`, ZDOTDIR: home });
  },
});

test('Cursor Auto launches and accepts a follow-up in the built thread UI', async ({ app }) => {
  test.setTimeout(120_000);
  const root = join(app.home, 'cursor-project');
  mkdirSync(root);
  await waitForThreadProvider(app.window, 'acp-cursor');
  const id = await app.window.evaluate(async root => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'acp-cursor',
        model: 'default', reasoningLevel: 'medium', serviceTier: 'default', acpMode: 'agent',
        input: 'cursor-probe:echo-selected-model', permissionMode: 'full' }),
    });
    const body = await response.json();
    if (!response.ok) throw Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, root);
  await app.window.evaluate(id => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  const timeline = app.window.getByTestId('thread-timeline');
  await expect(timeline).toContainText('selected-model:default', { timeout: 30_000 });
  const status = () => app.window.evaluate(async id =>
    (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id);
  await expect.poll(status).toBe('idle');
  const composer = app.window.getByTestId('thread-command-input');
  await composer.fill('cursor-probe:echo-selected-model');
  await composer.press('Enter');
  await expect(timeline.getByText('selected-model:default', { exact: true })).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(status).toBe('idle');
  await expect(timeline).not.toContainText('Invalid params');

  const log = join(app.home, 'cursor-requests.jsonl');
  expect(existsSync(log)).toBe(true);
  const requests = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(requests.some(request => request.method === 'initialize' &&
    request.params.clientCapabilities?._meta?.parameterizedModelPicker === true)).toBe(true);
  const authenticateIndex = requests.findIndex(request => request.method === 'authenticate');
  expect(authenticateIndex).toBeGreaterThanOrEqual(0);
  expect(requests[authenticateIndex].params).toEqual({ methodId: 'cursor_login', _meta: { headless: true } });
  expect(requests.findIndex(request => request.method === 'session/new')).toBeGreaterThan(authenticateIndex);
  expect(requests.filter(request => request.method === 'session/prompt')).toHaveLength(2);
  expect(requests.some(request => request.params?.value === 'auto-smart' || request.params?.modelId === 'auto-smart')).toBe(false);

  // A provider refusal must retain its actionable detail across the bridge,
  // runtime, HTTP event store, and renderer rather than just "Invalid params".
  await composer.fill('reject-with-error-data');
  await composer.press('Enter');
  await expect(timeline).toContainText('Invalid params: Invalid model value: auto-smart', { timeout: 30_000 });
  await expect.poll(status).toBe('error');
});
