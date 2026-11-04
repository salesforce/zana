import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';

// The production Pi bridge and runtime run in the built app. Only the model
// process is scripted, speaking Pi RPC and loading the real injected extension.
const test = base.extend({
  launchEnv: async ({ home }, use) => use({
    FAKE_PI_COMPACTION_RELEASE_FILE: join(home, 'release-compaction'),
    FAKE_PI_COMMAND_LOG: join(home, 'pi-commands.log'),
    ZCC_PI_BRIDGE_COMMAND: process.execPath,
    ZCC_PI_BRIDGE_ARGS: JSON.stringify([fileURLToPath(new URL('../plugins/provider-pi/src/bridge/fake-pi-rpc.mjs', import.meta.url))])
  })
});

test('Pi choices and inputs appear in Need you and return answers through the built runtime', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  await waitForThreadProvider(window, 'pi');
  const projectPath = join(home, 'pi-dialog-project');
  mkdirSync(projectPath);
  const choice = { method: 'select', title: 'Pi needs your choice', message: 'Pick the next action.', options: ['Allow once', 'Block'] };
  const threadId = await window.evaluate(async ({ path, input }) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'pi', model: 'fake-provider/fake-model', permissionMode: 'full', input })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread.id as string;
  }, { path: projectPath, input: `/ui ${JSON.stringify(choice)}` });
  const pending = () => window.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${id}/interactions`);
    if (!response.ok) throw new Error(`Interaction query failed: ${response.status}`);
    return await response.json();
  }, threadId);
  await expect.poll(async () => (await pending())?.length, { timeout: 30_000 }).toBe(1);
  await window.getByTestId('nav-agents').click();
  await expect(window.locator('.agent-card.is-thread')).toHaveClass(/lane-blocked/);
  await window.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, threadId);
  const banner = window.getByTestId('thread-pending-banner');
  const timeline = window.getByTestId('thread-timeline');
  const composer = window.getByTestId('thread-command-input');
  await expect(banner).toContainText(choice.title);
  await expect(window.locator('.thread-status-badge')).toContainText('Needs you');
  await expect(banner.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
  await banner.getByRole('radio', { name: /Allow once/ }).check();
  await banner.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(timeline).toContainText('UI said: {"type":"extension_ui_response","id":"ui-1","value":"Allow once"}');
  await expect(banner).toHaveCount(0);
  await expect.poll(async () => (await pending()).length).toBe(0);

  const ask = async (spec: Record<string, unknown>) => {
    await expect.poll(() => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toBe('idle');
    await composer.fill(`/ui ${JSON.stringify(spec)}`);
    await composer.press('Enter');
    await expect(banner).toContainText(String(spec.title));
    await expect(window.locator('.thread-status-badge')).toContainText('Needs you');
  };
  const answered = async (reply: string) => {
    await expect(timeline).toContainText(reply);
    await expect(banner).toHaveCount(0);
    await expect.poll(async () => (await pending()).length).toBe(0);
  };
  await ask({ method: 'input', title: 'Pi needs your text', placeholder: 'Your answer' });
  await banner.getByRole('textbox').fill('héllo 🙂');
  await banner.getByRole('button', { name: 'Submit', exact: true }).click();
  await answered('UI said: {"type":"extension_ui_response","id":"ui-2","value":"héllo 🙂"}');

  await ask({ method: 'confirm', title: 'Pi needs confirmation', message: 'Continue?' });
  await banner.getByRole('button', { name: 'No', exact: true }).click();
  await answered('UI said: {"type":"extension_ui_response","id":"ui-3","confirmed":false}');

  await ask({ method: 'editor', title: 'Pi needs your draft', prefill: 'Original draft' });
  await expect(banner.getByRole('textbox')).toHaveValue('Original draft');
  await banner.getByRole('textbox').fill('First line\nSecond line');
  await banner.getByRole('button', { name: 'Submit', exact: true }).click();
  await answered('UI said: {"type":"extension_ui_response","id":"ui-4","value":"First line\\nSecond line"}');

  await ask({ method: 'select', title: 'Cancel this Pi choice', options: ['Continue', 'Stop'] });
  await banner.getByRole('button', { name: 'Cancel', exact: true }).click();
  await answered('UI said: {"type":"extension_ui_response","id":"ui-5","cancelled":true}');
  await expect.poll(() => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toBe('idle');
  await expect(window.locator('.thread-status-badge').filter({ hasText: 'Needs you' })).toHaveCount(0);
  await window.getByTestId('nav-agents').click();
  await expect(window.locator('.agent-card.is-thread')).toBeVisible();
  await expect(window.locator('.agent-card.is-thread.lane-blocked')).toHaveCount(0);
});


test('Pi retains a follow-up sent during extension compaction through the built runtime', async ({
  app,
}) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  await waitForThreadProvider(window, 'pi');
  const path = join(home, 'pi-compaction-project');
  mkdirSync(path);
  const threadId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.value.id,
        providerId: 'pi',
        model: 'fake-provider/fake-model',
        permissionMode: 'full',
        input: '/compact-on-settle',
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread.id as string;
  }, path);
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const timeline = window.getByTestId('thread-timeline');
  await expect(timeline).toContainText('Response to: /compact-on-settle', {
    timeout: 30000,
  });
  await expect
    .poll(() =>
      window.evaluate(
        async (id) =>
          (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status,
        threadId,
      ),
    )
    .toBe('idle');
  const composer = window.getByTestId('thread-command-input');
  await composer.fill('sent during extension compaction');
  await composer.press('Enter');
  await expect(composer).toHaveText('');
  await expect(window.getByRole('button', { name: 'Send now', exact: true })).toBeVisible();
  const promptCount = () =>
    existsSync(join(home, 'pi-commands.log'))
      ? readFileSync(join(home, 'pi-commands.log'), 'utf8')
          .split('\n')
          .filter((x) => x === 'prompt').length
      : 0;
  await expect.poll(promptCount).toBe(1);
  writeFileSync(join(home, 'release-compaction'), '');
  await expect(timeline).toContainText(
    'Response to: sent during extension compaction',
    { timeout: 30000 },
  );
  await expect.poll(promptCount).toBe(2);
  await expect
    .poll(() =>
      window.evaluate(
        async (id) =>
          (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status,
        threadId,
      ),
    )
    .toBe('idle');
  await expect(timeline).not.toContainText('Cannot submit a prompt');
});
