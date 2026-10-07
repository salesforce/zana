import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test('Automatic retry, Settings and command palette recover project model pickers without reloading the app', async ({ app, home }) => {
  const win = app.window;
  let version = 1;
  let fail = false;
  let transientFailures = 1;
  let targetProjectId: string | undefined;
  let transientQuery: string | undefined;
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;
  const requests: string[] = [];
  await win.route('**/api/v1/system/execution-options*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    if (url.searchParams.get('projectId') === targetProjectId) await gate;
    const transient = transientFailures > 0 && url.searchParams.has('providerId') && url.searchParams.get('projectId') === targetProjectId;
    if (transient) { transientFailures -= 1; transientQuery = url.search; }
    await route.fulfill({ json: {
      providers: [{ id: 'claude-code', displayName: 'Claude Code', available: true,
        composerActions: [], capabilities: { permissionModes: ['full'] } }],
      models: fail || transient ? [] : [{ id: 'recovery-model', model: 'recovery-model', displayName: `Recovery model ${version}`,
        isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
        defaultReasoningEffort: 'medium' }],
      selectedOnlyModels: [], permissionCeiling: 'full',
      modelLoadError: transient ? { providerId: 'claude-code', code: 'failed', detail: 'Temporary outage' } : fail && url.searchParams.has('providerId')
        ? { providerId: 'claude-code', code: 'auth_required', detail: null } : null
    } });
  });
  // Install the discovery fixture before startup requests enter the shared
  // queue; refresh operations below must retain this document after warm-up.
  await win.reload();
  const path = join(home, 'model-recovery');
  mkdirSync(path);
  const project = await win.evaluate(async (dir) => {
    const result = await window.cc.projects.add(dir);
    if (!result.ok) throw new Error(result.message);
    return result.value;
  }, path);
  targetProjectId = project.id;
  const navigate = (url: string) => win.evaluate((value) => {
    window.history.pushState({}, '', value);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);
  const openComposer = async () => {
    await navigate('/agents');
    if (await win.getByTestId('agents-new-empty').count()) await win.getByTestId('agents-new-empty').click();
    else await win.getByTestId('agents-board-new-thread').first().click();
    const modal = win.getByTestId('launch-modal');
    await modal.getByRole('button', { name: 'CLI Agent', exact: true }).click();
    await modal.getByRole('button', { name: 'Project', exact: true }).click();
    await win.getByRole('listbox', { name: 'Project' }).getByRole('option', { name: 'model-recovery', exact: true }).click();
    return modal;
  };
  try {
    const modal = await openComposer();
    const model = modal.getByTestId('model-reasoning-picker-trigger');
    await expect(model).toContainText('Recovery model 1');
    await expect.poll(() => requests.filter(query => query === transientQuery).length).toBeGreaterThanOrEqual(2);
    await win.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await win.evaluate(() => { (window as unknown as { recoveryDocument: boolean }).recoveryDocument = true; });
    requests.length = 0;
    version = 2;
    gate = new Promise<void>((resolve) => { release = resolve; });
    await win.keyboard.press('ControlOrMeta+p');
    const palette = win.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('combobox').fill('Refresh models');
    await palette.getByRole('option', { name: /Refresh models/ }).click();
    await expect(palette).toHaveCount(0);
    await expect.poll(() => requests.some((query) => query.includes(project.id))).toBe(true);
    await openComposer();
    await expect(model).toContainText('Recovery model 1');
    release!();
    gate = undefined;
    await expect(model).toContainText('Recovery model 2');
    await modal.getByRole('button', { name: 'Modern', exact: true }).click();
    await expect(modal.getByTestId('model-reasoning-picker-trigger')).toContainText('Recovery model 2');
    await win.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await navigate('/settings/harness');
    const refresh = win.getByRole('button', { name: 'Recalculate models', exact: true });
    await expect(refresh).toBeVisible();
    // The automatic Settings check must finish before testing an explicit retry.
    await expect(win.getByRole('button', { name: 'Check status', exact: true })).toBeEnabled({ timeout: 30_000 });
    fail = true;
    await refresh.click();
    await expect(win.getByRole('status').filter({ hasText: 'Some model lists could not be refreshed.' })).toBeVisible();
    fail = false;
    version = 3;
    gate = new Promise<void>((resolve) => { release = resolve; });
    await refresh.click();
    await expect(win.getByRole('button', { name: 'Recalculating models…', exact: true })).toBeDisabled();
    release!();
    gate = undefined;
    await expect(win.getByRole('status').filter({ hasText: 'Model lists refreshed.' })).toBeVisible();
    const recovered = await openComposer();
    await expect(recovered.getByTestId('model-reasoning-picker-trigger')).toContainText('Recovery model 3');
    expect(await win.evaluate(() => (window as unknown as { recoveryDocument: boolean }).recoveryDocument)).toBe(true);
  } finally {
    release?.();
    await win.unrouteAll({ behavior: 'wait' });
  }
});
