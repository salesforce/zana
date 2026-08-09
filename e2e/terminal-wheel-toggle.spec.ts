/**
 * Verifies the "Mouse wheel scrolls full-screen programs" Settings toggle
 * (terminalWheelArrowsEnabled) end-to-end through the running app:
 *
 *  1. It defaults ON (checked) — pagers keep scrolling via the wheel out of the
 *     box; only users hitting the history-cycling annoyance opt out.
 *  2. Unchecking it round-trips through the real config IPC (store setter →
 *     window.cc.config.set → main normalizeConfig → disk) and comes back false.
 *
 * Drives the real renderer DOM + config IPC — same approach as
 * project-rail-spawn.spec.ts. NOTE: on macOS the app resolves ~/.zcc via
 * app.getPath('home') and ignores the sandbox HOME, so this writes the real
 * config.json; the fixture snapshots and restores it on teardown (see
 * fixtures/app.ts), so we assert but leave no trace.
 */
import { test, expect } from './fixtures/app';

test('settings: wheel-arrows toggle defaults on and round-trips through config', async ({
  app,
}) => {
  const { window } = app;

  // Baseline: config.get reflects the default (absent ⇒ renderer treats as on).
  const before = await window.evaluate(async () => {
    const cfg = await window.cc.config.get();
    return cfg.terminalWheelArrowsEnabled;
  });
  // Absent or true — either way the UI must render it checked (?? true).
  expect(before === undefined || before === true).toBe(true);

  // Open the Settings pane.
  const settingsNav = window.locator('button.nav-item').filter({ hasText: 'Settings' });
  await settingsNav.first().click();

  // The new control, found by its label text.
  const field = window
    .locator('.settings-check')
    .filter({ hasText: 'Mouse wheel scrolls full-screen programs' });
  await expect(field).toBeVisible({ timeout: 15_000 });

  const checkbox = field.locator('input[type="checkbox"]');
  // (1) Defaults ON.
  await expect(checkbox).toBeChecked();

  // (2) Uncheck → opt out. This drives onUpdate({ terminalWheelArrowsEnabled }).
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();

  // The flip must have persisted through the real config IPC round-trip.
  await expect
    .poll(
      async () =>
        window.evaluate(async () => {
          const cfg = await window.cc.config.get();
          return cfg.terminalWheelArrowsEnabled;
        }),
      { timeout: 10_000 }
    )
    .toBe(false);

  // Re-check to confirm the round-trip works both ways (and restore the default).
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect
    .poll(
      async () =>
        window.evaluate(async () => {
          const cfg = await window.cc.config.get();
          return cfg.terminalWheelArrowsEnabled;
        }),
      { timeout: 10_000 }
    )
    .toBe(true);
});
