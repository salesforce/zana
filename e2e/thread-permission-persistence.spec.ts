import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('Full survives creation, follow-ups, reload, and an explicit change to Edits', async ({ app }) => {
  const { window } = app;
  // Use the normal multi-mode composer with the deterministic runtime. Hide the
  // single-mode fake catalogue entry; the host still uses the real fake adapter.
  await window.route('**/api/v1/system/execution-options*', async (route) => {
    if (new URL(route.request().url()).searchParams.has('providerId')) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = await response.json();
    if (Array.isArray(body.providers)) body.providers = body.providers.filter((p: { id: string }) => p.id === 'codex');
    await route.fulfill({ response, json: body });
  });
  await window.reload();
  await window.getByTestId('nav-home').click();
  const home = window.locator('.thread-command-composer').first();
  await expect(home.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  await home.getByLabel('Permission mode', { exact: true }).click();
  await window.getByRole('option', { name: /^Full Access/ }).click();
  await expect(home.getByLabel('Permission mode', { exact: true })).toContainText('Full');
  await home.getByTestId('thread-command-input').fill('First message with Full');
  const createdResponse = window.waitForResponse((r) => r.url().endsWith('/api/v1/threads') && r.request().method() === 'POST');
  await home.getByTestId('thread-command-send').click();
  const created = await (await createdResponse).json();
  const id = (created.value ?? created.thread).id as string;
  const detail = window.getByTestId('thread-detail');
  const composer = detail.locator('.thread-command-composer');
  const picker = composer.getByLabel('Permission mode', { exact: true });
  await expect(picker).toContainText('Full');
  await expect(detail.getByTestId('thread-timeline')).toContainText('Response to: First message with Full');

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
  await send('Second message keeps Full', 'full');
  await expect(picker).toContainText('Full');
  await window.reload();
  await expect(picker).toContainText('Full');
  await send('Third message after reopening', 'full');

  await picker.click();
  await window.getByRole('option', { name: /^Accept Edits/ }).click();
  await send('Explicitly switch to Edits', 'accept-edits');
  await window.reload();
  await expect(picker).toContainText('Edits');
  await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);
  await window.unrouteAll({ behavior: 'wait' });
});
