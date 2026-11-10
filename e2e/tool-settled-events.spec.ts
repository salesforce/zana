/**
 * Electron production-boundary: `tool.settled` reaches plugins from a PTY thread and a Modern thread.
 * Two observer copies are installed before launch. Both subscribe; only the one declaring
 * `zcc.toolResults: 'preview'` gets `outputPreview`, which is redacted and capped at 4 KiB. Subscribing is
 * itself the opt-in for the metadata-only event, so the plain plugin receives the event WITHOUT a preview.
 *
 * PTY: a stub CLI runs the REAL PostToolUse relay main injected into its `--settings`, as Claude does.
 * Modern: the scripted Claude CLI speaks the real SDK hook protocol and runs the registered PostToolUse
 * callbacks after an allowed Bash. No model is involved.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';
import {
  addProject, claudeStub, installObservers, openTerminal, prepareScriptedClaude, readLaunch, rpcOn, say,
  waitForRunning, waitForSealedPolicy, writeHomeConfig, writeNodeStub
} from './fixtures/aida-p2.js';

const PREVIEW = 'p2-settled-preview';
const PLAIN = 'p2-settled-meta';
const MODEL_CLI = fileURLToPath(new URL('./fixtures/claude-model-cli.cjs', import.meta.url));
const PREVIEW_CAP_BYTES = 4 * 1024;
const SECRET = 'fixture-secret-must-be-redacted';

interface Settled {
  invocationId: string; sessionId?: string; threadId?: string; projectId: string; providerId: string; toolName: string;
  state: string; durationMs: number; exitCode?: number; outputBytes?: number; outputPreview?: string;
}

const VARIANTS = { [PREVIEW]: { toolResults: 'preview' }, [PLAIN]: {} };

function expectPreview(event: Settled, marker: string): void {
  expect(event.outputPreview, 'the preview plugin must receive outputPreview').toBeDefined();
  expect(event.outputPreview).toContain(marker);
  expect(event.outputPreview).not.toContain(SECRET);
  expect(Buffer.byteLength(event.outputPreview!)).toBeLessThanOrEqual(PREVIEW_CAP_BYTES);
}

const pty = base.extend<{ stubDir: string }>({
  stubDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-p2-settled-pty-'));
    try { await use(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  },
  launchEnv: async ({ home, stubDir }, use) => {
    installObservers(home, VARIANTS);
    writeHomeConfig(home, { claudeBinary: writeNodeStub(stubDir, 'claude-stub.cjs', claudeStub(MODEL_CLI)) });
    await use({});
  }
});

pty('a PTY thread settles a tool: preview plugin gets a redacted, capped preview; the plain plugin gets none', async ({ app, stubDir, home }) => {
  pty.setTimeout(150_000);
  const page = app.window;
  await waitForRunning(page, [PREVIEW, PLAIN]);
  await waitForSealedPolicy(app);
  const projectId = await addProject(page, join(home, 'settled-pty-project'));
  const sessionId = await openTerminal(page, projectId, 'claude', 'Settled PTY probe');
  await expect.poll(() => readLaunch(stubDir, sessionId) !== undefined, { timeout: 30_000, message: 'PTY never started' }).toBe(true);
  expect(readLaunch(stubDir, sessionId)!.settledUrl, 'main must inject the tool-settled relay').toContain('/hook/toolsettled/');

  await say(page, sessionId, 'settle one');
  await expect.poll(() => existsSync(join(stubDir, 'settle-one.json')), { timeout: 20_000 }).toBe(true);
  expect(JSON.parse(readFileSync(join(stubDir, 'settle-one.json'), 'utf8'))).toMatchObject({ hasRelay: true });

  const preview = rpcOn(page, PREVIEW);
  const plain = rpcOn(page, PLAIN);
  await expect.poll(async () => (await preview<Settled[]>('settledList')).length, { timeout: 20_000 }).toBe(1);
  const [event] = await preview<Settled[]>('settledList');
  expect(event).toMatchObject({ sessionId, projectId, providerId: 'claude-code', toolName: 'Bash', state: 'succeeded', exitCode: 0 });
  expect(event.invocationId).toMatch(/^[a-f0-9]{64}$/);
  expectPreview(event, 'PTY_SETTLED_OUTPUT:one');
  expect(event.outputBytes).toBeGreaterThan(PREVIEW_CAP_BYTES);

  await expect.poll(async () => (await plain<Settled[]>('settledList')).length, { timeout: 20_000 }).toBe(1);
  const [metadata] = await plain<Settled[]>('settledList');
  expect(metadata).toMatchObject({ invocationId: event.invocationId, toolName: 'Bash', state: 'succeeded' });
  expect(metadata.outputPreview).toBeUndefined();
  expect(JSON.stringify(metadata)).not.toContain('PTY_SETTLED_OUTPUT');
});

const modern = base.extend({
  launchEnv: async ({ home }, use) => {
    installObservers(home, VARIANTS);
    await use(prepareScriptedClaude(home));
  }
});

modern('a Modern Claude thread settles a tool: preview plugin gets a redacted, capped preview; the plain plugin gets none', async ({ app, home }) => {
  modern.setTimeout(180_000);
  const page = app.window;
  await waitForRunning(page, [PREVIEW, PLAIN]);
  await waitForThreadProvider(page, 'claude-code');
  await waitForSealedPolicy(app);
  const root = join(home, 'settled-modern-project');
  mkdirSync(root, { recursive: true });
  const cwd = realpathSync(root);
  const projectId = await addProject(page, cwd);
  const threadId = await page.evaluate(async (projectId) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'claude-code', input: 'Native fixture standby', permissionMode: 'accept-edits' })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return (result.thread ?? result.value).id as string;
  }, projectId);
  const status = () => page.evaluate(async (id) => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status as string, threadId);
  await expect.poll(status, { timeout: 30_000 }).toBe('idle');
  await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/threads/${id}/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'NATIVE_POLICY:settled-one', mode: 'queue-if-active' })
    });
    if (!response.ok) throw new Error(await response.text());
  }, threadId);

  const journal = join(cwd, '.native-policy-provider.jsonl');
  await expect.poll(() => existsSync(journal) && readFileSync(journal, 'utf8').includes('"phase":"post"'), { timeout: 40_000, message: 'the scripted CLI never ran PostToolUse' }).toBe(true);
  const post = readFileSync(journal, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((row) => row.phase === 'post');
  expect(post.callbacks.length, 'the SDK must register PostToolUse callbacks').toBeGreaterThan(0);
  expect(post.failed).toBeUndefined();

  const preview = rpcOn(page, PREVIEW);
  const plain = rpcOn(page, PLAIN);
  await expect.poll(async () => (await preview<Settled[]>('settledList')).length, { timeout: 30_000 }).toBe(1);
  const [event] = await preview<Settled[]>('settledList');
  expect(event).toMatchObject({ threadId, projectId, providerId: 'claude-code', toolName: 'Bash', state: 'succeeded' });
  expectPreview(event, 'SETTLED_OUTPUT:settled-one');

  await expect.poll(async () => (await plain<Settled[]>('settledList')).length, { timeout: 30_000 }).toBe(1);
  const [metadata] = await plain<Settled[]>('settledList');
  expect(metadata).toMatchObject({ invocationId: event.invocationId, threadId, toolName: 'Bash' });
  expect(metadata.outputPreview).toBeUndefined();
});
