/**
 * Copy on select in a real terminal.
 *
 * TerminalView copies a finished mouse selection to the system clipboard
 * (Settings → Terminal → Clipboard, "Copy selected text automatically", on by
 * default). This drives real mouse gestures over a live shell's xterm and reads
 * Electron's clipboard to prove:
 *   - a drag, a double-click (word) and a triple-click (line) each copy, with no
 *     extra keys;
 *   - a click that clears the selection leaves the clipboard alone;
 *   - Ctrl+C with text selected still interrupts the running program (SIGINT);
 *   - with the setting off, a selection is not copied.
 *
 * Each step clears the screen and prints its marker on the first row, so the
 * gestures only need the top-left corner and the width of the terminal.
 */
import { test, expect } from './fixtures/app.js';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/**
 * The steps drive bash. On Windows they use Git Bash: `ZCC_E2E_BASH`, else
 * the default Git for Windows install path.
 */
const WINDOWS_BASH = process.env.ZCC_E2E_BASH ?? 'C:/Program Files/Git/bin/bash.exe';
const windowsBash = process.platform === 'win32' && existsSync(WINDOWS_BASH);

test.use({ e2e: true, initialConfig: { tmuxScope: 'off', ...(windowsBash ? { shell: WINDOWS_BASH } : {}) } });

/** Distance from the screen's edge to a point inside the first or last cell. */
const EDGE_INSET = 4;
/** Clipboard text a step sets first, so "unchanged" is a real check. */
const SENTINEL = 'clipboard-before-step';

/**
 * The backlog as plain lines: ANSI/OSC sequences and carriage returns removed.
 * Windows ConPTY repaints lines with cursor and erase codes and pads them with
 * spaces, so matching a raw `MARKER\r\n` is not reliable there.
 */
function plainLines(raw: string): string[] {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd());
}

/** True once a whole output line equals `marker`. */
const hasLine = (raw: string, marker: string) => plainLines(raw).includes(marker);

interface Shell {
  screen: Locator;
  backlog: () => Promise<string>;
  /** Waits until the shell prints `marker` as a whole line. */
  waitForLine: (marker: string, timeout?: number) => Promise<void>;
  run: (cmd: string) => Promise<void>;
  /** Clears the screen, prints `text` on row 0, and waits for it. */
  showOnFirstRow: (text: string, done: string) => Promise<void>;
}

async function openShell(page: Page, projectId: string, projectDir: string, onSession: (id: string) => void): Promise<Shell> {
  const heading = page.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await page.getByRole('button', { name: `Open ${basename(projectDir)}`, exact: true }).click();
  await page.getByTestId('project-nav-terminals').click();
  await page.locator('.empty-project').getByRole('button', { name: 'New terminal', exact: true }).click();
  const terminal = page.locator('.term .xterm').first();
  await expect(terminal).toBeVisible();
  const sessionId = await page.evaluate(async (pid) => {
    const shell = (await window.cc.terminals.list(pid)).find((s) => s.profile === 'shell' && s.status !== 'exited');
    if (!shell) throw new Error('Missing shell created through the project UI');
    return shell.id;
  }, projectId);
  onSession(sessionId);
  const backlog = () => page.evaluate((id) => window.cc.terminals.backlog(id), sessionId);
  const run = (cmd: string) => page.evaluate(([id, text]) => window.cc.terminals.write(id, `${text}\r`), [sessionId, cmd] as const);
  const waitForLine = async (marker: string, timeout = 15_000) => {
    await expect.poll(async () => hasLine(await backlog(), marker), { timeout }).toBe(true);
  };
  await run('echo SHELL_READY');
  await waitForLine('SHELL_READY', 20_000);
  const showOnFirstRow = async (text: string, done: string) => {
    // The marker is built by arithmetic, so the typed command never matches it.
    await run(`printf '\\033[2J\\033[H%s\\n' '${text}'; echo ${done}_$((40+2))`);
    await waitForLine(`${done}_42`);
  };
  return { screen: terminal.locator('.xterm-screen'), backlog, waitForLine, run, showOnFirstRow };
}

async function firstRow(shell: Shell) {
  const box = await shell.screen.boundingBox();
  if (!box) throw new Error('Terminal screen has no box');
  // `.xterm-screen` can be wider than the visible pane (and the window), so
  // keep the far end of a drag inside what is actually on screen.
  const visibleRight = await shell.screen.evaluate((el) => {
    const pane = el.closest('.term')?.getBoundingClientRect();
    return Math.min(el.getBoundingClientRect().right, pane?.right ?? Infinity, window.innerWidth);
  });
  const y = box.y + EDGE_INSET;
  const row = { y, left: box.x + EDGE_INSET, right: visibleRight - EDGE_INSET };
  // The gestures must land on the terminal, not on an overlay above it.
  const hits = await shell.screen.page().evaluate(({ left, right, y: top }) => [left, right].map((x) => {
    const el = document.elementFromPoint(x, top);
    return el?.closest('.xterm') ? 'xterm' : `${el?.tagName ?? 'none'}.${el?.className ?? ''}`;
  }), row);
  expect(hits, 'element under the first-row gesture points').toEqual(['xterm', 'xterm']);
  return row;
}

function clipboard(app: ElectronApplication) {
  return {
    read: () => app.evaluate(({ clipboard: cb }) => cb.readText()),
    write: (text: string) => app.evaluate(({ clipboard: cb }, value) => cb.writeText(value), text)
  };
}

/** Drag across row 0, double-click its first word, then triple-click the row. */
async function checkGesturesCopy(page: Page, shell: Shell, cb: ReturnType<typeof clipboard>) {
  await shell.showOnFirstRow('DRAG_WORD second third', 'GESTURES');
  // Let xterm finish layout and paint (fit, font load) before the first gesture.
  await page.evaluate(() => document.fonts.ready.then(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))));
  const row = await firstRow(shell);

  await cb.write(SENTINEL);
  await page.mouse.move(row.left, row.y);
  await page.mouse.down();
  await page.mouse.move(row.right, row.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(cb.read).toBe('DRAG_WORD second third');

  await cb.write(SENTINEL);
  await page.mouse.dblclick(row.left, row.y);
  await expect.poll(cb.read).toBe('DRAG_WORD');

  await cb.write(SENTINEL);
  await page.mouse.click(row.left, row.y, { clickCount: 3 });
  await expect.poll(cb.read).toBe('DRAG_WORD second third');
}

/** A plain click clears the selection; the clipboard must keep its text. */
async function checkClickKeepsClipboard(page: Page, shell: Shell, cb: ReturnType<typeof clipboard>) {
  const row = await firstRow(shell);
  await page.mouse.dblclick(row.left, row.y);
  await expect.poll(cb.read).toBe('DRAG_WORD');
  await cb.write(SENTINEL);
  await page.mouse.click(row.right, row.y);
  // Give a wrong copy time to land before asserting nothing changed.
  await page.waitForTimeout(500);
  expect(await cb.read()).toBe(SENTINEL);
}

/**
 * Ctrl+C with text selected: bash aborts the whole `sleep; echo` list on
 * SIGINT, so NOT_INTERRUPTED never prints and the next command runs at once.
 */
async function checkCtrlCInterrupts(page: Page, shell: Shell) {
  await shell.showOnFirstRow('SELECT_DURING_SLEEP', 'SLEEPMARK');
  await shell.run('sleep 30; echo NOT_INTERRUPTED');
  const row = await firstRow(shell);
  await page.mouse.dblclick(row.left, row.y);
  await page.keyboard.press('Control+C');
  // Readline can drop input typed while it handles SIGINT (seen on Git Bash),
  // so resend the probe until it runs. A still-running `sleep 30` would hold
  // every probe back past the timeout.
  await expect.poll(async () => {
    if (hasLine(await shell.backlog(), 'AFTER_INT_43')) return true;
    await shell.run('echo AFTER_INT_$((40+3))');
    return false;
  }, { timeout: 10_000, intervals: [1_000] }).toBe(true);
  expect(plainLines(await shell.backlog())).not.toContain('NOT_INTERRUPTED');
}

/** Setting off: read live by the open terminal, so a selection is not copied. */
async function checkSettingOff(page: Page, shell: Shell, cb: ReturnType<typeof clipboard>) {
  await page.evaluate(() => window.cc.config.set({ terminalCopyOnSelectEnabled: false }));
  await shell.showOnFirstRow('OFF_WORD', 'OFFMARK');
  await cb.write(SENTINEL);
  const row = await firstRow(shell);
  await page.mouse.dblclick(row.left, row.y);
  await page.waitForTimeout(500);
  expect(await cb.read()).toBe(SENTINEL);
}

test('terminal: a finished mouse selection copies to the clipboard, Ctrl+C still interrupts, and the setting turns it off', async ({ app }) => {
  test.skip(process.platform === 'win32' && !windowsBash, `the spec drives bash; set ZCC_E2E_BASH to Git Bash (not found at ${WINDOWS_BASH})`);
  const { window: page } = app;
  const cb = clipboard(app.electron);
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-copy-on-select-'));
  const projectId = await page.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, projectDir);
  let sessionId: string | undefined;
  // Renderer warnings and errors (a failed copy logs here), kept for a failure report.
  const consoleLines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleLines.push(`${msg.type()}: ${msg.text()}`);
  });
  try {
    const shell = await openShell(page, projectId, projectDir, (id) => { sessionId = id; });
    try {
      await checkGesturesCopy(page, shell, cb);
      await checkClickKeepsClipboard(page, shell, cb);
      await checkCtrlCInterrupts(page, shell);
      await checkSettingOff(page, shell, cb);
    } catch (err) {
      // The automatic failure screenshot is taken after cleanup, so capture
      // the live terminal, its output and the renderer log first.
      await test.info().attach('terminal-at-failure.png', { body: await page.screenshot(), contentType: 'image/png' }).catch(() => {});
      await test.info().attach('terminal-output.txt', { body: plainLines(await shell.backlog()).join('\n'), contentType: 'text/plain' }).catch(() => {});
      await test.info().attach('renderer-console.txt', { body: consoleLines.join('\n') || '(none)', contentType: 'text/plain' }).catch(() => {});
      throw err;
    }
  } finally {
    if (sessionId) await page.evaluate((id) => window.cc.terminals.close(id), sessionId).catch(() => {});
    await page.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => {});
    rmSync(projectDir, { recursive: true, force: true });
  }
});
