import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { buildPlugin } from '../packages/plugin-build/src/build-plugin.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

// GUS is a separately owned plugin. Exercise its current renderer with a
// deterministic server; never load the user's Salesforce credentials or data.
const source = resolve(process.env.GUS_PLUGIN_ROOT || '../zcc-plugin-gus');
test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });
test.beforeEach(async ({ home }) => {
  if (!existsSync(join(source, 'app.tsx'))) return;
  const fixture = join(home, 'zcc-plugin-mobile-gus-test');
  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'zcc-plugin-mobile-gus-test', version: '0.1.0', type: 'module', engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' }, zcc: { name: 'GUS mobile test', description: 'Isolated mobile fixture', server: './server.ts', app: './app.tsx' } }));
  writeFileSync(join(fixture, 'app.tsx'), readFileSync(join(source, 'app.tsx'), 'utf8').replaceAll("'./src/", `'${source}/src/`));
  writeFileSync(join(fixture, 'server.ts'), `
    export default function plugin(zcc) {
      const mine = { id: 'work-1', name: 'W-100', subject: 'Make mobile work items comfortable to read', status: 'In Progress', priority: 'P1', type: 'Bug', assigneeId: 'me', assignee: 'Alex', sprintId: 'sprint-1', teamName: 'Mobile team' };
      const other = { ...mine, id: 'work-2', name: 'W-200', subject: 'Review the other teammate ticket', status: 'New', assigneeId: 'other', assignee: 'Taylor' };
      const stored = new Map([['selectedSprintId', 'current']]);
      let fail = false;
      for (const [name, run] of Object.entries({
        whoami: () => { if (fail) throw new Error('Fixture connection unavailable'); return { userId: 'me', username: 'fixture@example.invalid', instanceUrl: 'https://example.invalid' }; },
        listSprints: () => [{ id: 'sprint-1', name: 'Mobile sprint', startDate: '2020-01-01', endDate: '2099-01-01', openCount: 2, teamId: 'team-1', teamName: 'Mobile team' }],
        listTeams: () => [{ id: 'team-1', name: 'Mobile team', openCount: 2 }],
        watchList: () => ({ sprints: [], teams: [], work: [] }),
        listWork: () => [mine], listSprintWork: () => [mine, other], listBacklog: () => [mine, other], listAutoForward: () => [],
        listProjects: () => [], listPersonas: () => [],
        getChatter: () => [], getAttachments: () => [],
        getWork: () => ({ ...mine, detailsHtml: '<p>Readable ticket details on a small screen.</p>'.repeat(30) }),
        storageGet: key => stored.get(key), storageSet: ({key, value}) => { stored.set(key, value); return {ok:true}; },
        fixtureFail: value => { fail = value; return true; }
      })) zcc.rpc.method(name, run);
    }
  `);
  await buildPlugin(fixture, JSON.parse(readFileSync('package.json', 'utf8')).version);
  const builtManifest = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'));
  builtManifest.zcc.app = './app.js';
  builtManifest.zcc.server = './server.mjs';
  writeFileSync(join(fixture, 'package.json'), JSON.stringify(builtManifest));
  // Seed only this isolated HOME. This UI test does not exercise installation
  // or the desktop supervisor's install IPC (which has its own lifecycle specs).
  const pluginsDir = join(home, '.zcc', 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(join(pluginsDir, 'installed.json'), JSON.stringify({ version: 1, plugins: [{
    id: 'mobile-gus-test', version: '0.1.0', name: 'GUS mobile test', description: 'Isolated mobile fixture', icon: 'Bug',
    enabled: true, status: 'disabled', statusDetail: null, provenance: 'direct', sourceKind: 'path', source: `path:${fixture}`,
    rootDir: fixture, serverEntry: './server.mjs', appEntry: './app.js', npmResolvedVersion: null, npmIntegrity: null,
    gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null, installedAt: 1, updatedAt: 1,
  }] }));
});

test('GUS mobile keeps work, filters and ticket details on separate full-width screens', async ({ app, home }, testInfo) => {
  test.skip(!existsSync(join(source, 'app.tsx')), 'Set GUS_PLUGIN_ROOT to the GUS plugin checkout');
  test.setTimeout(180_000);
  await expect.poll(() => app.window.evaluate(async () => (await window.cc.pluginApps.list()).some(p => p.id === 'mobile-gus-test' && p.status === 'running'))).toBe(true);
  await app.window.getByRole('button', { name: 'GUS', exact: true }).click();
  await expect(app.window.locator('.gus-board')).toBeVisible();
  await expect(app.window.locator('.gus-rail')).toBeVisible();
  await expect(app.window.getByRole('button', { name: 'Filters', exact: true })).toHaveCount(0);

  const reservation = createServer();
  await new Promise<void>(r => reservation.listen(0, '127.0.0.1', r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(r => reservation.close(() => r()));
  const url = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: url, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pair = await context.request.post(`${url}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'GUS mobile test' } });
    const credential = await pair.json();
    expect((await context.request.post(`${url}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(url);
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await drawer.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(drawer.getByText('GUS', { exact: true })).toBeVisible({ timeout: 30_000 });
    await drawer.getByText('GUS', { exact: true }).click();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    for (const width of [320, 390, 820]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator('.gus-mobile-card')).toHaveCount(1);
      await expect(page.locator('.gus-rail')).toHaveCount(0);
      await expect(page.locator('.gus-board')).toHaveCount(0);
      const list = page.getByRole('region', { name: 'Work items', exact: true });
      expect((await list.boundingBox())!.width).toBeGreaterThan(width - 40);
      expect(await list.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${width}-gus-work.png`) });
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      const filters = page.getByRole('dialog', { name: 'Filters', exact: true });
      expect((await filters.boundingBox())!.width).toBe(width);
      await filters.getByRole('button', { name: 'Everyone', exact: true }).click();
      await expect(filters.getByRole('button', { name: 'Everyone', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(filters.getByRole('button', { name: 'Show 2 items', exact: true })).toBeVisible();
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${width}-gus-filters.png`) });
      await filters.getByRole('button', { name: 'Show 2 items', exact: true }).click();
      await expect(page.locator('.gus-mobile-card')).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeFocused();
      const search = page.getByRole('textbox', { name: 'Search work items' });
      await search.fill('W-100');
      await expect(page.locator('.gus-mobile-card')).toHaveCount(1);
      await page.locator('.gus-mobile-card').click();
      const detail = page.getByRole('dialog').filter({ has: page.locator('.gus-modal-subject') });
      expect((await detail.boundingBox())!.width).toBe(width);
      expect((await detail.boundingBox())!.height).toBeGreaterThan(800);
      await expect(detail.getByText('Readable ticket details on a small screen.', { exact: true }).first()).toBeVisible();
      expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${width}-gus-ticket.png`) });
      await detail.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(search).toHaveValue('W-100');
      await search.fill('no matching ticket');
      await expect(page.getByText('No matching work items', { exact: true })).toBeVisible();
      await search.fill('');
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      await filters.getByRole('button', { name: /Me/ }).click();
      await filters.getByRole('button', { name: 'Close filters', exact: true }).click();
    }
    await page.getByRole('tab', { name: 'Backlog', exact: true }).click();
    await expect(page.locator('.gus-mobile-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByRole('button', { name: 'Assigned to me', exact: true }).click();
    await page.getByRole('button', { name: 'Show 1 item', exact: true }).click();
    await expect(page.locator('.gus-mobile-card')).toHaveCount(1);
    await app.window.evaluate(() => window.cc.pluginApps.callRpc('mobile-gus-test', 'fixtureFail', true));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Fixture connection unavailable');
    await app.window.evaluate(() => window.cc.pluginApps.callRpc('mobile-gus-test', 'fixtureFail', false));
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.gus-mobile-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('dialog', { name: 'Filters', exact: true })).toHaveCount(0);
    await expect(page.locator('.gus-board')).toBeVisible();
    await expect(page.locator('.gus-rail')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.gus-mobile-card')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Renderer crashed' })).toHaveCount(0);
  } finally { await browser.close(); await gateway.close(); }
});
