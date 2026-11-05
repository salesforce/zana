/**
 * Electron production-boundary: dispatch admission carries prompt text only to a plugin that declared
 * `zcc.promptAccess`. Two copies of the observer fixture are installed before launch, one with the grant
 * and one without. A marker in the prompt makes the granted plugin reject, on a PTY entry (CLI Agent spawn),
 * a Modern create and a squad member start. The granted plugin sees redacted, capped text; the other gets
 * no `prompt` field at all. Scripted fake CLIs only, no model spend.
 */
import { execFileSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { test as base, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import {
  FIXTURE_BIN, addProject, installObservers, rpcOn, waitForRunning, waitForSealedPolicy
} from './fixtures/aida-p2.js';

const GRANTED = 'p2-prompt-yes';
const PLAIN = 'p2-prompt-no';
const MARKER = 'P2_REJECT_ME';
const SECRET = 'sk-p2fixturesecret0123456789abcdefXYZ';
const REJECT_MESSAGE = 'p2-prompt-blocked';
const PROMPT_CAP_BYTES = 32 * 1024;
const PRODUCT_PORT = 31_000 + (process.pid % 9_000);
const PRODUCT_URL = `http://127.0.0.1:${PRODUCT_PORT}`;
const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });

interface Dispatch {
  surface?: string; entry?: string; hasPrompt: boolean;
  prompt?: { text: string; truncated: boolean; attachmentCount: number }; decision: 'proceed' | 'reject';
}

const test = base.extend<{ squad: boolean }>({
  squad: [false, { option: true }],
  launchEnv: async ({ home, squad }, use) => {
    installObservers(home, { [GRANTED]: { promptAccess: true }, [PLAIN]: {} });
    // The squad run keeps the shipped provider path (no fake provider), on the scripted ACP binary.
    await use(squad
      ? {
        PATH: `${FIXTURE_BIN}${delimiter}${process.env.PATH ?? ''}`, FAKE_ACP_MODEL_CONFIG: '1', FAKE_ACP_MODE_CONFIG: '1',
        FAKE_ACP_MODE_OPTIONS: 'build:Build,plan:Plan', FAKE_ACP_HTTP_MCP: '1', FAKE_ACP_PROMPT_PREFIX: 'P2_FIXTURE:'
      }
      : { ZCC_SERVER_PORT: String(PRODUCT_PORT), ZCC_FAKE_PROVIDER: '1' });
  }
});

test.use({
  e2e: true,
  initialConfig: {
    claudeBinary: agent.path, defaultHarness: 'claude', sponsorPromptDismissed: true, tmuxScope: 'off',
    teamJobLaunchEnabled: true, harnessOpenCodeEnabled: true, autoRenameTabs: false
  }
});
test.afterAll(() => agent.cleanup());
test.setTimeout(150_000);

const post = (path: string, body: unknown) => fetch(`${PRODUCT_URL}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});

async function waitForProduct(): Promise<void> {
  await expect.poll(async () => {
    try { return (await fetch(`${PRODUCT_URL}/api/v1/health`)).ok; } catch { return false; }
  }, { timeout: 30_000, message: 'product HTTP never became ready' }).toBe(true);
}

test('prompt text reaches only the granted plugin, redacted and capped, and rejects a PTY entry and a Modern create', async ({ app, home }) => {
  const page = app.window;
  await waitForRunning(page, [GRANTED, PLAIN]);
  await waitForProduct();
  const granted = rpcOn(page, GRANTED);
  const plain = rpcOn(page, PLAIN);
  const projectId = ((await (await post('/api/v1/projects', { path: join(home, 'prompt-project') })).json()) as { project: { id: string } }).project.id;
  await granted('setRejectMarker', { marker: MARKER });

  const prompt = `please run ${MARKER} with token=${SECRET} and Bearer abcdefghijklmnop0123`;
  const spawn = await post('/api/v1/cli-agents', { projectId, profile: 'claude', prompt, title: '[zcc-live:e2e] prompt text' });
  const spawnBody = await spawn.json() as { message?: string; session?: unknown };
  expect(spawn.status, JSON.stringify(spawnBody)).toBe(409);
  expect(spawnBody.message).toContain(REJECT_MESSAGE);
  expect(spawnBody.session).toBeUndefined();

  const created = await post('/api/v1/threads', { projectId, providerId: 'fake', title: 'prompt text', input: prompt });
  const createdBody = await created.json() as { code?: string; message?: string };
  expect(created.status, JSON.stringify(createdBody)).toBe(409);
  expect(createdBody.code).toBe('dispatch_rejected');
  expect(createdBody.message).toContain(REJECT_MESSAGE);

  await expect.poll(async () => (await granted<Dispatch[]>('dispatchList')).filter((row) => row.decision === 'reject').map((row) => row.surface).sort())
    .toEqual(['modern', 'pty']);
  const seen = await granted<Dispatch[]>('dispatchList');
  for (const surface of ['pty', 'modern']) {
    const row = seen.find((entry) => entry.surface === surface && entry.entry === 'initial')!;
    expect(row.hasPrompt).toBe(true);
    expect(row.prompt!.text).toContain(MARKER);
    // Redacted, never the raw secret or bearer value.
    expect(row.prompt!.text).not.toContain(SECRET);
    expect(row.prompt!.text).not.toContain('abcdefghijklmnop0123');
    expect(Buffer.byteLength(row.prompt!.text)).toBeLessThanOrEqual(PROMPT_CAP_BYTES);
  }

  // The plugin without the grant is asked about the same dispatches and sees no prompt field.
  await expect.poll(async () => (await plain<Dispatch[]>('dispatchList')).map((row) => row.surface).sort()).toEqual(['modern', 'pty']);
  for (const row of await plain<Dispatch[]>('dispatchList')) {
    expect(row.hasPrompt).toBe(false);
    expect(row.prompt).toBeUndefined();
  }

  // A prompt past the cap arrives truncated and within the cap.
  await granted('setRejectMarker', { marker: '' });
  await granted('dispatchClear');
  const long = `LONG_PROMPT_START ${'filler words '.repeat(5_000)} LONG_PROMPT_END`;
  expect(Buffer.byteLength(long)).toBeGreaterThan(PROMPT_CAP_BYTES);
  const allowed = await post('/api/v1/threads', { projectId, providerId: 'fake', title: 'long prompt', input: long });
  expect(allowed.ok, JSON.stringify(await allowed.clone().json())).toBe(true);
  await expect.poll(async () => (await granted<Dispatch[]>('dispatchList')).filter((row) => row.surface === 'modern').length).toBeGreaterThan(0);
  const capped = (await granted<Dispatch[]>('dispatchList')).find((row) => row.surface === 'modern')!;
  expect(capped.prompt!.truncated).toBe(true);
  expect(Buffer.byteLength(capped.prompt!.text)).toBeLessThanOrEqual(PROMPT_CAP_BYTES);
  expect(capped.prompt!.text).toContain('LONG_PROMPT_START');
  expect(capped.prompt!.text).not.toContain('LONG_PROMPT_END');
});

test.describe('squad member start', () => {
  test.use({ squad: true });

  test('the granted plugin sees the member start prompt and rejects it; the plain plugin sees no text', async ({ app, home }) => {
    const page = app.window;
    await waitForRunning(page, [GRANTED, PLAIN]);
    await waitForSealedPolicy(app);
    await expect.poll(() => page.evaluate(async () =>
      (await (await fetch('/api/v1/threads/providers')).json()).providers.map((row: { id: string }) => row.id)
    ), { timeout: 30_000 }).toContain('acp-opencode');

    const root = join(home, 'prompt-squad-project');
    mkdirSync(root, { recursive: true });
    const cwd = realpathSync(root);
    const plan = join(cwd, 'plan.md');
    writeFileSync(join(cwd, 'README.md'), 'Prompt text squad fixture.\n');
    writeFileSync(plan, [
      '# Prompt text squad', '', '### inspect: Inspect <!-- executable-step -->', `- **Work:** Report ${MARKER} after reading README.md.`,
      '- **Depends on:** None', '- **Mode:** read-only', '- **Verification:** README.md exists.', ''
    ].join('\n'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, HOME: home }, timeout: 15_000 });
    git('init', '-b', 'main');
    git('add', 'README.md', 'plan.md');
    git('-c', 'user.name=Prompt Text E2E', '-c', 'user.email=prompt-text@example.test', 'commit', '-m', 'Fixture setup');
    const projectId = await addProject(page, cwd);

    const granted = rpcOn(page, GRANTED);
    const plain = rpcOn(page, PLAIN);
    await granted('setRejectMarker', { marker: MARKER });
    const guidance = `Stay in scope. ${MARKER} token=${SECRET}`;
    // The result is deliberately not asserted: a refused member start may surface as a failed launch.
    await page.evaluate(async ({ projectId, guidance, plan }) => {
      for (const id of ['p2-prompt-worker', 'p2-prompt-coordinator']) {
        const saved = await window.cc.personas.save({
          id, name: id, baseProfile: 'opencode', model: 'fake/default', permissionMode: 'default', appendSystemPrompt: guidance
        });
        if (!saved.ok) throw new Error(JSON.stringify(saved));
      }
      const team = await window.cc.teams.save({
        id: 'p2-prompt-squad', name: 'P2 prompt squad', transport: 'MODERN', worktreeIsolation: true, routingEnforced: false,
        slots: [{ personaId: 'p2-prompt-worker', quantity: 1 }], orchestratorPersonaId: 'p2-prompt-coordinator'
      });
      if (!team.ok) throw new Error(JSON.stringify(team));
      return window.cc.teams.startJob({
        teamId: 'p2-prompt-squad', projectId, title: 'P2 prompt squad', goal: `implement ${plan}`, coordinationMode: 'structured'
      });
    }, { projectId, guidance, plan }).catch(() => undefined);

    await expect.poll(async () => (await granted<Dispatch[]>('dispatchList')).filter((row) => row.entry === 'squad-member-start').length,
      { timeout: 60_000, message: 'no squad-member-start admission reached the granted plugin' }).toBeGreaterThan(0);
    const starts = (await granted<Dispatch[]>('dispatchList')).filter((row) => row.entry === 'squad-member-start');
    for (const row of starts) {
      expect(row).toMatchObject({ surface: 'modern', hasPrompt: true, decision: 'reject' });
      expect(row.prompt!.text).toContain(MARKER);
      expect(row.prompt!.text).not.toContain(SECRET);
    }
    const plainStarts = (await plain<Dispatch[]>('dispatchList')).filter((row) => row.entry === 'squad-member-start');
    expect(plainStarts.length).toBeGreaterThan(0);
    for (const row of plainStarts) {
      expect(row.hasPrompt).toBe(false);
      expect(row.prompt).toBeUndefined();
    }
  });
});
