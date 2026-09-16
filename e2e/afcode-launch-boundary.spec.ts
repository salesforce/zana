import { test, expect } from './fixtures/app.js';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, delimiter, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, ElectronApplication } from '@playwright/test';
import { stubOpenDialog, stubNativeDialogs } from './sdk/native-dialog.js';
import { buildPluginHost } from '../packages/plugin-build/src/build-plugin-host.js';

const binary = fileURLToPath(new URL('./fixtures/bin/afcode', import.meta.url));
const pluginPath = fileURLToPath(new URL('../plugins/provider-afcode', import.meta.url));
test.use({
  e2e: true,
  // Assert the PTY byte stream, independent of a developer's tmux screen settings.
  initialConfig: { tmuxScope: 'off', defaultHarness: 'claude' },
  launchEnv: { PATH: `${fileURLToPath(new URL('./fixtures/bin', import.meta.url))}${delimiter}${process.env.PATH ?? ''}` }
});
test.setTimeout(180_000);
test.beforeAll(async () => { await buildPluginHost(pluginPath, '2.1.2'); });

async function threadRequest(window: Page, path: string, body?: unknown) {
  return window.evaluate(async ({ path, body }) => {
    const res = await fetch('/api/v1/' + path, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));
    return result;
  }, { path, body });
}

async function setup(app: { window: Page; electron: ElectronApplication }, projectPath: string, executable = binary) {
  const { window } = app;
  await stubOpenDialog(app.electron, [[pluginPath]]);
  await stubNativeDialogs(app.electron, [0, 0]);
  const installed = await window.evaluate(() => window.cc.extensions.install({ kind: 'localDir' }));
  expect(installed, JSON.stringify(installed)).toMatchObject({ ok: true });
  const trust = window.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => window.evaluate(async () => (await window.cc.pluginApps.list()).find((p) => p.id === 'provider-afcode')), { timeout: 30_000 }).toMatchObject({ status: 'running', statusDetail: null });
  await window.evaluate(async (path) => {
    await window.cc.pluginApps.setSettings('provider-afcode', { executable: path });
    await window.cc.config.set({ afcodeBinary: path, harnessAfcodeEnabled: true, sponsorPromptDismissed: true });
  }, executable);
  return window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    return project.value.id;
  }, projectPath);
}

async function openThread(window: Page, id: string) {
  await window.evaluate((threadId) => {
    window.history.pushState({}, '', `/threads/${threadId}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  await expect(window.getByTestId('thread-detail')).toBeVisible({ timeout: 30_000 });
}

test('afcode ACP plugin streams, cancels and removes its provider on disable', async ({ app }, testInfo) => {
  const projectPath = mkdtempSync(join(tmpdir(), 'zcc-afcode-acp-'));
  let projectId: string | undefined;
  let threadId: string | undefined;
  try {
    projectId = await setup(app, projectPath);
    const created = await threadRequest(app.window, 'threads', { projectId, providerId: 'acp-afcode', model: 'acp-default', permissionMode: 'full', input: 'AFCODE_E2E:AFCODE_THREAD_READY', title: 'afcode boundary' });
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true });
    if (!created.ok) throw new Error(created.message);
    threadId = created.value.id;
    await openThread(app.window, threadId);
    await expect(app.window.getByTestId('thread-detail')).toContainText('echo:', { timeout: 60_000 });
    await threadRequest(app.window, `threads/${threadId}/send`, { model: 'acp-default', input: 'AFCODE_E2E:' + 'A'.repeat(40000) + ' AFCODE_LONG_END' });
    const detail = app.window.getByTestId('thread-detail');
    await expect(detail).toContainText('echo:' + 'A'.repeat(20));
    const expand = detail.getByRole('button', { name: 'Show more', exact: true });
    while (await expand.count()) await expand.first().click();
    await expect.poll(async () => (await detail.textContent())?.includes('echo:' + 'A'.repeat(40000) + ' AFCODE_LONG_END')).toBe(true);
    await threadRequest(app.window, `threads/${threadId}/send`, { model: 'acp-default', input: 'AFCODE_E2E:request-permission' });
    await expect(app.window.getByTestId('thread-detail')).toContainText('permission:yes', { timeout: 30_000 });
    await expect.poll(async () => (await threadRequest(app.window, `threads/${threadId}`)).thread.status).toBe('idle');
    await threadRequest(app.window, `threads/${threadId}/send`, { model: 'acp-default', input: 'AFCODE_E2E:hang' });
    await expect.poll(async () => (await threadRequest(app.window, `threads/${threadId}`)).thread.status).toBe('active');
    await expect.poll(() => readFileSync(join(projectPath, 'fixture-prompts.jsonl'), 'utf8').trim().split('\n').at(-1)).toBe('"hang"');
    await threadRequest(app.window, `threads/${threadId}/stop`, {});
    await expect.poll(async () => (await threadRequest(app.window, `threads/${threadId}`)).thread.status).toBe('idle');
    await threadRequest(app.window, `threads/${threadId}/send`, { model: 'acp-default', input: 'AFCODE_E2E:AFCODE_AFTER_STOP' });
    await expect(app.window.getByTestId('thread-detail')).toContainText('echo:AFCODE_AFTER_STOP', { timeout: 30_000 });
    const launches = readFileSync(join(projectPath, 'fixture-launches.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(launches.some((row) => row.args[0] === 'acp' && row.cwd === realpathSync(projectPath))).toBe(true);
    expect(launches.every((row) => row.home === app.home)).toBe(true);
    await app.window.evaluate(() => window.cc.pluginApps.setEnabled('provider-afcode', false));
    await expect.poll(async () => (await threadRequest(app.window, 'system/execution-options')).providers.some((p: { id: string }) => p.id === 'acp-afcode')).toBe(false);
  } finally {
    try { await testInfo.attach('launches', { body: readFileSync(join(projectPath, 'fixture-launches.jsonl'), 'utf8'), contentType: 'text/plain' }); } catch {}
    try { await testInfo.attach('prompts', { body: readFileSync(join(projectPath, 'fixture-prompts.jsonl'), 'utf8'), contentType: 'text/plain' }); } catch {}
    try { await testInfo.attach('requests', { body: readFileSync(join(projectPath, 'fixture-requests.jsonl'), 'utf8'), contentType: 'text/plain' }); } catch {}
    if (threadId) await threadRequest(app.window, `threads/${threadId}/stop`, {}).catch(() => {});
    if (projectId) await app.window.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => {});
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test('afcode CLI adapter delivers input, retains large output and opens its resume picker', async ({ app }, testInfo) => {
  const projectPath = mkdtempSync(join(tmpdir(), 'zcc-afcode-cli-'));
  let projectId: string | undefined;
  const sessions: string[] = [];
  try {
    projectId = await setup(app, projectPath);
    // The built-in CLI adapter remains available independently of the ACP plugin.
    await app.window.evaluate(() => window.cc.pluginApps.setEnabled('provider-afcode', false));
    const { window } = app;
    await window.getByTestId('nav-agents').click();
    await window.getByTestId('agents-board-new-thread').first().click();
    const modal = window.getByTestId('launch-modal');
    await modal.getByRole('button', { name: 'CLI Agent', exact: true }).click();
    await window.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    // Seed the shared last-used choice with both composers unmounted, so their
    // model-catalog hydration cannot overwrite it before the CLI mount.
    await window.evaluate(() => localStorage.setItem('zcc.composer.selection', JSON.stringify({
      providerId: 'acp-afcode', byProvider: {}
    })));
    await window.getByTestId('agents-board-new-thread').first().click();
    await modal.getByRole('button', { name: 'Project', exact: true }).click();
    await window.getByRole('listbox', { name: 'Project' }).getByRole('option', { name: basename(projectPath), exact: true }).click();
    const modelPicker = modal.getByTestId('model-reasoning-picker-trigger');
    await modelPicker.click();
    await expect(window.getByTestId('model-reasoning-provider-acp-afcode')).toHaveAttribute('aria-selected', 'true');
    await modelPicker.click();
    await expect(modelPicker).toContainText('Native configuration');
    await modal.getByTestId('legacy-agent-command-input').fill('AFCODE_OPENING_TASK');
    await modal.getByTestId('legacy-agent-command-send').click();
    await expect(modal).toBeHidden({ timeout: 30_000 });
    await expect(window.getByTestId('agent-terminal-modal')).toBeVisible();
    const session = await window.evaluate(async (pid) => (await window.cc.terminals.list(pid)).find((s) => s.projectId === pid && s.profile === 'afcode'), projectId);
    expect(session, JSON.stringify(await window.evaluate((pid) => window.cc.terminals.list(pid), projectId))).toBeTruthy();
    const created = { value: session! };
    sessions.push(created.value.id);
    await expect.poll(() => app.window.evaluate((id) => window.cc.terminals.backlog(id), created.value.id), { timeout: 30_000 }).toContain('AFCODE_RECEIVED:AFCODE_OPENING_TASK');
    await app.window.evaluate((id) => window.cc.terminals.reply(id, '/large'), created.value.id);
    await expect.poll(() => app.window.evaluate((id) => window.cc.terminals.backlog(id), created.value.id)).toContain('AFCODE_OUTPUT_COMPLETE');
    const output = await app.window.evaluate((id) => window.cc.terminals.backlog(id), created.value.id);
    expect(output.match(/L/g)?.length).toBeGreaterThanOrEqual(40000);
    expect(await app.window.evaluate((id) => window.cc.terminals.close(id), created.value.id)).toBe(true);
    const resume = await app.window.evaluate((pid) => window.cc.terminals.create({ projectId: pid, profile: 'afcode-resume', cols: 100, rows: 30 }), projectId);
    if (!resume.ok) throw new Error(resume.message);
    sessions.push(resume.value.id);
    await expect.poll(() => app.window.evaluate((id) => window.cc.terminals.backlog(id), resume.value.id)).toContain('Resume picker ready');
    const launches = readFileSync(join(projectPath, 'fixture-launches.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(launches.some((row) => JSON.stringify(row.args) === JSON.stringify(['--local']))).toBe(true);
    expect(launches.some((row) => JSON.stringify(row.args) === JSON.stringify(['--local', '--resume']))).toBe(true);
  } finally {
    try { await testInfo.attach('launches', { body: readFileSync(join(projectPath, 'fixture-launches.jsonl'), 'utf8'), contentType: 'text/plain' }); } catch {}
    for (const id of sessions) await app.window.evaluate((sid) => window.cc.terminals.close(sid), id).catch(() => {});
    if (projectId) await app.window.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => {});
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test('CLI Agent afcode tab launches afcode instead of remembered Claude', async ({ app }) => {
  const projectPath = mkdtempSync(join(tmpdir(), 'zcc-afcode-cli-pick-'));
  let projectId: string | undefined;
  const sessions: string[] = [];
  try {
    projectId = await setup(app, projectPath);
    await app.window.evaluate(() => window.cc.pluginApps.setEnabled('provider-afcode', false));
    const { window } = app;
    await window.evaluate(() => localStorage.setItem('zcc.composer.selection', JSON.stringify({
      providerId: 'claude-code', byProvider: { 'claude-code': { model: 'claude-sonnet-5' } }
    })));
    await window.getByTestId('nav-agents').click();
    await window.getByTestId('agents-board-new-thread').first().click();
    const modal = window.getByTestId('launch-modal');
    await modal.getByRole('button', { name: 'CLI Agent', exact: true }).click();
    await modal.getByRole('button', { name: 'Project', exact: true }).click();
    await window.getByRole('listbox', { name: 'Project' }).getByRole('option', { name: basename(projectPath), exact: true }).click();
    const modelPicker = modal.getByTestId('model-reasoning-picker-trigger');
    await modelPicker.click();
    const afcodeTab = window.getByTestId('model-reasoning-provider-acp-afcode');
    await expect(afcodeTab).toBeVisible({ timeout: 30_000 });
    await afcodeTab.click();
    await expect(afcodeTab).toHaveAttribute('aria-selected', 'true');
    await modelPicker.click();
    await modal.getByTestId('legacy-agent-command-input').fill('AFCODE_OPENING_TASK');
    await modal.getByTestId('legacy-agent-command-send').click();
    await expect(modal).toBeHidden({ timeout: 30_000 });
    const session = await window.evaluate(async (pid) => (await window.cc.terminals.list(pid)).find((s) => s.projectId === pid), projectId);
    expect(session?.profile, JSON.stringify(await window.evaluate((pid) => window.cc.terminals.list(pid), projectId))).toBe('afcode');
    sessions.push(session!.id);
    await expect.poll(() => app.window.evaluate((id) => window.cc.terminals.backlog(id), session!.id), { timeout: 30_000 }).toContain('AFCODE_RECEIVED:AFCODE_OPENING_TASK');
  } finally {
    for (const id of sessions) await app.window.evaluate((sid) => window.cc.terminals.close(sid), id).catch(() => {});
    if (projectId) await app.window.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => {});
    rmSync(projectPath, { recursive: true, force: true });
  }
});

// Opt in with ZCC_LIVE_AFCODE=/absolute/path/to/afcode. Uses sandboxed native
// auth and a single no-tools turn; the deterministic tests above spend nothing.
test.describe('installed afcode', () => {
  test.use({ seedClaudeAuth: true });
  for (const surface of ['CLI startup', 'ACP response'] as const) {
    test(`real ${surface}`, async ({ app }) => {
      const executable = process.env.ZCC_LIVE_AFCODE;
      test.skip(!executable, 'ZCC_LIVE_AFCODE must point to an ACP-enabled afcode');
      const settingsPath = join(app.home, '.claude', 'settings.json');
      const nativeToken = existsSync(settingsPath)
        ? JSON.parse(readFileSync(settingsPath, 'utf8')).env?.ANTHROPIC_AUTH_TOKEN
        : undefined;
      expect(Boolean(process.env.LLM_GATEWAY_EXPRESS_API_KEY?.trim() || nativeToken?.trim()),
        'Real afcode requires LLM_GATEWAY_EXPRESS_API_KEY or native env.ANTHROPIC_AUTH_TOKEN; apiKeyHelper alone is unsupported by afcode.').toBe(true);
      const projectPath = mkdtempSync(join(tmpdir(), 'zcc-afcode-live-'));
      // Keep worker sockets short enough for macOS and out of the shared UID fallback.
      const runtimeRoot = mkdtempSync('/tmp/zcc-afcode-');
      mkdirSync(join(app.home, '.afcode'), { recursive: true, mode: 0o700 });
      writeFileSync(join(app.home, '.afcode', 'run.json'), JSON.stringify({ runtime_root: runtimeRoot, reason: 'isolated E2E' }), { mode: 0o600 });
      let projectId: string | undefined;
      let threadId: string | undefined;
      let terminalId: string | undefined;
      try {
        projectId = await setup(app, projectPath, executable);
        if (surface === 'CLI startup') {
          const terminal = await app.window.evaluate((pid) => window.cc.terminals.create({ projectId: pid, profile: 'afcode', cols: 100, rows: 30 }), projectId);
          expect(terminal, JSON.stringify(terminal)).toMatchObject({ ok: true });
          if (!terminal.ok) throw new Error(terminal.message);
          terminalId = terminal.value.id;
          await expect.poll(() => app.window.evaluate((id) => window.cc.terminals.backlog(id), terminalId!), { timeout: 30_000 }).toContain(basename(projectPath));
          const session = await app.window.evaluate(async ({ projectId, terminalId }) => (await window.cc.terminals.list(projectId)).find((s) => s.id === terminalId), { projectId, terminalId });
          expect(session).toBeTruthy();
          expect(session?.exitCode).toBeUndefined();
          return;
        }
        const created = await threadRequest(app.window, 'threads', {
          projectId, providerId: 'acp-afcode', model: 'acp-default', permissionMode: 'full',
          input: 'Reply with only the decimal sum of 1234 and 5678. Do not use any tools.', title: 'afcode live smoke'
        });
        expect(created, JSON.stringify(created)).toMatchObject({ ok: true });
        threadId = created.value.id;
        await openThread(app.window, threadId!);
        const detail = app.window.getByTestId('thread-detail');
        await expect.poll(async () => {
          const text = await detail.textContent();
          return text?.includes('6912') || text?.includes('Error:');
        }, { timeout: 90_000 }).toBe(true);
        await expect(detail).toContainText('6912');

      } finally {
        if (terminalId) await app.window.evaluate((id) => window.cc.terminals.close(id), terminalId).catch(() => {});
        if (threadId) await threadRequest(app.window, `threads/${threadId}/stop`, {}).catch(() => {});
        if (projectId) await app.window.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => {});
        const cleanupEnv = { ...process.env, HOME: app.home, AFCODE_RUNTIME_DIR: runtimeRoot };
        // ACP workers are durable. Stop only sessions in this test's private socket root.
        for (const name of (existsSync(join(runtimeRoot, 'w')) ? readdirSync(join(runtimeRoot, 'w')) : [])) {
          if (!/^[a-f0-9]{32}\.sock$/.test(name)) continue;
          try { execFileSync(executable!, ['agents', 'stop', name.slice(0, -5)], { env: cleanupEnv, timeout: 10_000, maxBuffer: 64 * 1024, stdio: 'pipe' }); } catch {}
        }
        try { execFileSync(executable!, ['daemon', 'stop'], { env: cleanupEnv, timeout: 10_000, maxBuffer: 64 * 1024, stdio: 'pipe' }); } catch {}
        rmSync(runtimeRoot, { recursive: true, force: true });
        rmSync(projectPath, { recursive: true, force: true });
      }
    });
  }
});
