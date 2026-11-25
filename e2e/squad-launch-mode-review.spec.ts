/**
 * Review walkthrough for the manual test plan (Group A). Drives the built app through each UX item and saves a
 * screenshot per item to REVIEW_SHOTS_DIR (default: the test output dir), plus a JSON log of what was captured
 * or failed. It asserts nothing about look and feel; a person reads the screenshots.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test } from './fixtures/app.js';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true, teamJobLaunchEnabled: true } });
test.setTimeout(300_000);

test('UX review walkthrough', async ({ app }, testInfo) => {
  const win: Page = app.window;
  const dir = process.env.REVIEW_SHOTS_DIR ?? testInfo.outputPath('review');
  mkdirSync(dir, { recursive: true });
  const log: Array<{ id: string; status: 'captured' | 'failed'; note: string }> = [];
  const step = async (id: string, note: string, fn: () => Promise<void>) => {
    try { await fn(); await win.screenshot({ path: join(dir, `${id}.png`) }); log.push({ id, status: 'captured', note }); }
    catch (error) { log.push({ id, status: 'failed', note: `${note}: ${String(error).split('\n')[0]}` }); await win.screenshot({ path: join(dir, `${id}-FAILED.png`) }).catch(() => undefined); }
  };

  await win.evaluate(async () => {
    for (const team of [
      { id: 'lm-default', name: 'LM Default Squad' },
      { id: 'lm-pinned', name: 'LM Pinned Squad', transport: 'CLI' as const },
      { id: 'lm-caller', name: 'LM Caller Squad', transport: 'CALLER' as const }
    ]) {
      await window.cc.teams.save({ ...team, description: 'Review fixture', orchestratorPersonaId: 'builtin:orchestrator', slots: [{ personaId: 'builtin:orchestrator' }] } as never);
    }
    await window.cc.config.set({ squadDefaultTransport: 'caller' } as never);
  });
  const openSquads = async () => {
    if (!(await win.getByTestId('settings-nav-squads').isVisible().catch(() => false))) await win.getByRole('link', { name: 'Settings', exact: true }).click();
    await win.getByTestId('settings-nav-squads').click();
    await win.getByTestId('squads-defaults').waitFor({ timeout: 15_000 });
  };
  await openSquads();

  await step('UX-01-placement', 'Defaults group below the Squad list, above Advanced', async () => {
    await win.getByTestId('squads-defaults').scrollIntoViewIfNeeded();
  });
  await step('UX-02-options', 'All Squads launch mode picklist open', async () => {
    await win.getByLabel('All Squads launch mode').click();
  });
  await win.keyboard.press('Escape');
  await step('UX-03-help-and-strip', 'Precedence strip details opened', async () => {
    await win.getByTestId('squads-defaults').locator('summary').click();
    await win.getByTestId('squads-defaults').evaluate((el) => { el.scrollIntoView({ block: 'end' }); el.closest('[class*="scroll"], main')?.scrollTo?.({ top: 1e6 }); });
    await win.waitForTimeout(300);
  });
  await step('UX-06-editor-default', 'Squad editor with Use default', async () => {
    await win.getByRole('button', { name: 'Open LM Default Squad' }).click();
    await win.getByRole('dialog', { name: 'LM Default Squad' }).locator('summary', { hasText: /launch mode/i }).click().catch(() => undefined);
  });
  await win.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => undefined);
  await step('UX-06b-editor-follow-caller', 'Squad editor with Follow caller pinned', async () => {
    await win.getByRole('button', { name: 'Open LM Caller Squad' }).click();
  });
  await win.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => undefined);
  await step('UX-07-pinned-chip', 'Pinned Squad row chip (CLI) next to inherited ones', async () => {
    await win.getByRole('button', { name: 'Open LM Pinned Squad' }).scrollIntoViewIfNeeded();
  });
  await step('UX-08-built-ins', 'Built-in Squads with inherited chips', async () => {
    await win.getByRole('button', { name: /^Open / }).first().scrollIntoViewIfNeeded();
  });
  await step('UX-08b-cli-default', 'Global set to CLI Agent: inherited Squads show CLI AGENT with the tag', async () => {
    await win.evaluate(() => window.cc.config.set({ squadDefaultTransport: 'CLI' } as never));
    await win.waitForTimeout(800);
    await win.getByRole('button', { name: 'Open LM Default Squad' }).scrollIntoViewIfNeeded();
  });
  await win.evaluate(() => window.cc.config.set({ squadDefaultTransport: 'caller' } as never));
  await step('UX-11-search', 'Settings search "squad launch"', async () => {
    const search = win.getByRole('combobox', { name: 'Search settings' });
    await search.fill('squad launch');
    await win.waitForTimeout(800);
  });
  await win.getByRole('combobox', { name: 'Search settings' }).fill('').catch(() => undefined);
  await step('UX-12-persist', 'Set to Modern, app reloaded, setting still Modern', async () => {
    await win.getByLabel('All Squads launch mode').click();
    await win.getByRole('option', { name: /^Modern/ }).click();
    await win.waitForTimeout(500);
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    if (!(await win.getByTestId('squads-defaults').isVisible().catch(() => false))) {
      await win.getByRole('link', { name: 'Settings', exact: true }).click({ timeout: 5_000 }).catch(() => undefined);
      await win.getByTestId('settings-nav-squads').click({ timeout: 5_000 }).catch(() => undefined);
    }
    await win.getByTestId('squads-defaults').scrollIntoViewIfNeeded();
  });
  await step('UX-13-light', 'Light theme', async () => {
    await win.evaluate(() => window.cc.config.set({ theme: 'light' } as never));
    await win.waitForTimeout(600);
  });
  await step('UX-13-dark', 'Dark theme', async () => {
    await win.evaluate(() => window.cc.config.set({ theme: 'dark' } as never));
    await win.waitForTimeout(600);
  });
  await step('UX-14-narrow', 'Window at 900px', async () => {
    await win.setViewportSize({ width: 900, height: 700 });
    await win.waitForTimeout(400);
  });
  await win.setViewportSize({ width: 1400, height: 900 }).catch(() => undefined);

  await step('UX-05-team-default', 'Default launch mode = Squad shows last transport hint', async () => {
    await win.evaluate(() => window.cc.config.set({ composerLastTransportMode: 'thread' } as never));
    if (!(await win.getByTestId('settings-nav-composer').isVisible().catch(() => false))) await win.getByRole('link', { name: 'Settings', exact: true }).click();
    await win.getByTestId('settings-nav-composer').click();
    await win.getByRole('button', { name: 'Default launch mode' }).click();
    await win.getByRole('option', { name: 'Squad' }).click();
    await win.getByTestId('launch-mode-team-hint').waitFor({ timeout: 10_000 });
  });
  await openSquads();

  const openComposer = async (name: string) => {
    await win.getByRole('button', { name: `Launch ${name}`, exact: true }).click();
    const projects = await win.evaluate(async () => (await window.cc.projects.list()).length);
    if (projects > 1) await win.getByRole('menuitem').first().click();
    await win.getByRole('dialog', { name: 'New squad' }).waitFor({ timeout: 15_000 });
  };
  await step('UX-18-picker', 'New Agent Squad composer: launch mode picker open', async () => {
    await openComposer('LM Default Squad');
    await win.locator('[data-testid="team-launch-mode-chip"]').getByRole('button', { name: 'Squad launch mode' }).click();
  });
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  await step('UX-19-picker-pinned', 'Composer for a pinned Squad: picker disabled', async () => {
    await openComposer('LM Pinned Squad');
  });

  await win.keyboard.press('Escape');
  await step('UX-10-fallback-notice', 'Inherited Modern falls back to CLI when the Squad uses on-demand seats', async () => {
    await win.evaluate(async () => {
      await window.cc.teams.save({ id: 'lm-seats', name: 'LM Seats Squad', description: 'Review fixture', orchestratorPersonaId: 'builtin:orchestrator', slots: [{ personaId: 'builtin:orchestrator' }, { personaId: 'builtin:orchestrator', startOnDemand: true }] } as never);
      await window.cc.config.set({ squadDefaultTransport: 'MODERN' } as never);
    });
    await openComposer('LM Seats Squad');
    await win.getByTestId('team-launch-mode-note').waitFor({ timeout: 10_000 });
  });

  writeFileSync(join(dir, 'log.json'), JSON.stringify(log, null, 2));
});
