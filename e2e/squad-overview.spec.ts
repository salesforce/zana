import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { createDemoVideo, parseRecordSize } from './sdk/demo-video.js';
import { createJobTeamContext, launchJobTeamCliOwner, readCoordinatorLog, teardownJobTeam } from './sdk/job-team-scenario.js';

const recording = Boolean(process.env.ZCC_E2E_RECORD_VIDEO);
const runTitle = 'CLI Agent durable job';
const question = 'Which label should result.txt use?';

test.use({
  e2e: true,
  initialConfig: { theme: 'light', sponsorPromptDismissed: true, teamJobLaunchEnabled: true, autoRenameTabs: false },
  launchEnv: { ZCC_FAKE_PROVIDER: '1', ...(recording && process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {}) }
});

test.setTimeout(150_000);

async function createSolo(page: Page, projectId: string, title: string) {
  const id = await page.evaluate(async ({ projectId, title }) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, title, providerId: 'fake', input: 'Draft a short project note.' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).value.id as string;
  }, { projectId, title });
  await expect.poll(() => page.evaluate(async (threadId) => {
    const response = await fetch(`/api/v1/threads/${threadId}`);
    return (await response.json()).thread?.status;
  }, id), { timeout: 15_000 }).toBe('idle');
}

async function click(page: Page, target: Locator) {
  if (recording) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    await page.waitForTimeout(200);
  }
  await target.click();
}

test('Squads groups the run and solo agents, filters both views and opens the real blocker', async ({ app }, testInfo) => {
  const page = app.window;
  const ctx = createJobTeamContext(app, { tmpPrefix: 'atlas-website-' });
  try {
    if (recording) {
      await app.electron.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height);
      }, parseRecordSize(process.env.ZCC_E2E_RECORD_SIZE));
    }
    const projectId = await launchJobTeamCliOwner(ctx, {
      workerQuantity: 2,
      orchestratorExtra: { name: 'Atlas Coordinator' },
      workerExtra: { name: 'Atlas Researcher' },
      teamExtra: { name: 'Atlas Research' }
    });
    const dialog = page.getByRole('dialog', { name: /E2E start Job Team/ });
    if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const secondDir = join(app.home, 'release-templates');
    mkdirSync(secondDir);
    const second = await page.evaluate((path) => window.cc.projects.add(path), secondDir);
    if (!second.ok) throw new Error(second.message);
    await createSolo(page, projectId, 'Draft release checklist');
    await createSolo(page, second.value.id, 'Review announcement template');

    await page.getByTestId('nav-agents').click();
    await page.getByRole('button', { name: 'Squads view' }).click();
    const squads = page.getByRole('region', { name: 'Squads', exact: true });
    const project = squads.getByRole('combobox', { name: 'Project', exact: true });
    await project.selectOption(projectId);
    const attention = squads.getByRole('button', { name: /Needs you Which label/ });
    await expect(attention).toBeVisible({ timeout: 45_000 });
    await expect(squads.getByRole('heading', { name: runTitle })).toBeVisible();
    const solo = squads.getByRole('region', { name: 'Solo agents' });
    const draft = solo.getByRole('button', { name: /Draft release checklist/ });
    await expect(draft).toBeVisible();
    if (!recording) await page.screenshot({ path: testInfo.outputPath('squad-overview.png') });

    const demo = recording ? await createDemoVideo(page, []) : undefined;
    if (demo) {
      await page.evaluate(() => {
        const dot = document.createElement('div');
        dot.style.cssText = 'position:fixed;left:-30px;top:-30px;width:19px;height:19px;border:2px solid #1569ba;background:#84bdf27a;border-radius:50%;z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%)';
        document.body.appendChild(dot);
        document.addEventListener('mousemove', (event) => {
          dot.style.left = `${event.clientX}px`;
          dot.style.top = `${event.clientY}px`;
        }, true);
      });
      await demo.flash();
    }
    const caption = async (text: string, ms = 3400) => {
      if (!demo) return;
      await demo.caption(text);
      await page.waitForTimeout(ms);
    };
    await caption('Squads opens on Overview. The question that needs an answer is above the run and solo agents.');

    await click(page, squads.getByRole('button', { name: /^\d+ Needs you$/ }));
    await expect(draft).toBeHidden();
    await caption('Select Needs you to narrow the roster to agents waiting for you.');
    await click(page, squads.getByRole('button', { name: /^\d+ All agents$/ }));

    const search = squads.getByRole('searchbox', { name: 'Search agents and runs' });
    await search.fill('release checklist');
    await expect(draft).toBeVisible();
    await expect(attention).toBeHidden();
    await caption('Search works across agent names and Squad run titles in the selected project.');
    await click(page, draft);
    const details = squads.getByRole('complementary', { name: 'Agent details' });
    await expect(details.getByRole('heading', { name: 'Draft release checklist' })).toBeFocused();
    await caption('Select an agent to see its status and open its thread or terminal.');
    await click(page, details.getByRole('button', { name: 'Close agent details' }));
    await expect(draft).toBeFocused();
    await search.clear();

    const idle = solo.getByRole('button', { name: /^Idle agents/ });
    await click(page, idle);
    await expect(draft).toBeHidden();
    await caption('Collapse idle agents to leave more room for current work.', 2700);
    await click(page, idle);

    await project.selectOption(second.value.id);
    await expect(squads.getByRole('button', { name: /Review announcement template/ })).toBeVisible();
    await expect(attention).toBeHidden();
    await caption('Switch projects from the same view.', 2700);
    await project.selectOption(projectId);
    await expect(attention).toBeVisible();

    await click(page, squads.getByRole('button', { name: 'Map', exact: true }));
    const map = squads.getByRole('region', { name: 'Squad map' });
    await expect(map.locator('path.squad-flow-edge').first()).toBeVisible({ timeout: 15_000 });
    await expect(map.getByText('Work dependency', { exact: true })).toBeVisible();
    await expect(map.locator('.squad-flow-node-blocker')).toHaveCount(0);
    if (!recording) await page.screenshot({ path: testInfo.outputPath('squad-map.png') });
    await caption('Map shows who is connected. Dashed lines show work dependencies.');

    await click(page, attention);
    const job = page.getByLabel('Squad details', { exact: true });
    await expect(job.getByText(question, { exact: true })).toBeVisible();
    const response = job.getByRole('textbox', { name: 'Blocker response' });
    await response.scrollIntoViewIfNeeded();
    await caption('Open the question to respond in Squad details.');
    await response.fill('About Atlas');
    await click(page, job.getByRole('button', { name: 'Respond', exact: true }));
    await expect.poll(() => readCoordinatorLog(ctx), { timeout: 30_000 }).toContain('answer About Atlas');
    await click(page, job.getByRole('button', { name: 'Close details' }));
    await click(page, squads.getByRole('button', { name: 'Overview', exact: true }));
    await expect(attention).toBeHidden({ timeout: 20_000 });
    await caption('The run receives the response. Overview clears the question once it is answered.', 4000);
    await demo?.finish();
    if (demo) await demo.flash();
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${readCoordinatorLog(ctx).slice(-10_000)}`, { cause: error });
  } finally {
    await teardownJobTeam(ctx);
  }
});
