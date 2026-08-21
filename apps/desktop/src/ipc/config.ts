// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { harnessVerifyState } from './shared.js';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import type { AppConfig, OverseerAuditEntry, ProjectSettings } from '@zana-ai/zcc-domain/product';

export function registerConfigIpc(): void {
  


  // Config remains on the compatibility owner until its normalizer, canonical
  // harness projection, and atomic write transaction move together. A raw JSON
  // server reader would silently change persisted compatibility semantics.
  ctx.safeHandle(IPC.config.get, () => store.getConfig(), () => store.getConfig());
  ctx.safeHandle<[Partial<AppConfig>], AppConfig>(
    IPC.config.set,
    (patch) => {
      // Window state is main-owned. Renderer config writes cannot alter shared
      // unscoped-window geometry or fullscreen monitor selection.
      const { windowBounds: _windowBounds, windowMaximized: _windowMaximized, ...safePatch } = patch;
      const next = store.setConfig(safePatch);
      if (
        patch.harnessCursorEnabled !== undefined ||
        patch.harnessCodexEnabled !== undefined ||
        patch.harnessPiEnabled !== undefined ||
        patch.harnessOpenCodeEnabled !== undefined ||
        patch.claudeBinary !== undefined ||
        patch.cursorBinary !== undefined ||
        patch.codexBinary !== undefined ||
        patch.piBinary !== undefined ||
        patch.opencodeBinary !== undefined
      ) {
        harnessVerifyState.cache = undefined;
      }
      // Keep the claude-cli LLM provider pointed at the configured binary so a
      // binary change takes effect without a restart.
      if (patch.claudeBinary !== undefined) {
        ctx.rebuildProviders(next);
      }
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
      // Flip the menu-bar surface live: switching to the popover clears the
      // native context menu (so the click toggles the card); switching back
      // rebuilds the native menu and hides any open popover. No relaunch.
      if (patch.menubarPopoverEnabled !== undefined) {
        if (next.menubarPopoverEnabled !== true) ctx.menubar?.hide();
        ctx.tray?.refreshSurface();
      }
      // Theme change re-themes an open popover on its next push.
      if (patch.theme !== undefined) ctx.menubar?.refresh();
      // Fan the new config out to EVERY window so other windows (per-project
      // windows, the focus window) refresh their mirrored feature flags live.
      // Without this a flag toggled off in one window (e.g. Follow-ups) keeps
      // rendering its tab/nav entry in the others until they reload.
      ctx.safeSend(IPC.config.onChanged, next);
      return next;
    },
    () => store.getConfig()
  );

  // Recent Overseer decisions for the dry-run review pane. Read-only; bounded by
  // the audit ring's cap so the result can never be unbounded (Rule 5). Empty
  // on any error — the pane just shows nothing.
  ctx.safeHandle<[number | undefined], OverseerAuditEntry[]>(
    IPC.overseer.recent,
    (limit) => ctx.overseerAudit.recent(limit),
    () => []
  );
  ctx.safeHandle(
    IPC.projectSettings.get,
    async (id: string) => ctx.runtimeSupervisor
      ? await ctx.runtimeSupervisor.getProjectSettings(id) as ProjectSettings
      : store.getProjectSettings(id),
    () => ({} as ProjectSettings)
  );
  // Mutations must reject on persistence failure so the renderer can roll back
  // its optimistic state and show the write error. Reads remain best-effort.
  ipcMain.handle(IPC.projectSettings.set, (_event, id: string, patch: Partial<ProjectSettings>) =>
    ctx.runtimeSupervisor
      ? ctx.runtimeSupervisor.setProjectSettings(id, patch)
      : (() => {
          const settings = store.setProjectSettings(id, patch);
          ctx.safeSend(IPC.projectSettings.onChanged, id);
          return settings;
        })()
  );
}

