/**
 * Full publish→install happy path (plan Phase 6, "definition-of-done gate").
 * Exercises every layer the prior phases built, wired together for real:
 *
 *   1. Boot the REAL `website/` standalone server (Next production build)
 *      against a temp SQLite DB + a generated Ed25519 keypair, fronted by a
 *      self-signed HTTPS proxy (see `fixtures/website-server.ts` for why the
 *      proxy exists — the desktop engine hard-requires HTTPS).
 *   2. Drive the mock GitHub OAuth flow (`GITHUB_OAUTH_MODE=mock`) to get a
 *      real session cookie, then `POST /api/tokens` to mint a `zpat_…`
 *      publish token — the exact auth artifacts a real publisher would get.
 *   3. Run the REAL CLI (`scripts/publish-extension.mjs --api --token`) as a
 *      child process against a freshly-built dummy extension artifact dir
 *      (id `e2e-marketplace-pub`, mirroring `fixtures/registry.ts`'s dummy —
 *      NOT one of the app's bundled ids like `docs`.
 *      Publishing under a bundled id was tried first and failed: the app
 *      seeds those at boot (`seedBundledExtensions`) at the exact version
 *      this test would publish, so the marketplace row is already
 *      "Installed" before the remote release is even fetched — there is no
 *      "Install" state to click. A synthetic id keeps step 5 a genuine
 *      install of something the host has never seen.)
 *   4. Assert the served `GET /extensions/index.json` lists the release and
 *      the downloaded archive's sha256 matches what the API returned.
 *   5. Point a throwaway `~/.zcc/extension-registry.json` at the live HTTPS
 *      feed (generated public key, `requireSignature: true`) and drive the
 *      REAL Electron app's Marketplace UI (via the existing `MarketplacePage`
 *      fixture + `launchApp`) to install it — the UNCHANGED engine downloads,
 *      sha256/Ed25519-verifies, and stages the release exactly as it would
 *      against a production deployment.
 *
 * Install-verification path taken: APP-UI (not the engine-level fallback) —
 * this environment can launch the built Electron app headlessly via
 * Playwright's `_electron` driver (verified separately with `e2e/smoke.spec.ts`
 * and the existing `marketplace.spec.ts`/`marketplace-lifecycle.spec.ts`
 * suites), so the more faithful full-UI path is feasible and used here.
 */
import { test as base, expect } from '@playwright/test';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

import { startWebsiteServer, type WebsiteServer } from './fixtures/website-server.js';
import { launchApp, writeRegistryConfig, dismissConsentOverlays, type AppHandle } from './fixtures/app.js';
import { MarketplacePage } from './fixtures/marketplace.js';

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLISH_SCRIPT = join(REPO_ROOT, 'scripts', 'publish-extension.mjs');

/** Extension id/title used for this test's publish→install round-trip. Not
 * one of the app's bundled ids (see the header comment for why). */
const EXT_ID = 'e2e-marketplace-pub';
const EXT_TITLE = 'E2E Marketplace Pub';
const EXT_VERSION = '1.0.0';

/**
 * Write a minimal, valid extension artifact dir — the same shape
 * `fixtures/registry.ts`'s dummy extension uses, so `buildArchive()` in
 * `scripts/publish-extension.mjs` accepts it (a manifest + `main.mjs`).
 */
function writeDummyExtensionArtifact(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'extension.json'),
    JSON.stringify(
      {
        id: EXT_ID,
        version: EXT_VERSION,
        title: EXT_TITLE,
        icon: 'Sparkles',
        titleLabel: EXT_TITLE,
        entry: { main: 'main.mjs' },
        engines: { zccApi: '^1.0.0' },
        permissions: ['storage'],
      },
      null,
      2
    )
  );
  writeFileSync(
    join(dir, 'main.mjs'),
    `export default { id: ${JSON.stringify(EXT_ID)}, setup(ctx) { ctx.log('${EXT_ID} activated'); return { ping: async () => 'pong' }; } };\n`
  );
}

/**
 * Run `fn` with this process's global `fetch()` trusting the ephemeral
 * self-signed proxy cert, then restore the previous setting.
 *
 * `NODE_EXTRA_CA_CERTS` only affects Node's TLS trust store if it's a real
 * env var *at process bootstrap* (confirmed experimentally: writing
 * `process.env.NODE_EXTRA_CA_CERTS` from inside an already-running process
 * does NOT retroactively affect the global `fetch()` in that same process —
 * it still throws "self-signed certificate"). That mechanism is used
 * correctly elsewhere in this spec for freshly *spawned* child processes
 * (the CLI, the Electron app), which read env at their own bootstrap. For
 * calls made directly from this already-running test process, there's no
 * equivalent "add a CA" knob available post-bootstrap, so temporarily
 * disable certificate verification instead — scoped tightly (only around
 * calls that talk exclusively to our own throwaway local proxy) and always
 * restored, so it can't leak into the CLI/app child processes below.
 */
async function withInsecureTls<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
  }
}

// A booted website server + a live Electron app is heavier than a unit test;
// give the whole flow generous room (build is cached after the first run).
const TEST_TIMEOUT_MS = 120_000;

type Fixtures = {
  workDir: string;
  site: WebsiteServer;
};

const test = base.extend<Fixtures>({
  workDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-e2e-publish-'));
    await use(dir);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  },

  site: async ({ workDir }, use) => {
    const server = await startWebsiteServer(join(workDir, 'site'));
    try {
      await use(server);
    } finally {
      await server.close();
    }
  },
});

test.describe('marketplace publish E2E — publish via API, install via the real app', () => {
  test.setTimeout(TEST_TIMEOUT_MS);

  test('login → mint token → publish → serve → install', async ({ workDir, site }) => {
    // === Step 2: mock GitHub OAuth login → session cookie → minted token ===
    // (all direct fetch() calls from this process; see withInsecureTls above
    // for why TLS verification is relaxed rather than using NODE_EXTRA_CA_CERTS
    // here)
    const { sessionCookie, token } = await withInsecureTls(async () => {
      const loginRes = await fetch(`${site.baseUrl}/api/auth/github/login/`, { redirect: 'manual' });
      expect(loginRes.status).toBe(302);
      const authorizeUrl = loginRes.headers.get('location');
      expect(authorizeUrl).toBeTruthy();
      const state = new URL(authorizeUrl!).searchParams.get('state');
      expect(state).toBeTruthy();

      const oauthStateCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];
      expect(oauthStateCookie).toContain('oauth_state=');

      const callbackUrl = `${site.baseUrl}/api/auth/github/callback/?code=${encodeURIComponent(
        'mock:e2e-publisher:9001'
      )}&state=${encodeURIComponent(state!)}`;
      const callbackRes = await fetch(callbackUrl, {
        redirect: 'manual',
        headers: { cookie: oauthStateCookie },
      });
      expect(callbackRes.status).toBe(302);
      expect(callbackRes.headers.get('location')).toContain('/dashboard');

      const setCookies = callbackRes.headers.getSetCookie?.() ?? [callbackRes.headers.get('set-cookie') ?? ''];
      const sessionCookie = setCookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('zcc_session='));
      expect(sessionCookie).toBeTruthy();

      const mintRes = await fetch(`${site.baseUrl}/api/tokens/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: sessionCookie! },
        body: JSON.stringify({ name: 'e2e-publish-token' }),
      });
      expect(mintRes.status).toBe(201);
      const { token } = (await mintRes.json()) as { token: string };
      expect(token).toMatch(/^zpat_[0-9a-f]+$/);

      return { sessionCookie: sessionCookie!, token };
    });
    void sessionCookie;

    // === Step 3: run the REAL CLI against a freshly-built dummy extension dir ===
    const extensionDir = join(workDir, 'artifact', EXT_ID);
    writeDummyExtensionArtifact(extensionDir);

    const { stdout } = await execFileAsync(
      process.execPath,
      [PUBLISH_SCRIPT, extensionDir, '--api', site.baseUrl, '--token', token],
      { cwd: REPO_ROOT, env: { ...process.env, NODE_EXTRA_CA_CERTS: site.caCertPath } }
    );
    expect(stdout).toContain(`published ${EXT_ID} v`);
    const shaMatch = /sha256\s+→\s+([0-9a-f]+)/.exec(stdout);
    expect(shaMatch).toBeTruthy();
    const printedShaPrefix = shaMatch![1];

    const urlMatch = /url\s+→\s+(\S+)/.exec(stdout);
    expect(urlMatch).toBeTruthy();
    const releaseUrl = urlMatch![1];

    // === Step 4: assert the served feed lists it + archive bytes match sha256 ===
    await withInsecureTls(async () => {
      const indexRes = await fetch(`${site.baseUrl}/extensions/index.json`);
      expect(indexRes.status).toBe(200);
      const index = (await indexRes.json()) as { schema: number; releases: Array<Record<string, unknown>> };
      expect(index.schema).toBe(1);
      const release = index.releases.find((r) => r.id === EXT_ID);
      expect(release).toBeTruthy();
      expect(String(release!.sha256)).toContain(printedShaPrefix.replace('…', ''));

      const archiveRes = await fetch(String(release!.url));
      expect(archiveRes.status).toBe(200);
      const archiveBytes = Buffer.from(await archiveRes.arrayBuffer());
      const actualSha256 = createHash('sha256').update(archiveBytes).digest('hex');
      expect(actualSha256).toBe(release!.sha256);
      expect(releaseUrl).toBe(release!.url);
    });

    // === Step 5: point a throwaway ~/.zcc/extension-registry.json at the live
    // HTTPS feed and install through the REAL app UI ===
    const home = mkdtempSync(join(tmpdir(), 'zcc-e2e-publish-home-'));
    mkdirSync(join(home, '.zcc'), { recursive: true });
    writeRegistryConfig(home, {
      enabled: true,
      registryUrl: `${site.baseUrl}/extensions/index.json`,
      publicKey: site.publicKeyPem,
      requireSignature: true,
    });

    // SAFETY (same rationale as the `app` fixture in fixtures/app.ts): on
    // macOS the app resolves ~/.zcc via app.getPath('home'), which IGNORES the
    // sandboxed HOME above for ~/.zcc/config.json specifically. This spec
    // calls `launchApp` directly (bypassing that fixture, since it also wants
    // to boot its own website-backed registry instead of `registry.ts`'s), so
    // it must replicate the fixture's snapshot/restore protection itself —
    // otherwise a run on a macOS dev machine could clobber the developer's
    // real ~/.zcc/config.json.
    const realConfigPath = join(homedir(), '.zcc', 'config.json');
    const realConfigBefore = existsSync(realConfigPath) ? readFileSync(realConfigPath, 'utf8') : null;

    let app: AppHandle | undefined;
    try {
      app = await launchApp(home, { caCertPath: site.caCertPath });
      await dismissConsentOverlays(app.window);

      const market = new MarketplacePage(app.window);
      await market.open();

      await expect(market.row(EXT_TITLE)).toBeVisible({ timeout: 20_000 });
      // The row's action button briefly shows a disabled, ellipsis-suffixed
      // label ("Installing…"/"Updating…") while `listMarketplace()`'s
      // main-process round trip is in flight (see
      // src/renderer/components/settings/Marketplace.tsx's `rowAction()`).
      // Wait for that to resolve to the real "Install" state before clicking.
      await expect(market.rowButton(EXT_TITLE)).toBeEnabled({ timeout: 20_000 });
      await expect(market.rowButton(EXT_TITLE)).toHaveText(/Install/);

      await market.rowButton(EXT_TITLE).click();
      await expect(market.rowButton(EXT_TITLE)).toHaveText(/Installed/, { timeout: 30_000 });

      const list = await market.ipc<Array<{ id: string; enabled: boolean }>>('list');
      const installed = list.find((e) => e.id === EXT_ID);
      expect(installed).toBeTruthy();
      expect(installed!.enabled).toBe(true);
    } finally {
      if (app) await app.electron.close();
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      try {
        if (realConfigBefore !== null) {
          writeFileSync(realConfigPath, realConfigBefore);
        } else if (existsSync(realConfigPath)) {
          rmSync(realConfigPath, { force: true });
        }
      } catch {
        /* best-effort */
      }
    }

    // `workDir` (the `site` fixture's own scratch space) needs no further use
    // here — it's torn down by the `workDir`/`site` fixtures' own teardown.
    void workDir;
  });
});
