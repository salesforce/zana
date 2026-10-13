import { test, expect } from './fixtures/app.js';
import { DISABLED_CLAUDE_BINARY } from './fixtures/app-config.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('host CLI health checks suppress real provider probes in an isolated home', async ({ app }) => {
  const status = await app.window.evaluate(async () => {
    const response = await fetch('/api/v1/hosts');
    const body = await response.json();
    const hosts = Array.isArray(body) ? body : body.hosts;
    const host = hosts.find((candidate: { status: string }) => candidate.status === 'connected');
    if (!host) throw new Error('Isolated host was not enrolled');
    const checked = await fetch(`/api/v1/hosts/${host.id}/provider-clis/status`);
    if (!checked.ok) throw new Error(await checked.text());
    return await checked.json();
  });
  expect(status).toEqual({});
});

test('background naming cannot invoke real Claude from an isolated test home', async ({ app }) => {
  const binary = await app.window.evaluate(async () => (await window.cc.config.get()).claudeBinary);
  expect(binary).toBe(DISABLED_CLAUDE_BINARY);
  // Exercise the real renderer -> IPC -> LLM provider -> child process boundary.
  const result = await app.window.evaluate(() => window.cc.llmPrompts.test('builtin:tab-namer', { prompt: 'Name this isolation check' }));
  expect(result.ok).toBe(false);
  expect(result.error).toContain('Real Claude is disabled in deterministic E2E tests');
});

test('server thread naming uses the canonical binary after desktop config migration', async ({ app }) => {
  const projectPath = join(app.home, 'naming-project');
  mkdirSync(projectPath);
  const binary = join(app.home, 'fake-background-claude');
  const invoked = join(app.home, 'canonical-cli-invoked');
  writeFileSync(binary, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(invoked)}, 'called');\nprocess.stdout.write('Canonical isolated title');\n`, { mode: 0o700 });
  await app.window.evaluate(async ({ binary, disabled }) => {
    await window.cc.config.set({ claudeBinary: binary, autoRenameTabs: true });
    // The real persisted representation is harnesses.byId.claude.binary. A
    // stale legacy value must not override it in the server utility process.
    await fetch('/api/v1/config', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claudeBinary: disabled, harnesses: { byId: { claude: { binary } } } }),
    });
  }, { binary, disabled: DISABLED_CLAUDE_BINARY });
  const threadId = await app.window.evaluate(async (path) => {
    const added = await window.cc.projects.add(path);
    if (!added.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: added.value.id, providerId: 'fake', input: 'Name this isolated conversation' }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, projectPath);
  await expect.poll(() => existsSync(invoked), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => app.window.evaluate(async (id) => {
    const response = await fetch(`/api/v1/threads/${id}`);
    const body = await response.json();
    return (body.thread ?? body.value ?? body).title;
  }, threadId)).toBe('Canonical isolated title');
});
