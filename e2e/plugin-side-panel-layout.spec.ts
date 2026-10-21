import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('plugin pages share the rail, tabs, resizing and maximize layout across global and project views', async ({ app, home }, testInfo) => {
  test.setTimeout(180_000);
  const win = app.window;
  await win.setViewportSize({ width: 1440, height: 900 });
  const pages = [
    ['pr-monitor', '/plugins/pr-monitor/main'],
    ['design-docs', '/plugins/design-docs/design-docs'],
    ['salesforce', '/plugins/salesforce/orgs'],
    ['tasks', '/plugins/tasks/tasks'],
    ['storage-retention', '/plugins/storage-retention/storage'],
    ['plugin-guide', '/extensions/pages/plugin-guide/plugin-guide']
  ];
  // A missing Salesforce CLI degrades server tools while its page remains available.
  for (const [id] of [...pages, ['docs', '']]) {
    expect(await win.evaluate((id) => window.cc.extensions.install({ kind: 'bundled', id }), id)).toMatchObject({ ok: true });
    await expect.poll(() => win.evaluate(async (id) => (await window.cc.pluginApps.list()).find(row => row.id === id)?.status, id), { timeout: 30_000 }).toMatch(/running|needs-configuration|degraded/);
  }
  const path = join(home, 'shared-panel-project');
  mkdirSync(path, { recursive: true });
  const projectId = await win.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw Error(result.message);
    return result.value.id;
  }, path);
  const destinations = [
    ...pages.map(([, path]) => path),
    '/plugins/docs/panel',
    `/projects/${projectId}/design-docs`,
    `/projects/${projectId}/salesforce`,
    `/projects/${projectId}/library`
  ];
  for (const [index, destination] of destinations.entries()) {
    await test.step(destination, async () => {
      await win.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, destination);
      const host = win.getByTestId('plugin-panel-host-layout');
      await expect(host).toBeVisible();
      await expect(host).toHaveCount(1);
      const rail = host.getByRole('toolbar', { name: 'Side panel' });
      await expect(rail).toBeVisible();
      const main = host.locator(':scope > .split-plugin-main');
      const hostBox = (await host.boundingBox())!;
      const mainBox = (await main.boundingBox())!;
      const railBox = (await rail.boundingBox())!;
      expect(Math.abs(mainBox.x + mainBox.width - railBox.x)).toBeLessThan(2);
      expect(railBox.width).toBeGreaterThanOrEqual(35.5);
      expect(railBox.width).toBeLessThanOrEqual(38);
      expect(Math.abs(railBox.x + railBox.width - hostBox.x - hostBox.width)).toBeLessThan(2);
      await captureElectronScreenshot(app.electron, win, testInfo.outputPath(`page-${index}-rail.png`));

      await host.getByTestId('plugin-panel-secondary-show').click();
      await expect(host.getByTestId('thread-new-tab-page')).toBeVisible();
      await host.getByTestId('thread-new-tab-agent').click();
      await expect(host.getByTestId('panel-agent-tab-composer')).toBeVisible();
      const panel = host.getByTestId('thread-secondary-panel');
      const panelBox = (await panel.boundingBox())!;
      expect(panelBox.width).toBeLessThan(hostBox.width - 100);
      expect((await main.boundingBox())!.width).toBeGreaterThan(100);
      await captureElectronScreenshot(app.electron, win, testInfo.outputPath(`page-${index}-agent.png`));

      const resize = host.getByRole('separator', { name: 'Resize right panel' });
      const resizeBox = (await resize.boundingBox())!;
      await win.mouse.move(resizeBox.x + 4, resizeBox.y + 100);
      await win.mouse.down();
      await win.mouse.move(resizeBox.x - 70, resizeBox.y + 100);
      await win.mouse.up();
      const resized = (await panel.boundingBox())!.width;
      expect(resized).toBeGreaterThan(panelBox.width + 40);

      await host.getByTestId('thread-secondary-maximize').click();
      await expect(main).toBeHidden();
      expect(Math.abs((await panel.boundingBox())!.width - hostBox.width)).toBeLessThan(2);
      await expect(resize).toBeHidden();
      await captureElectronScreenshot(app.electron, win, testInfo.outputPath(`page-${index}-maximized.png`));
      await host.getByTestId('thread-secondary-maximize').click();
      await expect(main).toBeVisible();
      expect(Math.abs((await panel.boundingBox())!.width - resized)).toBeLessThan(2);

      await host.getByRole('button', { name: 'Close Agent', exact: true }).click();
      await expect(host.getByTestId('thread-new-tab-page')).toBeVisible();
      await host.getByTestId('thread-secondary-hide').click();
      await expect(rail).toBeVisible();
      await host.getByTestId('plugin-panel-agent-show').click();
      await expect(host.getByTestId('panel-agent-tab-composer')).toBeVisible();
      await host.getByTestId('thread-secondary-hide').click();
    });
  }
});
