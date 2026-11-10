/** First-run and upgrade onboarding through real Electron, catalog access, Git install and restart. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const wizard = (win: Page) => win.getByRole('dialog', { name: 'Set up Zana', exact: true });
async function expectFooterNavigation(win: Page, next: string, back: string) {
  const dialog = wizard(win);
  const footer = dialog.locator('.onboarding-footer');
  const forward = footer.getByRole('button', { name: next, exact: true });
  const previous = footer.getByRole('button', { name: back, exact: true });
  await expect(forward).toBeVisible();
  await expect(previous).toBeVisible();
  await expect(dialog.locator('.onboarding-body .primary')).toHaveCount(0);
  const before = await forward.boundingBox();
  await dialog.locator('.onboarding-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect((await forward.boundingBox())?.y).toBe(before?.y);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  const forwardBox = (await forward.boundingBox())!;
  const previousBox = (await previous.boundingBox())!;
  if (await win.evaluate(() => innerWidth) > 650) {
    expect(previousBox.x + previousBox.width).toBeLessThanOrEqual(forwardBox.x);
    expect(Math.abs(previousBox.y - forwardBox.y)).toBeLessThan(2);
  }
  await dialog.locator('.onboarding-body').evaluate(el => { el.scrollTop = 0; });
}
async function resume(win: Page, button = 'Resume setup') {
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await win.getByTestId('settings-nav-global').click();
  await win.getByRole('button', { name: button, exact: true }).click();
  await expect(wizard(win)).toBeVisible();
}

test('employee setup checks access, installs an inline bundle, and resumes the checklist after restart', async ({ home }, testInfo) => {
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
    await expect(wizard(win)).toContainText('Are you a Salesforce employee?');
    await expect(wizard(win).getByRole('button', { name: 'Skip for now', exact: true })).toHaveCount(1);
    await expect(wizard(win).getByRole('button', { name: 'Change setup choice', exact: true })).toHaveCount(0);
    await expect(wizard(win).getByRole('button', { name: 'Finish later', exact: true })).toHaveCount(0);
    await win.getByRole('button', { name: 'Yes, set up Salesforce tools' }).click();
    await expect(wizard(win)).toContainText('Salesforce VPN');
    await expectFooterNavigation(win, 'Check access and continue', 'Change setup choice');
    await win.getByRole('button', { name: 'Check access and continue' }).click();
    await expect(wizard(win).getByRole('alert')).toBeVisible();
    await expect(wizard(win)).toContainText('Connect the internal marketplace');
    await expectFooterNavigation(win, 'Retry access check', 'Change setup choice');
    mkdirSync(catalog, { recursive: true });
    writeFileSync(join(catalog, 'marketplace.json'), JSON.stringify({ schemaVersion: 1, name: 'employee-fixtures', displayName: 'Employee Fixtures',
      plugins: [{ id, displayName: 'Employee Fixture Tool', description: 'Onboarding install fixture',
        author: { name: 'E2E' }, source: { git: { url: git.urlFor(id) } } }] }));
    writeFileSync(join(catalog, 'packs.json'), JSON.stringify({ schemaVersion: 1, packs: [{ id: 'employee-starter',
      displayName: 'Employee Starter', description: 'Tools for employee onboarding', members: [{ pluginId: id, required: true }] }] }));
    await win.getByRole('button', { name: 'Retry access check' }).click();
    await expect(wizard(win)).toContainText('Choose your starting bundle');
    await expect(wizard(win).getByRole('button', { name: 'Install and continue', exact: true })).toBeVisible();
    await expectFooterNavigation(win, 'Install and continue', 'Back to access check');
    await expect(wizard(win).getByRole('button', { name: 'Change setup choice', exact: true })).toHaveCount(0);
    await expect(wizard(win).locator('.ext-pack-inline-footer')).toHaveCount(0);
    await expect(win.getByRole('button', { name: 'Review pack', exact: true })).toHaveCount(0);
    await expect(win.getByRole('dialog', { name: 'Review Employee Starter', exact: true })).toHaveCount(0);
    await expect(wizard(win)).toContainText('full trust');
    await expect(wizard(win)).toContainText('Employee Fixture Tool');
    await testInfo.attach('employee-inline-bundle', { body: await win.screenshot(), contentType: 'image/png' });
    await wizard(win).getByRole('button', { name: 'Install and continue', exact: true }).click();
    await expect(wizard(win)).toContainText('Finish connecting your tools');
    await expect(wizard(win)).toContainText('Employee Fixture Tool');
    await expect(wizard(win)).toContainText('Installing a plugin does not sign you in');
    const installed = JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8'));
    expect(installed.plugins).toEqual(expect.arrayContaining([expect.objectContaining({ id, version: '1.0.0' })]));
    await testInfo.attach('employee-connection-checklist', { body: await win.screenshot(), contentType: 'image/png' });
    await wizard(win).getByRole('button', { name: 'Open plugin settings', exact: true }).click();
    await expect(win.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
    await win.getByRole('link', { name: 'Back to app', exact: true }).click();
    await resume(win);
    await expect(wizard(win)).toContainText('Finish connecting your tools');
    await win.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await expect(wizard(win)).not.toBeVisible();
    await closeApp(app.electron);
    app = await launchApp(home, { env }); win = app.window;
    await expect(wizard(win)).not.toBeVisible();
    await resume(win);
    await expect(wizard(win)).toContainText('Employee Fixture Tool');
    await wizard(win).getByRole('button', { name: 'Change setup choice', exact: true }).click();
    await wizard(win).getByRole('button', { name: 'Yes, set up Salesforce tools' }).click();
    await wizard(win).getByRole('button', { name: 'Check access and continue' }).click();
    await expect(wizard(win).getByRole('button', { name: 'Continue setup', exact: true })).toBeVisible();
    await expect(wizard(win).getByRole('button', { name: 'Install and continue', exact: true })).toHaveCount(0);
    await expect(wizard(win)).toContainText('Already installed');
    await win.setViewportSize({ width: 760, height: 650 });
    await expectFooterNavigation(win, 'Continue setup', 'Back to access check');
    await win.setViewportSize({ width: 560, height: 650 });
    await expectFooterNavigation(win, 'Continue setup', 'Back to access check');
    expect(await wizard(win).evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await wizard(win).getByRole('button', { name: 'Continue setup', exact: true }).click();
    await expect(wizard(win)).toContainText('Finish connecting your tools');
    expect(JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8')).plugins).toEqual(installed.plugins);
    await win.setViewportSize({ width: 760, height: 650 });
    await expectFooterNavigation(win, 'Open Salesforce tools', 'Change setup choice');
    expect(await wizard(win).evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await wizard(win).getByRole('button', { name: 'Open Salesforce tools', exact: true }).click();
    await expect(wizard(win)).not.toBeVisible();
    await expect(win).toHaveURL(/\/extensions\/plugins$/);
    await expect(win.getByText('Employee Fixture Tool', { exact: true }).first()).toBeVisible();
    expect((await win.evaluate(() => window.cc.config.get())).onboarding).toMatchObject({ audience: 'organization', step: 'complete', pluginIds: [id] });
    await closeApp(app.electron);
    app = await launchApp(home, { env });
    await expect(wizard(app.window)).not.toBeVisible();
  } finally { if (app) await closeApp(app.electron); await git.close(); }
});

test('existing users see the question once, can skip, resume and choose general setup', async ({ home }, testInfo) => {
  test.setTimeout(120_000);
  const env = envFor(home, `path:${join(home, 'unused-catalog')}`);
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, { env, initialConfig: { onboarding: undefined, walkthroughCompleted: true,
      setupDismissed: true, sponsorPromptDismissed: true, lastSeenVersion: '0.1.0' } });
    let win = app.window;
    await expect(wizard(win)).toBeVisible();
    await win.setViewportSize({ width: 760, height: 650 });
    expect(await wizard(win).evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await testInfo.attach('onboarding-welcome', { body: await win.screenshot(), contentType: 'image/png' });
    await win.getByRole('button', { name: 'Skip for now' }).click();
    await expect(wizard(win)).not.toBeVisible();
    await closeApp(app.electron);
    app = await launchApp(home, { env }); win = app.window;
    await expect(wizard(win)).not.toBeVisible();
    // The queued update panel can appear after setup is dismissed.
    const whatsNew = win.getByRole('dialog', { name: /what.s new/i });
    if (await whatsNew.isVisible()) await win.keyboard.press('Escape');
    await resume(win);
    await win.getByRole('button', { name: 'No, continue with general setup' }).click();
    await expect(wizard(win)).toContainText('Find your tools');
    await win.getByRole('button', { name: 'Continue to Zana' }).click();
    expect((await win.evaluate(() => window.cc.config.get())).onboarding).toMatchObject({ audience: 'general', step: 'complete' });
    await closeApp(app.electron);
    app = await launchApp(home, { env });
    await expect(wizard(app.window)).not.toBeVisible();
  } finally { if (app) await closeApp(app.electron); }
});
