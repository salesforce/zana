// @ts-nocheck
import { productHandle, safeProductHandle } from './shared-product-registration.js';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { harnessVerifyState } from './shared.js';
import { reconcileHarnessConfig } from './config-harness-refresh.js';
import { mainClaudeBinary } from '../main-claude-binary.js';
import { presentAppConfig } from '@zana-ai/zcc-server/http/public-app-url';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import type { AppConfig, OverseerAuditEntry, ProjectSettings } from '@zana-ai/zcc-domain/product';

export function registerConfigIpc(): void {
  


  // Config remains on the compatibility owner until its normalizer, canonical
  // harness projection, and atomic write transaction move together. A raw JSON
  // server reader would silently change persisted compatibility semantics.
  safeProductHandle(IPC.config.get, () => presentAppConfig(store.getConfig()), () => presentAppConfig(store.getConfig()));
  productHandle<[Partial<AppConfig>], AppConfig>(
    IPC.config.set,
    (patch) => {
      // Window state is main-owned. Renderer config writes cannot alter shared
      // unscoped-window geometry, plugin/thread view window geometry or fullscreen
      // monitor selection.
      const {
        windowBounds: _windowBounds,
        windowMaximized: _windowMaximized,
        pluginViewWindowBounds: _pluginViewWindowBounds,
        threadViewWindowBounds: _threadViewWindowBounds,
        ...safePatch
      } = patch;
      const previous = store.getConfig();
      const next = presentAppConfig(store.setConfig(safePatch));
      if (mainClaudeBinary(previous) !== mainClaudeBinary(next)) ctx.invalidateLlmReuse();
      reconcileHarnessConfig(previous, next, {
        invalidate: () => { harnessVerifyState.cache = undefined; }
      });
      // Apply a keep-awake toggle immediately: turning it OFF releases a held
      // block at once (don't wait for the grace timer / next status edge);
      // turning it ON re-acquires if any agent is currently working.
      if (patch.keepAwakeWhileWorking !== undefined) {
        ctx.keepAwake.refresh();
      }
      // Make the auto-close-idle master toggle act instantly across the fleet
      // rather than waiting for the next idle edge: turning OFF disarms every
      // pending close at once; turning ON arms a close for any agent already
      // sitting idle (observe() only arms on the working→idle edge, which won't
      // recur for an already-idle session). Eligibility is re-checked inside.
      if (patch.autoCloseIdleEnabled !== undefined) {
        if (next.autoCloseIdleEnabled === true) ctx.autoCloseIdle.armAllIdle();
        else ctx.autoCloseIdle.cancelAll();
      }
      // Start/stop the Zana Mobile gateway when its master toggle flips. Start
      // is idempotent; a start failure (e.g. port in use) is recorded on the
      // manager and surfaced through `mobile:status`, so the flag stays true and
      // the panel shows the reason rather than silently reverting.
      if (patch.mobileGatewayEnabled !== undefined) {
        if (next.mobileGatewayEnabled === true)
          void ctx.mobileGateway.start().catch(() => {});
        else void ctx.mobileGateway.stop().catch(() => {});
      }
      // Flip the menu-bar surface live: switching to the popover clears the
      // native context menu (so the click toggles the card); switching back
      // rebuilds the native menu and hides any open popover. No relaunch.
      if (patch.menubarPopoverEnabled !== undefined) {
        if (next.menubarPopoverEnabled !== true) ctx.menubar?.hide();
        ctx.tray?.refreshSurface();
      }
      // Theme change re-themes an open popover on its next push, and the
      // Windows caption buttons of every window now.
      if (patch.theme !== undefined) {
        ctx.menubar?.refresh();
        ctx.refreshTitleBarOverlays();
      }
      // Fan the new config out to EVERY window so other windows (per-project
      // windows, the focus window) refresh their mirrored feature flags live.
      // Without this a flag toggled off in one window (e.g. Follow-ups) keeps
      // rendering its tab/nav entry in the others until they reload.
      ctx.safeSend(IPC.config.onChanged, next);
      return next;
    }
  );

  // Recent Overseer decisions for the dry-run review pane. Read-only; bounded by
  // the audit ring's cap so the result can never be unbounded (Rule 5). Empty
  // on any error — the pane just shows nothing.
  safeProductHandle<[number | undefined], OverseerAuditEntry[]>(
    IPC.overseer.recent,
    (limit) => ctx.overseerAudit.recent(limit),
    () => []
  );
  safeProductHandle(
    IPC.projectSettings.get,
    async (id: string) => ctx.runtimeSupervisor
      ? await ctx.runtimeSupervisor.getProjectSettings(id) as ProjectSettings
      : store.getProjectSettings(id),
    () => ({} as ProjectSettings)
  );
  // Mutations must reject on persistence failure so the renderer can roll back
  // its optimistic state and show the write error. Reads remain best-effort.
  productHandle(IPC.projectSettings.set, (id: string, patch: Partial<ProjectSettings>) =>
    ctx.runtimeSupervisor
      ? ctx.runtimeSupervisor.setProjectSettings(id, patch)
      : (() => {
          const settings = store.setProjectSettings(id, patch);
          ctx.safeSend(IPC.projectSettings.onChanged, id);
          return settings;
        })()
  );
}
