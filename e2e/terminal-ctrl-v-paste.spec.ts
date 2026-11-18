/**
 * Ctrl+V / Ctrl+Shift+V paste in a real terminal (Windows and Linux).
 *
 * TerminalView's key handler leaves the chord to Chromium's native paste
 * instead of letting xterm turn it into `^V`. This drives real key presses into
 * a live shell and reads the PTY backlog to prove:
 *   - Ctrl+V pastes the system clipboard exactly once (the Edit menu's
 *     `role: 'paste'` accelerator must not paste a second copy);
 *   - Ctrl+Shift+V pastes too;
 *   - a multi-line paste arrives inside bracketed-paste markers when the
 *     program turned that mode on;
 *   - with "Ctrl+V pastes" off, Ctrl+V types nothing from the clipboard.
 *
 * CI runs on Linux, where the setting defaults to off, so the spec turns it on
 * through the initial config. macOS keeps xterm's `^V` (⌘V pastes), so skip it.
 * On Windows the steps drive Git Bash (`ZCC_E2E_BASH`, see terminal-lines.ts),
 * and output is matched as whole plain lines because ConPTY repaints them.
 * The bracketed-paste step syncs on an OSC 52 clipboard write, so the spec
 * turns OSC 52 writes on explicitly (`terminalClipboardWriteEnabled`) rather
 * than relying on the default.
 */
import { test, expect } from './fixtures/app.js';
import type { Locator, Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { hasLine, plainLines, windowsBash, windowsBashConfig, windowsBashSkipReason } from './fixtures/terminal-lines.js';

test.use({ e2e: true, initialConfig: { tmuxScope: 'off', terminalCtrlVPasteEnabled: true, terminalClipboardWriteEnabled: true, ...windowsBashConfig } });
test.skip(process.platform === 'darwin', 'macOS pastes with ⌘V; Ctrl+V stays ^V there');
test.skip(process.platform === 'win32' && !windowsBash, windowsBashSkipReason);

interface Shell {
  sessionId: string;
  input: Locator;
  backlog: () => Promise<string>;
  run: (cmd: string) => Promise<void>;
  /** Waits until the shell prints `marker` as a whole line. */
  waitForLine: (marker: string, timeout?: number) => Promise<void>;
}

/** Electron's system clipboard, read and written from main. */
interface Clipboard {
  read: () => Promise<string>;
  write: (text: string) => Promise<void>;
}

/** Opens a shell through the project UI and focuses xterm's input. */
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
  const input = terminal.locator('.xterm-helper-textarea');
  await input.focus();
  await expect(input).toBeFocused();
  return { sessionId, input, backlog, run, waitForLine };
}

/**
 * Pastes `echo <tag>_$((40+n))_DONE` with `chord` and runs it. The output
 * (`<tag>_<40+n>_DONE`) differs from the command text, so it only appears once
 * the pasted line runs; a doubled paste would print `<tag>_<40+n>_DONEecho`.
 */
async function pasteAndRun(page: Page, shell: Shell, clipboard: Clipboard, chord: string, tag: string, n: number) {
  await clipboard.write(`echo ${tag}_$((40+${n}))_DONE`);
  await page.keyboard.press(chord);
  await page.keyboard.press('Enter');
  const out = `${tag}_${40 + n}_DONE`;
  await shell.waitForLine(out);
  expect(plainLines(await shell.backlog()).join('\n')).not.toContain(`${out}echo`);
}

/**
 * Multi-line paste with bracketed paste on: the program must receive the text
 * inside ESC[200~ … ESC[201~, so a shell inserts the lines instead of running
 * each one. The probe script turns the mode on, then writes PASTE_READY to
 * the clipboard with OSC 52. The renderer's xterm parses the two in order, so
 * once the clipboard holds PASTE_READY the paste can't race the mode switch
 * (bash itself turns the mode off while a command runs and back on at the
 * next prompt). A cursor-position query can't be the sync point: Windows
 * ConPTY answers it itself, before the renderer has seen ?2004h. The reads
 * time out so a lost paste fails as BRACKETED_BAD instead of hanging.
 * xterm sends CR line endings; the raw PTY may hand the script LF, so accept
 * either.
 */
async function checkBracketedPaste(page: Page, shell: Shell, projectDir: string, clipboard: Clipboard) {
  const probe = join(projectDir, 'paste-probe.sh');
  writeFileSync(probe, [
    'stty raw -echo',
    `printf '\\033[?2004h\\033]52;c;%s\\a' '${Buffer.from('PASTE_READY').toString('base64')}'`,
    "IFS= read -r -t 15 -d '~' start",
    "IFS= read -r -t 5 -d '~' body",
    'stty sane',
    "printf '\\033[?2004l\\r\\n'",
    "if [ \"$start\" = $'\\033[200' ] && { [ \"$body\" = $'MULTI_A\\rMULTI_B\\033[201' ] || [ \"$body\" = $'MULTI_A\\nMULTI_B\\033[201' ]; }; then echo BRACKETED_OK; else printf 'BRACKETED_BAD %q %q\\n' \"$start\" \"$body\"; fi",
    ''
  ].join('\n'));
  await clipboard.write('before-probe');
  await shell.run(`bash '${probe}'`);
  await expect.poll(clipboard.read, { timeout: 20_000 }).toBe('PASTE_READY');
  await clipboard.write('MULTI_A\nMULTI_B');
  await shell.input.focus();
  await page.keyboard.press('Control+V');
  await expect.poll(async () => plainLines(await shell.backlog()).join('\n'), { timeout: 25_000 }).toMatch(/BRACKETED_(OK|BAD)/);
  const lines = plainLines(await shell.backlog());
  expect(lines, lines.join('\n')).toContain('BRACKETED_OK');
}

/**
 * Setting off: the store picks the change up live, and Ctrl+V goes back to
 * xterm's ^V, so the clipboard text is never typed. Main sends
 * config.onChanged before it answers config.set, so the store has the new
 * value by the time that resolves. ^V makes readline insert the next key
 * literally (the `x`); Ctrl+C then clears the line.
 *
 * The probe's output (`AFTER_OFF_45`) differs from the typed text, so only a
 * probe that ran counts. Git Bash on Windows drops the line typed while
 * readline handles SIGINT, so there the probe is resent until it runs.
 * Elsewhere it is sent once: a dropped line is a real failure.
 */
async function checkCtrlVOff(page: Page, shell: Shell, clipboard: Clipboard) {
  await page.evaluate(() => window.cc.config.set({ terminalCtrlVPasteEnabled: false }));
  await clipboard.write('echo OFF_$((40+4))_DONE');
  await shell.input.focus();
  await page.keyboard.press('Control+V');
  await page.keyboard.press('x');
  await page.keyboard.press('Control+C');
  if (process.platform === 'win32') {
    await expect.poll(async () => {
      if (hasLine(await shell.backlog(), 'AFTER_OFF_45')) return true;
      await shell.run('echo AFTER_OFF_$((40+5))');
      return false;
    }, { timeout: 15_000, intervals: [1_000] }).toBe(true);
  } else {
    await shell.run('echo AFTER_OFF_$((40+5))');
    await shell.waitForLine('AFTER_OFF_45');
  }
  const text = plainLines(await shell.backlog()).join('\n');
  expect(text).not.toContain('OFF_$((40+4))');
  expect(text).not.toContain('OFF_44_DONE');
}

test('terminal: Ctrl+V and Ctrl+Shift+V paste the clipboard once, and the setting turns Ctrl+V off', async ({ app }) => {
  const { window: page } = app;
  const clipboard: Clipboard = {
    read: () => app.electron.evaluate(({ clipboard: cb }) => cb.readText()),
    write: (text: string) => app.electron.evaluate(({ clipboard: cb }, value) => cb.writeText(value), text)
  };
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-ctrl-v-paste-'));
  const projectId = await page.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, projectDir);
  let sessionId: string | undefined;
  try {
    const shell = await openShell(page, projectId, projectDir, (id) => { sessionId = id; });
    await pasteAndRun(page, shell, clipboard, 'Control+V', 'CTRLV', 2);
    await pasteAndRun(page, shell, clipboard, 'Control+Shift+V', 'SHIFTV', 3);
    await checkBracketedPaste(page, shell, projectDir, clipboard);
    await checkCtrlVOff(page, shell, clipboard);
  } finally {
    if (sessionId) await page.evaluate((id) => window.cc.terminals.close(id), sessionId).catch(() => {});
    await page.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => {});
    // The shell can hold its cwd here for a moment after close (EPERM on Windows).
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
