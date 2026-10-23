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
 */
import { test, expect } from './fixtures/app.js';
import type { Locator, Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true, initialConfig: { tmuxScope: 'off', terminalCtrlVPasteEnabled: true } });
test.skip(process.platform === 'darwin', 'macOS pastes with ⌘V; Ctrl+V stays ^V there');

interface Shell {
  sessionId: string;
  input: Locator;
  backlog: () => Promise<string>;
  run: (cmd: string) => Promise<void>;
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
  await run('echo SHELL_READY');
  await expect.poll(backlog, { timeout: 20_000 }).toContain('SHELL_READY\r\n');
  const input = terminal.locator('.xterm-helper-textarea');
  await input.focus();
  await expect(input).toBeFocused();
  return { sessionId, input, backlog, run };
}

/**
 * Pastes `echo <tag>_$((40+n))_DONE` with `chord` and runs it. The output
 * (`<tag>_<40+n>_DONE`) differs from the command text, so it only appears once
 * the pasted line runs; a doubled paste would print `<tag>_<40+n>_DONEecho`.
 */
async function pasteAndRun(page: Page, shell: Shell, setClipboard: (text: string) => Promise<void>, chord: string, tag: string, n: number) {
  await setClipboard(`echo ${tag}_$((40+${n}))_DONE`);
  await page.keyboard.press(chord);
  await page.keyboard.press('Enter');
  const out = `${tag}_${40 + n}_DONE`;
  await expect.poll(shell.backlog).toContain(`${out}\r\n`);
  expect(await shell.backlog()).not.toContain(`${out}echo`);
}

/**
 * Multi-line paste with bracketed paste on: the program must receive the text
 * inside ESC[200~ … ESC[201~, so a shell inserts the lines instead of running
 * each one. The probe script turns the mode on and then asks for the cursor
 * position. Only the renderer's xterm answers that, after parsing ?2004h, so
 * once PASTE_READY appears the paste can't race the mode switch (bash itself
 * turns the mode off while a command runs and back on at the next prompt).
 * xterm sends CR line endings; the raw PTY may hand the script LF, so accept
 * either.
 */
async function checkBracketedPaste(page: Page, shell: Shell, projectDir: string, setClipboard: (text: string) => Promise<void>) {
  const probe = join(projectDir, 'paste-probe.sh');
  writeFileSync(probe, [
    'stty raw -echo',
    "printf '\\033[?2004h\\033[6n'",
    'IFS= read -r -d R _pos',
    "printf 'PASTE_READY'",
    "IFS= read -r -d '~' start",
    "IFS= read -r -d '~' body",
    'stty sane',
    "printf '\\033[?2004l\\r\\n'",
    "if [ \"$start\" = $'\\033[200' ] && { [ \"$body\" = $'MULTI_A\\rMULTI_B\\033[201' ] || [ \"$body\" = $'MULTI_A\\nMULTI_B\\033[201' ]; }; then echo BRACKETED_OK; else printf 'BRACKETED_BAD %q %q\\n' \"$start\" \"$body\"; fi",
    ''
  ].join('\n'));
  await setClipboard('MULTI_A\nMULTI_B');
  await shell.run(`bash '${probe}'`);
  await expect.poll(shell.backlog, { timeout: 20_000 }).toContain('PASTE_READY');
  await shell.input.focus();
  await page.keyboard.press('Control+V');
  await expect.poll(shell.backlog).toMatch(/BRACKETED_(OK|BAD)/);
  expect(await shell.backlog()).toContain('BRACKETED_OK\r\n');
}

/**
 * Setting off: the store picks the change up live, and Ctrl+V goes back to
 * xterm's ^V, so the clipboard text is never typed. Main sends
 * config.onChanged before it answers config.set, so the store has the new
 * value by the time that resolves. ^V makes readline insert the next key
 * literally (the `x`); Ctrl+C then clears the line.
 */
async function checkCtrlVOff(page: Page, shell: Shell, setClipboard: (text: string) => Promise<void>) {
  await page.evaluate(() => window.cc.config.set({ terminalCtrlVPasteEnabled: false }));
  await setClipboard('echo OFF_$((40+4))_DONE');
  await shell.input.focus();
  await page.keyboard.press('Control+V');
  await page.keyboard.press('x');
  await page.keyboard.press('Control+C');
  await shell.run('echo AFTER_OFF_$((40+5))');
  await expect.poll(shell.backlog).toContain('AFTER_OFF_45\r\n');
  const text = await shell.backlog();
  expect(text).not.toContain('OFF_$((40+4))');
  expect(text).not.toContain('OFF_44_DONE');
}

test('terminal: Ctrl+V and Ctrl+Shift+V paste the clipboard once, and the setting turns Ctrl+V off', async ({ app }) => {
  const { window: page } = app;
  const setClipboard = (text: string) => app.electron.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-ctrl-v-paste-'));
  const projectId = await page.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, projectDir);
  let sessionId: string | undefined;
  try {
    const shell = await openShell(page, projectId, projectDir, (id) => { sessionId = id; });
    await pasteAndRun(page, shell, setClipboard, 'Control+V', 'CTRLV', 2);
    await pasteAndRun(page, shell, setClipboard, 'Control+Shift+V', 'SHIFTV', 3);
    await checkBracketedPaste(page, shell, projectDir, setClipboard);
    await checkCtrlVOff(page, shell, setClipboard);
  } finally {
    if (sessionId) await page.evaluate((id) => window.cc.terminals.close(id), sessionId).catch(() => {});
    await page.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => {});
    rmSync(projectDir, { recursive: true, force: true });
  }
});
