import { test, expect, dismissConsentOverlays } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  isolateBundledCatalog: true,
  initialConfig: { sponsorPromptDismissed: true, defaultHarness: 'claude', defaultThreadProviderId: 'removed-provider' }
});

test('thread defaults are explicit, independent, persistent, and never silently replaced', async ({ app }, info) => {
  const page = app.window;
  const navigate = async (path: string) => page.evaluate(path => {
    history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await dismissConsentOverlays(page);
  await page.getByTestId('nav-home').click();
  const home = page.locator('.home-agent-composer');
  await home.getByRole('group', { name: 'Launch mode' }).getByRole('button', { name: 'Modern', exact: true }).click();
  const input = home.getByTestId('thread-command-input');
  await expect(home.getByText(/selected harness is unavailable/)).toBeVisible();
  await input.fill('Keep this draft and harness');
  await expect(home.getByTestId('thread-command-send')).toBeDisabled();
  await home.getByTestId('model-reasoning-picker-trigger').click();
  await page.getByTestId('model-reasoning-provider-fake').click();
  await page.keyboard.press('Escape');
  await expect(home.getByTestId('thread-default-hint')).toContainText('This thread only');
  expect((await page.evaluate(() => window.cc.config.get())).defaultThreadProviderId).toBe('removed-provider');

  // A separate new-thread surface still starts from the configured default.
  await navigate('/threads/new');
  await expect(page.getByTestId('new-thread-view').getByText(/selected harness is unavailable/)).toBeVisible();
  await page.getByTestId('nav-home').click();
  await expect(input).toHaveText('Keep this draft and harness');
  await expect(home.getByTestId('thread-default-hint')).toContainText('This thread only');

  // Both settings pages share the same default while CLI agents keep their own.
  await navigate('/settings/composer');
  await expect(page.getByRole('heading', { name: 'New chat defaults' })).toBeVisible();
  await page.getByRole('button', { name: 'Default for threads', exact: true }).click();
  await page.getByRole('option', { name: 'Fake', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.cc.config.get())).defaultThreadProviderId).toBe('fake');
  expect((await page.evaluate(() => window.cc.config.get())).defaultHarness).toBe('claude');
  const defaults = page.getByRole('region', { name: 'New chat defaults' });
  await expect(defaults.getByRole('button', { name: 'Model', exact: true })).toContainText('Fake Model');
  await defaults.getByRole('button', { name: 'Model', exact: true }).scrollIntoViewIfNeeded();
  await captureElectronScreenshot(app.electron, page, info.outputPath('composer-defaults.png'));
  await navigate('/settings/harness');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Default for threads', exact: true })).toContainText('Fake');
  const row = page.locator('[data-provider-id="fake"]');
  await row.getByRole('button', { name: 'Configure Fake' }).click();
  await expect(row.getByRole('button', { name: 'Model', exact: true })).toContainText('Fake Model');
  await row.getByRole('button', { name: 'Model', exact: true }).scrollIntoViewIfNeeded();
  await captureElectronScreenshot(app.electron, page, info.outputPath('harness-details.png'));
  await page.getByRole('button', { name: 'Default for threads', exact: true }).scrollIntoViewIfNeeded();
  await captureElectronScreenshot(app.electron, page, info.outputPath('thread-and-cli-defaults.png'));

  await navigate('/');
  await home.getByRole('group', { name: 'Launch mode' }).getByRole('button', { name: 'Modern', exact: true }).click();
  await expect(home.getByTestId('thread-default-hint')).toContainText('Global thread default');
  const projectId = await page.evaluate(async () => (await window.cc.projects.list()).find(project => project.quickAgent)?.id);
  expect(projectId).toBeTruthy();
  const overridden = await page.evaluate(async id => {
    const response = await fetch(`/api/v1/projects/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultThreadProviderId: 'removed-project-provider' }) });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).project;
  }, projectId);
  expect(overridden.defaultThreadProviderId).toBe('removed-project-provider');
  await expect(home.getByTestId('thread-default-hint')).toContainText('Project default');
  await expect(home.getByText(/selected harness is unavailable/)).toBeVisible();
  await page.evaluate(async id => {
    const response = await fetch(`/api/v1/projects/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultThreadProviderId: null }) });
    if (!response.ok) throw new Error(await response.text());
  }, projectId);
  await expect(home.getByTestId('thread-default-hint')).toContainText('Global thread default');
  await input.fill('A thread created using the explicit default');
  await page.evaluate(async () => {
    const response = await fetch('/api/v1/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultThreadProviderId: 'next-thread-default' }) });
    if (!response.ok) throw new Error(await response.text());
  });
  await expect(home.getByTestId('thread-default-hint')).toContainText('Draft harness');
  await expect(home.getByTestId('thread-command-send')).toBeEnabled();
  await home.getByTestId('thread-command-send').click();
  await expect.poll(() => page.evaluate(async () => {
    const body = await (await fetch('/api/v1/threads')).json();
    return body.threads?.find((thread: { providerId: string }) => thread.providerId === 'fake')?.providerId;
  })).toBe('fake');
  await expect(page.getByTestId('thread-detail')).toBeVisible();
  await page.getByTestId('nav-home').click();
  await expect(input).toHaveText('');
  await expect(home.getByTestId('thread-default-hint')).toContainText('Global thread default');
  await expect(home.getByTestId('model-reasoning-picker-trigger')).toHaveAttribute('title', /^next-thread-default/);
  await expect(home.getByTestId('thread-command-send')).toBeDisabled();
});
