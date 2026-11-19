/**
 * Built-Electron: CLI Agents open as tabs in the shared application tab strip.
 *
 * A stub Claude CLI keeps a real PTY alive. Closing a tab, closing others and closing all must
 * never kill the process; only "Close agent" does. Tabs survive a reload (window-local restore).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, launchApp, closeApp, dismissConsentOverlays } from './fixtures/app.js';
import { writeNodeStub } from './fixtures/aida-p2.js';

const STUB = String.raw`
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.296 (Claude Code)'); process.exit(0); }
if (args.includes('--print')) { console.log('Probe'); process.exit(0); }
console.log('agent-tab stub ready');
setInterval(() => {}, 1000);
`;

interface Session { id: string; pid?: number; status?: string }

async function setup() {
  const stubDir = mkdtempSync(join(tmpdir(), 'zcc-agent-tabs-'));
  const claude = writeNodeStub(stubDir, 'claude-stub.cjs', STUB);
  const home = join(stubDir, 'home');
  mkdirSync(home, { recursive: true });
  const app = await launchApp(home, {
    e2e: true,
    initialConfig: { sponsorPromptDismissed: true, claudeBinary: claude, autoRenameTabs: false }
  });
  const win = app.window;
  await dismissConsentOverlays(win);
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-agent-tabs-project-')));
  mkdirSync(projectDir, { recursive: true });
  const projectId = await win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id as string;
  }, projectDir);
  const create = (title: string) =>
    win.evaluate(async ({ projectId, title }) => {
      const result = await window.cc.terminals.create({ projectId, profile: 'claude', cols: 100, rows: 32, title });
      const session = result && 'ok' in result ? result.value : result;
      if (!session?.id) throw new Error(JSON.stringify(result));
      return { id: session.id, pid: session.pid } as { id: string; pid?: number };
    }, { projectId, title });
  const list = (): Promise<Session[]> =>
    win.evaluate((pid) => window.cc.terminals.list(pid) as Promise<Session[]>, projectId);
  const cleanup = async () => {
    await closeApp(app.electron);
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  };
  return { app, win, create, list, cleanup, projectId };
}

const route = (page: Page, to: string) =>
  page.evaluate((to) => {
    history.pushState({}, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, to);

const alive = (pid: number | undefined) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test.setTimeout(120_000);

test('agents open as tabs, closing tabs keeps the process, Close agent ends it, reload restores', async () => {
  const s = await setup();
  try {
    const { win } = s;
    const a = await s.create('Agent Alpha');
    const b = await s.create('Agent Beta');
    const bar = win.getByTestId('application-tabs');
    await route(win, `/sessions/${a.id}`);
    await expect(bar.getByRole('tab', { name: /Agent Alpha/ })).toHaveAttribute('aria-selected', 'true');
    await route(win, `/sessions/${b.id}`);
    await expect(bar.locator('[data-tab-kind="agent"]')).toHaveCount(2);

    // Tab close is not process close.
    await bar.getByRole('button', { name: 'Close tab: Agent Alpha' }).click();
    await expect(bar.locator('[data-tab-kind="agent"]')).toHaveCount(1);
    expect(alive(a.pid)).toBe(true);
    expect((await s.list()).find((row) => row.id === a.id)?.status).not.toBe('exited');

    // Reopen restores the closed agent tab; a reload keeps open tabs.
    await win.reload();
    await dismissConsentOverlays(win);
    await expect(bar.getByRole('tab', { name: /Agent Beta/ })).toBeVisible();

    // Close all tabs leaves both processes running.
    await bar.getByRole('tab', { name: /Agent Beta/ }).click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Close all tabs', exact: true }).click();
    await expect(bar.locator('[data-tab-kind="agent"]')).toHaveCount(0);
    expect(alive(a.pid) && alive(b.pid)).toBe(true);

    // Close agent ends the process and removes the tab.
    await route(win, `/sessions/${b.id}`);
    await expect(bar.getByRole('tab', { name: /Agent Beta/ })).toBeVisible();
    win.once('dialog', (dialog) => void dialog.accept());
    await bar.getByRole('tab', { name: /Agent Beta/ }).click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Close agent', exact: true }).click();
    await expect(bar.locator('[data-tab-kind="agent"]')).toHaveCount(0);
    await expect.poll(() => alive(b.pid), { timeout: 15_000 }).toBe(false);
    expect(alive(a.pid)).toBe(true);
  } finally {
    await s.cleanup();
  }
});

test('an agent whose process ends keeps its tab as an exited session', async () => {
  const s = await setup();
  try {
    const { win } = s;
    const a = await s.create('Agent Ended');
    const bar = win.getByTestId('application-tabs');
    await route(win, `/sessions/${a.id}`);
    await expect(bar.locator('[data-tab-kind="agent"]')).toHaveCount(1);
    await win.evaluate((id) => window.cc.terminals.close(id), a.id);
    await expect.poll(() => alive(a.pid), { timeout: 15_000 }).toBe(false);
    // The session stays listed as exited, so its tab stays; only a vanished session prunes it.
    await expect(bar.locator('[data-tab-kind="agent"]')).toHaveCount(1);
    await expect(bar.getByRole('tab', { name: /Agent Ended/ })).toBeVisible();
  } finally {
    await s.cleanup();
  }
});
