import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { sponsorPromptDismissed: true },
  isolateBundledCatalog: true
});

const titles = ['Keyboard report one', 'Keyboard report two', 'Keyboard report three'];

test.beforeEach(async ({ home }) => {
  const projectPath = join(home, 'keyboard-project');
  mkdirSync(projectPath);
  mkdirSync(join(home, '.zcc', 'inbox'), { recursive: true });
  mkdirSync(join(home, '.zcc', 'saved'), { recursive: true });
  writeFileSync(join(home, '.zcc', 'projects.json'), JSON.stringify({ version: 1, projects: [{
    id: 'keyboard-project', name: 'Keyboard project', path: projectPath, createdAt: Date.now(), lastActiveAt: Date.now()
  }] }));
  writeFileSync(join(home, '.zcc', 'inbox', 'entries.jsonl'), titles.map((subject, i) => JSON.stringify({
    id: `keyboard-${i}`, projectId: 'keyboard-project', subject, comments: `Keep message ${i}`, ts: Date.now() - i, report: true
  })).join('\n') + '\n');
  titles.forEach((title, i) => writeFileSync(join(home, '.zcc', 'saved', `keyboard-${i}.json`), JSON.stringify({
    id: `keyboard-${i}`, projectId: 'keyboard-project', title, comments: `Keep saved message ${i}`, savedAt: Date.now() - i,
    docs: [{ path: 'report.md', content: `Frozen document ${i}` }]
  })));
});

for (const tab of ['Feed', 'Saved'] as const) {
  test(`${tab} survives Quick agent editing and only deletes after scoped confirmation`, async ({ app }) => {
    const page = app.window;
    await dismissConsentOverlays(page);
    const confirmations: string[] = [];
    let acceptDelete = false;
    page.on('dialog', async (dialog) => {
      confirmations.push(dialog.message());
      if (acceptDelete) await dialog.accept();
      else await dialog.dismiss();
    });

    const inboxFile = join(app.home, '.zcc', 'inbox', 'entries.jsonl');
    const savedFile = join(app.home, '.zcc', 'saved', 'keyboard-0.json');
    const inboxBefore = readFileSync(inboxFile, 'utf8');
    const savedBefore = readFileSync(savedFile, 'utf8');

    await page.getByTestId('nav-inbox').click();
    await page.getByRole('button', { name: 'Split view', exact: true }).click();
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    const rows = page.locator('.inbox-view .inbox-row');
    const first = rows.filter({ hasText: titles[0] });
    await first.click();
    await first.press('Backspace');
    expect(confirmations).toEqual([]);
    await expect(rows).toHaveCount(3);

    // Use the real global launcher without navigating away from the selected Inbox/Saved record.
    await page.getByRole('button', { name: 'Open Keyboard project', exact: true }).hover();
    await page.getByRole('button', { name: 'New agent in Keyboard project', exact: true }).click();
    const modal = page.getByTestId('launch-modal');
    await expect(modal).toBeVisible();
    for (const mode of ['CLI Agent', 'Modern'] as const) {
      await modal.getByRole('group', { name: 'Launch mode' }).getByRole('button', { name: mode, exact: true }).click();
      const editor = modal.getByTestId(mode === 'Modern' ? 'thread-command-input' : 'legacy-agent-command-input');
      await editor.fill('abcd');
      await editor.press('Backspace');
      await expect(editor).toHaveText('abc');
      await editor.press('ControlOrMeta+a');
      await editor.press('Delete');
      await expect(editor).toHaveText('');
      await editor.fill('bc');
      await editor.pressSequentially('jk');
      await expect(editor).toHaveText('bcjk');
      await editor.fill('');
      await editor.press('Backspace');
      await editor.press('Delete');
      // A focus trap alone cannot protect non-editable dialog controls.
      const modeButton = modal.getByRole('group', { name: 'Launch mode' }).getByRole('button', { name: mode, exact: true });
      await modeButton.focus();
      await modeButton.press('Backspace');
      await modeButton.press('Delete');
      await expect(rows).toHaveCount(3);
      await expect(page.locator('.inbox-view .inbox-row.active')).toContainText(titles[0]);
      expect(confirmations).toEqual([]);
    }
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    expect(readFileSync(inboxFile, 'utf8')).toBe(inboxBefore);
    expect(readFileSync(savedFile, 'utf8')).toBe(savedBefore);

    // Reload through the real persistence boundary: surviving rows are not merely optimistic UI state.
    await page.reload();
    await page.getByTestId('nav-inbox').click();
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    await expect(rows).toHaveCount(3);
    await first.click();
    await first.press('Delete');
    await expect.poll(() => confirmations.length).toBe(1);
    expect(confirmations[0]).toContain('permanently');
    await expect(first).toHaveClass(/active/);
    await expect(rows).toHaveCount(3);

    acceptDelete = true;
    const deleteButton = page.getByRole('button', { name: tab === 'Feed' ? 'Delete this inbox entry' : 'Delete this saved report', exact: true });
    await deleteButton.click();
    await expect.poll(() => confirmations.length).toBe(2);
    await expect(rows).toHaveCount(2);
    if (tab === 'Feed') {
      await expect.poll(() => readFileSync(inboxFile, 'utf8').includes('"keyboard-0"')).toBe(false);
      expect(readFileSync(savedFile, 'utf8')).toBe(savedBefore);
    } else {
      await expect.poll(() => existsSync(savedFile)).toBe(false);
      expect(readFileSync(inboxFile, 'utf8')).toBe(inboxBefore);
    }
    await page.reload();
    await page.getByTestId('nav-inbox').click();
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: titles[0] })).toHaveCount(0);
  });
}
