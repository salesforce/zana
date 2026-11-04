/**
 * Demo recording (not a regression test): Squad guide 4, "Pick the right Squad".
 * See docs/media/squad-guide-README.md for the record command.
 *
 * No model is called: this video only walks the built-in Squad catalogue in Settings.
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
// Demo recording, not a regression test: run it only when recording (see docs/media/squad-guide-README.md).
test.skip(!process.env.ZCC_E2E_RECORD_VIDEO, 'Demo recording only');

async function tap(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box && process.env.ZCC_E2E_RECORD_VIDEO) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
  await page.waitForTimeout(120);
  await target.click();
}

test('demo: pick the right Squad', async ({ app }) => {
  const page = app.window;
  await app.electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), parseRecordSize(process.env.ZCC_E2E_RECORD_SIZE));
  await page.addStyleTag({ content: '.statusbar { display: none !important; } .settings-panel { zoom: 1.45; }' });
  await page.evaluate(() => {
    const dot = Object.assign(document.createElement('div'), { id: 'e2e-cursor' });
    dot.style.cssText = 'position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,200,60,.55);border:2px solid rgba(255,170,0,.95);z-index:2147483647;pointer-events:none;';
    document.body.appendChild(dot);
    addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
  });
  const beat = (ms: number) => page.waitForTimeout(ms);

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings-nav-squads').click();
  await tap(page, page.getByRole('tab', { name: /^Builtin/ }));
  await expect(page.getByRole('button', { name: 'Open Research Squad' })).toBeVisible();
  const expand = async (name: string) => {
    await tap(page, page.getByRole('button', { name: `Expand ${name} to see agents` }));
    const region = page.getByRole('region', { name: `Agents in ${name}` });
    await expect(region).toBeVisible();
    // Keep the whole expanded row above the caption bar.
    await region.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await page.waitForTimeout(700);
  };
  const collapse = async (name: string) => {
    await tap(page, page.getByRole('button', { name: `Collapse ${name}` }).or(page.getByRole('button', { name: `Expand ${name} to see agents` })));
  };

  const demo = await createDemoVideo(page);
  await demo.flash();

  await demo.section({ number: 1, title: 'Squads that come with Zana', subtitle: 'Settings → Agents & Automation → Squads → Builtin', hint: 'Built-in Squads' });
  await demo.say('intro');
  await demo.settle();
  for (const [name, id] of [['Debug Squad', 'debug'], ['Delivery Squad', 'delivery'], ['Design Squad', 'design'], ['Research Squad', 'research'], ['Review Squad', 'review']]) {
    await expand(name);
    await demo.say(id);
    await demo.settle();
    await collapse(name);
  }

  await demo.section({ number: 2, title: 'Make them yours', subtitle: 'Use, edit, or create', hint: 'New squad' });
  await page.getByTestId('settings-nav-squads').scrollIntoViewIfNeeded().catch(() => {});
  const create = page.getByRole('button', { name: /New squad/i }).first();
  await create.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await page.waitForTimeout(600);
  const box = await create.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
  await demo.say('close');
  await demo.settle();
  await demo.finish();
});
