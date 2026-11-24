import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { makeFakeAgentBinary } from './sdk/harness.js';

const exec = promisify(execFile);
const harness = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
test.afterAll(() => harness.cleanup());
test.use({ initialConfig: { sponsorPromptDismissed: true, claudeBinary: harness.path, defaultHarness: 'claude', defaultThreadProviderId: 'fake' }, launchEnv: { ZCC_FAKE_PROVIDER: '1', ZCC_E2E_PEER_BOOT_KEY_HEX: randomBytes(32).toString('hex') } });

async function route(page: Page, path: string) {
  await page.evaluate(path => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function openBotsSwitch(page: Page) {
  await route(page, '/settings/experimental');
  return page.getByRole('switch', { name: 'Bots', exact: true });
}

test.beforeEach(async ({ app }) => {
  const page = app.window;
  const nav = page.locator('.nav-item').filter({ hasText: /^Bots$/ }).first();
  const toggle = await openBotsSwitch(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 45_000 });
  await page.getByRole('link', { name: 'Back to app' }).click();
  await expect(nav).toHaveCount(0);
  await openBotsSwitch(page);
  await toggle.click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('link', { name: 'Back to app' }).click();
  await expect(nav).toBeVisible();
});

test('Bots shows routines, tagged memory, and host settings controls in the installed panel', async ({ app, home }, testInfo) => {
  test.setTimeout(180_000);
  const cli = resolve(process.env.ZCC_E2E_APP_ROOT ?? '.', 'packages/cli/dist/bin/zcc');
  const run = (args: string[]) => exec(process.execPath, [cli, ...args], {
    cwd: home, timeout: 60_000, env: { ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'),
      ZCC_SERVER_URL: new URL(app.window.url()).origin, ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined,
      ZCC_THREAD_ID: undefined, BB_THREAD_ID: undefined,
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
  await panel.getByRole('tab', { name: 'Vault' }).click();
  const vault = panel.getByRole('region', { name: 'Vault' });
  await expect(vault.getByLabel(/passphrase/i)).toHaveCount(0);
  await expect(vault.getByRole('button', { name: 'New item' })).toBeVisible();
  await expect(vault.getByRole('region', { name: 'Connections' })).toHaveCount(0);
  await vault.getByRole('button', { name: 'New item' }).click();
  await vault.getByRole('button', { name: 'Login', exact: true }).click();
  await vault.getByLabel('Websites').fill('https://accounts.example.test');
  await vault.getByLabel('Username').fill('release-test');
  await vault.getByLabel('Password', { exact: true }).fill('test-only-password');
  await expect(vault.getByLabel('Release Scout', { exact: true })).toBeChecked();
  await vault.getByRole('button', { name: 'Save item' }).click();
  await expect(vault.getByRole('button', { name: /accounts.example.test/ })).toBeVisible();
  await vault.getByRole('button', { name: /accounts.example.test/ }).click();
  await expect(vault.getByRole('button', { name: 'Replace Password' })).toBeVisible();
  await expect(vault.locator('input[type=password]')).toHaveCount(0);
  await vault.getByRole('button', {name:'Replace Password'}).click();
  const replacement = vault.getByLabel('Password', {exact:true});
  await expect(replacement).toHaveAttribute('type','password');
  await expect(replacement).toHaveValue('');
  await replacement.fill('replacement-test-password');
  await vault.getByRole('button', {name:'Save item'}).click();
  await vault.getByRole('button', {name:/accounts.example.test/}).click();
  await expect(vault.getByRole('button', {name:'Replace Password'})).toBeVisible();
  await vault.getByRole('button', { name: 'Cancel' }).click();
  await expect(vault.getByRole('button', { name: /accounts.example.test/ })).toBeVisible();
  await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('vault.png'));
  await panel.getByRole('tab', { name: 'Overview' }).click();
  await expect(panel.locator('.bt-item[aria-current="true"] .bt-av')).toHaveClass(/is-live/);
  await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('overview.png'));
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
  const role = panel.getByRole('textbox', { name: 'Personality and role' });
  const saveRole = panel.getByRole('button', { name: 'Save', exact: true });
  await expect(role).toContainText('Watch release branches');
  await expect(saveRole).toHaveCount(0);
  await role.fill('Triage releases');
  await role.press('ControlOrMeta+a');
  await panel.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(role.locator('strong')).toHaveText('Triage releases');
  await saveRole.click();
  const readPersonality = async () => {
    const response = await app.window.request.post(new URL('/api/v1/plugin-apps/bots/rpc', app.window.url()).href, {
      data: { method: 'get', args: { bot: 'release-scout' } }
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).value.bot.personality;
  };
  await expect.poll(readPersonality).toBe('**Triage releases**');
  await panel.getByRole('tab', { name: 'Overview' }).click();
  await panel.getByRole('tab', { name: 'Settings' }).click();
  await expect(role.locator('strong')).toHaveText('Triage releases');
  await role.fill('Unsaved role');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(role.locator('strong')).toHaveText('Triage releases');
  await expect(saveRole).toHaveCount(0);
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
  await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('settings.png'));
  // Constrain only this isolated plugin pane, just as a narrow side panel does.
  await panel.evaluate(el => { el.style.width = '360px'; });
  await expect.poll(() => panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await select.scrollIntoViewIfNeeded();
  await expect(select).toBeInViewport();
  await panel.getByLabel('Name', {exact:true}).fill('Scout II');
  await panel.getByRole('button', {name:'Save',exact:true}).click();
  await expect(panel.getByRole('heading',{name:'Scout II'})).toBeVisible();

  const toggle = await openBotsSwitch(app.window);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  const nav = app.window.locator('.nav-item').filter({ hasText: /^Bots$/ }).first();
  await expect(toggle).toBeEnabled();
  await app.window.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await app.window.getByRole('link', { name: 'Back to app' }).click();
  await expect(nav).toHaveCount(0);
  await openBotsSwitch(app.window);
  await toggle.click();
  await expect(toggle).toBeEnabled();
  await app.window.getByRole('link', { name: 'Back to app' }).click();
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(panel.getByRole('heading', { name: 'Scout II' })).toBeVisible();
  await expect.poll(readPersonality).toBe('**Triage releases**');
  await expect(panel.getByText('Digest', { exact: true }).first()).toBeVisible();

  await route(app.window, '/settings/plugins/bots');
  const settingsVault = app.window.getByRole('region', { name: 'Vault' });
  await expect(settingsVault.getByRole('button', { name: /accounts.example.test/ })).toBeVisible();
  await expect(settingsVault.getByRole('region', { name: 'Connections' })).toHaveCount(0);
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
  await expect(page.locator('.home-panel > .aurora-grid')).toBeVisible();
  await page.getByRole('button', { name: 'Basic view', exact: true }).click();
  const sidebar = page.getByTestId('basic-ui-sidebar');
  const row = sidebar.getByRole('button', { name: 'Demo Coach', exact: true });
  await expect(row.locator('.bt-av svg')).toBeVisible();
  const shape = await row.locator('.bt-av').getAttribute('data-shape');
  const avatarColor = (body: Element) => getComputedStyle(body).fill;
  const color = await row.locator('.bt-body > g').first().evaluate(avatarColor);
  await expect(row).toHaveAccessibleDescription('Not started');
  await expect(page.locator('.home-panel > .aurora-grid')).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name: 'Show more', exact: true })).toHaveCount(0);
  for (const name of ['Scout', 'Guide', 'Editor', 'Planner']) {
    const created = await page.request.post(new URL('/api/v1/plugin-apps/bots/rpc', page.url()).href, {
      data: { method: 'create', args: { name, projectId, providerId: 'fake' } }
    });
    expect(created.ok()).toBe(true);
  }
  const add = sidebar.getByRole('button', { name: /New bot/ });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'New bot' });
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await add.click();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Reviewer');
  await dialog.getByRole('button', { name: 'Create bot' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name: 'Reviewer', exact: true })).toHaveAttribute('aria-current', 'page');
  await sidebar.getByRole('button', { name: 'Show less', exact: true }).click();
  const more = sidebar.getByRole('button', { name: 'Show more', exact: true });
  await expect(more).toBeVisible();
  await expect(sidebar.locator('.bt-basic-row')).toHaveCount(5);
  await more.click();
  const overflow = sidebar.getByRole('button', { name: 'Reviewer', exact: true });
  await overflow.hover();
  await sidebar.getByRole('button', { name: 'Pin Reviewer', exact: true }).click();
  await expect(sidebar.locator('.bt-basic-row').first()).toHaveText(/Reviewer/);
  await page.reload();
  await expect(more).toBeVisible();
  await expect(sidebar.locator('.bt-basic-row').first()).toHaveText(/Reviewer/);
  await sidebar.getByRole('button', { name: 'Unpin Reviewer', exact: true }).click();
  await expect(overflow).toHaveCount(0);
  const search = sidebar.getByRole('searchbox');
  await search.fill('reviewer');
  await expect(overflow).toBeVisible();
  await search.fill('missing');
  await expect(row).toHaveCount(0);
  await search.fill('coach');
  await row.click();
  await expect(page).toHaveURL(/\/threads\/[^/?#]+/);
  await expect(row).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.thread-detail-main > .aurora-grid')).toHaveCount(0);
  const chat = page.url();
  const api = new URL('/api/v1' + new URL(chat).pathname, chat).href;
  const readThread = async () => (await (await page.request.get(api)).json()).thread;
  expect(await readThread()).toMatchObject({ title: 'Demo Coach', status: 'idle', providerThreadId: null, permissionMode: 'full' });
  const welcome = page.getByRole('heading', { name: 'What shall we work on today?', level: 2 });
  await expect(welcome).toBeInViewport();
  const composer = page.getByTestId('thread-command-input');
  await expect(composer).toBeInViewport();
  const placeholder = () => composer.locator('p.is-editor-empty').evaluate((p) => getComputedStyle(p, '::before').content);
  await expect.poll(placeholder).toContain('Send your first message');
  await expect(composer).toHaveText('');
  await expect(sidebar.getByLabel('Message Demo Coach')).toHaveCount(0);
  await composer.fill('Hello from the thread composer.');
  await expect(welcome).toBeVisible();
  await page.getByTestId('thread-command-send').click();
  await expect(welcome).toHaveCount(0);
  await expect(page.getByTestId('thread-timeline')).toContainText('Hello from the thread composer.');
  await expect.poll(async () => (await readThread()).providerThreadId).toBeTruthy();
  await expect.poll(async () => (await readThread()).status).toBe('idle');
  await expect.poll(placeholder).toContain('Ask for a follow-up');
  const { events } = await (await page.request.get(api + '/events')).json();
  expect(events.filter((event: { type: string }) => event.type === 'client/turn/requested')).toHaveLength(1);
  await search.fill('');
  await expect(sidebar.locator('.basic-ui-chat-row')).toHaveCount(0);
  await sidebar.getByRole('link', { name: 'New chat' }).click();
  // Hold both reads so the short-lived opening frame can be asserted reliably.
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const threadRead = (url: URL) => url.href === api || url.href.split('?')[0] === api + '/timeline';
  await page.route(threadRead, async route => { await gate; await route.continue(); });
  try {
    await row.click();
    const detail = page.getByTestId('thread-detail');
    await expect(detail.getByRole('status').filter({ hasText: 'Loading conversation' })).toBeVisible();
    await expect(detail.locator('h1')).toHaveText('');
    await expect(detail.getByTestId('thread-detail-status')).toHaveCount(0);
    await expect(detail.getByTestId('thread-loading')).toHaveCount(0);
    await expect(welcome).toHaveCount(0);
    await expect(composer).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page).toHaveURL(chat);
  const transcript = page.getByTestId('thread-timeline');
  await expect(transcript).toContainText('Hello from the thread composer.');
  const message = transcript.locator('.thread-timeline-row.is-user').first();
  const scrollGap = () => message.evaluate(el => {
    const pane = el.closest('.thread-detail-timeline')!;
    return pane.getBoundingClientRect().right - el.getBoundingClientRect().right;
  });
  await expect.poll(scrollGap).toBeGreaterThanOrEqual(10);
  const botTitle = page.getByRole('heading', { level: 1 }).getByRole('button', { name: 'Open Demo Coach profile' });
  const headerLeft = await page.locator('.thread-detail-heading').evaluate(el => el.getBoundingClientRect().left);
  for (const item of [botTitle, page.locator('.basic-thread-project')]) {
    await expect(item).toBeVisible();
    await expect.poll(() => item.evaluate(el => el.getBoundingClientRect().left)).toBeCloseTo(headerLeft, 0);
  }
  await page.unroute(threadRead);
  await composer.fill('My draft');
  await botTitle.click();
  const profile = page.locator('.bt-profile');
  await expect(profile.getByRole('heading', { name: 'Demo Coach' })).toBeVisible();
  await expect(profile.getByRole('button', { name: /Add routine/ })).toBeVisible();
  await profile.getByRole('tab', { name: 'Settings' }).click();
  const name = profile.getByRole('textbox', { name: 'Name', exact: true });
  const save = profile.getByRole('button', { name: 'Save', exact: true });
  const cancel = profile.getByRole('button', { name: 'Cancel', exact: true });
  await expect(save).toHaveCount(0);
  await expect(cancel).toHaveCount(0);
  await name.fill('Draft name');
  await expect(save).toBeInViewport({ ratio: 1 });
  await profile.getByRole('button', { name: 'Delete bot…' }).scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport({ ratio: 1 });
  await cancel.click();
  await expect(name).toHaveValue('Demo Coach');
  await expect(save).toHaveCount(0);
  await name.fill('Interview Coach');
  await save.click();
  await expect(cancel).toHaveCount(0);
  const renamed = page.getByRole('button', { name: 'Open Interview Coach profile' });
  await expect(renamed).toBeVisible();
  await page.getByTestId('thread-secondary-hide').click();
  await expect(composer).toHaveText('My draft');
  await expect(page).toHaveURL(chat);
  await page.getByRole('button', { name: 'Advanced view', exact: true }).click();
  await expect(page.locator('.bt-basic')).toHaveCount(0);
  const rail = page.locator('.sidebar--global');
  const activeThread = rail.locator('[data-testid="project-thread-row"][aria-current="true"]');
  await expect(activeThread.locator('.bt-av')).toHaveAttribute('data-shape', shape!);
  expect(await activeThread.locator('.bt-body > g').first().evaluate(avatarColor)).toBe(color);
  const regular = await page.request.post(new URL('/api/v1/threads', chat).href, {
    data: { projectId, providerId: 'fake', title: 'Ordinary conversation', input: 'Hello' }
  });
  expect(regular.ok()).toBe(true);
  const ordinaryIcon = rail.getByRole('button', { name: 'Ordinary conversation', exact: true }).locator('.tab-profile-icon');
  await expect(ordinaryIcon.locator('svg')).toBeVisible();
  await expect(ordinaryIcon.locator('.bt-av')).toHaveCount(0);
  await renamed.click();
  await expect(profile.getByRole('heading', { name: 'Interview Coach' })).toBeVisible();
  await expect(page).toHaveURL(chat);
  await expect(page.locator('.nav-item').filter({ hasText: /^Bots$/ }).first()).toBeVisible();

  await page.getByTestId('nav-agents').click();
  const cards = page.locator('.agent-card.is-thread');
  const botCard = cards.filter({ hasText: (await readThread()).title });
  // Bot threads stay off the Agents board until the Bots toggle shows them.
  await expect(botCard).toHaveCount(0);
  const showBots = page.getByTestId('agents-board-thread-toggle-bots-threads');
  await expect(showBots).toHaveAttribute('aria-pressed', 'false');
  await showBots.click();
  await expect(showBots).toHaveAttribute('aria-pressed', 'true');
  await expect(botCard.locator('.agent-card-icon .bt-av')).toHaveAttribute('data-shape', shape!);
  expect(await botCard.locator('.bt-body > g').first().evaluate(avatarColor)).toBe(color);
  const regularCard = cards.filter({ hasText: 'Ordinary conversation' });
  await expect(regularCard.locator('.agent-card-icon svg')).toBeVisible();
  await expect(regularCard.locator('.bt-av')).toHaveCount(0);
});

test('a ten-minute direct routine posts in the main chat without starting a provider turn', async ({ app, home }) => {
  const page = app.window;
  const rpc = async (method: string, args: Record<string, unknown>) => {
    const res = await page.request.post(new URL('/api/v1/plugin-apps/bots/rpc', page.url()).href, { data: { method, args } });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()).value;
  };
  const path = join(home, 'routine-project');
  mkdirSync(path);
  const res = await page.request.post(new URL('/api/v1/projects', page.url()).href, { data: { path } });
  const projectId = (await res.json()).project.id;
  const bot = 'Desk clock';
  await rpc('create', { name: bot, projectId, providerId: 'fake' });
  await rpc('addRoutine', { bot, routine: { name: 'Stretch', kind: 'reminder', cron: '*/10 * * * *', prompt: 'Take a stretch break.', enabled: false } });
  const { threadId } = await rpc('runRoutine', { bot, routineId: 'stretch' });
  await route(page, '/threads/' + threadId);
  const transcript = page.getByTestId('thread-timeline');
  await expect(transcript.getByText('Take a stretch break.', { exact: true })).toHaveCount(1);
  await rpc('runRoutine', { bot, routineId: 'stretch' });
  await expect(transcript.getByText('Take a stretch break.', { exact: true })).toHaveCount(2);
  await page.reload();
  await expect(transcript.getByText('Take a stretch break.', { exact: true })).toHaveCount(2);
  const api = new URL('/api/v1/threads/' + threadId, page.url()).href;
  const { thread } = await (await page.request.get(api)).json();
  expect(thread).toMatchObject({ status: 'idle', providerThreadId: null });
  const { events } = await (await page.request.get(api + '/events')).json();
  expect(events.filter((event: { type: string }) => event.type === 'client/turn/requested')).toHaveLength(0);
});
