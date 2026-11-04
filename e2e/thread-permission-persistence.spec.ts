import { test, expect } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

for (const initial of [{ mode: 'auto', label: 'Auto' }, { mode: 'full', label: 'Full' }]) {
  test(`${initial.label} survives creation, follow-ups, reload, and an explicit change to Edits`, async ({ app }) => {
    const { window } = app;
    await waitForThreadProvider(window, 'fake');
    // The fake runtime supports all three modes. Expose them to the composer
    // without requiring a separately installed/authenticated provider in CI.
    await window.route('**/api/v1/system/execution-options*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (Array.isArray(body.providers)) {
        body.providers = body.providers.filter((p: { id: string }) => p.id === 'fake')
          .map((p: { capabilities: Record<string, unknown> }) => ({
            ...p, capabilities: { ...p.capabilities, permissionModes: ['accept-edits', 'auto', 'full'] }
          }));
      }
      // Reload can cancel an in-flight catalog request before its response arrives.
      await route.fulfill({ response, json: body }).catch((error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes('Route is already handled')) throw error;
      });
    });
    await window.reload();
    await window.getByTestId('nav-home').click();
    const home = window.locator('.thread-command-composer').first();
    await expect(home.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
    await home.getByLabel('Permission mode', { exact: true }).click();
    await window.getByRole('option', { name: initial.mode === 'full' ? /^Full Access/ : /^Approve for me/ }).click();
    await expect(home.getByLabel('Permission mode', { exact: true })).toContainText(initial.label);
    await home.getByTestId('thread-command-input').fill(`First message with ${initial.label}`);
    const createdResponse = window.waitForResponse((r) => r.url().endsWith('/api/v1/threads') && r.request().method() === 'POST');
    await home.getByTestId('thread-command-send').click();
    const response = await createdResponse;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON().providerId).toBe('fake');
    expect(response.request().postDataJSON().permissionMode).toBe(initial.mode);
    const created = await response.json();
    const id = (created.value ?? created.thread).id as string;
    const detail = window.getByTestId('thread-detail');
    const composer = detail.locator('.thread-command-composer');
    const picker = composer.getByLabel('Permission mode', { exact: true });
    await expect(picker).toContainText(initial.label);
    await expect(detail.getByTestId('thread-timeline')).toContainText(`Response to: First message with ${initial.label}`);

    const send = async (text: string, permissionMode: string) => {
      await composer.getByTestId('thread-command-input').fill(text);
      const request = window.waitForRequest((r) => r.url().endsWith(`/threads/${id}/send`) && r.method() === 'POST');
      await composer.getByTestId('thread-command-input').press('Enter');
      expect((await request).postDataJSON().permissionMode).toBe(permissionMode);
      await expect(detail.getByTestId('thread-timeline')).toContainText(`Response to: ${text}`);
      await expect.poll(() => window.evaluate(async (threadId) => {
        const response = await fetch(`/api/v1/threads/${threadId}`);
        return (await response.json()).thread.permissionMode;
      }, id)).toBe(permissionMode);
    };
    await send(`Second message keeps ${initial.label}`, initial.mode);
    await expect(picker).toContainText(initial.label);
    await window.reload();
    await expect(picker).toContainText(initial.label);
    await send('Third message after reopening', initial.mode);

    await picker.click();
    await window.getByRole('option', { name: /^Accept Edits/ }).click();
    await send('Explicitly switch to Edits', 'accept-edits');
    await window.reload();
    await expect(picker).toContainText('Edits');
    await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);
    await window.unrouteAll({ behavior: 'ignoreErrors' });
  });
}

test('omitted permissions use a single-mode provider default through creation and follow-ups', async ({ app }) => {
  const { window } = app;
  await waitForThreadProvider(window, 'fake');
  // CLI and SDK callers can omit permissionMode. The deterministic provider,
  // like other full-only providers, must not receive the generic Edits default.
  const id = await window.evaluate(async () => {
    const { projects } = await (await fetch('/api/v1/projects')).json();
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: projects[0].id,
        providerId: 'fake',
        title: 'Provider permission default',
        input: 'Start without an explicit permission mode'
      })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  });
  const readExecution = () => window.evaluate(async (threadId) => {
    const { thread } = await (await fetch(`/api/v1/threads/${threadId}`)).json();
    return { status: thread.status, permissionMode: thread.permissionMode };
  }, id);
  await expect.poll(readExecution).toEqual({ status: 'idle', permissionMode: 'full' });

  await window.evaluate((threadId) => {
    history.pushState({}, '', `/threads/${threadId}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  const detail = window.getByTestId('thread-detail');
  const timeline = detail.getByTestId('thread-timeline');
  await expect(timeline).toContainText('Response to: Start without an explicit permission mode');

  await window.evaluate(async (threadId) => {
    const response = await fetch(`/api/v1/threads/${threadId}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'Follow up without an explicit permission mode' })
    });
    if (!response.ok) throw new Error(await response.text());
  }, id);
  await expect(timeline).toContainText('Response to: Follow up without an explicit permission mode');
  await expect.poll(readExecution).toEqual({ status: 'idle', permissionMode: 'full' });

  await window.reload();
  const composer = detail.locator('.thread-command-composer');
  await expect(composer.getByTestId('thread-command-send')).toBeEnabled();
  await expect.poll(readExecution).toEqual({ status: 'idle', permissionMode: 'full' });
  await composer.getByTestId('thread-command-input').fill('Continue from the composer');
  const request = window.waitForRequest((r) => r.url().endsWith(`/threads/${id}/send`) && r.method() === 'POST');
  await composer.getByTestId('thread-command-input').press('Enter');
  expect((await request).postDataJSON().permissionMode).toBe('full');
  await expect(timeline).toContainText('Response to: Continue from the composer');
  await expect.poll(readExecution).toEqual({ status: 'idle', permissionMode: 'full' });
  await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);
});
