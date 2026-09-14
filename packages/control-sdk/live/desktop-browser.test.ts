/**
 * Attach live test for desktop-browser product HTTP.
 *
 * Isolated stacks skip (no BrowserView). A connected host that returns 503
 * `desktop_browser_unavailable` is a real failure: product HTTP runs in the
 * utility process and must reach Electron's broker (BB does this via
 * host-rpc + the host-daemon broker WebSocket). Do not skip that 503.
 * Cookie import POSTs into the tagged thread's automation partition. The
 * default probe does not copy signed-in cookies; `ZCC_LIVE_BROWSER_IMPORT=1`
 * opts into a real copy when a source profile is available.
 */
import { describe, expect, it } from 'vitest';
import {
  importSourcesLeakCookieMaterial,
  isSkip,
  jpegMagicOk,
  liveEnabled,
  preflightOrSkip,
  runDesktopBrowserImportProbe,
  runDesktopBrowserLeaseCycle,
  Zcc
} from '../src/index.js';

const enabled = liveEnabled();

describe.skipIf(!enabled)('live desktop browser', () => {
  it('leases loopback CDP, captures a JPEG, and probes cookie import', async () => {
    const zcc = await Zcc.connect();
    try {
      const picked = await zcc.browsers.pickInstance();
      if (isSkip(picked)) {
        console.warn(`[live] skip desktop-browser ${picked.reason}`);
        return;
      }
      const project = await zcc.projects.ensureLiveSandbox();
      const pre = await preflightOrSkip(zcc, { surface: 'thread', providerId: 'claude-code' });
      if (isSkip(pre)) {
        console.warn(`[live] skip desktop-browser ${pre.reason}`);
        return;
      }
      const thread = await zcc.threads.spawn({
        projectId: project.id,
        prompt: 'stop immediately without using tools',
        providerId: 'claude-code',
        permissionMode: 'accept-edits',
        title: 'desktop-browser'
      });
      const session = zcc.browsers.session({
        hostId: picked.instance.hostId,
        instanceId: picked.instance.instanceId,
        generation: picked.instance.generation,
        threadId: thread.id
      });
      const cycle = await runDesktopBrowserLeaseCycle(session, {
        controllerLabel: `zcc-live:${zcc.runId}`,
        ttlMs: 30_000,
        probeCdp: true
      });
      expect(cycle.wsEndpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\//);
      expect(cycle.cdpProduct).toMatch(/Chrome/i);
      expect(cycle.capture.mimeType).toBe('image/jpeg');
      expect(jpegMagicOk(cycle.capture.base64)).toBe(true);
      const sources = await zcc.browsers.listImportSources(picked.instance);
      expect(importSourcesLeakCookieMaterial(sources)).toBe(false);
      const importProbe = await runDesktopBrowserImportProbe(zcc.http, {
        hostId: picked.instance.hostId,
        instanceId: picked.instance.instanceId,
        generation: picked.instance.generation,
        threadId: thread.id,
        sources,
        copyCookies: process.env.ZCC_LIVE_BROWSER_IMPORT === '1'
      });
      expect(importSourcesLeakCookieMaterial(importProbe.outcome)).toBe(false);
      if (!importProbe.copiesCookies) {
        expect(importProbe.outcome).toMatchObject({ ok: false, reason: expect.any(String) });
      }
      await thread.stop();
    } finally {
      await zcc.close();
    }
  });
});

describe.skipIf(enabled)('live desktop browser (gated)', () => {
  it('does not run without ZCC_LIVE_CONTROL=1', () => {
    expect(liveEnabled()).toBe(false);
  });
});
