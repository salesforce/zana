/**
 * Manual test plan group A (UX-1..UX-10) for "Resume after API errors" (#649),
 * driven through the built app's real Settings UI, one test per UX item so each
 * can be run alone: `pnpm test:e2e -- e2e/api-error-resume-ux.spec.ts -g "UX-4"`.
 * Each test attaches a screenshot as evidence.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

const STUB = `#!${process.execPath}\nif (process.argv.includes('--version')) console.log('2.1.296 (Claude Code)');\n`;
const SUGGEST_VENDOR = '+ Provider anthropic not found (LiteLLM proxy in front of Claude Code)';
const SUGGEST_GENERIC = '+ Connection lost mid-response';
const SECTION = '#settings-anchor-api-error-resume';

async function launch(home: string) {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-resume-ux-'));
  const claude = join(dir, 'claude-stub.cjs');
  writeFileSync(claude, STUB, { mode: 0o700 });
  const app = await launchApp(home, { initialConfig: { sponsorPromptDismissed: true, claudeBinary: claude } });
  const cleanup = async () => { await closeApp(app.electron); rmSync(dir, { recursive: true, force: true }); };
  return { app, win: app.window, cleanup };
}
type Ctx = Awaited<ReturnType<typeof launch>>;

/** Settings → Agents → scroll to "Resume after API errors". */
async function openSection(win: Page) {
  const link = win.getByRole('link', { name: 'Settings', exact: true });
  if (await link.count()) await link.click(); // already inside Settings on a second visit
  await win.getByTestId('settings-nav-agents').click();
  await win.locator(SECTION).scrollIntoViewIfNeeded();
  await expect(win.getByText('Resume after API errors', { exact: true }).first()).toBeVisible();
}
const toggle = (win: Page) => win.getByRole('switch', { name: 'Resume after matching API errors' });
const shot = async (c: Ctx, name: string, info: import('@playwright/test').TestInfo) => {
  await c.win.locator(SECTION).scrollIntoViewIfNeeded();
  await captureElectronScreenshot(c.app.electron, c.win, info.outputPath(`${name}.png`));
  await info.attach(name, { path: info.outputPath(`${name}.png`), contentType: 'image/png' });
};
const withApp = (name: string, body: (c: Ctx, info: import('@playwright/test').TestInfo) => Promise<void>) =>
  test(name, async ({ home }, info) => {
    test.setTimeout(90_000);
    const c = await launch(home);
    try { await openSection(c.win); await body(c, info); } finally { await c.cleanup(); }
  });

withApp('UX-1 coverage line lists covered and not-yet-available agents', async (c, info) => {
  const line = c.win.getByText(/^On this machine, works with: /);
  await expect(line).toBeVisible({ timeout: 15_000 });
  await expect(line).toContainText('Claude Code');
  const text = (await line.textContent()) ?? '';
  const [covered = '', notYet = ''] = text.split('Not available yet:');
  // OpenCode and Pi are covered; Cursor has no readable failure signal and stays on the not-yet side.
  for (const supported of ['OpenCode', 'Pi']) expect(notYet, `${supported} is covered`).not.toContain(supported);
  if (text.includes('Cursor')) expect(notYet, 'Cursor stays not available').toContain('Cursor');
  expect(covered).not.toContain('Cursor');
  await shot(c, 'ux-1-coverage-line', info);
});

withApp('UX-2 help text does not say Claude only', async (c, info) => {
  const help = c.win.locator(`${SECTION} .settings-section-help`);
  await expect(help).toContainText('Zana sends it a message so it carries on. Off by default.');
  for (const word of ['Claude Code', 'CLI', 'Modern', 'Squad']) await expect(help).not.toContainText(word);
  await expect(help).not.toContainText('Claude Code');
  await shot(c, 'ux-2-help-text', info);
});

withApp('UX-3 checkbox toggles and reveals the controls', async (c, info) => {
  await expect(toggle(c.win)).not.toBeChecked();
  await expect(c.win.getByRole('button', { name: 'Add rule' })).toHaveCount(0);
  await toggle(c.win).click();
  await expect(toggle(c.win)).toBeChecked();
  await expect(c.win.getByRole('button', { name: 'Add rule' })).toBeVisible();
  await expect(c.win.getByLabel('Messages before stopping')).toBeVisible();
  // With no rule yet, only what makes sense without one is shown; Check needs a rule to test against.
  await expect(c.win.getByText(/Only add errors that clear up by themselves/)).toBeVisible();
  await expect(c.win.getByLabel('Error text to check')).toHaveCount(0);
  await expect(c.win.getByText(/typed into the agent as if you sent it/)).toHaveCount(0);
  await shot(c, 'ux-3-enabled', info);
  await c.win.getByRole('button', { name: 'Add rule' }).click();
  await expect(c.win.getByLabel('When the error matches (rule 1)')).toBeFocused();
  await expect(c.win.getByLabel('Error text to check')).toBeVisible();
  await expect(c.win.getByText(/typed into the agent as if you sent it/)).toBeVisible();
  await c.win.getByRole('button', { name: 'Remove rule 1' }).click();
  await toggle(c.win).click();
  await expect(c.win.getByRole('button', { name: 'Add rule' })).toHaveCount(0);
});

withApp('UX-4 only the vendor suggestion carries a hint', async (c, info) => {
  await toggle(c.win).click();
  await expect(c.win.getByRole('button', { name: SUGGEST_VENDOR })).toBeVisible();
  const generic = c.win.getByRole('button', { name: SUGGEST_GENERIC, exact: true });
  await expect(generic).toBeVisible();
  await expect(generic.locator('.api-error-resume-hint')).toHaveCount(0);
  await shot(c, 'ux-4-suggestions', info);
});

withApp('UX-5 clicking a suggestion adds a filled rule', async (c, info) => {
  await toggle(c.win).click();
  await c.win.getByRole('button', { name: SUGGEST_GENERIC, exact: true }).click();
  await expect(c.win.getByLabel('When the error matches (rule 1)')).toHaveValue('Connection lost mid-response');
  await expect(c.win.getByLabel('Send this message (rule 1)')).toHaveValue('continue');
  await expect(c.win.getByLabel('After (seconds) (rule 1)')).toHaveValue('30');
  await expect(c.win.getByRole('button', { name: SUGGEST_GENERIC, exact: true })).toHaveCount(0);
  await expect(c.win.locator(`${SECTION} .api-error-resume-error`)).toHaveCount(0);
  await shot(c, 'ux-5-rule-added', info);
});

withApp('UX-6 the rule persists after leaving and reopening Settings', async (c, info) => {
  await toggle(c.win).click();
  await c.win.getByRole('button', { name: SUGGEST_GENERIC, exact: true }).click();
  await expect.poll(async () => (await c.win.evaluate(() => window.cc.config.get())).apiErrorResume?.rules?.[0]?.match)
    .toBe('Connection lost mid-response');
  await c.win.getByTestId('settings-nav-terminal').click(); // leave the Agents tab, then come back
  await expect(c.win.locator(SECTION)).toHaveCount(0);
  await openSection(c.win);
  await expect(toggle(c.win)).toBeChecked();
  await expect(c.win.getByLabel('When the error matches (rule 1)')).toHaveValue('Connection lost mid-response');
  await expect(c.win.getByLabel('After (seconds) (rule 1)')).toHaveValue('30');
  await shot(c, 'ux-6-persisted', info);
});

withApp('UX-7 Check an error reports the matching rule, or none', async (c, info) => {
  await toggle(c.win).click();
  await c.win.getByRole('button', { name: SUGGEST_GENERIC, exact: true }).click();
  await c.win.getByLabel('Error text to check').fill('Connection lost mid-response while streaming');
  await c.win.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(c.win.getByText('Matches rule 1: Zana would send “continue” after 30 s.')).toBeVisible({ timeout: 15_000 });
  await shot(c, 'ux-7-match', info);
  await c.win.getByLabel('Error text to check').fill('unrelated text');
  await c.win.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(c.win.getByText('No rule matches. Zana would leave the agent waiting for you.')).toBeVisible({ timeout: 15_000 });
  await shot(c, 'ux-7-no-match', info);
});

withApp('UX-8 light and dark themes keep the line and hint readable', async (c, info) => {
  await toggle(c.win).click();
  for (const theme of ['dark', 'light'] as const) {
    await c.win.evaluate((t) => window.cc.config.set({ theme: t }), theme);
    await expect(c.win.locator('html')).toHaveAttribute('data-theme', theme);
    const bg = await c.win.evaluate(() => getComputedStyle(document.body).backgroundColor);
    for (const sel of [`${SECTION} .settings-help`, `${SECTION} .api-error-resume-hint`]) {
      const color = await c.win.locator(sel).first().evaluate((el) => getComputedStyle(el).color);
      expect(color, `${sel} in ${theme}`).not.toBe(bg);
    }
    await shot(c, `ux-8-${theme}`, info);
  }
});

withApp('UX-9 narrow window wraps without clipping', async (c, info) => {
  await toggle(c.win).click();
  await c.app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700));
  await c.win.waitForTimeout(500);
  const overflow = await c.win.locator(SECTION).evaluate((el) => {
    const box = el.getBoundingClientRect();
    return [...el.querySelectorAll('button, input, textarea, p')].filter((n) => n.getBoundingClientRect().right > box.right + 1).length;
  });
  expect(overflow, 'elements poking out of the section').toBe(0);
  await shot(c, 'ux-9-narrow', info);
});

withApp('UX-10 Tab order follows reading order', async (c, info) => {
  await toggle(c.win).click();
  await c.win.getByRole('button', { name: SUGGEST_GENERIC, exact: true }).click();
  await toggle(c.win).focus();
  const seen: string[] = [];
  for (let i = 0; i < 30; i++) {
    await c.win.keyboard.press('Tab');
    seen.push(await c.win.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute('aria-label') || el?.textContent?.trim() || el?.tagName || '';
    }));
  }
  const at = (label: string) => seen.findIndex((s) => s === label);
  const order = ['When the error matches (rule 1)', 'Send this message (rule 1)', 'After (seconds) (rule 1)', 'Add rule', 'Messages before stopping', 'Error text to check'].map(at);
  expect(order.every((n) => n >= 0), `all reachable: ${JSON.stringify(seen)}`).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  await shot(c, 'ux-10-keyboard', info);
});
