import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

// Settings search (salesforce/zana#272) in the built Electron app: ranked
// results, precise jump + flash, collapsed/tabbed containers, plugin settings,
// live values, typo tolerance, the Cmd+P Settings scope and secret hygiene.

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

const FIXTURES = fileURLToPath(new URL('./fixtures/settings-search-plugins', import.meta.url));
const VALUES = JSON.parse(readFileSync(join(FIXTURES, 'fixture-values.json'), 'utf8'));
const NORMAL_DIR = join(FIXTURES, 'normal');
const SECRET_DIR = join(FIXTURES, 'secret');
const NORMAL_ID = 'settings-search-normal';
const SECRET_ID = 'settings-search-secret';

async function openSettings(win: Page) {
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await win.getByTestId('settings-nav-global').click();
  return win.getByRole('combobox', { name: 'Search settings' });
}

/** A handled jump drops its `#target` (replace, no history entry) so route memory never replays it. */
async function hashCleared(win: Page) {
  await expect.poll(() => new URL(win.url()).hash, { timeout: 10_000 }).toBe('');
}

async function inView(win: Page, selector: string) {
  const el = win.locator(selector).first();
  await expect(el).toBeAttached({ timeout: 10_000 });
  await expect.poll(
    () => el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.height > 0;
    }),
    { timeout: 10_000 }
  ).toBe(true);
  return el;
}

function seedPlugins(home: string) {
  const dir = join(home, '.zcc/plugins');
  mkdirSync(dir, { recursive: true });
  const row = (id: string, name: string, rootDir: string) => ({
    id, version: '0.1.0', name, enabled: true, status: 'running', provenance: 'direct', sourceKind: 'path',
    source: `path:${rootDir}`, rootDir, serverEntry: './server.ts', appEntry: null, installedAt: Date.now(), updatedAt: Date.now()
  });
  writeFileSync(join(dir, 'installed.json'), JSON.stringify({
    version: 1,
    plugins: [row(NORMAL_ID, VALUES.normal.name, NORMAL_DIR), row(SECRET_ID, VALUES.secret.name, SECRET_DIR)]
  }));
}

test('help-text-only phrase finds the row, jumps to it, flashes it and shows a screenshot', async ({ app }, testInfo) => {
  const win = app.window;
  const search = await openSettings(win);
  await search.fill('does not make terminals faster');
  const hit = win.getByTestId('settings-result-terminal.tmux-persistence');
  await expect(hit).toBeVisible();
  await expect(hit.locator('mark').first()).toBeVisible();
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('01-help-text-results.png'));
  await hit.click();
  await expect(win).toHaveURL(/\/settings\/terminal/);
  const row = await inView(win, '[data-settings-target="terminal.tmux-persistence"]');
  await expect(row).toHaveClass(/settings-search-flash/);
  await hashCleared(win);
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('02-help-text-jump.png'));
});

test('cross-page jump lands in view (baseline probe regression)', async ({ app }, testInfo) => {
  const win = app.window;
  const search = await openSettings(win);
  await search.fill('heartbeat');
  await win.getByTestId('settings-result-agents.agent-heartbeat.intro').click();
  await expect(win).toHaveURL(/\/settings\/agents/);
  await inView(win, '#settings-anchor-agent-heartbeat');
  await hashCleared(win);
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('03-cross-page-heartbeat.png'));
});

test('opening the same result twice reveals it both times (no stale hash, no stuck reveal state)', async ({ app }) => {
  const win = app.window;
  const search = await openSettings(win);
  await search.fill('does not make terminals faster');
  const hit = win.getByTestId('settings-result-terminal.tmux-persistence');
  await hit.click();
  const row = await inView(win, '[data-settings-target="terminal.tmux-persistence"]');
  await expect(row).toHaveClass(/settings-search-flash/);
  await hashCleared(win);
  await expect(row).not.toHaveClass(/settings-search-flash/, { timeout: 5_000 });
  // Scroll it away, then open the very same result again from the rail.
  await row.evaluate((node) => {
    for (let el: HTMLElement | null = node.parentElement; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight) { el.scrollTop = el.scrollHeight; break; }
    }
  });
  await hit.click();
  await inView(win, '[data-settings-target="terminal.tmux-persistence"]');
  await expect(row).toHaveClass(/settings-search-flash/);
});

test('a term that lives only in a collapsed Advanced block expands it', async ({ app }, testInfo) => {
  const win = app.window;
  const search = await openSettings(win);
  await search.fill('shim');
  const hit = win.getByTestId('settings-result-editor.cursor-binary');
  await expect(hit).toBeVisible();
  await hit.click();
  await inView(win, '[data-settings-target="editor.cursor-binary"]');
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('04-advanced-expanded.png'));
});

test('a Harness page field selects the right tab', async ({ app }, testInfo) => {
  const win = app.window;
  const search = await openSettings(win);
  await search.fill('append system prompt');
  const hit = win.getByTestId('settings-result-harness.claude.append-system-prompt');
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(win).toHaveURL(/\/settings\/harness/);
  await expect(win.getByTestId('harness-legacy-pane')).toBeVisible();
  await inView(win, '[data-settings-target="harness.claude.append-system-prompt"]');
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('05-harness-tab.png'));
});

test('keyboard: arrows move the active row, Enter opens it, Escape clears', async ({ app }) => {
  const win = app.window;
  const search = await openSettings(win);
  await search.fill('terminal');
  const options = win.getByRole('option');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  const count = await options.count();
  expect(count).toBeGreaterThan(1);
  await search.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  const activeId = await options.nth(1).getAttribute('id');
  await expect(search).toHaveAttribute('aria-activedescendant', activeId!);
  await search.press('ArrowUp');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  const before = win.url();
  await search.press('Enter');
  await expect.poll(() => win.url()).not.toBe(before);
  await expect(win).toHaveURL(/\/settings\/[a-z-]+/);
  await search.fill('zzzz-nothing');
  await expect(win.getByRole('status').filter({ hasText: 'No matching settings' })).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(win.getByRole('listbox')).toHaveCount(0);
});

test('typos still find the setting and exact queries rank the exact hit first', async ({ app }, testInfo) => {
  const win = app.window;
  const search = await openSettings(win);
  await search.fill('tmxu');
  await expect(win.getByTestId('settings-result-terminal.tmux-persistence')).toBeVisible();
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('06-typo-tmxu.png'));
  await search.fill('tmux');
  await expect(win.getByRole('option').first()).toContainText('tmux');
});

test('current values are searchable, shown as Current, and follow edits', async ({ app }, testInfo) => {
  const win = app.window;
  const oldPath = '/opt/e2e-search-old/bin/claude-fixture';
  const newPath = '/opt/e2e-search-new/bin/claude-fixture';
  await win.evaluate((value) => window.cc.config.set({ claudeBinary: value }), oldPath);
  const search = await openSettings(win);
  await search.fill('e2e-search-old');
  const hit = win.getByRole('option').filter({ hasText: 'Current:' }).first();
  await expect(hit).toContainText(oldPath);
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('07-value-match.png'));
  await win.evaluate((value) => window.cc.config.set({ claudeBinary: value }), newPath);
  await search.fill('');
  await search.fill('e2e-search-old');
  await expect(win.getByRole('option')).toHaveCount(0);
  await search.fill('e2e-search-new');
  await expect(win.getByRole('option').filter({ hasText: 'Current:' }).first()).toContainText(newPath);
});

test('Cmd+P: Settings section for a help phrase, Enter lands on the flashed row, settings scope lists more', async ({ app }, testInfo) => {
  const win = app.window;
  await win.getByTestId('nav-inbox').click();
  await win.keyboard.press('ControlOrMeta+p');
  const palette = win.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  const input = palette.getByRole('combobox');
  await input.fill('does not make terminals faster');
  await expect(palette.getByRole('option').filter({ hasText: 'tmux' }).first()).toBeVisible({ timeout: 15_000 });
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('08-palette-settings-section.png'));
  await input.press('Enter');
  await expect(palette).toHaveCount(0);
  const row = await inView(win, '[data-settings-target="terminal.tmux-persistence"]');
  await expect(row).toHaveClass(/settings-search-flash/);

  await win.keyboard.press('ControlOrMeta+p');
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: 'Settings', exact: true }).click();
  await input.fill('terminal');
  expect(await palette.getByRole('option').count()).toBeGreaterThan(5);
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('09-palette-settings-scope.png'));
});

test('plugin-defined settings are searchable, land on #plugin-configure and never leak secret values', async ({ home }, testInfo) => {
  test.setTimeout(180_000);
  seedPlugins(home);
  const app = await launchApp(home, { env: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });
  try {
    const win = app.window;
    await expect.poll(() => win.evaluate(async (ids) => {
      const list = await window.cc.pluginApps.list();
      return ids.map((id) => list.find((p) => p.id === id)?.status);
    }, [NORMAL_ID, SECRET_ID]), { timeout: 60_000 }).toEqual(['running', 'running']);
    await win.evaluate(async ([secretId, phrase]) => {
      await window.cc.pluginApps.setSettings(secretId, { accessPhrase: phrase });
    }, [SECRET_ID, VALUES.secret.secretValue]);

    // Production boundary (preload -> IPC -> main): the search read is redacted
    // in main, so the secret never reaches the renderer. Positive control: the
    // Configure page's plain read still carries it.
    const reads = await win.evaluate(async (secretId) => ({
      search: JSON.stringify(await window.cc.pluginApps.getSettings(secretId, { omitSecrets: true })),
      configure: JSON.stringify(await window.cc.pluginApps.getSettings(secretId))
    }), SECRET_ID);
    expect(reads.search).not.toContain(VALUES.secret.secretValue);
    expect(reads.search).toContain('accessPhrase');
    expect(reads.configure).toContain(VALUES.secret.secretValue);

    const search = await openSettings(win);
    await search.fill('quokka');
    const hit = win.getByRole('option').filter({ hasText: VALUES.normal.stringLabel }).first();
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await captureElectronScreenshot(app.electron, win, testInfo.outputPath('10-plugin-result.png'));
    await hit.click();
    await expect(win).toHaveURL(new RegExp(`${NORMAL_ID}\\?view=installed.*#plugin-configure`));
    // The installed plugin page itself, not the Browse detail ("Plugin not found."):
    await expect(win.locator('#plugin-configure')).toBeVisible({ timeout: 15_000 });
    await expect(win.getByText('Plugin not found.')).toHaveCount(0);
    const field = win.locator('#plugin-configure .plugin-setting-row').filter({
      has: win.locator(`[aria-label="${VALUES.normal.stringLabel}"]`)
    });
    await expect(field).toHaveClass(/settings-search-flash/);
    await captureElectronScreenshot(app.electron, win, testInfo.outputPath('11-plugin-configure.png'));

    await win.goBack();
    await expect(search).toBeVisible();
    await search.fill(VALUES.secret.secretLabel);
    await expect(win.getByRole('option').filter({ hasText: VALUES.secret.secretLabel }).first()).toBeVisible({ timeout: 15_000 });
    await search.fill(VALUES.secret.secretValue);
    await expect(win.getByRole('status').filter({ hasText: 'No matching settings' })).toBeVisible();
    await expect(win.getByRole('option')).toHaveCount(0);
    await win.keyboard.press('ControlOrMeta+p');
    const palette = win.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('combobox').fill(VALUES.secret.secretValue);
    await expect(palette.getByRole('option').filter({ hasText: VALUES.secret.secretLabel })).toHaveCount(0);
    await captureElectronScreenshot(app.electron, win, testInfo.outputPath('12-secret-not-searchable.png'));
  } finally {
    await closeApp(app.electron);
  }
});
