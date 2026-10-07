import { test, expect, isAppRendererUrl } from './fixtures/app.js';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

async function beginDrag(page: Page, source: Locator, target: Locator, x = 0.9, y = 0.5) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width * x, to!.y + to!.height * y, { steps: 12 });
}

const nav = (page: Page, title: string) => page.getByTestId(`nav-${title.toLowerCase()}`);

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

test('project splits: drag views and agents in focused and dedicated project windows', async ({ app }) => {
  const { window: page, home, electron } = app;
  const projectName = 'Split Project';
  const path = join(home, projectName);
  mkdirSync(path);
  const bin = join(path, 'agent.cjs');
  writeFileSync(bin, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('2.1.220 (Claude Code)'); process.exit(0); }
process.stdin.resume();
setInterval(() => {}, 1000);
`);
  chmodSync(bin, 0o755);
  const { projectId, sessionId } = await page.evaluate(async ({ path, bin }) => {
    await window.cc.config.set({ claudeBinary: bin });
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const session = await window.cc.terminals.create({
      projectId: project.value.id, profile: 'claude', title: 'Split Agent', cols: 80, rows: 24
    });
    if (!session.ok) throw new Error(session.message);
    return { projectId: project.value.id, sessionId: session.value.id };
  }, { path, bin });
  const heading = page.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click();

  async function checkProjectSplits(target: Page) {
    const rail = target.locator('.project-scoped-nav');
    const workspace = target.getByTestId('split-workspace');
    await expect(rail).toBeVisible();
    await rail.getByTestId('project-nav-agents').click();
    await beginDrag(target, rail.getByTestId('project-nav-scheduler'), workspace, 0.03, 0.03);
    await expect(target.locator('.split-drag-overlay-label')).toHaveText('Split left');
    await target.keyboard.press('Escape');
    await target.mouse.up();
    await expect(workspace).toHaveAttribute('data-split', 'false');
    await beginDrag(target, rail.getByTestId('project-nav-terminals'), workspace);
    await expect(target.locator('.split-drag-overlay-label')).toHaveText('Split right');
    await target.mouse.up();
    await expect(workspace).toHaveAttribute('data-split', 'true');
    await expect(workspace.locator('.split-pane')).toHaveCount(2);
    await expect(workspace.getByTestId('project-mode-pane')).toHaveCount(2);
    const agents = workspace.locator('.split-pane').filter({ has: target.locator('[data-mode="agents"]') });
    // The project tree sits below the mode links. Reaching this pane edge
    // travels farther vertically than horizontally, and must still split.
    await beginDrag(target, rail.locator('[data-kind="agent"]').filter({ hasText: 'Split Agent' }), agents, 0.1, 0.1);
    await expect(target.locator('.split-drag-overlay-label')).toHaveText('Split left');
    await target.mouse.up();
    await expect(workspace.locator('.split-pane')).toHaveCount(3);
    await expect(target).toHaveURL(new RegExp(`/projects/${projectId}/sessions/${sessionId}`));
    await expect(rail).toBeVisible();
    await rail.getByTestId('project-nav-explorer').click({ modifiers: ['ControlOrMeta'] });
    await expect(workspace.locator('.split-pane')).toHaveCount(4);
    await expect(target).toHaveURL(new RegExp(`/projects/${projectId}/explorer`));
    await expect(rail).toBeVisible();
  }

  await checkProjectSplits(page);
  await page.evaluate((id) => window.cc.windows.openProject(id), projectId);
  let scoped: Page | undefined;
  await expect.poll(() => {
    scoped = electron.windows().find((candidate) => candidate !== page && isAppRendererUrl(candidate.url()));
    return Boolean(scoped);
  }).toBe(true);
  await checkProjectSplits(scoped!);
});

test('shell splits: drag, cancel, resize, move, maximize and reload', async ({ app }, testInfo) => {
  const { window: page } = app;
  await nav(page, 'Home').click();
  const workspace = page.getByTestId('split-workspace');
  await expect(workspace).toHaveAttribute('data-split', 'false');

  await beginDrag(page, nav(page, 'Inbox'), workspace);
  await expect(page.locator('.split-drag-overlay-label')).toHaveText('Split right');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.split-drag-overlay')).toHaveCount(0);
  await expect(workspace).toHaveAttribute('data-split', 'false');

  // A fresh click after cancellation must work; no sticky per-row suppression.
  await nav(page, 'Inbox').click();
  await expect(page).toHaveURL(/inbox/);
  await nav(page, 'Home').click();
  await page.locator('[contenteditable="true"]').first().fill('Draft survives split changes');
  await beginDrag(page, nav(page, 'Inbox'), workspace);
  await expect(page.locator('.split-drag-overlay-label')).toHaveText('Split right');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('split-drop-preview.png'));
  await page.mouse.up();
  await expect(workspace).toHaveAttribute('data-split', 'true');
  await expect(workspace.locator('.split-pane')).toHaveCount(2);
  await expect(workspace.locator('.split-pane-bar-title')).toHaveText(['Home', 'Inbox']);
  await expect(page.locator('[contenteditable="true"]').first()).toHaveText('Draft survives split changes');
  const divider = workspace.getByRole('separator', { name: 'Resize panes left and right' });
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '52');
  await page.keyboard.press('Enter');
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  const beforeResize = await workspace.locator('.split-pane').first().boundingBox();
  const handle = await divider.boundingBox();
  await page.mouse.move(handle!.x, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 100, handle!.y + handle!.height / 2, { steps: 10 });
  await expect(divider).toHaveAttribute('data-dragging', 'true');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await workspace.locator('.split-pane').first().boundingBox())!.width).toBeCloseTo(beforeResize!.width, 0);
  await page.mouse.move(handle!.x, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 100, handle!.y + handle!.height / 2, { steps: 10 });
  // Changing pane focus rerenders the shell while the pointer is captured.
  // That must not abort the divider interaction or use an obsolete callback.
  await page.keyboard.press('Control+1');
  await expect(workspace.locator('[data-focused="true"] .split-pane-bar-title')).toHaveText('Home');
  await expect(divider).toHaveAttribute('data-dragging', 'true');
  await page.mouse.up();
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
  await divider.dblclick();
  await expect(divider).toHaveAttribute('aria-valuenow', '50');

  // Keyboard focus tracks the containing pane as reliably as a pointer click.
  const inbox = workspace.locator('.split-pane').filter({ has: page.locator('.split-pane-bar-title', { hasText: 'Inbox' }) });
  await inbox.getByRole('button', { name: 'Move pane', exact: true }).click();
  await page.getByRole('option', { name: 'Move pane below', exact: true }).click();
  await expect(workspace.locator('.split-tree').first()).toHaveClass(/split-tree--col/);
  const maximize = inbox.getByRole('button', { name: 'Maximize pane', exact: true });
  await maximize.click();
  await expect(inbox).toHaveAttribute('data-maximized', 'true');
  const full = await workspace.boundingBox();
  const maximized = await inbox.boundingBox();
  expect(maximized!.x).toBeCloseTo(full!.x, 0);
  expect(maximized!.y).toBeCloseTo(full!.y, 0);
  expect(maximized!.width).toBeCloseTo(full!.width, 0);
  expect(maximized!.height).toBeCloseTo(full!.height, 0);
  await expect(nav(page, 'Home')).toBeVisible();
  await inbox.getByRole('button', { name: 'Restore pane' }).click();

  // Center-drag swaps views; an edge-drag moves the view into a new split.
  const homeTitle = workspace.locator('.split-pane-bar-title', { hasText: 'Home' });
  await beginDrag(page, homeTitle, inbox, 0.5, 0.5);
  await expect(page.locator('.split-drag-overlay-label')).toHaveText('Swap views');
  await page.mouse.up();
  await expect(workspace.locator('.split-pane-bar-title')).toHaveText(['Inbox', 'Home']);
  await beginDrag(page, workspace.locator('.split-pane-bar-title', { hasText: 'Home' }), inbox, 0.9, 0.5);
  await expect(page.locator('.split-drag-overlay-label')).toHaveText('Move right');
  await page.mouse.up();
  await expect(workspace.locator('.split-tree').first()).toHaveClass(/split-tree--row/);
  await expect(page.locator('[contenteditable="true"]').first()).toHaveText('Draft survives split changes');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('split-workspace.png'));
  await page.setViewportSize({ width: 680, height: 900 });
  await expect(workspace).toHaveAttribute('data-split', 'false');
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
  await expect(page.locator('[contenteditable="true"]').first()).toHaveText('Draft survives split changes');
  await page.setViewportSize({ width: 1480, height: 960 });
  await expect(workspace).toHaveAttribute('data-split', 'true');
  await page.reload();
  await expect(workspace.locator('.split-pane-bar-title')).toHaveText(['Inbox', 'Home']);
  await workspace.getByRole('button', { name: 'Close pane', exact: true }).last().click();
  await expect(workspace).toHaveAttribute('data-split', 'false');
  await expect(workspace.locator('.split-pane')).toHaveCount(1);
});
