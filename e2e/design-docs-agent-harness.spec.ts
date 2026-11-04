/**
 * Design Docs agents run on the project's effective AI harness
 * (`harness: 'project-default'`) with that harness's AI-harness overrides,
 * unless Design Docs' own Agent settings store a plugin override, which then
 * replaces the inherited chain for that harness (Project → Default, where
 * Default is stored at the host's Global scope). Overrides are validated when saved. An unusable harness fails with
 * an actionable error, never a silent fallback to another provider.
 */
import { mkdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, closeApp, launchApp } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

const fakeClaude = makeFakeAgentBinary({ script: [
  'if [ "$1" = "--version" ]; then echo "2.1.284 (Claude Code)"; exit 0; fi',
  'exit 78'
].join('\n') });

test.afterAll(() => fakeClaude.cleanup());

async function installDesignDocs(win: Page) {
  const existing = await win.evaluate(async () => (await window.cc.pluginApps.list()).some((plugin) => plugin.id === 'design-docs'));
  if (!existing) {
    expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }))).toMatchObject({ ok: true });
  }
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((plugin) => plugin.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');
}

async function projectDoc(win: Page, path: string, title: string) {
  mkdirSync(path, { recursive: true });
  return win.evaluate(async ({ path, title }) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    const doc = await window.cc.pluginApps.callRpc('design-docs', 'create', { title, template: 'technical', projectId: result.value.id }) as { id: string };
    return { docId: doc.id, projectId: result.value.id };
  }, { path, title });
}

async function threadRecord(win: Page, id: string) {
  return win.evaluate(async (threadId) =>
    ((await (await fetch(`/api/v1/threads/${threadId}`)).json()) as { thread: Record<string, unknown> }).thread, id);
}

type Scope = { kind: 'global' } | { kind: 'default-project' } | { kind: 'project'; projectId: string };

async function storedRouting(win: Page, scope: Scope) {
  return win.evaluate((scope) => window.cc.pluginApps.callRpc('design-docs', 'harnessRouting', scope), scope);
}

async function askAgent(win: Page, doc: string) {
  return win.evaluate((doc) => window.cc.pluginApps.callRpc('design-docs', 'askAgent', { doc, action: 'review' }), doc) as Promise<{ threadId: string; projectId: string }>;
}

async function threadCount(win: Page, doc: string) {
  return (await win.evaluate((doc) => window.cc.pluginApps.callRpc('design-docs', 'get', { doc }), doc) as { threads: unknown[] }).threads.length;
}

async function openAgentSettings(win: Page) {
  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.locator('.dd-list').getByRole('button', { name: 'Settings', exact: true }).click();
  await win.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Agent', exact: true }).click();
  return win.getByRole('region', { name: 'Agent harness' });
}

async function expandClaude(win: Page) {
  const expand = win.getByRole('region', { name: 'Agent harness' }).getByRole('button', { name: 'Agent settings for Claude Code' });
  if (await expand.getAttribute('aria-expanded') !== 'true') await expand.click();
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
}

async function pick(win: Page, control: string, option: RegExp) {
  await win.getByRole('region', { name: 'Agent harness' }).getByRole('button', { name: control }).click();
  await win.getByRole('listbox', { name: control }).getByRole('option', { name: option }).click();
}

async function rpcError(win: Page, method: string, args: unknown): Promise<string> {
  return win.evaluate(async ({ method, args }) => {
    try {
      await window.cc.pluginApps.callRpc('design-docs', method, args);
      return 'unexpected success';
    } catch (failure) {
      return String(failure);
    }
  }, { method, args });
}

test('Design Docs agents report an unusable project harness instead of starting another provider', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  await installDesignDocs(win);
  const { docId } = await projectDoc(win, join(home, 'dd-harness-unusable'), 'Unusable harness doc');

  // The E2E home disables the real Claude binary, so the default harness is not installed.
  // The removed "Always use" RPCs are gone.
  expect(await rpcError(win, 'setAgentSettings', { mode: 'provider', providerId: 'claude-code' })).not.toBe('unexpected success');

  const error = await rpcError(win, 'askAgent', { doc: docId, action: 'review' });
  const plugin = await win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((plugin) => plugin.id === 'design-docs'));
  expect(error, JSON.stringify(plugin)).toContain('No usable AI harness:');
  expect(error).toContain('Settings → AI Harness');
  // Nothing was spawned, so nothing was linked to the doc.
  const detail = await win.evaluate((doc) => window.cc.pluginApps.callRpc('design-docs', 'get', { doc }), docId) as { threads: unknown[] };
  expect(detail.threads).toEqual([]);

  // The doc's Ask agent menu only drafts the prompt in the side-panel composer, so choosing Review spawns nothing.
  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.getByText('Unusable harness doc').first().click();
  await win.getByRole('button', { name: /Ask agent/ }).first().click();
  await win.getByRole('menuitem', { name: /^Review/ }).click();
  const afterMenu = await win.evaluate((doc) => window.cc.pluginApps.callRpc('design-docs', 'get', { doc }), docId) as { threads: unknown[] };
  expect(afterMenu.threads).toEqual([]);

  // The Agent tab offers per-scope overrides; an uninstalled harness's controls are disabled.
  const agent = await openAgentSettings(win);
  await expect(agent).toContainText("A project's choice wins over Default.");
  const scopes = agent.getByRole('tablist', { name: 'Harness scope' });
  await expect(scopes.getByRole('tab', { name: 'Default', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(scopes.getByRole('tab', { name: 'Project', exact: true })).toBeVisible();
  await expect(scopes.getByRole('tab')).toHaveCount(2);
  await expandClaude(win);
  await expect(agent.getByRole('button', { name: 'Default execution state' })).toBeDisabled();
});

test('Design Docs agents run on the project harness and honor its AI-harness overrides', async ({ home }) => {
  test.setTimeout(180_000);
  const app = await launchApp(home, {
    // PATH is headed by a deterministic fake `claude`, so no live Claude runs.
    allowLiveClaude: true,
    env: { PATH: `${fakeClaude.dir}${delimiter}${process.env.PATH ?? ''}` },
    // Codex is disabled so a harness choice that names it is deterministically unusable.
    initialConfig: { sponsorPromptDismissed: true, claudeBinary: fakeClaude.path, defaultHarness: 'claude', harnessCodexEnabled: false } as never
  });
  try {
    const win = app.window;
    await installDesignDocs(win);
    const { docId, projectId } = await projectDoc(win, join(home, 'dd-harness-default'), 'Default harness doc');
    // The Claude thread provider joins the catalog only once harness-claude has
    // loaded, which can trail design-docs on a slow start.
    await waitForThreadProvider(win, 'claude-code', 90_000);

    // No overrides: the project harness provider with its default permission mode.
    const started = await win.evaluate((doc) => window.cc.pluginApps.callRpc('design-docs', 'askAgent', { doc, action: 'review' }), docId) as { threadId: string; projectId: string };
    expect(started.projectId).toBe(projectId);
    const plain = await threadRecord(win, started.threadId);
    expect(plain).toMatchObject({ providerId: 'claude-code', originPluginId: 'design-docs' });
    expect(plain.permissionMode).not.toBe('full');

    // A project AI-harness override (Settings → Project → AI harnesses) reaches the spawned thread.
    await win.evaluate((id) => window.cc.projectSettings.set(id, {
      harnessRouting: { schemaVersion: 1, byAdapter: { claude: { executionState: 'autonomous' } } }
    } as never), projectId);
    const overridden = await win.evaluate((doc) => window.cc.pluginApps.callRpc('design-docs', 'askAgent', { doc, action: 'review' }), docId) as { threadId: string };
    expect(await threadRecord(win, overridden.threadId)).toMatchObject({
      providerId: 'claude-code', originPluginId: 'design-docs', permissionMode: 'full'
    });

    // Execution state + model level together: both land on the thread.
    await win.evaluate((id) => window.cc.projectSettings.set(id, {
      harnessRouting: { schemaVersion: 1, byAdapter: { claude: { executionState: 'accept-edits', modelLevel: 'low' } } }
    } as never), projectId);
    const levelled = await win.evaluate((doc) => window.cc.pluginApps.callRpc('design-docs', 'askAgent', { doc, action: 'review' }), docId) as { threadId: string };
    expect(await threadRecord(win, levelled.threadId)).toMatchObject({
      providerId: 'claude-code', permissionMode: 'accept-edits', model: 'haiku'
    });

    // A launch field a thread cannot carry rejects, naming it, and spawns nothing.
    const before = (await win.evaluate((doc) => window.cc.pluginApps.callRpc('design-docs', 'get', { doc }), docId) as { threads: unknown[] }).threads.length;
    await win.evaluate((id) => window.cc.projectSettings.set(id, { permissionMode: 'plan' } as never), projectId);
    const unmapped = await rpcError(win, 'askAgent', { doc: docId, action: 'review' });
    expect(unmapped).toContain('the project Claude Code permission mode (plan) has no thread equivalent');
    expect(unmapped).toContain('Settings → AI Harness');
    const after = (await win.evaluate((doc) => window.cc.pluginApps.callRpc('design-docs', 'get', { doc }), docId) as { threads: unknown[] }).threads.length;
    expect(after).toBe(before);

    // A Design Docs Global override set in its Agent settings replaces the
    // inherited chain as a whole value: the project's unmapped `plan` mode
    // no longer applies, and the plugin's execution state + model do.
    const agent = await openAgentSettings(win);
    await expect(agent.getByRole('tab', { name: 'Default', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expandClaude(win);
    await pick(win, 'Default execution state', /\[Autonomous\]$/);
    await expect.poll(() => storedRouting(win, { kind: 'global' })).toMatchObject({
      schemaVersion: 1, byAdapter: { claude: { executionState: 'autonomous' } }
    });
    await pick(win, 'Default model level', /\[Low\]$/);
    await expect.poll(() => storedRouting(win, { kind: 'global' })).toMatchObject({
      byAdapter: { claude: { executionState: 'autonomous', modelTargetId: 'haiku' } }
    });
    await expect(agent.getByRole('alert')).toHaveCount(0);
    const pluginGlobal = await askAgent(win, docId);
    expect(await threadRecord(win, pluginGlobal.threadId)).toMatchObject({
      providerId: 'claude-code', originPluginId: 'design-docs', permissionMode: 'full', model: 'haiku'
    });

    // A Project-scope plugin override wins over the plugin's Global one, whole:
    // Global's model is not merged in.
    await agent.getByRole('tab', { name: 'Project', exact: true }).click();
    await agent.getByRole('combobox', { name: 'Project' }).selectOption(projectId);
    await expandClaude(win);
    await pick(win, 'Default execution state', /\[Accept Edits\]$/);
    await expect.poll(() => storedRouting(win, { kind: 'project', projectId })).toEqual({
      schemaVersion: 1, byAdapter: { claude: { executionState: 'accept-edits' } }
    });
    const pluginProject = await askAgent(win, docId);
    const projectThread = await threadRecord(win, pluginProject.threadId);
    expect(projectThread).toMatchObject({ providerId: 'claude-code', originPluginId: 'design-docs', permissionMode: 'accept-edits' });
    expect(projectThread.model).not.toBe('haiku');

    // Save-time validation: an unknown provider target or a malformed model id
    // is rejected and the stored override is left as it was.
    const projectScope = { kind: 'project', projectId } as const;
    const badProvider = await rpcError(win, 'setHarnessRouting', {
      scope: projectScope, value: { schemaVersion: 1, byAdapter: { claude: { providerTargetId: 'retired-provider' } } }
    });
    expect(badProvider).not.toBe('unexpected success');
    expect(badProvider).toContain('claude:');
    const badModel = await rpcError(win, 'setHarnessRouting', {
      scope: projectScope, value: { schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'bad model!' } } }
    });
    expect(badModel).not.toBe('unexpected success');
    expect(badModel).toContain('claude:');
    expect(await storedRouting(win, projectScope)).toEqual({
      schemaVersion: 1, byAdapter: { claude: { executionState: 'accept-edits' } }
    });

    // Clearing the Project override falls back to the plugin's Global override.
    await win.evaluate((scope) => window.cc.pluginApps.callRpc('design-docs', 'setHarnessRouting', { scope, value: null }), projectScope);
    expect(await storedRouting(win, projectScope)).toBeNull();
    const cleared = await askAgent(win, docId);
    expect(await threadRecord(win, cleared.threadId)).toMatchObject({ permissionMode: 'full', model: 'haiku' });

    // The plugin's harness choice, not Zana's default, picks the harness.
    // (Zana keeps only an enabled harness as its default, so its default stays Claude here.)
    const beforeChoice = await threadCount(win, docId);

    // Choosing Claude Code at Default in Design Docs Settings stores the choice and runs on it, with the Default rows.
    await agent.getByRole('tab', { name: 'Default', exact: true }).click();
    await pick(win, 'Default harness', /^Claude Code$/);
    await expect.poll(() => storedRouting(win, { kind: 'global' })).toMatchObject({ defaultHarness: 'claude' });
    await expect(agent.getByRole('alert')).toHaveCount(0);
    const chosen = await askAgent(win, docId);
    expect(await threadRecord(win, chosen.threadId)).toMatchObject({
      providerId: 'claude-code', originPluginId: 'design-docs', permissionMode: 'full', model: 'haiku'
    });
    expect(await threadCount(win, docId)).toBe(beforeChoice + 1);

    // A Project choice wins over Default: naming the disabled Codex fails closed,
    // never falling back to Default's Claude or Zana's (usable) Claude default.
    await win.evaluate((scope) => window.cc.pluginApps.callRpc('design-docs', 'setHarnessRouting', {
      scope, value: { schemaVersion: 1, byAdapter: {}, defaultHarness: 'codex' }
    }), projectScope);
    const blocked = await rpcError(win, 'askAgent', { doc: docId, action: 'review' });
    expect(blocked).toContain("this plugin's harness (codex) is disabled or unavailable");
    expect(await threadCount(win, docId)).toBe(beforeChoice + 1);

    // Clearing the Project choice falls back to Default's Claude choice.
    await win.evaluate((scope) => window.cc.pluginApps.callRpc('design-docs', 'setHarnessRouting', { scope, value: null }), projectScope);
    const restored = await askAgent(win, docId);
    expect(await threadRecord(win, restored.threadId)).toMatchObject({ providerId: 'claude-code', model: 'haiku' });
  } finally {
    await closeApp(app.electron);
  }
});

test('Design Docs Settings rejects an invalid harness override and spawns name the plugin setting', async ({ home }) => {
  test.setTimeout(180_000);
  // A stale Global override (a provider target the harness no longer lists),
  // as left by an older catalog. Seeded raw: the save path would reject it.
  const stale = { schemaVersion: 1, byAdapter: { claude: { providerTargetId: 'retired-provider' } } };
  const app = await launchApp(home, {
    allowLiveClaude: true,
    env: { PATH: `${fakeClaude.dir}${delimiter}${process.env.PATH ?? ''}` },
    initialConfig: {
      sponsorPromptDismissed: true, claudeBinary: fakeClaude.path, defaultHarness: 'claude',
      pluginHarnessRouting: { 'design-docs': stale }
    } as never
  });
  try {
    const win = app.window;
    await installDesignDocs(win);
    const { docId } = await projectDoc(win, join(home, 'dd-harness-invalid'), 'Invalid override doc');
    await waitForThreadProvider(win, 'claude-code', 90_000);
    expect(await storedRouting(win, { kind: 'global' })).toEqual(stale);

    // The spawn rejects, points at this plugin's setting, and starts nothing.
    const spawn = await rpcError(win, 'askAgent', { doc: docId, action: 'review' });
    expect(spawn).not.toBe('unexpected success');
    expect(spawn).toContain("Change it in this plugin's AI Harness settings.");
    expect(spawn).not.toContain('Settings → AI Harness');
    expect(await threadCount(win, docId)).toBe(0);

    // Editing it in Settings re-validates the whole value; the rejection is
    // shown inline and nothing is persisted.
    const agent = await openAgentSettings(win);
    await expandClaude(win);
    await pick(win, 'Default execution state', /\[Autonomous\]$/);
    const alert = agent.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('claude:');
    expect(await storedRouting(win, { kind: 'global' })).toEqual(stale);
    await pick(win, 'Default model level', /\[Low\]$/);
    await expect(alert).toContainText('claude:');
    expect(await storedRouting(win, { kind: 'global' })).toEqual(stale);

    // Clearing the override restores the inherited project harness.
    await win.evaluate(() => window.cc.pluginApps.callRpc('design-docs', 'setHarnessRouting', { scope: { kind: 'global' }, value: null }));
    const started = await askAgent(win, docId);
    expect(await threadRecord(win, started.threadId)).toMatchObject({ providerId: 'claude-code', originPluginId: 'design-docs' });
  } finally {
    await closeApp(app.electron);
  }
});
