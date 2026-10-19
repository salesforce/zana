import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('chat drafts and send configuration survive thread navigation, hiding and successful send', async ({ app }) => {
  const page = app.window;
  const ids = await page.evaluate(async () => {
    const project = (await window.cc.projects.list())[0]!;
    const ids: string[] = [];
    for (const title of ['Draft chat A', 'Draft chat B']) {
      const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id, providerId: 'fake', input: title, title, environment: { kind: 'personal' } }) });
      if (!response.ok) throw Error(await response.text());
      ids.push((await response.json()).thread.id);
    }
    return ids;
  });
  const navigate = async (path: string) => {
    await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
  };
  for (const id of ids) await expect.poll(() => page.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id)).toBe('idle');
  await navigate(`/threads/${ids[0]}`);
  const input = page.getByTestId('thread-detail').getByTestId('thread-command-input');
  await expect(input).toBeVisible();
  await input.fill('Unsent message A');
  const imagePicker = page.getByTestId('thread-detail').locator('input[type="file"]');
  await imagePicker.setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
  const sendMode = page.getByTestId('composer-send-mode-picker');
  await sendMode.click();
  await page.getByRole('option', { name: /^Steer / }).click();
  await navigate(`/threads/${ids[1]}`);
  await expect(input).toHaveText('');
  await input.fill('Unsent message B');
  await sendMode.click();
  await page.getByRole('option', { name: /^Queue / }).click();
  await navigate(`/threads/${ids[0]}`);
  await expect(input).toHaveText('Unsent message A');
  await expect(page.getByTestId('thread-detail').getByRole('button', { name: 'Remove draft.png' })).toBeVisible();
  await expect(sendMode).toContainText('Steer');
  await page.evaluate(() => { dispatchEvent(new Event('blur')); dispatchEvent(new Event('focus')); });
  await expect(input).toHaveText('Unsent message A');
  await navigate('/inbox');
  await navigate(`/threads/${ids[0]}`);
  await expect(input).toHaveText('Unsent message A');
  await page.getByTestId('thread-detail').getByTestId('thread-command-send').click();
  await expect(input).toHaveText('');
  await navigate(`/threads/${ids[1]}`);
  await expect(input).toHaveText('Unsent message B');
  await navigate(`/threads/${ids[0]}`);
  await expect(input).toHaveText('');
  await expect(sendMode).toContainText('Steer');
});

test('home draft survives leaving and returning without appearing in the new-thread surface', async ({ app }) => {
  const page = app.window;
  await page.getByTestId('nav-home').click();
  const input = page.locator('.home-agent-composer [contenteditable="true"]').first();
  await expect(input).toBeVisible();
  await input.fill('Unsent Home prompt');
  await page.getByTestId('nav-inbox').click();
  await page.getByTestId('nav-home').click();
  await expect(input).toHaveText('Unsent Home prompt');
  await page.evaluate(() => { history.pushState({}, '', '/threads/new'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByTestId('new-thread-view').locator('[contenteditable="true"]')).toHaveText('');
  await page.getByTestId('nav-home').click();
  await expect(input).toHaveText('Unsent Home prompt');
});

test('launcher close/reopen and mode changes preserve the prompt without leaking into Home', async ({ app }) => {
  const page = app.window;
  await page.getByTestId('nav-agents').click();
  await page.getByTestId('agents-board-new-thread').first().click();
  const modal = page.getByTestId('launch-modal');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'CLI Agent', exact: true }).click();
  await modal.getByTestId('legacy-agent-command-input').fill('Launcher draft');
  await modal.getByRole('button', { name: 'Modern', exact: true }).click();
  await expect(modal.getByTestId('thread-command-input')).toHaveText('Launcher draft');
  await modal.getByRole('button', { name: 'CLI Agent', exact: true }).click();
  await expect(modal.getByTestId('legacy-agent-command-input')).toHaveText('Launcher draft');
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await page.getByTestId('agents-board-new-thread').first().click();
  await expect(modal.getByTestId('legacy-agent-command-input')).toHaveText('Launcher draft');
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-home').click();
  await expect(page.locator('.home-agent-composer [contenteditable="true"]').first()).toHaveText('');
});
