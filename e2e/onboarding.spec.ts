/** Non-blocking onboarding companion through real Electron: skip, access, bundle install, tour, restart and resume. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { startGitDaemon } from './fixtures/git-daemon.js';
import type { Page } from '@playwright/test';

const profile = (source: string) => ({ id: 'salesforce-employees', organization: 'Salesforce',
  question: 'Are you a Salesforce employee?', prerequisite: 'Connect to the Salesforce VPN and check your corporate Git sign-in.', marketplaceSource: source });
function envFor(home: string, source: string) {
  const empty = join(home, 'empty-bundled'); mkdirSync(empty, { recursive: true });
  return { ZCC_ONBOARDING_PROFILE: JSON.stringify(profile(source)), ZCC_OFFICIAL_MARKETPLACE_URL: 'off',
    ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off', ZCC_SKIP_PLUGIN_NPM: '1',
    ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0', ZCC_BUNDLED_PLUGINS_DIR: empty, ZCC_BUNDLED_EXTENSIONS_DIR: empty };
}
const wizard = (win: Page) => win.getByRole('complementary', { name: 'Set up Zana', exact: true });
const step = (win: Page, id: string) => wizard(win).locator(`[data-step="${id}"]`);
const YES = /Yes, I.m an employee/;
const NO = /No, or not now/;
const onboarding = (win: Page) => win.evaluate(async () => (await window.cc.config.get()).onboarding as any);
/** The harness step depends on the machine, so tests skip it like a first-time user without agents. */
async function skipHarness(win: Page) {
  await expect(step(win, 'harness')).toHaveAttribute('data-state', 'todo');
  await step(win, 'harness').getByRole('button', { name: 'Skip for now', exact: true }).click();
  await expect(step(win, 'harness')).toHaveAttribute('data-state', 'skipped');
}
async function resume(win: Page, button = 'Resume setup') {
  // Settings lives in the Advanced sidebar.
  await win.getByTestId('basic-ui-mode-advanced').click();
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await win.getByTestId('settings-nav-global').click();
  await win.getByRole('button', { name: button, exact: true }).click();
  await expect(wizard(win)).toBeVisible();
}

test('employee setup is non-blocking, checks access, installs an inline bundle and finishes with the tour', async ({ home }, testInfo) => {
  test.setTimeout(240_000);
  const id = 'employee-fixture-tool';
  const git = await startGitDaemon(join(home, 'fixture-git'), [{ repoName: id, files: {
    'package.json': JSON.stringify({ name: `zcc-plugin-${id}`, version: '1.0.0', zcc: {
      name: 'Employee Fixture Tool', description: 'Onboarding install fixture', branding: { icon: 'Package' }, server: './server.mjs' } }),
    'server.mjs': 'export default zcc => { zcc.rpc.method("health", () => ({ok:true})); };'
  } }]);
  const catalog = join(home, 'employee-catalog');
  const env = envFor(home, `path:${catalog}`);
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, { env, initialConfig: { onboarding: undefined, sponsorPromptDismissed: true, theme: 'light' } });
    let win = app.window;
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(wizard(win)).toBeVisible();
    await expect(win.getByRole('dialog', { name: 'Set up Zana' })).toHaveCount(0);
    await expect(wizard(win)).toContainText('Nothing is installed or signed in without your click');
    // First run starts in Basic, and the app stays usable while the companion is open.
    await expect(win.locator('.app-shell')).toHaveAttribute('data-ui-mode', 'basic');
    await expect(win.getByTestId('basic-ui-mode-basic')).toHaveAttribute('aria-pressed', 'true');
    await win.getByRole('link', { name: 'New chat' }).click();
    await expect(wizard(win)).toBeVisible();
    await skipHarness(win);
    await expect(wizard(win)).toContainText('Are you a Salesforce employee?');
    await wizard(win).getByRole('button', { name: YES }).click();
    await expect(wizard(win)).toContainText('Salesforce VPN');
    await wizard(win).getByRole('button', { name: 'Check access and continue' }).click();
    await expect(wizard(win).getByRole('alert')).toBeVisible();
    mkdirSync(catalog, { recursive: true });
    writeFileSync(join(catalog, 'marketplace.json'), JSON.stringify({ schemaVersion: 1, name: 'employee-fixtures', displayName: 'Employee Fixtures',
      plugins: [{ id, displayName: 'Employee Fixture Tool', description: 'Onboarding install fixture',
        author: { name: 'E2E' }, source: { git: { url: git.urlFor(id) } } }] }));
    writeFileSync(join(catalog, 'packs.json'), JSON.stringify({ schemaVersion: 1, packs: [{ id: 'employee-starter',
      displayName: 'Employee Starter', description: 'Tools for employee onboarding', members: [{ pluginId: id, required: true }] }] }));
    await wizard(win).getByRole('button', { name: 'Retry access check' }).click();
    await expect(step(win, 'workplace')).toHaveAttribute('data-state', 'done');
    await expect(step(win, 'bundle')).toHaveAttribute('data-state', 'todo');
    await expect(wizard(win).getByRole('button', { name: 'Install and continue', exact: true })).toBeVisible();
    await expect(wizard(win)).toContainText('Employee Fixture Tool');
    await testInfo.attach('companion-bundle', { body: await win.screenshot(), contentType: 'image/png' });
    await wizard(win).getByRole('button', { name: 'Install and continue', exact: true }).click();
    await expect(step(win, 'bundle')).toHaveAttribute('data-state', 'done');
    const installed = JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8'));
    expect(installed.plugins).toEqual(expect.arrayContaining([expect.objectContaining({ id, version: '1.0.0' })]));
    // Advanced step: coachmark anchors to the title-bar switch.
    await expect(step(win, 'advanced')).toHaveAttribute('data-state', 'todo');
    await expect(win.getByRole('region', { name: 'Basic and Advanced' })).toBeVisible();
    await expect(win.locator('body')).toHaveAttribute('data-onboarding-spotlight', 'interface-mode');
    await testInfo.attach('companion-coachmark', { body: await win.screenshot(), contentType: 'image/png' });
    await win.getByRole('region', { name: 'Basic and Advanced' }).getByRole('button', { name: 'Got it' }).click();
    await step(win, 'advanced').getByRole('button', { name: /stay in Basic|Done/ }).click();
    await expect(wizard(win)).toBeHidden({ timeout: 15_000 });
    const saved = await onboarding(win);
    expect(saved).toMatchObject({ version: 2, audience: 'organization', marketplaceSource: `path:${catalog}`, pluginIds: [id],
      steps: { harness: 'skipped', workplace: 'done', bundle: 'done', advanced: 'done' } });
    expect(saved.completedAt).toBeTruthy();
    await closeApp(app.electron);
    app = await launchApp(home, { env }); win = app.window;
    await expect(wizard(win)).toHaveCount(0);
  } finally { if (app) await closeApp(app.electron); await git.close(); }
});

test('finish later minimizes to a sidebar pill that resumes after restart and from Settings', async ({ home }, testInfo) => {
  test.setTimeout(120_000);
  const env = envFor(home, `path:${join(home, 'unused-catalog')}`);
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, { env, initialConfig: { onboarding: undefined, walkthroughCompleted: true,
      setupDismissed: true, sponsorPromptDismissed: true, lastSeenVersion: '0.1.0' } });
    let win = app.window;
    await expect(wizard(win)).toBeVisible();
    await win.setViewportSize({ width: 1100, height: 700 });
    await testInfo.attach('onboarding-companion', { body: await win.screenshot(), contentType: 'image/png' });
    await wizard(win).focus();
    await win.keyboard.press('Escape');
    const pill = win.getByRole('button', { name: /Finish setting up/ });
    await expect(pill).toBeVisible();
    await expect(wizard(win)).not.toBeVisible();
    await closeApp(app.electron);
    app = await launchApp(home, { env }); win = app.window;
    const whatsNew = win.getByRole('dialog', { name: /what.s new/i });
    if (await whatsNew.isVisible()) await win.keyboard.press('Escape');
    await expect(win.getByRole('button', { name: /Finish setting up/ })).toBeVisible();
    await win.getByRole('button', { name: /Finish setting up/ }).click();
    await expect(wizard(win)).toBeVisible();
    await skipHarness(win);
    await wizard(win).getByRole('button', { name: NO }).click();
    await step(win, 'workplace').getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(step(win, 'workplace')).toHaveAttribute('data-state', 'skipped');
    await expect(step(win, 'bundle')).toContainText('Browse');
    await step(win, 'bundle').getByRole('button', { name: 'Skip', exact: true }).click();
    await step(win, 'advanced').getByRole('button', { name: /stay in Basic|Done/ }).click();
    await expect(wizard(win)).toBeHidden({ timeout: 15_000 });
    const saved = await onboarding(win);
    expect(saved.steps).toMatchObject({ harness: 'skipped', workplace: 'skipped', bundle: 'skipped', advanced: 'done' });
    expect(saved.completedAt).toBeTruthy();
    await resume(win, 'Configure');
    await closeApp(app.electron);
    app = await launchApp(home, { env });
    await expect(wizard(app.window)).toHaveCount(0);
  } finally { if (app) await closeApp(app.electron); }
});

test('employee setup signs in to Git with a browser device code through the real main-process gh boundary', async ({ home }, testInfo) => {
  test.skip(process.platform === 'win32', 'fake gh is a POSIX shell script');
  test.setTimeout(180_000);
  // Stands in for the corporate Git host so the reachability probe succeeds.
  const listener = createServer(socket => socket.destroy());
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${(listener.address() as { port: number }).port}`;
  const catalog = join(home, 'device-catalog');
  const state = join(home, 'fake-gh-state');
  mkdirSync(state, { recursive: true });
  const gh = join(home, 'fake-gh');
  // Large output proves capture is not truncated at the 8 KiB pipe boundary seen in Electron main.
  writeFileSync(gh, `#!/bin/sh
case "$1 $2" in
  "auth status") if [ -f "${state}/approved" ]; then echo '{"hosts":{"${host}":[{"state":"success","active":true,"login":"e2e-user"}]}}'; else echo '{"hosts":{}}'; fi ;;
  "auth login") head -c 12000 /dev/zero | tr '\\0' ' ' >&2
    echo '! First copy your one-time code: E2E1-CODE' >&2
    echo 'Open this URL to continue in your web browser: https://${host}/login/device' >&2
    while [ ! -f "${state}/approve" ]; do sleep 0.1; done; touch "${state}/approved" ;;
  "auth setup-git") mkdir -p "${catalog}"
    printf '%s' '{"schemaVersion":1,"name":"device-fixtures","displayName":"Device Fixtures","plugins":[]}' > "${catalog}/marketplace.json"
    printf '%s' '{"schemaVersion":1,"packs":[]}' > "${catalog}/packs.json" ;;
  *) exit 2 ;;
esac
`);
  chmodSync(gh, 0o755);
  const env = { ...envFor(home, `path:${catalog}`), ZCC_GH_BINARY: gh,
    ZCC_ONBOARDING_PROFILE: JSON.stringify({ ...profile(`path:${catalog}`), gitAuth: { host, method: 'gh-device' } }) };
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, { env, initialConfig: { onboarding: undefined, sponsorPromptDismissed: true, theme: 'light' } });
    const win = app.window;
    await skipHarness(win);
    await wizard(win).getByRole('button', { name: YES }).click();
    await expect(wizard(win)).toContainText('Corporate network (VPN)');
    await wizard(win).getByRole('button', { name: 'Check access and continue' }).click();
    await expect(wizard(win)).toContainText('Connected to the corporate network');
    await wizard(win).getByRole('button', { name: 'Sign in with browser', exact: true }).click();
    await expect(wizard(win).getByRole('group', { name: 'One-time sign-in code' })).toContainText('E2E1-CODE');
    await expect(wizard(win).getByRole('button', { name: `Open ${host}` })).toBeVisible();
    await testInfo.attach('employee-device-code', { body: await win.screenshot(), contentType: 'image/png' });
    writeFileSync(join(state, 'approve'), '');
    await expect(step(win, 'workplace')).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    expect(existsSync(join(state, 'approved'))).toBe(true);
    expect(await onboarding(win)).toMatchObject({ marketplaceSource: `path:${catalog}`, steps: { workplace: 'done' } });
  } finally { if (app) await closeApp(app.electron); listener.close(); }
});
