/**
 * Boot smoke — the cheapest signal that the built app is launchable and the
 * renderer + preload bridge are alive. If this fails, every other E2E is noise.
 *
 * This is the ONE spec wired into `release.yml` as a REQUIRED gate (the `smoke`
 * job runs `npm run test:smoke:only` and `build` needs it): a build that can't
 * boot or whose main↔renderer IPC is dead must never reach signing/notarization.
 * Keep every assertion here a pure READ — on macOS the app resolves ~/.zcc via
 * app.getPath('home') (ignoring the sandbox HOME, see fixtures/app.ts), so a
 * mutating call would leak into the developer's real state and there's no
 * cleanup hook in this deliberately-minimal spec.
 */
import { test, expect } from './fixtures/app';

test('app boots: renderer mounts and the IPC bridge is live', async ({ app }) => {
  expect(app.window.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  // React root mounted something.
  const rootChildren = await app.window.evaluate(
    () => document.querySelector('#root')?.childElementCount ?? 0
  );
  expect(rootChildren).toBeGreaterThan(0);

  // The preload context bridge exposed the extensions API the marketplace uses.
  const hasBridge = await app.window.evaluate(
    () =>
      typeof (window as unknown as { cc?: { extensions?: { marketplaceList?: unknown } } }).cc
        ?.extensions?.marketplaceList === 'function'
  );
  expect(hasBridge).toBe(true);

  // Main actually ANSWERS — a live round-trip, not just a present bridge. A
  // preload that wired `window.cc` while the main handlers never registered
  // (or the ipc bridge is one-way broken) would pass the check above but hang
  // or reject here. app.version() → app.getVersion() in main returns the
  // packaged semver; assert the shape so a build that boots but can't talk to
  // main still fails the gate.
  const version = await app.window.evaluate(() =>
    (window as unknown as { cc: { app: { version: () => Promise<string> } } }).cc.app.version()
  );
  expect(version, 'app.version() must round-trip a semver from main').toMatch(/^\d+\.\d+\.\d+/);

  // Projects are the first product read routed through the supervised server
  // utility process. This is read-only so the release smoke cannot touch the
  // developer's real ZCC state.
  const projects = await app.window.evaluate(() =>
    (window as unknown as { cc: { projects: { list: () => Promise<unknown[]> } } }).cc.projects.list()
  );
  expect(Array.isArray(projects), 'projects.list() must round-trip via the server runtime').toBe(true);
});
