/**
 * The reusable E2E backbone: a Playwright `test` extended with an isolated,
 * booted Electron app (and an optional local HTTPS marketplace). Every future
 * spec imports `test`/`expect` from here.
 *
 * Isolation model (why the suite never touches your real machine state):
 *   - HOME is a throwaway tmp dir, so every `~/.zcc/*` path the app resolves
 *     (extensions, registry config, inbox, personas, …) lands in the sandbox.
 *   - ZCC_DATA_DIR is pinned under that HOME so host-daemon enroll/lock does
 *     not collide with a live developer daemon on `~/.zcc`.
 *   - `--user-data-dir` is a throwaway dir so a running Zana instance cannot
 *     steal Electron's single-instance lock and leave Playwright without a window.
 *   - ZCC_EXTENSIONS_DIR is pinned under that HOME for belt-and-suspenders.
 *   - The app runs against the BUILT bundle (out/main/index.js) — the same code
 *     a packaged build runs, minus code-signing.
 *
 * Opting a test into the marketplace channel: `test.use({ useRegistry: true })`.
 * That boots a signed HTTPS registry (see registry.ts), writes the matching
 * `~/.zcc/extension-registry.json` BEFORE launch (the app reads config at boot),
 * and launches the app trusting the registry's self-signed CA.
 */
import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page,
  expect,
} from '@playwright/test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  copyFileSync,
  cpSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startLocalRegistry, type LocalRegistry, type DummyExtensionSpec } from './registry.js';
import { EventRecorder } from '../sdk/events.js';
import { linuxCiElectronArgs, linuxCiElectronEnv } from './linux-electron-launch.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MAIN_ENTRY = join(REPO_ROOT, 'out/main/index.js');
const PACKAGE_VERSION = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version as string;

/** This repo's Electron binary — ABI-matched to node-pty / better-sqlite3. */
function projectElectronBinary(): string {
  return createRequire(import.meta.url)('electron') as string;
}

export interface RegistryConfig {
  enabled: boolean;
  registryUrl: string;
  publicKey?: string;
  requireSignature?: boolean;
}

/** Write `~/.zcc/extension-registry.json` inside a sandbox HOME. */
export function writeRegistryConfig(home: string, cfg: RegistryConfig): void {
  const dir = join(home, '.zcc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'extension-registry.json'), JSON.stringify(cfg, null, 2));
}

/** Seed first-run state that is not part of the UI behavior under test. */
function writeAppConfig(home: string, initialConfig: Record<string, unknown> = {}): void {
  const dir = join(home, '.zcc');
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, 'config.json');
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      JSON.stringify({ walkthroughCompleted: true, setupDismissed: true, ...initialConfig }, null, 2)
    );
  }
}

/**
 * Seed a sandbox HOME with the developer's REAL `claude` auth/onboarding state so
 * a launched `claude` agent can actually run a turn — needed ONLY by the opt-in
 * AI specs (`test.use({ seedClaudeAuth: true })`), never the deterministic ones.
 *
 * The sandbox HOME (which isolates `~/.zcc`) is exactly what breaks a real agent:
 * `claude` reads its onboarding + settings from HOME, so under a throwaway HOME it
 * has `hasCompletedOnboarding: null` (→ onboarding prompt, never runs the prompt)
 * and no `apiKeyHelper`/gateway `env` (→ unauthenticated). This copies the three
 * HOME-rooted artifacts the CLI needs:
 *   - `~/.claude.json`   — onboarding flag + userID
 *   - `~/.claude/`       — settings.json (apiKeyHelper + ANTHROPIC_* gateway env)
 *   - `~/.devbar` (symlink) — the apiKeyHelper's daemon socket lives here and its
 *     path is HOME-relative, so rewriting HOME would break auth without it.
 *
 * Returns true if it seeded a usable state, false if the source artifacts are
 * absent (so the spec can skip cleanly on a machine without a logged-in claude).
 * Best-effort per-artifact: a missing optional piece never throws.
 */
export function seedClaudeAuthState(home: string): boolean {
  const realHome = homedir();
  const srcJson = join(realHome, '.claude.json');
  const srcDir = join(realHome, '.claude');
  // Onboarding flag is the load-bearing gate; without it the CLI won't run headless.
  if (!existsSync(srcJson)) return false;
  try {
    copyFileSync(srcJson, join(home, '.claude.json'));
  } catch {
    return false;
  }
  if (existsSync(srcDir)) {
    try {
      cpSync(srcDir, join(home, '.claude'), { recursive: true });
    } catch {
      /* best-effort — settings may be partially copyable */
    }
  }
  // The apiKeyHelper resolves its daemon socket under $HOME/.devbar; symlink the
  // real one so the rewritten HOME still reaches the live auth daemon.
  const srcDevbar = join(realHome, '.devbar');
  if (existsSync(srcDevbar)) {
    try {
      symlinkSync(srcDevbar, join(home, '.devbar'));
    } catch {
      /* best-effort — absent on machines not using the devbar auth helper */
    }
  }
  return true;
}

/**
 * Pre-accept claude's per-folder "Is this a project you trust?" dialog for `dir`
 * by writing `projects[dir].hasTrustDialogAccepted = true` into the sandbox
 * HOME's `~/.claude.json`. A brand-new tmp project dir is untrusted, so a real
 * `claude` agent otherwise blocks on that dialog forever (waiting for an Enter
 * that a headless run never sends) and never reaches the prompt.
 *
 * Call AFTER {@link seedClaudeAuthState} (which creates the file) and BEFORE
 * spawning the agent — claude reads `~/.claude.json` at spawn, and the PTY child
 * inherits the sandbox HOME. Best-effort: never throws.
 */
export function trustProjectInSandbox(home: string, dir: string): void {
  const jsonPath = join(home, '.claude.json');
  try {
    const raw = existsSync(jsonPath) ? readFileSync(jsonPath, 'utf8') : '{}';
    const parsed = JSON.parse(raw) as { projects?: Record<string, unknown> };
    parsed.projects = parsed.projects ?? {};
    const existing = (parsed.projects[dir] as Record<string, unknown>) ?? {};
    parsed.projects[dir] = { ...existing, hasTrustDialogAccepted: true };
    writeFileSync(jsonPath, JSON.stringify(parsed, null, 2));
  } catch {
    /* best-effort — a missing/corrupt file just means the dialog may appear */
  }
}

export interface AppHandle {
  electron: ElectronApplication;
  window: Page;
  home: string;
}

/** The app opens detached DevTools in dev mode; return the real renderer window. */
async function appWindow(app: ElectronApplication): Promise<Page> {
  await app.firstWindow({ timeout: 60_000 });
  for (let i = 0; i < 80; i++) {
    for (const w of app.windows()) {
      if (isAppRendererUrl(w.url())) return w;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('app renderer window never appeared');
}

/** Production uses the supervised loopback server; dev/repair keeps file URLs. */
export function isAppRendererUrl(url: string): boolean {
  return url.includes('index.html') || /^http:\/\/127\.0\.0\.1:\d+\//.test(url);
}

export interface LaunchOptions {
  caCertPath?: string;
  env?: Record<string, string>;
  /** Arm the gated test-observability tap (ZCC_E2E=1 → window.__zccTest). */
  e2e?: boolean;
  /** Config fields written before app boot for startup-path coverage. */
  initialConfig?: Record<string, unknown>;
}

/**
 * Launch the built app with an isolated HOME. Caller owns shutdown. Exported
 * (not just used internally by the `app` fixture) so a spec that needs a
 * custom boot sequence — e.g. `e2e/marketplace-publish-e2e.spec.ts` pointing
 * the registry config at a locally-run website server instead of the
 * `registry.ts` fixture's own throwaway registry — can drive the same launch
 * path without duplicating it.
 */
export async function launchApp(home: string, opts: LaunchOptions = {}): Promise<AppHandle> {
  writeAppConfig(home, opts.initialConfig);
  const preserveHome = opts.env?.ZCC_E2E_PRESERVE_HOME === '1';
  const dataDir = join(home, '.zcc');
  mkdirSync(dataDir, { recursive: true });
  const userDataDir = join(home, 'electron-user-data');
  mkdirSync(userDataDir, { recursive: true });
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: preserveHome ? homedir() : home,
    ZCC_E2E_HOME: home,
    ZCC_DATA_DIR: dataDir,
    ZCC_EXTENSIONS_DIR: join(home, '.zcc', 'extensions'),
    // Electron's unpackaged default is "0.0". The main process uses this only
    // in E2E so the smoke test observes the same version as package.json.
    ZCC_E2E_APP_VERSION: PACKAGE_VERSION,
    ...(opts.e2e ? { ZCC_E2E: '1' } : {}),
    ...opts.env,
    ...linuxCiElectronEnv(),
  };
  // A parent `electron-vite dev` / leftover diagnostic must not steal this
  // unpackaged E2E boot onto the live renderer or product server.
  if (!opts.env?.ELECTRON_RENDERER_URL) delete env.ELECTRON_RENDERER_URL;
  if (!opts.env?.ZCC_DESKTOP_APP_URL) delete env.ZCC_DESKTOP_APP_URL;
  if (!opts.env?.ZCC_SERVER_URL) delete env.ZCC_SERVER_URL;
  if (!opts.env?.ZCC_HOST_ENROLL_TOKEN) delete env.ZCC_HOST_ENROLL_TOKEN;
  if (opts.caCertPath) env.NODE_EXTRA_CA_CERTS = opts.caCertPath;

  const app = await electron.launch({
    // Without this, Playwright downloads its own Electron (log: "Downloading
    // Electron binary...") which will not load this repo's native addons.
    executablePath: projectElectronBinary(),
    args: [...linuxCiElectronArgs(), `--user-data-dir=${userDataDir}`, MAIN_ENTRY],
    env,
    timeout: 60_000
  });
  const stderrChunks: string[] = [];
  app.process()?.stderr?.on('data', (chunk: Buffer | string) => {
    stderrChunks.push(String(chunk));
  });
  try {
    const window = await appWindow(app);
    await window.waitForSelector('#root', { timeout: 30_000 });
    await dismissConsentOverlays(window);
    return { electron: app, window, home };
  } catch (err) {
    const stderr = stderrChunks.join('').trim();
    if (!stderr) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}\n\nmain stderr:\n${stderr}`);
  }
}

/**
 * On a fresh boot the app seeds its bundled extensions (docs), each
 * of which declares permissions and raises a first-run consent overlay that
 * intercepts pointer events. Tests aren't about that flow, so dismiss every
 * pending overlay (the overlay shows one un-consented extension at a time).
 * Idempotent: returns once no overlay is visible.
 */
export async function dismissConsentOverlays(window: Page): Promise<void> {
  const overlay = window.locator('.consent-overlay');
  for (let i = 0; i < 10; i++) {
    try {
      await overlay.waitFor({ state: 'visible', timeout: 2_000 });
    } catch {
      return; // none (left) visible
    }
    // "Dismiss" (the non-primary action) leaves the extension unconsented but
    // clears the modal — exactly the neutral state a marketplace test wants.
    await overlay.locator('button.btn:not(.primary)').first().click();
    await window.waitForTimeout(200);
  }
}

type Fixtures = {
  /** Throwaway HOME for the test (auto-removed). */
  home: string;
  /** Opt the marketplace channel ON (boots a signed HTTPS registry). */
  useRegistry: boolean;
  /**
   * Hide first-party bundled plugins from Browse so remote-registry specs can
   * assert exact row counts. Default off — production Browse is non-empty.
   */
  isolateBundledCatalog: boolean;
  /** When useRegistry, reject unsigned releases (default true). */
  requireSignature: boolean;
  /** Customize the published dummy extension. */
  dummySpec: DummyExtensionSpec;
  /** Opt the gated test-observability tap ON (ZCC_E2E=1 → window.__zccTest). */
  e2e: boolean;
  /** Additional process env for focused boot-path specs. */
  launchEnv: Record<string, string>;
  /** Config fields written before Electron starts. */
  initialConfig: Record<string, unknown>;
  /**
   * Seed the sandbox HOME with the developer's real `claude` auth/onboarding
   * state so a launched real agent can run a turn. Opt-in — only the AI specs
   * that spawn a real model need it. See {@link seedClaudeAuthState}.
   */
  seedClaudeAuth: boolean;
  /** The booted registry (null unless useRegistry). */
  registry: LocalRegistry | null;
  /** A freshly booted, isolated Electron app. */
  app: AppHandle;
  /** Live event/log recorder. Requires `test.use({ e2e: true })`. */
  events: EventRecorder;
};

export const test = base.extend<Fixtures>({
  useRegistry: [false, { option: true }],
  isolateBundledCatalog: [false, { option: true }],
  requireSignature: [true, { option: true }],
  dummySpec: [{}, { option: true }],
  e2e: [false, { option: true }],
  launchEnv: [{}, { option: true }],
  initialConfig: [{}, { option: true }],
  seedClaudeAuth: [false, { option: true }],

  home: async ({}, use) => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-e2e-home-'));
    await use(home);
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  },

  registry: async ({ useRegistry, home, dummySpec }, use) => {
    if (!useRegistry) {
      await use(null);
      return;
    }
    const reg = await startLocalRegistry(join(home, '.registry-work'), dummySpec);
    try {
      await use(reg);
    } finally {
      await reg.close();
    }
  },

  app: async ({ home, registry, requireSignature, e2e, launchEnv, initialConfig, seedClaudeAuth, isolateBundledCatalog }, use) => {
    if (registry) {
      writeRegistryConfig(home, {
        enabled: true,
        registryUrl: registry.indexUrl,
        publicKey: registry.publicKeyPem,
        requireSignature,
      });
    }
    // AI specs need a real, authenticated `claude` — seed the sandbox HOME with
    // its onboarding/auth artifacts BEFORE launch (the CLI reads them at spawn).
    if (seedClaudeAuth) seedClaudeAuthState(home);
    // SAFETY: on macOS the app resolves ~/.zcc via app.getPath('home') and
    // IGNORES the sandbox HOME, so any test that calls `config.set(...)` writes
    // the DEVELOPER's real ~/.zcc/config.json. A spec pointing `claudeBinary` at
    // a throwaway stub (see agent-status-hydrate) would otherwise leave the real
    // config pointing at a deleted temp file — silently breaking real agent
    // launches after the suite runs. Snapshot the real config here and restore
    // it verbatim on teardown so no spec can leak into it. Belt-and-suspenders:
    // the sandbox HOME already isolates ~/.zcc on Linux/CI.
    const realConfigPath = join(homedir(), '.zcc', 'config.json');
    const realConfigBefore = existsSync(realConfigPath)
      ? readFileSync(realConfigPath, 'utf8')
      : null;

    // Electron on macOS resolves config through app.getPath('home'), not the
    // sandbox HOME. Seed its real path before boot, then restore it in teardown.
    if (process.platform === 'darwin' && Object.keys(initialConfig).length > 0) {
      const current = realConfigBefore === null ? {} : JSON.parse(realConfigBefore) as Record<string, unknown>;
      mkdirSync(join(homedir(), '.zcc'), { recursive: true });
      writeFileSync(realConfigPath, JSON.stringify({ ...current, ...initialConfig }, null, 2));
    }

    const env: Record<string, string> = { ...launchEnv };
    if (isolateBundledCatalog) {
      const empty = join(home, 'empty-bundled-catalog');
      mkdirSync(empty, { recursive: true });
      env.ZCC_BUNDLED_PLUGINS_DIR = empty;
      env.ZCC_BUNDLED_EXTENSIONS_DIR = empty;
    }

    const handle = await launchApp(home, {
      caCertPath: registry?.caCertPath,
      e2e,
      env,
      initialConfig
    });
    try {
      await use(handle);
    } finally {
      // Bounded shutdown: a graceful `electron.close()` can hang if a live PTY
      // child (e.g. a wedged real agent in the AI spec) blocks the app's exit.
      // Race the graceful close against a deadline and force-kill the process if
      // it overruns, so a stuck agent can never eat the whole test timeout in
      // teardown. Deterministic specs close well within the deadline.
      let closed = false;
      await Promise.race([
        handle.electron.close().then(() => { closed = true; }).catch(() => { closed = true; }),
        new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
      ]);
      if (!closed) {
        try {
          handle.electron.process()?.kill('SIGKILL');
        } catch {
          /* already exited */
        }
      }
      // Restore the developer's real config exactly as it was (or remove a file
      // the suite created where none existed).
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
  },

  events: async ({ app, e2e }, use) => {
    const recorder = new EventRecorder(app.window);
    if (e2e) await recorder.assertAvailable();
    await use(recorder);
  },
});

export { expect };
