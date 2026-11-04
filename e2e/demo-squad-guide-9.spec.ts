/**
 * Demo recording (not a regression test): Squad guide 9, "Build your own Persona and Squad".
 * See docs/media/squad-guide-README.md for the record command.
 *
 * No model is called: this video only edits Personas and Squads in Settings.
 */
import { test, expect } from './fixtures/app.js';
import { createDemoVideo } from './sdk/demo-video.js';
import { parseRecordSize } from './sdk/demo-video-core.js';
import type { Locator, Page } from '@playwright/test';

test.use({
  e2e: true,
  initialConfig: { theme: 'light', sponsorPromptDismissed: true, teamJobLaunchEnabled: true, autoRenameTabs: false },
  launchEnv: process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {}
});
test.setTimeout(240_000);

async function tap(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box && process.env.ZCC_E2E_RECORD_VIDEO) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
  await page.waitForTimeout(120);
  await target.click();
}

async function pick(page: Page, picker: Locator, listbox: string, option: string): Promise<void> {
  await tap(page, picker);
  await page.waitForTimeout(250);
  await tap(page, page.getByRole('listbox', { name: listbox }).getByRole('option', { name: new RegExp(`^${option.replace(/[()]/g, '\\$&')}(?:\\s|$)`) }).first());
}

test('demo: build your own Persona and Squad', async ({ app }) => {
  const page = app.window;
  await app.electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), parseRecordSize(process.env.ZCC_E2E_RECORD_SIZE));
  await page.addStyleTag({ content: '.statusbar { display: none !important; } .settings-panel { zoom: 1.3; } .settings-panel [role="dialog"] { max-height: 66vh !important; }' });
  await page.evaluate(() => {
    const dot = Object.assign(document.createElement('div'), { id: 'e2e-cursor' });
    dot.style.cssText = 'position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,200,60,.55);border:2px solid rgba(255,170,0,.95);z-index:2147483647;pointer-events:none;';
    document.body.appendChild(dot);
    addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
  });
  const beat = (ms: number) => page.waitForTimeout(ms);
  const menu = async (row: Locator, item: string) => {
    await row.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    await beat(900);
    const box = await row.boundingBox();
    if (box && process.env.ZCC_E2E_RECORD_VIDEO) await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 14 });
    await row.click({ button: 'right', position: { x: 120, y: 12 } });
    await tap(page, page.getByRole('menuitem', { name: item }));
  };

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings-nav-personas').click();

  const demo = await createDemoVideo(page);
  await demo.flash();

  // --- 01 Start from a built-in Persona ---
  await demo.section({ number: 1, title: 'Start from a built-in Persona', subtitle: 'Personas → right-click → Duplicate', hint: 'Or New persona' });
  await demo.say('persona');
  const builtin = page.getByRole('button', { name: 'Open Software Engineer' });
  await expect(builtin).toBeVisible();
  await menu(builtin, 'Duplicate');
  await tap(page, page.getByRole('tab', { name: /^User/ }));
  const mine = page.getByRole('button', { name: /^Open Software Engineer/ }).first();
  await expect(mine).toBeVisible({ timeout: 15_000 });
  await demo.settle();

  // --- 02 Name, model level, instructions ---
  await demo.section({ number: 2, title: 'Name, model level, instructions', subtitle: 'Harness stays neutral', hint: 'Follows the launch harness' });
  await demo.say('fields');
  await tap(page, mine);
  const persona = page.locator('[role="dialog"]').filter({ has: page.locator('#persona-name') });
  await expect(persona).toBeVisible({ timeout: 15_000 });
  await persona.locator('#persona-name').click();
  await persona.locator('#persona-name').fill('');
  await persona.locator('#persona-name').pressSequentially('Docs Writer', { delay: 55 });
  await persona.locator('#persona-desc').click();
  await persona.locator('#persona-desc').fill('');
  await persona.locator('#persona-desc').pressSequentially('Writes and edits user-facing docs', { delay: 30 });
  await pick(page, persona.locator('#persona-model-level'), 'Model level', 'Medium');
  await persona.locator('#persona-system').click();
  await persona.locator('#persona-system').fill('');
  await persona.locator('#persona-system').pressSequentially('Write short, plain docs. Cite the source file for every claim.', { delay: 18 });
  await beat(500);
  await tap(page, persona.getByRole('button', { name: 'Save', exact: true }));
  await expect(persona).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open Docs Writer' })).toBeVisible();
  await demo.settle();

  // --- 03 Duplicate a built-in Squad ---
  await demo.section({ number: 3, title: 'Duplicate a built-in Squad', subtitle: 'Settings → Squads → right-click → Duplicate', hint: 'Start from a copy' });
  await tap(page, page.getByTestId('settings-nav-squads'));
  await tap(page, page.getByRole('tab', { name: /^Builtin/ }));
  const research = page.getByRole('button', { name: 'Open Research Squad' });
  await expect(research).toBeVisible();
  await demo.say('duplicate');
  await menu(research, 'Duplicate');
  await tap(page, page.getByRole('tab', { name: /^User/ }));
  const copy = page.getByRole('button', { name: /^Open .*Research Squad/ }).first();
  await expect(copy).toBeVisible({ timeout: 15_000 });
  await demo.settle();
  await tap(page, copy);
  const editor = page.locator('[role="dialog"]').filter({ has: page.locator('#team-name') });
  await expect(editor).toBeVisible({ timeout: 15_000 });

  // --- 04 Slots and the Orchestrator ---
  await demo.section({ number: 4, title: 'Slots and the Orchestrator', subtitle: 'Persona + tab count, crown = Orchestrator', hint: 'Every run needs one' });
  await demo.say('slots');
  await tap(page, editor.getByRole('button', { name: 'Add slot' }));
  const slotPersona = editor.getByLabel('Slot persona');
  await pick(page, slotPersona.last(), 'Slot persona', 'Docs Writer');
  await beat(600);
  await tap(page, editor.getByLabel('Mark as orchestrator').first());
  await demo.settle();

  // --- 05 Launch options ---
  await demo.section({ number: 5, title: 'Launch options', subtitle: 'Planning, approval, worktree', hint: 'All optional' });
  await demo.say('options');
  const scrollTo = async (sel: string) => {
    await editor.locator(sel).evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await beat(1100);
  };
  await scrollTo('#team-default-planning');
  await pick(page, editor.locator('#team-default-planning'), 'Squad default planning', 'Plan provided in goal');
  await beat(900);
  await scrollTo('#team-launch-approval');
  await pick(page, editor.locator('#team-launch-approval'), 'Squad launch approval', 'Review before launch');
  await beat(900);
  await scrollTo('#team-worktree-isolation');
  await beat(1800);
  await scrollTo('#team-worktree-on-complete');
  await beat(1800);
  await demo.settle();
  await tap(page, editor.getByRole('button', { name: 'Save', exact: true }));
  await expect(editor).toBeHidden();
  await tap(page, page.getByRole('tab', { name: /^User/ }));
  await expect(copy).toBeVisible({ timeout: 15_000 });

  // --- 06 Set as default ---
  await demo.section({ number: 6, title: 'Set as default', subtitle: 'Row menu → Set as default', hint: 'Preselected in New Agent' });
  await demo.say('default');
  await menu(copy, 'Set as default');
  await beat(600);
  await expect(page.getByText('Default', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await demo.settle();
  await demo.say('close');
  await demo.finish();
});
