import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('phone agent pages return to their overview in one tap without adding a header row', async ({ app }, testInfo) => {
  test.setTimeout(150_000);
  const root = join(app.home, 'mobile-return-project');
  mkdirSync(root);
  writeFileSync(join(root, 'agent.cjs'), `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('2.1.220 (Claude Code)'); process.exit(0); }
process.stdout.write('RETURN_AGENT_READY\\r\\n');
process.stdin.resume();
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const seed = await app.window.evaluate(async (path) => {
    async function post(url: string, body: unknown) {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }
    const { project } = await post('/api/v1/projects', { path });
    const { thread } = await post('/api/v1/threads', {
      projectId: project.id, providerId: 'fake',
      title: 'Review the mobile composer and return to the agent overview', input: 'Return navigation check'
    });
    const { value: session } = await post('/api/v1/terminals', {
      projectId: project.id, profile: 'claude', title: 'Mobile return CLI agent', command: './agent.cjs'
    });
    return { projectId: project.id as string, threadId: thread.id as string, sessionId: session.id as string };
  }, root);
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const serverUrl = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const paired = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Agents return test' } });
    expect(paired.ok()).toBe(true);
    const credential = await paired.json();
    expect((await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
    const phone = await context.newPage();
    const drawer = phone.getByRole('dialog', { name: 'Navigation', exact: true });
    const back = phone.getByRole('link', { name: 'Back to agents', exact: true });
    const menu = phone.getByRole('button', { name: 'Expand sidebar', exact: true });
    // A direct URL has no overview in browser history; the action still has a destination.
    await phone.goto(`${serverUrl}/threads/${seed.threadId}`);
    await expect(back).toHaveAttribute('href', '/agents');
    for (const width of [320, 390, 820]) {
      await phone.setViewportSize({ width, height: 844 });
      await expect(phone.getByTestId('thread-command-input')).toBeVisible();
      const header = (await phone.locator('.titlebar').boundingBox())!;
      const title = (await phone.locator('.mobile-thread-title-slot h1').boundingBox())!;
      await expect(menu).toBeHidden();
      const backBox = (await back.boundingBox())!;
      expect(header.height).toBe(48);
      expect(backBox.width).toBeGreaterThanOrEqual(44);
      expect(backBox.height).toBeGreaterThanOrEqual(44);
      expect(backBox.y + backBox.height).toBeLessThanOrEqual(header.y + header.height);
      expect(backBox.x).toBeLessThanOrEqual(8);
      expect(backBox.x + backBox.width).toBeLessThanOrEqual(title.x);
      expect(title.width).toBeGreaterThan(40);
      expect(title.x + title.width).toBeLessThanOrEqual(width);
      expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await phone.screenshot({ path: testInfo.outputPath(`mobile-return-${width}.png`) });
      await back.click();
      await expect(phone).toHaveURL(`${serverUrl}/agents`);
      await expect(back).toHaveCount(0);
      await expect(drawer).toBeHidden();
      await menu.click();
      await drawer.getByRole('list', { name: 'Your agents' }).locator(`a[href='/threads/${seed.threadId}']`).click();
      await expect(drawer).toBeHidden();
      await expect(back).toBeVisible();
    }
    // The same action covers CLI agents and keeps a project-scoped agent in its project.
    for (const [path, destination] of [
      [`/sessions/${seed.sessionId}`, '/agents'],
      [`/projects/${seed.projectId}/threads/${seed.threadId}`, `/projects/${seed.projectId}`],
      [`/projects/${seed.projectId}/sessions/${seed.sessionId}`, `/projects/${seed.projectId}`]
    ]) {
      await phone.evaluate((destination) => {
        history.pushState({}, '', destination);
        dispatchEvent(new PopStateEvent('popstate'));
      }, path);
      await expect(phone).toHaveURL(serverUrl + path);
      await expect(back).toHaveAttribute('href', destination);
      if (path.includes('/sessions/')) {
        const notice = phone.getByTestId('cli-agent-mobile-unsupported');
        for (const width of [320, 390, 820]) {
          await phone.setViewportSize({ width, height: 844 });
          await expect(notice).toBeVisible();
          await expect(notice.getByRole('heading')).toHaveText('CLI Agents aren’t supported on mobile yet');
          await expect(notice.locator('.fairy-mobile-laptop')).toBeVisible();
          await expect(phone.getByTestId('agent-session-view')).toHaveCount(0);
          expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
          if (width === 390) {
            await phone.screenshot({
              path: testInfo.outputPath(`mobile-cli-agent-${path.startsWith('/projects/') ? 'project' : 'global'}.png`),
              animations: 'disabled'
            });
          }
        }
      }
      await back.click();
      await expect(phone).toHaveURL(serverUrl + destination);
      await expect(drawer).toBeHidden();
      await expect(back).toHaveCount(0);
    }
    await phone.goto(`${serverUrl}/threads/${seed.threadId}`);
    await phone.setViewportSize({ width: 1280, height: 900 });
    await expect(phone.locator('.app-shell')).toHaveAttribute('data-mobile', 'false');
    await expect(back).toHaveCount(0);
    await expect(app.window.getByRole('link', { name: 'Back to agents', exact: true })).toHaveCount(0);
  } finally {
    await browser.close();
    await gateway.close();
  }
});
