/**
 * Ctrl+V / Ctrl+Shift+V paste in a real terminal (Windows and Linux).
 *
 * TerminalView's key handler leaves the chord to Chromium's native paste
 * instead of letting xterm turn it into `^V`. This drives real key presses into
 * a live shell and reads the PTY backlog to prove:
 *   - Ctrl+V pastes the system clipboard exactly once (the Edit menu's
 *     `role: 'paste'` accelerator must not paste a second copy);
 *   - Ctrl+Shift+V pastes too;
 *   - a multi-line paste waits for Enter when the shell uses bracketed paste;
 *   - with "Ctrl+V pastes" off, Ctrl+V types nothing from the clipboard.
 *
 * CI runs on Linux, where the setting defaults to off, so the spec turns it on
 * through the initial config. macOS keeps xterm's `^V` (⌘V pastes), so skip it.
 */
import { test, expect } from './fixtures/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true, initialConfig: { tmuxScope: 'off', terminalCtrlVPasteEnabled: true } });
test.skip(process.platform === 'darwin', 'macOS pastes with ⌘V; Ctrl+V stays ^V there');

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
    const heading = page.getByTestId('sidebar-projects-heading');
    if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
    await page.getByRole('button', { name: `Open ${basename(projectDir)}`, exact: true }).click();
    await page.getByTestId('project-nav-terminals').click();
    await page.locator('.empty-project').getByRole('button', { name: 'New terminal', exact: true }).click();
    const terminal = page.locator('.term .xterm').first();
    await expect(terminal).toBeVisible();
    sessionId = await page.evaluate(async (pid) => {
      const shell = (await window.cc.terminals.list(pid)).find((s) => s.profile === 'shell' && s.status !== 'exited');
      if (!shell) throw new Error('Missing shell created through the project UI');
      return shell.id;
    }, projectId);
    const backlog = () => page.evaluate((id) => window.cc.terminals.backlog(id), sessionId!);
    await page.evaluate((id) => window.cc.terminals.write(id, 'echo SHELL_READY\r'), sessionId);
    await expect.poll(backlog, { timeout: 20_000 }).toContain('SHELL_READY\r\n');
    const input = terminal.locator('.xterm-helper-textarea');
    await input.focus();
    await expect(input).toBeFocused();

    // The command's output (`CTRLV_42_DONE`) differs from its text, so it only
    // appears once the pasted line runs. A doubled paste would run
    // `echo CTRLV_$((40+2))_DONEecho …` and print `CTRLV_42_DONEecho`.
    await setClipboard('echo CTRLV_$((40+2))_DONE');
    await page.keyboard.press('Control+V');
    await page.keyboard.press('Enter');
    await expect.poll(backlog).toContain('CTRLV_42_DONE\r\n');
    expect(await backlog()).not.toContain('CTRLV_42_DONEecho');

    await setClipboard('echo SHIFTV_$((40+3))_DONE');
    await page.keyboard.press('Control+Shift+V');
    await page.keyboard.press('Enter');
    await expect.poll(backlog).toContain('SHIFTV_43_DONE\r\n');
    expect(await backlog()).not.toContain('SHIFTV_43_DONEecho');

    // Multi-line paste: with bracketed paste on (bash/readline sets ?2004h), the
    // lines are inserted but none runs until Enter.
    if ((await backlog()).includes('\x1b[?2004h')) {
      await setClipboard('echo MULTI_$((1+1))_A\necho MULTI_$((2+2))_B');
      await page.keyboard.press('Control+V');
      // Prove the paste arrived before checking nothing ran: an output-only
      // marker would be ambiguous, so wait on the echoed (still unrun) text.
      await expect.poll(backlog).toContain('MULTI_$((2+2))_B');
      expect(await backlog()).not.toContain('MULTI_2_A\r\n');
      await page.keyboard.press('Enter');
      await expect.poll(backlog).toContain('MULTI_4_B\r\n');
      expect(await backlog()).toContain('MULTI_2_A\r\n');
    }

    // Setting off: the store picks the change up live, and Ctrl+V goes back to
    // xterm's ^V, so the clipboard text is never typed. Main sends
    // config.onChanged before it answers config.set, so the store has the new
    // value by the time this resolves.
    await page.evaluate(() => window.cc.config.set({ terminalCtrlVPasteEnabled: false }));
    await setClipboard('echo OFF_$((40+4))_DONE');
    await input.focus();
    await page.keyboard.press('Control+V');
    // ^V makes readline insert the next key literally (the `x`); Ctrl+C then
    // clears the line.
    await page.keyboard.press('x');
    await page.keyboard.press('Control+C');
    await page.evaluate((id) => window.cc.terminals.write(id, 'echo AFTER_OFF_$((40+5))\r'), sessionId);
    await expect.poll(backlog).toContain('AFTER_OFF_45\r\n');
    const text = await backlog();
    expect(text).not.toContain('OFF_$((40+4))');
    expect(text).not.toContain('OFF_44_DONE');
  } finally {
    if (sessionId) await page.evaluate((id) => window.cc.terminals.close(id), sessionId).catch(() => {});
    await page.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => {});
    rmSync(projectDir, { recursive: true, force: true });
  }
});
