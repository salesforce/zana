import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from './fixtures/app.js';

const exec = promisify(execFile);
test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('Bots shows routines, tagged memory, and host settings controls in the installed panel', async ({ app, home }, testInfo) => {
  test.setTimeout(180_000);
  const cli = resolve(process.env.ZCC_E2E_APP_ROOT ?? '.', 'packages/cli/dist/bin/zcc');
  const run = (args: string[]) => exec(process.execPath, [cli, ...args], {
    cwd: home, timeout: 60_000, env: { ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'),
      ZCC_SERVER_URL: new URL(app.window.url()).origin, ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined,
      ZCC_SKIP_PLUGIN_NPM: '1' }
  });
  const projectPath = join(home, 'bot-project');
  mkdirSync(projectPath);
  const projectId = await app.window.evaluate(async path => {
    const response = await fetch('/api/v1/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({path}) });
    return (await response.json()).project.id as string;
  }, projectPath);
  await expect(app.window.locator('.nav-item').filter({ hasText: /^Bots$/ }).first()).toBeVisible();
  await run(['bots','create','Release Scout','--color','#f97316','--personality','Watch release branches and flag risky merges.','--project',projectId]);
  await run(['bots','routine','add','release-scout','--name','Digest','--cron','0 9 * * 1-5','--prompt','Report changes']);
  // Bundled plugins finish starting independently during a cold launch.
  await expect.poll(async () => {
    const response = await app.window.request.get(new URL('/api/v1/plugins', app.window.url()).href);
    const { plugins } = await response.json();
    return plugins.find((plugin: { id: string }) => plugin.id === 'memory')?.status;
  }, { timeout: 30_000 }).toBe('running');
  await run(['memory','add','--scope','global','--name','release-digest','--summary','Release digest preferences','--details','Include branch names.','--tag','bot:release-scout','--reason','Remember the release format']);
  await app.window.locator('.nav-item').filter({hasText:/^Bots$/}).first().click();
  const panel = app.window.locator('.bt-root');
  await expect(panel.getByRole('tab', {name:'Overview'})).toBeVisible();
  await expect(panel.getByText('Next run')).toBeVisible();
  await expect(panel.locator('.bt-item[aria-current="true"] .bt-av')).toHaveClass(/is-live/);
  await panel.screenshot({ path: testInfo.outputPath('overview.png') });
  await panel.getByRole('button', {name:'Open library →'}).click();
  await panel.getByText('release-digest', {exact:true}).click();
  await expect(panel.getByText('Include branch names.')).toBeVisible();
  await panel.getByRole('tab', {name:'Settings'}).click();
  const select = panel.getByLabel('Provider', {exact:true});
  for (const label of ['Provider', 'Model']) {
    await panel.getByRole('button', {name: label, exact: true}).click();
    const field = app.window.getByRole('textbox', {name: 'Search ' + label.toLowerCase() + 's'});
    await expect(field).toBeFocused();
    await field.press('Escape');
  }
  await expect(panel.getByLabel('Personality and role')).toHaveCSS('resize','vertical');
  const picker = panel.getByRole('button', {name: 'Project', exact: true});
  await picker.click();
  const search = app.window.getByRole('textbox', {name: 'Search projects'});
  const pane = panel.locator('.bt-main');
  await pane.evaluate(el => { el.scrollTop = Math.max(0, el.scrollTop - 45); });
  await expect.poll(async () => {
    const menu = await app.window.getByRole('listbox', {name:'Project'}).boundingBox();
    const field = await picker.boundingBox();
    if (!menu || !field) return false;
    const gap = Math.max(menu.y - field.y - field.height, field.y - menu.y - menu.height);
    return Math.abs(gap - 4) < 2 && Math.abs(menu.x - field.x) < 2;
  }).toBe(true);
  await search.fill('no-such-bot-project');
  await expect(app.window.getByText('No matching projects')).toBeVisible();
  await search.fill('bot-project');
  const options = app.window.getByRole('listbox', {name: 'Project'});
  await expect(options.getByRole('option', {name: 'bot-project', exact: true})).toBeVisible();
  await search.press('Enter');
  await expect(options).toBeHidden();
  await expect(picker).toContainText('bot-project');
  await panel.screenshot({ path: testInfo.outputPath('settings.png') });
  // Constrain only this isolated plugin pane, just as a narrow side panel does.
  await panel.evaluate(el => { el.style.width = '360px'; });
  await expect.poll(() => panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await select.scrollIntoViewIfNeeded();
  await expect(select).toBeInViewport();
  await panel.getByLabel('Name', {exact:true}).fill('Scout II');
  await panel.getByRole('button', {name:'Save',exact:true}).click();
  await expect(panel.getByRole('heading',{name:'Scout II'})).toBeVisible();
});

test('Basic sidebar opens bot conversations and leaves Advanced navigation intact', async ({ app, home }) => {
  const page = app.window;
  const path = join(home, 'sidebar-bot-project');
  mkdirSync(path);
  const project = await page.request.post(new URL('/api/v1/projects', page.url()).href, { data: { path } });
  expect(project.ok()).toBe(true);
  const projectId = (await project.json()).project.id;
  const create = await page.request.post(new URL('/api/v1/plugin-apps/bots/rpc', page.url()).href, {
    data: { method: 'create', args: { name: 'Demo Coach', color: '#9675d1', projectId, providerId: 'fake' } }
  });
  expect(create.ok()).toBe(true);
  await page.getByRole('button', { name: 'Basic view', exact: true }).click();
  const sidebar = page.getByTestId('basic-ui-sidebar');
  const row = sidebar.getByRole('button', { name: 'Demo Coach' });
  await expect(row).toBeVisible();
  const search = sidebar.getByRole('searchbox');
  await search.fill('missing');
  await expect(row).toHaveCount(0);
  await search.fill('coach');
  await row.click();
  await sidebar.getByLabel('Message Demo Coach').fill('Hello from the sidebar test.');
  await sidebar.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page).toHaveURL(/\/threads\/[^/?#]+/);
  await expect(row).toHaveAttribute('aria-current', 'page');
  const chat = page.url();
  await search.fill('');
  await expect(sidebar.locator('.basic-ui-chat-row')).toHaveCount(0);
  await sidebar.getByRole('link', { name: 'New chat' }).click();
  await row.click();
  await expect(page).toHaveURL(chat);
  await page.getByRole('button', { name: 'Advanced view', exact: true }).click();
  await expect(page.locator('.bt-basic')).toHaveCount(0);
  await expect(page.locator('.nav-item').filter({ hasText: /^Bots$/ }).first()).toBeVisible();
});
