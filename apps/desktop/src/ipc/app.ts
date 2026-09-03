// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { productServerUrl } from '../window/renderer-url.js';
import { microVmPlatformSupported } from '@zana-ai/zcc-host-daemon/harness/microvm-environment';
import { getReleaseNotes } from '../release-notes.js';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import { arch, homedir, release } from 'node:os';
import { electronZccDataDir } from '@zana-ai/zcc-server/electron-data-dir';
import {
  boundCrashText,
  crashIssueMarkdown,
  CRASH_REPORT_FIELD_MAX,
  type ReleaseNote,
  type Result,
  type ScheduledTask,
  type SetupStatus,
  type UpdateStatus,
  type WhatsNewEvent
} from '@zana-ai/zcc-domain/product';
import { crashReportsDir, saveRendererCrashReport } from '../crash-report-store.js';

export function registerAppIpc(): void {
  
  ctx.safeHandle(IPC.app.homedir, () => homedir(), () => '');
  ctx.safeHandle(IPC.app.version, () => ctx.runtimeSupervisor?.appVersion() ?? ctx.resolvedAppVersion(), () => '');
  ctx.safeHandle(
    IPC.app.saveCrashReport,
    async (input: { message?: unknown; stack?: unknown; componentStack?: unknown } | null) => {
      const raw = input && typeof input === 'object' ? input : {};
      const payload = {
        message: boundCrashText(raw.message, CRASH_REPORT_FIELD_MAX),
        stack: boundCrashText(raw.stack, CRASH_REPORT_FIELD_MAX),
        componentStack: boundCrashText(raw.componentStack, CRASH_REPORT_FIELD_MAX)
      };
      const version = String(
        await (ctx.runtimeSupervisor?.appVersion() ?? ctx.resolvedAppVersion() ?? '')
      );
      const osLabel = `${process.platform} ${release()} ${arch()}`;
      const dataDir = electronZccDataDir();
      const { fileName } = await saveRendererCrashReport({
        dir: crashReportsDir(dataDir),
        markdown: crashIssueMarkdown({ ...payload, version, osLabel })
      });
      return { ok: true, version, osLabel, fileName };
    },
    () => ({ ok: false })
  );
  ctx.safeHandle(IPC.app.microVmSupported, () => microVmPlatformSupported(), () => false);
  // Renderer-driven fullscreen targets its sender window, never whichever window
  // happened to gain focus before main handles the request.
  ctx.safeHandleFromWindow<[boolean], void>(
    IPC.app.setFullScreen,
    (win, flag: boolean) => {
      if (typeof flag !== 'boolean') throw new TypeError('fullscreen flag must be boolean');
      if (win.isFullScreen() === flag) return;
      const controller = ctx.boundsControllers.get(win.id);
      if (flag) controller?.beginFullscreenTransition();
      win.setFullScreen(flag);
    },
    () => {}
  );
  ctx.safeHandleFromWindow(
    IPC.app.isFullScreen,
    (win) => win.isFullScreen(),
    () => false
  );

  // Auto-update. `ctx.updater` is null until whenReady wires it; check/install
  // no-op gracefully before then and in dev (the ctx.updater shim reports
  // `disabled`).
  ctx.safeHandle(
    IPC.updates.check,
    async () => {
      await ctx.updater?.checkForUpdates({ manual: true });
    },
    () => undefined
  );
  ctx.safeHandle(
    IPC.updates.download,
    async (opts?: { installNow?: boolean }) => {
      await ctx.updater?.downloadUpdate(opts);
    },
    () => undefined
  );
  ctx.safeHandle(
    IPC.updates.skip,
    (version: string) => {
      // Rule 1: the renderer is untrusted. This string is persisted into the
      // shared AppConfig, so bound it to a semver-ish token before it lands on
      // disk (a compromised renderer can't bloat config or persist junk).
      if (typeof version !== 'string' || version.length > 64 || !/^[\w.+-]+$/.test(version)) {
        return;
      }
      ctx.updater?.skipVersion(version);
    },
    () => undefined
  );
  ctx.safeHandle(
    IPC.updates.quitAndInstall,
    () => {
      // Defer so this `ipcMain.handle` can return. Calling quitAndInstall
      // synchronously inside invoke deadlocks the quit on Electron (the
      // renderer is still awaiting the round-trip, so "Restart now" is a
      // silent no-op).
      setImmediate(() => {
        ctx.updater?.quitAndInstall();
      });
    },
    () => undefined
  );
  // Dev/QA: drive a fake update flow. Rule 1 — the renderer is untrusted, so
  // re-check the config gate HERE (not just in the ctx.updater) before letting a
  // fake "available"/"downloaded" reach the UI + inbox tap. `version` is
  // re-validated inside ctx.updater.simulate; a disabled gate makes this a no-op.
  ctx.safeHandle(
    IPC.updates.simulate,
    async (version: string) => {
      if (!store.getConfig().enableUpdateSimulation) return;
      await ctx.updater?.simulate(version);
    },
    () => undefined
  );
  // Pull the current status: a renderer that mounts after the boot check ran
  // (the boot `available` push fires before the window's onStatus listener is
  // attached) seeds its store from this instead of missing the one-shot event.
  ctx.safeHandle(
    IPC.updates.getStatus,
    (): UpdateStatus => ctx.updater?.getStatus() ?? { kind: 'idle' },
    () => ({ kind: 'idle' })
  );
  // Curated in-app release notes for the "What's New" modal. Args are advisory
  // hints — `getReleaseNotes` clamps to the versions that actually ship on disk
  // (Rule 1), and degrades to an empty array on any read/parse failure so the
  // modal simply shows nothing rather than erroring.
  ctx.safeHandle(
    IPC.updates.getReleaseNotes,
    (range?: { fromVersion?: string | null; toVersion?: string | null }): Promise<ReleaseNote[]> =>
      getReleaseNotes(range?.fromVersion ?? null, range?.toVersion ?? null),
    () => [] as ReleaseNote[]
  );
  // Race-free pull for the "What's New" modal: return the window computed at boot
  // (or null) and, when there is one, ADVANCE the baseline so it fires exactly
  // once regardless of when the renderer mounts. Idempotent — a second consumer
  // (e.g. a second window) gets null.
  ctx.safeHandle(
    IPC.updates.consumeWhatsNew,
    (): WhatsNewEvent | null => {
      const evt = ctx.pendingWhatsNew;
      if (evt) {
        ctx.pendingWhatsNew = null;
        store.setConfig({ lastSeenVersion: evt.toVersion });
      }
      return evt;
    },
    () => null
  );

  // First-run dependency ctx.doctor. `ctx.doctor` is null until whenReady wires it;
  // every handler no-ops gracefully before then. Detection/install are
  // best-effort in the ctx.doctor itself — nothing here throws into the renderer.
  ctx.safeHandle(
    IPC.deps.get,
    (): SetupStatus => ctx.doctor?.snapshot() ?? { busy: false, items: [] },
    () => ({ busy: false, items: [] })
  );
  ctx.safeHandle(
    IPC.deps.check,
    async () => {
      await ctx.doctor?.check();
    },
    () => undefined
  );
  ctx.safeHandle(
    IPC.deps.install,
    async () => {
      await ctx.doctor?.install();
    },
    () => undefined
  );
  ctx.safeHandle(
    IPC.deps.dismiss,
    () => {
      ctx.doctor?.dismiss();
    },
    () => undefined
  );

  ctx.safeHandle(
    IPC.hosts.relaunchLocal,
    async (): Promise<{ ok: true } | { ok: false; message: string }> => {
      if (typeof ctx.runtimeSupervisor?.relaunchEnrolledHost === 'function') {
        return ctx.runtimeSupervisor.relaunchEnrolledHost();
      }
      try {
        const response = await fetch(new URL('api/v1/hosts/relaunch-local', productServerUrl()), {
          method: 'POST'
        });
        const body = await response.json() as { ok?: boolean; message?: string };
        if (body.ok === true) return { ok: true };
        return {
          ok: false,
          message: typeof body.message === 'string' ? body.message : 'Could not relaunch this machine'
        };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'Could not relaunch this machine'
        };
      }
    },
    () => ({ ok: false, message: 'Could not relaunch this machine' })
  );
}

