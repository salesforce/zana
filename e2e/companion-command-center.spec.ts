/**
 * Command Center companion (opt-in, macOS): "Minimize to Command Center" hides
 * the full window and floats the slim rail; a rail icon opens ONE quick panel
 * beside it; Esc closes the panel; the logo brings Zana back.
 *
 * Drives the real windows: the rail and panel are separate frameless
 * `surface=companion` renderers, located by URL.
 */
import { test, expect } from './fixtures/app.js';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test.skip(process.platform !== 'darwin', 'Command Center is a macOS surface');
test.use({ initialConfig: { companionEnabled: true } });

function companionPage(electron: ElectronApplication, part: 'rail' | 'panel' | 'tooltip'): Page | undefined {
  return electron.windows().find((w) => w.url().includes('surface=companion') && w.url().includes(`part=${part}`));
}

async function waitForCompanion(electron: ElectronApplication, part: 'rail' | 'panel' | 'tooltip'): Promise<Page> {
  let page: Page | undefined;
  await expect
    .poll(() => (page = companionPage(electron, part)) ? 'open' : 'waiting', { timeout: 20_000 })
    .toBe('open');
  await page!.waitForSelector('#root', { timeout: 30_000 });
  return page!;
}

/** URLs of the windows currently on screen, from main. */
function visibleUrls(electron: ElectronApplication): Promise<string[]> {
  return electron.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && w.isVisible())
      .map((w) => w.webContents.getURL())
  );
}

test('companion: rail replaces the window, opens one panel, and hands back to Zana', async ({ app }) => {
  const { window, electron } = app;

  // E2E keeps app windows hidden (never steal focus); show the main one
  // inactive so we can see "Minimize to Command Center" put it away.
  await electron.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('surface='))?.showInactive();
  });
  expect(await window.evaluate(() => window.cc.companion.enter())).toBe(true);

  const rail = await waitForCompanion(electron, 'rail');
  await expect(rail.locator('.cc-rail')).toBeVisible();
  await expect(rail.locator('.cc-rail-btn')).toHaveCount(4);
  await expect(rail.locator('.cc-rail-logo')).toBeVisible();
  // The brand logo actually loads: a missing asset once rendered a broken image.
  const logo = rail.locator('.cc-rail-logo img');
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Native placement, renderer zoom and CSS must agree. An oversized native
  // height once left a large empty tail below the avatar.
  const geometry = await rail.evaluate(() => {
    const nav = document.querySelector('.cc-rail')!.getBoundingClientRect();
    const first = document.querySelector('.cc-rail-logo')!.getBoundingClientRect();
    const last = document.querySelector('.cc-rail-btn:last-child')!.getBoundingClientRect();
    return { height: nav.height, width: nav.width, topGap: first.top - nav.top, bottomGap: nav.bottom - last.bottom, viewport: { width: innerWidth, height: innerHeight } };
  });
  expect(geometry.width).toBeCloseTo(52, 1);
  expect(geometry.height).toBeGreaterThan(235);
  expect(geometry.height).toBeLessThanOrEqual(237);
  expect(geometry.bottomGap).toBeLessThanOrEqual(10);
  expect(geometry.bottomGap).toBeCloseTo(geometry.topGap, 1);
  const native = await electron.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('part=rail'))!;
    return { zoom: win.webContents.getZoomFactor(), width: win.getBounds().width, height: win.getBounds().height };
  });
  expect(native).toEqual({ zoom: 0.95, width: 72, height: 246 });
  expect(Math.abs(geometry.viewport.height * native.zoom - native.height)).toBeLessThanOrEqual(1);
  expect(await electron.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('companion-enter')?.accelerator ?? null)).toBeNull();
  if (process.env.ZCC_E2E_RAIL_SHOT) await rail.screenshot({ path: process.env.ZCC_E2E_RAIL_SHOT });

  // The full window is hidden; only the rail floats.
  await expect
    .poll(async () => (await visibleUrls(electron)).map((u) => (u.includes('surface=companion') ? 'rail' : 'app')))
    .toEqual(['rail']);

  // Hover shows the actual Agents card, inactive and with action space reserved.
  await rail.getByRole('button', { name: /^Agents:/ }).hover();
  const panel = await waitForCompanion(electron, 'panel');
  const card = panel.locator('.cc-card');
  await expect(card).toHaveAttribute('role', 'tooltip');
  await expect(panel.getByText('No agents running.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Open Agents', includeHidden: true })).toBeHidden();
  await expect.poll(() => card.evaluate(el => el.getAnimations().some(a => a.playState === 'running'))).toBe(false);
  const hoverBounds = await card.boundingBox();
  const nativePanel = await electron.browserWindow(panel);
  const hoverWindow = await nativePanel.evaluate(win => ({ bounds: win.getBounds(), focusable: win.isFocusable() }));
  expect(hoverWindow.focusable).toBe(false);

  // Click pins the same window/card; revealing actions must not move it.
  await rail.getByRole('button', { name: /^Agents:/ }).click();
  await expect(card).toHaveAttribute('role', 'dialog');
  await expect(panel.getByRole('button', { name: 'Open Agents' })).toBeVisible();
  expect(await card.boundingBox()).toEqual(hoverBounds);
  expect(await nativePanel.evaluate(win => win.getBounds())).toEqual(hoverWindow.bounds);
  expect(await nativePanel.evaluate(win => win.isFocusable())).toBe(true);
  await nativePanel.dispose();
  await expect
    .poll(async () => (await visibleUrls(electron)).filter((u) => u.includes('part=tooltip')).length)
    .toBe(0);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('aria-label', 'Agents');
  await expect(rail.getByRole('button', { name: /^Agents:/ })).toHaveAttribute('aria-pressed', 'true');

  // Switching icons swaps the panel's content in place.
  await rail.getByRole('button', { name: /^Needs you:/ }).click();
  await expect(card).toHaveAttribute('aria-label', 'Needs you');
  await expect(panel.getByText('All clear')).toBeVisible();

  // Esc closes it. Synthetic input (CDP or webContents.sendInputEvent) never
  // reaches a FOCUSED non-activating NSPanel under Playwright, so drive the
  // panel's own keydown handler with a DOM event instead.
  await panel.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await expect
    .poll(async () => (await visibleUrls(electron)).filter((u) => u.includes('part=panel')).length)
    .toBe(0);
  await expect(rail.getByRole('button', { name: /^Needs you:/ })).toHaveAttribute('aria-pressed', 'false');

  // "Open Zana" in Status must leave Command Center, including the rail.
  // Previously it only surfaced the app and left the floating widget active.
  await rail.getByRole('button', { name: /^Status:/ }).click();
  await expect(card).toHaveAttribute('aria-label', 'Status');
  await panel.getByRole('button', { name: 'Open Zana', exact: true }).dispatchEvent('click');
  await expect
    .poll(async () => (await visibleUrls(electron)).filter((u) => u.includes('surface=companion')).length)
    .toBe(0);
  await expect(card).toHaveCount(0);

  // Re-entering still works. The logo also puts the rail away. (Re-showing the main
  // window is a no-op under E2E by design, so only the rail side is asserted.)
  expect(await window.evaluate(() => window.cc.companion.enter())).toBe(true);
  await expect.poll(async () => (await visibleUrls(electron)).filter((u) => u.includes('part=rail')).length).toBe(1);
  await rail.locator('.cc-rail-logo').click();
  await expect
    .poll(async () => (await visibleUrls(electron)).filter((u) => u.includes('surface=companion')).length)
    .toBe(0);
});

test('companion: reopening Zana from the Dock, another launch or navigation dismisses the rail', async ({ app }) => {
  const { window, electron } = app;
  for (const path of ['dock', 'second-instance', 'scheduler'] as const) {
    await electron.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('surface='))!.showInactive();
    });
    expect(await window.evaluate(() => window.cc.companion.enter())).toBe(true);
    const rail = await waitForCompanion(electron, 'rail');
    await expect.poll(async () => (await visibleUrls(electron)).filter(u => u.includes('part=rail')).length).toBe(1);
    // Opening a companion panel itself must keep the rail available.
    await rail.getByRole('button', { name: /^Scheduler:/ }).click();
    const panel = await waitForCompanion(electron, 'panel');
    await expect(panel.locator('.cc-card')).toHaveAttribute('aria-label', 'Scheduler');
    if (path === 'scheduler') {
      await panel.getByRole('button', { name: 'Open Scheduler', exact: true }).dispatchEvent('click');
    } else {
      await electron.evaluate(({ app }, path) => {
        if (path === 'dock') app.emit('activate');
        else if (path === 'second-instance') app.emit('second-instance', {}, [], '', {});
      }, path);
    }
    await expect.poll(async () => (await visibleUrls(electron)).filter(u => u.includes('surface=companion')).length, { message: `${path} dismisses the companion` }).toBe(0);
    await expect(panel.locator('.cc-card')).toHaveCount(0);
  }
});

test('companion: entering is refused while the opt-in flag is off', async ({ app }) => {
  const { window, electron } = app;
  await window.evaluate(() => window.cc.config.set({ companionEnabled: false }));
  expect(await window.evaluate(() => window.cc.companion.enter())).toBe(false);
  expect(companionPage(electron, 'rail')).toBeUndefined();
});

test.describe('companion answers', () => {
  test.use({ initialConfig: { companionEnabled: true, askUserQuestionUiEnabled: true } });

  test('companion: a question answered from the panel reaches the agent terminal', async ({ app, home }) => {
    test.setTimeout(120_000);
    const { window, electron } = app;
    const path = join(home, 'companion-answer-project');
    mkdirSync(path);
    const projectId = await window.evaluate(async (p) => {
      const res = await window.cc.projects.add(p);
      if (!res.ok) throw new Error(res.message);
      return res.value.id;
    }, path);
    const created = await window.evaluate(
      ({ projectId, cwd }) => window.cc.terminals.create({ projectId, profile: 'shell', cols: 80, rows: 24, cwd }),
      { projectId, cwd: path }
    );
    if (!created.ok) throw new Error(created.message);
    const sessionId = created.value.id;
    try {
      // The shell waits for one line and records exactly what the pty delivered.
      const out = join(path, 'answer.txt');
      // The pty buffers input until the shell is ready.
      await window.evaluate(
        ({ id, file }) => window.cc.terminals.write(id, `read -r ANSWER && printf '%s' "$ANSWER" > '${file}'\r`),
        { id: sessionId, file: out }
      );

      expect(await window.evaluate(() => window.cc.companion.enter())).toBe(true);
      const rail = await waitForCompanion(electron, 'rail');

      // The same route Claude's AskUserQuestion hook posts to; main appends the
      // question to its inbox for this live session.
      const { port } = JSON.parse(readFileSync(join(home, 'electron-user-data', 'mcp-port-dev.json'), 'utf8')) as { port: number };
      const posted = await fetch(`http://127.0.0.1:${port}/hook/question/${projectId}/${sessionId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tool_input: { questions: [{ question: 'Which side?', options: [{ label: 'Left' }, { label: 'Right' }] }] }
        })
      });
      expect(posted.ok).toBe(true);

      await rail.getByRole('button', { name: /^Needs you:/ }).click();
      const panel = await waitForCompanion(electron, 'panel');
      // Synthetic pointer input never reaches the focused non-activating panel
      // under Playwright (see the Esc note above), so click via DOM events.
      await panel.locator('.cc-request').filter({ hasText: 'Which side?' }).dispatchEvent('click');
      await expect(panel.locator('.cc-question-prompt')).toHaveText('Which side?');
      await panel.getByRole('button', { name: /Right/ }).dispatchEvent('click');
      await expect(panel.getByRole('button', { name: /Right/ })).toHaveAttribute('aria-pressed', 'true');
      // Enter on each native button must activate that control, never submit
      // the currently selected answer through the window's shortcut listener.
      for (const name of ['Back to the list', 'Skip', 'Open in Zana', '1 Left']) {
        const control = panel.getByRole('button', { name, exact: true }).first();
        const preserved = await control.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', bubbles: true, cancelable: true
        })));
        expect(preserved).toBe(true);
      }
      expect(existsSync(out)).toBe(false);
      // A failed IPC command must be caught in the production renderer and
      // leave the question available for recovery.
      await electron.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('companion:open');
        ipcMain.handle('companion:open', () => { throw new Error('Injected navigation failure'); });
      });
      await panel.getByRole('button', { name: 'Open in Zana', exact: true }).first().dispatchEvent('click');
      await expect(panel.getByRole('alert')).toContainText('Could not open Zana');
      await expect(panel.locator('.cc-question-prompt')).toHaveText('Which side?');
      await panel.getByRole('button', { name: 'Send' }).dispatchEvent('click');
      await expect(panel.getByRole('status')).toContainText('is continuing');

      await expect.poll(() => (existsSync(out) ? readFileSync(out, 'utf8') : ''), { timeout: 15_000 }).toBe('Right');
    } finally {
      await window.evaluate((id) => window.cc.terminals.close(id), sessionId).catch(() => {});
    }
  });
});

test.describe('companion Modern threads', () => {
  test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { companionEnabled: true } });

  test('companion: a running Modern thread is counted, previewed on hover, and listed', async ({ app }) => {
    test.setTimeout(120_000);
    const { window, electron } = app;
    const project = await window.evaluate(async () => {
      const response = await fetch('/api/v1/projects');
      return (await response.json()).projects[0] as { id: string };
    });
    const thread = await window.evaluate(async (projectId) => {
      const response = await fetch('/api/v1/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, providerId: 'fake', title: 'Rail modern agent', input: 'delay:60000 rail' })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      return body.thread as { id: string };
    }, project.id);
    await expect.poll(() => window.evaluate(async (id) => {
      return (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status;
    }, thread.id)).toBe('active');

    expect(await window.evaluate(() => window.cc.companion.enter())).toBe(true);
    const rail = await waitForCompanion(electron, 'rail');
    const agents = rail.getByRole('button', { name: /^Agents:/ });
    await expect(agents).toHaveAttribute('aria-label', /^Agents: 1 working/, { timeout: 20_000 });

    // The same grouped card is used for hover and pin, including live rows.
    await agents.hover();
    const panel = await waitForCompanion(electron, 'panel');
    const card = panel.getByRole('tooltip', { name: 'Agents' });
    const row = panel.locator('.cc-row', { hasText: 'Rail modern agent' });
    await expect(row).toBeVisible();
    await expect(row).toBeDisabled();
    await expect(panel.locator('.cc-group-label')).toHaveText(['Working 1']);
    await expect.poll(() => card.evaluate(el => el.getAnimations().some(a => a.playState === 'running'))).toBe(false);
    const hoverBounds = await card.boundingBox();
    const rowBounds = await row.boundingBox();
    await panel.evaluate(() => { (window as Window & { originalCard?: Element | null }).originalCard = document.querySelector('.cc-card'); });

    await agents.click();
    const pinnedCard = panel.getByRole('dialog', { name: 'Agents' });
    await expect(pinnedCard).toBeVisible();
    await expect(row).toBeEnabled();
    expect(await pinnedCard.boundingBox()).toEqual(hoverBounds);
    expect(await row.boundingBox()).toEqual(rowBounds);
    expect(await panel.evaluate(() => (window as Window & { originalCard?: Element | null }).originalCard === document.querySelector('.cc-card'))).toBe(true);
    // The rail's delayed hover hide must not dismiss a panel that is now pinned.
    await rail.evaluate(() => window.cc.companion.tooltip(null));
    await expect.poll(async () => (await visibleUrls(electron)).filter(u => u.includes('part=panel')).length).toBe(1);
  });
});
