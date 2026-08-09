/**
 * Auto-update wiring around electron-updater's `autoUpdater`.
 *
 * Behavior (decided): NOTIFY-ONLY. We do NOT auto-download. Every ~30 min (and
 * once on boot) we ask the GHE release feed whether a newer version exists. If
 * one does, we surface it (`available`) and let the user decide:
 *   - "Install on restart" → download in the background; it applies on the next
 *     normal quit (`autoInstallOnAppQuit`), so a running terminal / scheduled
 *     agent is never interrupted mid-session.
 *   - "Download & restart now" → download, then `quitAndInstall` as soon as it's
 *     staged.
 *   - "Skip this version" → remember the version and stop offering it until a
 *     newer one ships.
 * Nothing is fetched until the user opts in.
 *
 * The periodic poll is owned here: armed once via `start()` and cleared in
 * `stop()` (CLAUDE.md #3 — long-lived timers are registered once at app init and
 * released on shutdown). A check already in flight is skipped, and periodic
 * (non-manual) checks swallow transient network/offline errors silently so an
 * off-VPN machine isn't toasted every 30 minutes — only a manual check surfaces
 * failures.
 *
 * macOS specifics: electron-updater uses Squirrel.Mac, which REQUIRES the app
 * to be code-signed and the new build to share the same signing identity as the
 * running one. We sign with a self-signed cert (see electron-builder.yml). An
 * unsigned dev/build can't auto-update — and electron-updater throws if asked to
 * in development — so every entry point here is guarded by `app.isPackaged` and
 * no-ops (reporting `disabled`) otherwise.
 *
 * Only core code can push to the renderer (app modules can't), so this lives in
 * the main process and emits via the injected `safeSend`, mirroring the
 * inbox/terminal push channels.
 */

import { app } from 'electron';
// electron-updater is CommonJS; default-import then destructure so it resolves
// under this package's ESM ("type": "module") build.
import electronUpdater from 'electron-updater';
import { IPC } from '../shared/ipc.js';
import type { UpdateProgress, UpdateStatus } from '../shared/types.js';

const { autoUpdater } = electronUpdater;

/** Default cadence for the background check: every 30 minutes. */
export const DEFAULT_UPDATE_POLL_MS = 30 * 60 * 1000;

/**
 * How long a single check may sit in `checking` before we give up and recover.
 * electron-updater's `checkForUpdates()` can hang indefinitely on a stalled
 * socket (DNS blackhole, captive portal, a proxy that never responds) WITHOUT
 * ever firing a terminal `update-available` / `update-not-available` / `error`
 * event — which leaves the UI's "Checking…" button disabled forever (the "it
 * froze, clicking does nothing" bug). The watchdog bounds every check so the UI
 * always returns to an actionable state.
 */
export const UPDATE_CHECK_TIMEOUT_MS = 20 * 1000;

export interface UpdaterDeps {
  /** Same core push used by terminals/inbox; no-ops if the window is gone. */
  safeSend: (channel: string, ...args: unknown[]) => void;
  log: (context: string, err: unknown) => void;
  /** Version the user chose to skip, if any (persisted in AppConfig). */
  getSkippedVersion: () => string | undefined;
  /** Persist the skipped version (AppConfig). */
  setSkippedVersion: (version: string) => void;
  /** Poll cadence; defaults to {@link DEFAULT_UPDATE_POLL_MS}. */
  pollIntervalMs?: number;
  /**
   * How long a single check may hang before the watchdog recovers the UI;
   * defaults to {@link UPDATE_CHECK_TIMEOUT_MS}. Overridable for tests.
   */
  checkTimeoutMs?: number;
  /**
   * Optional hook to supply per-request auth headers for the feed + artifact
   * fetches (electron-updater is an anonymous HTTP client — it does NOT inherit
   * the user's browser/SSO login, so a PRIVATE release host returns a login
   * page unless we attach a credential). Resolved fresh before every check /
   * download and assigned to `autoUpdater.requestHeaders`; return `undefined`
     * (or throw) to fetch unauthenticated. This is a deliberately generic seam
     * for deployments that host private release feeds.
   */
  resolveRequestHeaders?: () => Promise<Record<string, string> | undefined>;
  /**
   * Arm the QA/dev {@link Updater.simulate} affordance. When false/absent,
   * `simulate()` is a no-op that throws — a normal user (or a compromised
   * renderer) can't drive a fake "restart now". Wired from the
   * `enableUpdateSimulation` AppConfig flag in `index.ts`, re-checked in the IPC
   * handler too (Rule 1 — main authorizes). Simulation NEVER touches
   * electron-updater, the network, or `quitAndInstall`.
   */
  allowSimulation?: boolean;
}

export interface Updater {
  /**
   * Check the feed for a newer version. `manual` (default true) controls error
   * loudness: a manual check surfaces failures as `error`; a background poll
   * stays quiet so offline/off-VPN machines aren't toasted on every tick.
   */
  checkForUpdates(opts?: { manual?: boolean }): Promise<void>;
  /**
   * Start downloading the available update. `installNow` relaunches into it as
   * soon as it's staged; otherwise it applies on the next normal quit.
   */
  downloadUpdate(opts?: { installNow?: boolean }): Promise<void>;
  /** Remember this version as skipped; stop offering it until a newer one ships. */
  skipVersion(version: string): void;
  /** Relaunch into a downloaded update now. No-op if nothing is staged. */
  quitAndInstall(): void;
  /**
   * QA/dev only: walk the FULL available → downloading → downloaded status flow
   * through the same `emitStatus`/`onProgress` pipeline the renderer consumes,
   * without contacting the feed, downloading a byte, or ever installing/quitting
   * (the subsequent `quitAndInstall` stays a real no-op — nothing is staged).
   * Gated by {@link UpdaterDeps.allowSimulation}: rejects when not armed, and
   * validates `version` to a semver-ish token. Lets QA exercise the banner + the
   * About card end-to-end in a packaged build with no real release published.
   */
  simulate(version: string): Promise<void>;
  /**
   * The most recent status emitted. Lets a renderer that subscribes AFTER the
   * boot check pull the current state instead of missing the one-shot push
   * (the boot `available` fires before the window's listener is attached).
   */
  getStatus(): UpdateStatus;
  /** Arm the periodic background poll. Idempotent. No-op in dev. */
  start(): void;
  /** Clear the periodic poll. Safe to call multiple times. */
  stop(): void;
}

/**
 * Turn electron-updater's raw failure into a message a human can act on. The
 * common one in practice: the feed request returns an HTML page (a 404 / login
 * / VPN-gateway page on the GHE host) instead of `latest-mac.yml`, and the sax
 * parser chokes with a cryptic, coordinate-tagged message like "Unexpected
 * close tag Line: N Column: M Char: >" or "Attribute without value Line: N
 * Column: M Char: >". That almost always means "no published Release for this
 * version yet, or the feed host is unreachable" — say THAT, not the parser's
 * internals.
 */
export function friendlyUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // XML/HTML leaked into the YAML parser → the feed isn't a real release feed.
  // The sax parser tags every failure with a "Line: N Column: M Char:"
  // coordinate suffix, which is the most reliable tell across its many phrasings
  // (unexpected close tag, attribute without value, unquoted attribute, …) — match
  // that, plus the obvious HTML/YAML-shape signals.
  if (
    /line:\s*\d+\s*column:\s*\d+\s*char:|unexpected close tag|attribute without value|<\s*\/?\s*html|non-whitespace before first tag|unexpected end|invalid.*yaml/i.test(
      raw
    )
  ) {
    return 'No published release found, or the update feed is unreachable (check your network / VPN). Nothing to update right now.';
  }
  // electron-updater's own "no release / 404" phrasings.
  if (/404|not found|cannot find.*latest|no published versions|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(raw)) {
    return 'Couldn’t reach the update feed (no published release yet, or you’re offline / off-VPN).';
  }
  return raw;
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const { safeSend, log } = deps;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_UPDATE_POLL_MS;
  const checkTimeoutMs = deps.checkTimeoutMs ?? UPDATE_CHECK_TIMEOUT_MS;

  // Refresh auth headers on the anonymous updater client before a feed/artifact
  // fetch. Best-effort: a failed/absent resolver just fetches unauthenticated
  // (and a private feed then surfaces via friendlyUpdateError). Never throws.
  const applyRequestHeaders = async (): Promise<void> => {
    if (!deps.resolveRequestHeaders) return;
    try {
      const headers = await deps.resolveRequestHeaders();
      // Only set when we actually have a credential; assigning `{}`/undefined
      // would clobber any headers electron-updater set for a `generic` feed.
      if (headers && Object.keys(headers).length > 0) {
        autoUpdater.requestHeaders = headers;
      }
    } catch (err) {
      log('updater.resolveRequestHeaders', err);
    }
  };

  // Dedupe identical status pushes: with a 30-min poll re-finding the same
  // version, we'd otherwise re-emit `available` forever and the renderer would
  // re-toast each time. Suppress byte-identical repeats.
  //
  // `lastStatus` is ALSO the source for `getStatus()`: a renderer that mounts
  // after the boot check ran (the common case — the boot `available` fires
  // before the window's onStatus listener is attached) pulls this on subscribe
  // instead of missing the one-shot push. So track the object, not just its
  // JSON, and keep it updated even on a deduped repeat.
  let lastStatusJson = '';
  let lastStatus: UpdateStatus = { kind: 'idle' };
  // Watchdog that bounds how long a check may sit in `checking` (see
  // UPDATE_CHECK_TIMEOUT_MS). Armed when a check starts; cleared as soon as ANY
  // non-`checking` status is emitted (the check resolved one way or another).
  let checkWatchdog: ReturnType<typeof setTimeout> | null = null;
  const clearCheckWatchdog = () => {
    if (checkWatchdog) {
      clearTimeout(checkWatchdog);
      checkWatchdog = null;
    }
  };
  const emitStatus = (status: UpdateStatus) => {
    // Any resolved (non-checking) status means the in-flight check settled —
    // stop the watchdog so it can't fire a spurious timeout afterward.
    if (status.kind !== 'checking') clearCheckWatchdog();
    lastStatus = status;
    const json = JSON.stringify(status);
    if (json === lastStatusJson) return;
    lastStatusJson = json;
    safeSend(IPC.updates.onStatus, status);
  };
  const getStatus = (): UpdateStatus => lastStatus;

  // Target version, captured on `update-available` so the `downloading` status
  // can report it (autoUpdater.currentVersion is the *installed* version, not
  // the one being fetched).
  let pendingVersion: string | undefined;

  // In dev (or any unpackaged run) electron-updater can't function and throws
  // if invoked. Return a no-op updater that reports `disabled` so the UI can
  // show "not available in dev" instead of an error.
  //
  // Dev/demo escape hatch: `ZCC_FAKE_UPDATE=9.9.9 npm start` makes the shim
  // emit a real `available` status (then walk through downloading → downloaded
  // on download) so the update BANNER/About UI is exercisable in dev without a
  // packaged, signed build. Nothing is actually fetched or installed — a normal
  // dev run (no env var) still reports `disabled`.
  if (!app.isPackaged) {
    const fake = process.env.ZCC_FAKE_UPDATE?.trim();
    if (fake) {
      const version = fake.replace(/^v/i, '');
      return {
        async checkForUpdates() {
          emitStatus({ kind: 'available', version });
        },
        async downloadUpdate({ installNow = false }: { installNow?: boolean } = {}) {
          // Simulate a download (no network): step the progress over ~1.5s so the
          // `downloading` banner state + progress bar are actually observable,
          // then stage it. A real download is many seconds; this is just enough
          // to exercise the UI.
          emitStatus({ kind: 'downloading', version });
          for (const percent of [15, 45, 80, 100]) {
            await new Promise((r) => setTimeout(r, 350));
            safeSend(IPC.updates.onProgress, {
              percent,
              transferred: percent,
              total: 100,
              bytesPerSecond: 1_000_000
            });
            emitStatus({ kind: 'downloading', version });
          }
          emitStatus({ kind: 'downloaded', version });
          if (installNow) log('updater(dev-fake)', 'quitAndInstall suppressed in dev');
        },
        skipVersion(v: string) {
          deps.setSkippedVersion(v);
          emitStatus({ kind: 'not-available' });
        },
        quitAndInstall() {
          log('updater(dev-fake)', 'quitAndInstall is a no-op in dev');
        },
        async simulate() {
          // The dev-fake shim already IS a simulation (its checkForUpdates emits
          // `available`); a second entry point would just double up.
          log('updater(dev-fake)', 'simulate: already in dev-fake mode; use checkForUpdates');
        },
        getStatus,
        start() {
          /* no periodic poll for the dev fake */
        },
        stop() {
          /* no-op */
        }
      };
    }
    return {
      async checkForUpdates() {
        emitStatus({ kind: 'disabled' });
      },
      async downloadUpdate() {
        /* no-op in dev */
      },
      skipVersion() {
        /* no-op in dev */
      },
      quitAndInstall() {
        /* no-op in dev */
      },
      async simulate() {
        // In a plain dev run electron-updater is disabled; point QA at the
        // `ZCC_FAKE_UPDATE` env shim, which drives the same flow.
        log('updater(dev)', 'simulate: unavailable in dev — set ZCC_FAKE_UPDATE to demo');
      },
      getStatus,
      start() {
        /* no-op in dev */
      },
      stop() {
        /* no-op in dev */
      }
    };
  }

  // Feed host is config, not code: the `publish` block in electron-builder.yml
  // defaults to the public github.com release repo (grebmann1/zcc-releases), so
  // electron-updater's built-in `GitHubProvider` works anonymously with no token
  // or VPN. When `ZCC_UPDATE_FEED_URL` is set, point the updater at that static
  // HTTPS base via electron-updater's `generic` provider instead — it reads
  // `latest-mac.yml` + artifacts from any plain object store / CDN, with NO
  // GitHub dependency. This is the escape hatch for non-GitHub release hosting
  // (a private S3 bucket, a CDN mirror, etc.). Unset → the baked-in public
  // GitHub publish config is used unchanged.
  const feedUrl = process.env.ZCC_UPDATE_FEED_URL?.trim();
  if (feedUrl) {
    if (!/^https:\/\//i.test(feedUrl)) {
      // Fail loud at wiring time rather than silently falling back to the
      // baked-in feed — a misconfigured (non-HTTPS) base is a deploy bug.
      log('updater.setFeedURL', new Error(`ZCC_UPDATE_FEED_URL must be HTTPS: ${feedUrl}`));
    } else {
      try {
        autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
      } catch (err) {
        log('updater.setFeedURL', err);
      }
    }
  }

  // Notify-only: never fetch a byte until the user opts in. Keep
  // install-on-quit for the downloaded artifact (the "install on restart"
  // choice relies on it).
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m: unknown) => console.log(`[updater] ${String(m)}`),
    warn: (m: unknown) => console.warn(`[updater] ${String(m)}`),
    error: (m: unknown) => log('autoUpdater', m),
    debug: () => {}
  };

  // Whether the most recent check was user-initiated — gates whether the
  // `error` event surfaces to the UI (manual: yes; background poll: stay quiet).
  let lastCheckManual = true;
  // Prevent overlapping checks (the boot check, a manual click, and a poll tick
  // could otherwise collide).
  let checkInFlight = false;
  // Set by downloadUpdate({ installNow: true }): relaunch as soon as the
  // artifact is staged rather than waiting for the next quit.
  let installWhenDownloaded = false;
  // True once an artifact is fully staged on disk (`update-downloaded`). Gates
  // the manual quitAndInstall so it honors its "no-op if nothing is staged"
  // contract even if the IPC is called out of the normal (button-gated) flow.
  let updateStaged = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  autoUpdater.on('checking-for-update', () => emitStatus({ kind: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    pendingVersion = info?.version;
    // Honor a skipped version: the user already declined it, so don't re-offer
    // until something newer ships.
    if (pendingVersion && pendingVersion === deps.getSkippedVersion()) {
      emitStatus({ kind: 'not-available' });
      return;
    }
    emitStatus({ kind: 'available', version: pendingVersion });
  });
  autoUpdater.on('update-not-available', () => {
    // No newer release: drop the captured target so a later stray
    // `download-progress` can't report a stale version.
    pendingVersion = undefined;
    emitStatus({ kind: 'not-available' });
  });
  autoUpdater.on('download-progress', (p) => {
    const progress: UpdateProgress = {
      percent: p?.percent ?? 0,
      transferred: p?.transferred ?? 0,
      total: p?.total ?? 0,
      bytesPerSecond: p?.bytesPerSecond ?? 0
    };
    safeSend(IPC.updates.onProgress, progress);
    emitStatus({ kind: 'downloading', version: pendingVersion });
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateStaged = true;
    emitStatus({ kind: 'downloaded', version: info?.version ?? pendingVersion });
    if (installWhenDownloaded) {
      installWhenDownloaded = false;
      // `isSilent=false`, `isForceRunAfter=true`: show the installer's normal
      // progress and relaunch the app afterward.
      autoUpdater.quitAndInstall(false, true);
    }
  });
  autoUpdater.on('error', (err) => {
    log('autoUpdater.error', err);
    // Stay quiet on background polls so an offline / off-VPN machine isn't
    // toasted on every tick; only a manual check surfaces the failure.
    if (lastCheckManual) {
      emitStatus({ kind: 'error', message: friendlyUpdateError(err) });
    }
  });

  async function checkForUpdates({ manual = true }: { manual?: boolean } = {}): Promise<void> {
    if (checkInFlight) return;
    checkInFlight = true;
    lastCheckManual = manual;
    // Bound the check: if no terminal event lands within checkTimeoutMs, recover
    // the UI so its "Checking…" button doesn't stay disabled forever. A late
    // event that arrives after the timeout still updates the status normally.
    clearCheckWatchdog();
    checkWatchdog = setTimeout(() => {
      checkWatchdog = null;
      checkInFlight = false;
      log('checkForUpdates', new Error(`update check timed out after ${checkTimeoutMs}ms`));
      if (manual) {
        emitStatus({
          kind: 'error',
          message: 'The update check timed out — check your network / VPN and try again.'
        });
      } else {
        // A silent background poll that stalled: fall back to a neutral state so
        // the UI isn't wedged on "Checking…" until the next tick.
        emitStatus({ kind: 'idle' });
      }
    }, checkTimeoutMs);
    try {
      await applyRequestHeaders();
      await autoUpdater.checkForUpdates();
    } catch (err) {
      // checkForUpdates can reject (offline, no release yet); the 'error' event
      // usually fires too, but guard so a check never rejects into the
      // unhandledRejection path. Loudness mirrors the event handler.
      clearCheckWatchdog();
      log('checkForUpdates', err);
      if (manual) {
        emitStatus({ kind: 'error', message: friendlyUpdateError(err) });
      }
    } finally {
      checkInFlight = false;
    }
  }

  return {
    checkForUpdates,
    async downloadUpdate({ installNow = false }: { installNow?: boolean } = {}) {
      installWhenDownloaded = installNow;
      try {
        await applyRequestHeaders();
        await autoUpdater.downloadUpdate();
      } catch (err) {
        // Clear the install-on-download intent: this attempt failed, so a later
        // `update-downloaded` (e.g. electron-updater completing a previously
        // queued artifact on the next check) must NOT relaunch mid-session on a
        // stale flag. A fresh downloadUpdate() call re-arms it explicitly.
        installWhenDownloaded = false;
        log('downloadUpdate', err);
        emitStatus({ kind: 'error', message: friendlyUpdateError(err) });
      }
    },
    skipVersion(version: string) {
      deps.setSkippedVersion(version);
      // Clear the offer; the next check that finds something newer will re-offer.
      emitStatus({ kind: 'not-available' });
    },
    quitAndInstall() {
      // No-op unless an artifact is actually staged — electron-updater throws /
      // quits-without-installing otherwise. The renderer only shows the button
      // on `downloaded`, but the IPC is callable in any state, so guard here.
      if (!updateStaged) return;
      autoUpdater.quitAndInstall(false, true);
    },
    async simulate(version: string) {
      // Gate: only when explicitly armed (Rule 1 — the IPC handler re-checks the
      // config flag too). Refuse rather than silently no-op so a mis-wired call
      // surfaces in the log.
      if (!deps.allowSimulation) {
        throw new Error('update simulation is not enabled');
      }
      // Validate the version to the same semver-ish token skipVersion accepts —
      // it lands in a renderer-visible status and (via the index.ts tap) an inbox
      // entry, so bound it.
      const v = typeof version === 'string' ? version.replace(/^v/i, '') : '';
      if (!v || v.length > 64 || !/^[\w.+-]+$/.test(v)) {
        throw new Error(`invalid simulate version: ${String(version)}`);
      }
      // Never touch electron-updater: drive the SAME status pipeline the real
      // events use. Deliberately skip the `checking` state so the watchdog isn't
      // armed (it only fires against an in-flight real check), and leave
      // `updateStaged` false so the follow-on quitAndInstall stays a true no-op —
      // nothing is installed. Honor a skipped version exactly like the real
      // `update-available` path so QA can exercise "skip".
      if (v === deps.getSkippedVersion()) {
        emitStatus({ kind: 'not-available' });
        return;
      }
      pendingVersion = v;
      emitStatus({ kind: 'available', version: v });
      await new Promise((r) => setTimeout(r, 500));
      emitStatus({ kind: 'downloading', version: v });
      for (const percent of [15, 45, 80, 100]) {
        await new Promise((r) => setTimeout(r, 350));
        safeSend(IPC.updates.onProgress, {
          percent,
          transferred: percent,
          total: 100,
          bytesPerSecond: 1_000_000
        });
        emitStatus({ kind: 'downloading', version: v });
      }
      emitStatus({ kind: 'downloaded', version: v });
      log('updater.simulate', `walked fake update flow for v${v} (nothing installed)`);
    },
    getStatus,
    start() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        void checkForUpdates({ manual: false });
      }, pollIntervalMs);
    },
    stop() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      clearCheckWatchdog();
    }
  };
}
