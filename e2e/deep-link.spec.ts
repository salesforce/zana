import { test, expect, type AppHandle } from './fixtures/app.js';

/**
 * Plugin deep links through the REAL main handlers of the built app. E2E never
 * registers a scheme with the OS, so links enter the way the OS would deliver
 * them: `open-url` (macOS) and the `second-instance` argv (Windows/Linux, and
 * the dev `pnpm dev:open-link` helper), both emitted on Electron's `app`.
 * ZCC_E2E_DEEP_LINK_SCHEME names the only scheme this build accepts.
 */
test.use({
  initialConfig: { sponsorPromptDismissed: true, mobileGatewayEnabled: false },
  launchEnv: { ZCC_E2E_DEEP_LINK_SCHEME: 'zana-e2e' }
});

type Delivery = { pluginId: string; route: string; payload: string | null };

async function recordDeliveries(app: AppHandle): Promise<void> {
  await app.window.evaluate(() => {
    const store = ((window as unknown as { __links?: unknown[] }).__links = []);
    window.cc.deepLinks!.onLink((delivery) => store.push(delivery));
  });
}

const deliveries = (app: AppHandle) =>
  app.window.evaluate(() => (window as unknown as { __links: Delivery[] }).__links);

const openUrl = (app: AppHandle, url: string) =>
  app.electron.evaluate(({ app: electronApp }, link) => {
    electronApp.emit('open-url', { preventDefault() {} }, link);
  }, url);

const secondInstance = (app: AppHandle, argv: string[]) =>
  app.electron.evaluate(({ app: electronApp }, args) => {
    electronApp.emit('second-instance', {}, args, process.cwd());
  }, argv);

test('main delivers valid links to the renderer and drops everything else', async ({ app }) => {
  const win = app.window;
  await expect.poll(() => win.evaluate(() => window.cc.deepLinks!.config())).toEqual({
    base: 'zana-e2e://',
    acceptSchemes: ['zana', 'zana-dev', 'zana-e2e']
  });
  await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find((p) => p.id === 'docs')?.status)).toBe('running');
  await recordDeliveries(app);

  await openUrl(app, 'zana-e2e://plugin/docs/peer/join?d=abc_-123');
  await expect.poll(() => deliveries(app)).toEqual([{ pluginId: 'docs', route: 'peer/join', payload: 'abc_-123' }]);
  // The host opens the plugin's view before handing the payload over.
  await openUrl(app, 'zana-e2e://plugin/plugin-guide/x');
  await expect.poll(() => win.url()).toContain('plugin-guide');

  await secondInstance(app, ['/path/to/app', '--flag', 'zana-e2e://plugin/docs/second?d=x%2By']);
  await expect.poll(() => deliveries(app).then((rows) => rows.length)).toBe(3);
  expect((await deliveries(app))[2]).toEqual({ pluginId: 'docs', route: 'second', payload: 'x+y' });

  // Rejected in main: wrong channel scheme, traversal, bad encoding, unknown shape, no link in argv.
  await openUrl(app, 'zana://plugin/docs/peer');
  await openUrl(app, 'zana-e2e://plugin/docs/../etc');
  await openUrl(app, 'zana-e2e://plugin/docs/ok?d=%E0%A4%A');
  await openUrl(app, 'zana-e2e://plugin/Docs/ok');
  await openUrl(app, 'zana-e2e://other/docs/ok');
  await secondInstance(app, ['/path/to/app', '--flag']);
  // A valid sentinel after the bad ones proves they were processed (order is serialized) and dropped.
  await openUrl(app, 'zana-e2e://plugin/docs/sentinel');
  await expect.poll(() => deliveries(app).then((rows) => rows.at(-1)?.route)).toBe('sentinel');
  expect((await deliveries(app)).map((row) => row.route)).toEqual(['peer/join', 'x', 'second', 'sentinel']);
});

test('the in-app paste path re-validates in main and accepts every known scheme', async ({ app }) => {
  const win = app.window;
  await recordDeliveries(app);
  expect(await win.evaluate(() => window.cc.deepLinks!.open('zana://plugin/docs/pasted?d=1'))).toEqual({ ok: true, pluginId: 'docs', route: 'pasted' });
  expect(await win.evaluate(() => window.cc.deepLinks!.open('zana-dev://plugin/docs/pasted'))).toEqual({ ok: true, pluginId: 'docs', route: 'pasted' });
  expect(await win.evaluate(() => window.cc.deepLinks!.open('https://plugin/docs/pasted'))).toEqual({ ok: false, reason: 'wrong-scheme' });
  expect(await win.evaluate(() => window.cc.deepLinks!.open('zana://plugin/docs/a b'))).toEqual({ ok: false, reason: 'control-characters' });
  expect(await win.evaluate(() => window.cc.deepLinks!.open(42 as never))).toEqual({ ok: false, reason: 'not-a-string' });
  await expect.poll(() => deliveries(app).then((rows) => rows.length)).toBe(2);
});

test('a link for a plugin that is not installed toasts and does nothing', async ({ app }) => {
  const win = app.window;
  await openUrl(app, 'zana-e2e://plugin/not-installed/x');
  await expect(win.getByText("That link is for a plugin that isn't installed.")).toBeVisible({ timeout: 20_000 });
  expect(new URL(win.url()).pathname).not.toContain('not-installed');
});
