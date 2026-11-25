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

test('Squads shows Squad runs only, filters both views and opens the real blocker', async ({ app }, testInfo) => {
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
    const runCard = squads.getByRole('region', { name: runTitle, exact: true });
    await expect(runCard.getByRole('button', { name: /Needs you Which label/ })).toBeVisible({ timeout: 45_000 });
    await expect(squads.getByRole('heading', { name: runTitle })).toBeVisible();
    await expect(squads.getByRole('button', { name: '1 All', exact: true })).toBeVisible();
    await expect(squads.getByText('Draft release checklist', { exact: true })).toBeHidden();
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
    await caption('Squads opens on Overview. The question appears inside the run that needs an answer.');

    await click(page, squads.getByRole('button', { name: '1 Needs you', exact: true }));
    await expect(attention).toBeVisible();
    await caption('Select Needs you to see Squad runs waiting for you.');
    await click(page, squads.getByRole('button', { name: '1 All', exact: true }));

    const search = squads.getByRole('searchbox', { name: 'Search Squad runs and members' });
    await search.fill('release checklist');
    await expect(squads.getByText('No matching Squad runs', { exact: true })).toBeVisible();
    await search.fill('Atlas Researcher');
    const researcher = runCard.getByRole('button', { name: /Atlas Researcher/ }).first();
    await expect(researcher).toBeVisible();
    await caption('Search finds Squad runs and their members in the selected project.');
    await click(page, researcher);
    const details = squads.getByRole('complementary', { name: 'Agent details' });
    await expect(details.getByRole('heading', { name: 'Atlas Researcher' })).toBeFocused();
    await caption('Select a Squad member to see their status and open their thread or terminal.');
    await click(page, details.getByRole('button', { name: 'Close agent details' }));
    await expect(researcher).toBeFocused();
    await search.clear();

    await project.selectOption(second.value.id);
    await expect(squads.getByText('No Squad runs in this project', { exact: true })).toBeVisible();
    await expect(squads.getByText('Review announcement template', { exact: true })).toBeHidden();
    await expect(attention).toBeHidden();
    await caption('Switch projects from the same view.', 2700);
    await project.selectOption(projectId);
    await expect(attention).toBeVisible();

    await click(page, squads.getByRole('button', { name: 'Map', exact: true }));
    const map = squads.getByRole('region', { name: 'Squad map' });
    await expect(map.locator('path.squad-flow-edge').first()).toBeVisible({ timeout: 15_000 });
    await expect(map.getByText('Work dependency', { exact: true })).toBeVisible();
    await expect(map.locator('.squad-flow-node-blocker')).toHaveCount(0);
    await expect(map.getByText('Draft release checklist', { exact: true })).toBeHidden();
    if (!recording) await page.screenshot({ path: testInfo.outputPath('squad-map.png') });
    await caption('Map shows who is connected. Dashed lines show work dependencies.');

    if (!recording) {
      await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 640));
      await click(page, attention);
      await expect(page.locator('.agents-board-content[data-execution-open]')).toBeFocused();
      const detailLayout = page.locator('.execution-run-layout');
      await expect.poll(() => detailLayout.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
      await page.keyboard.press('Escape');
      await expect(attention).toBeFocused();
      await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    }
    await click(page, attention);
    const job = page.getByLabel('Squad details', { exact: true });
    const closeDetails = job.getByRole('button', { name: 'Close details', exact: true });
    await expect(squads).toBeHidden();
    const blocker = job.getByRole('region', { name: question, exact: true });
    const work = job.getByRole('region', { name: 'Work steps', exact: true });
    const rail = job.getByRole('complementary', { name: 'Run activity and diagnostics' });
    await expect(work.getByRole('progressbar')).toHaveAttribute('value', '2');
    await expect(rail.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
    await expect.poll(() => job.locator('.execution-run-layout').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);
    await expect(blocker.getByRole('heading', { name: question })).toBeVisible();
    const response = blocker.getByRole('textbox', { name: 'Your answer' });
    await expect(response).toBeVisible();
    await expect(blocker.getByText('About · About Atlas', { exact: true })).toBeVisible();
    await expect(blocker.getByRole('radio')).toHaveCount(0);
    await response.scrollIntoViewIfNeeded();
    if (!recording) await page.screenshot({ path: testInfo.outputPath('blocker-open.png') });
    await caption('Squad details keeps the question and work steps together, with activity beside them.');
    const diagnostics = rail.getByText('Delivery details', { exact: true });
    const formTop = (await response.boundingBox())!.y;
    await click(page, diagnostics);
    await expect(rail.getByText('Inbox item', { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(closeDetails).toBeInViewport({ ratio: 1 });
    expect((await response.boundingBox())!.y).toBeCloseTo(formTop, 0);
    if (!recording) await page.screenshot({ path: testInfo.outputPath('blocker-diagnostics.png') });
    await caption('Delivery details opens in the side column while the reply stays in place.');
    await click(page, diagnostics);
    const allEvents = rail.getByText(/^(All|Recent) events \(\d+\)$/);
    await click(page, allEvents);
    const eventLog = rail.getByRole('list', { name: 'Event log' });
    await expect(eventLog.getByText('Execution reserved', { exact: false })).toBeVisible();
    const warnings = rail.getByRole('checkbox', { name: 'Warnings only' });
    await click(page, warnings);
    await expect(eventLog.getByText('Execution reserved', { exact: false })).toHaveCount(0);
    await caption('Recent activity shows milestones. All events keeps the full log, with a warnings filter.');
    await click(page, allEvents);
    const runDiagnostics = rail.getByText('Diagnostics', { exact: true });
    await expect(rail.getByRole('button', { name: 'Copy diagnostics' })).toBeHidden();
    await click(page, runDiagnostics);
    await expect(rail.getByText('Run ID', { exact: true })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Copy diagnostics', exact: true })).toBeVisible();
    await caption('Diagnostics keeps execution IDs, usage, routing, and the copy action together.', 2800);
    await click(page, runDiagnostics);
    if (recording) {
      await response.pressSequentially('About Atlas', { delay: 80 });
      await page.waitForTimeout(500);
    } else {
      await response.fill('About Atlas');
    }
    await click(page, blocker.getByRole('button', { name: 'Send answer', exact: true }));
    await expect(blocker.getByText('Answer queued', { exact: true })).toBeVisible();
    await expect(blocker.locator('.execution-blocker-receipt')).toContainText('About Atlas');
    await expect(response).toHaveCount(0);
    if (!recording) await page.screenshot({ path: testInfo.outputPath('blocker-queued.png') });
    await caption('The card shows your answer while it waits for the worker to acknowledge it.', 1600);
    await expect.poll(() => readCoordinatorLog(ctx), { timeout: 30_000 }).toContain('answer About Atlas');
    await expect(blocker.getByText('Answer delivered', { exact: true })).toBeVisible();
    await expect(blocker.locator('.execution-blocker-receipt')).toContainText('About Atlas');
    await caption('Answer delivered confirms the worker received it.', 2800);
    await click(page, closeDetails);
    await expect(squads.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await click(page, squads.getByRole('button', { name: 'Overview', exact: true }));
    await expect(attention).toBeHidden({ timeout: 20_000 });
    await caption('The run receives the response. Overview clears the question once it is answered.', 4000);
    await expect(squads.getByRole('button', { name: '1 Completed', exact: true })).toBeVisible({ timeout: 20_000 });
    await click(page, squads.getByRole('button', { name: '1 Completed', exact: true }));
    await expect(runCard.getByText('Completed', { exact: true })).toBeVisible();
    await caption('Completed keeps finished runs easy to find, even after the workers exit.', 3500);
    await demo?.finish();
    if (demo) await demo.flash();
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${readCoordinatorLog(ctx).slice(-10_000)}`, { cause: error });
  } finally {
    await teardownJobTeam(ctx);
  }
});
