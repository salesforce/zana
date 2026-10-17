/**
 * Design Docs agents always run on the project's effective AI harness
 * (`harness: 'project-default'`) with that harness's AI-harness overrides.
 * An unusable harness fails with an actionable error, never a silent fallback
 * to whichever provider registered first.
 */
import { mkdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, closeApp, launchApp } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';

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
  expect(error).toContain('No usable AI harness:');
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

  // The Agent tab only explains where the harness comes from; it has no controls.
  await win.locator('.dd-list').getByRole('button', { name: 'Settings', exact: true }).click();
  await win.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Agent', exact: true }).click();
  const agent = win.getByRole('region', { name: 'Agent harness' });
  await expect(agent).toContainText("the doc's project");
  await expect(agent).toContainText('for a doc with no project, the Default Project');
  await expect(agent).toContainText('Settings → AI Harness');
  await expect(agent.locator('input, select')).toHaveCount(0);
});

test('Design Docs agents run on the project harness and honor its AI-harness overrides', async ({ home }) => {
  test.setTimeout(120_000);
  const app = await launchApp(home, {
    // PATH is headed by a deterministic fake `claude`, so no live Claude runs.
    allowLiveClaude: true,
    env: { PATH: `${fakeClaude.dir}${delimiter}${process.env.PATH ?? ''}` },
    initialConfig: { sponsorPromptDismissed: true, claudeBinary: fakeClaude.path, defaultHarness: 'claude' }
  });
  try {
    const win = app.window;
    await installDesignDocs(win);
    const { docId, projectId } = await projectDoc(win, join(home, 'dd-harness-default'), 'Default harness doc');

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

    // The Agent tab explains the inheritance and offers no override controls.
    await win.getByRole('button', { name: /^Design Docs/ }).click();
    await win.locator('.dd-list').getByRole('button', { name: 'Settings', exact: true }).click();
    await win.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Agent', exact: true }).click();
    const agent = win.getByRole('region', { name: 'Agent harness' });
    await expect(agent).toContainText('Settings → AI Harness');
    await expect(agent.locator('input, select')).toHaveCount(0);
  } finally {
    await closeApp(app.electron);
  }
});
