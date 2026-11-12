// @ts-nocheck
import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { NamedCheckScopeSchema, NamedChecksSchema, ProjectSettingsPatchSchema, type NamedCheck, type NamedCheckScope } from '@zana-ai/zcc-contracts/project-settings';
import { isTrustedRendererUrl, rendererUrl } from '../window/renderer-url.js';
import { addPickedTrustedPreviewFolder, removeStoredTrustedPreviewFolder } from '../native/trusted-preview-folders.js';
import { productHandle, safeProductHandle } from './shared-product-registration.js';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { harnessVerifyState } from './shared.js';
import { reconcileHarnessConfig } from './config-harness-refresh.js';
import { mainClaudeBinary } from '../main-claude-binary.js';
import { presentAppConfig } from '@zana-ai/zcc-server/http/public-app-url';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import type { AppConfig, OverseerAuditEntry, ProjectSettings } from '@zana-ai/zcc-domain/product';

export interface NamedChecksSettingsService {
  get(scope: NamedCheckScope): Promise<NamedCheck[]> | NamedCheck[];
  set(scope: NamedCheckScope, checks: NamedCheck[]): Promise<NamedCheck[]>;
}

export function registerConfigIpc(namedChecks?: NamedChecksSettingsService): void {
  if (namedChecks) {
    const authorize = (event: IpcMainInvokeEvent, scope: unknown): NamedCheckScope => {
      const win = ctx.mainWindow();
      if (!win || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame
        || !rendererUrl() || !isTrustedRendererUrl(event.sender.getURL())) {
        throw new Error('Named-check settings require owner main window');
      }
      const parsed = NamedCheckScopeSchema.parse(scope);
      if (parsed.kind === 'project' && !ctx.localProjects().some((project) => project.id === parsed.projectId)) {
        throw new Error('Named-check project must be registered');
      }
      return parsed;
    };
    ipcMain.handle(IPC.namedChecks.get, (event, scope) => namedChecks.get(authorize(event, scope)));
    ipcMain.handle(IPC.namedChecks.set, async (event, scope, checks) => {
      const next = await namedChecks.set(authorize(event, scope), NamedChecksSchema.parse(checks));
      ctx.safeSend(IPC.namedChecks.onChanged);
      return next;
    });
  }
  


  // Config remains on the compatibility owner until its normalizer, canonical
  // harness projection, and atomic write transaction move together. A raw JSON
  // server reader would silently change persisted compatibility semantics.
  safeProductHandle(IPC.config.get, () => presentAppConfig(store.getConfig()), () => presentAppConfig(store.getConfig()));
  productHandle<[Partial<AppConfig>], AppConfig>(
    IPC.config.set,
    (patch) => {
      if ('namedChecks' in patch || 'checks' in patch) throw new Error('Named checks require dedicated owner IPC');
      // Window state is main-owned. Renderer config writes cannot alter shared
      // unscoped-window geometry, plugin/thread view window geometry or fullscreen
      // monitor selection.
      const {
        windowBounds: _windowBounds,
        windowMaximized: _windowMaximized,
        pluginViewWindowBounds: _pluginViewWindowBounds,
        threadViewWindowBounds: _threadViewWindowBounds,
        // Preview trust is granted only by the folder chooser handlers below.
        trustedPreviewFolders: _trustedPreviewFolders,
        companionPlacement: _companionPlacement,
        ...safePatch
      } = patch;
      const previous = store.getConfig();
      const next = presentAppConfig(store.setConfig(safePatch));
      if (patch.agentSoundIdle !== undefined || patch.notificationSoundProvider !== undefined || patch.notificationSoundsEnabled !== undefined) ctx.agentSounds.refresh();
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
      // Command Center: turning it off closes an open rail (the app comes back)
      // and hides the "Minimize to Command Center" entry points; a theme change
      // re-themes the rail on its next push.
      if (patch.companionEnabled !== undefined) ctx.syncCompanionMenu();
      if (patch.companionEnabled !== undefined || patch.theme !== undefined) {
        ctx.companion?.onConfigChanged();
      }
      // Fan the new config out to EVERY window so other windows (per-project
      // windows, the focus window) refresh their mirrored feature flags live.
      // Without this a flag toggled off in one window (e.g. Follow-ups) keeps
      // rendering its tab/nav entry in the others until they reload.
      ctx.safeSend(IPC.config.onChanged, next);
      return next;
    }
  );

  // Preview trust is a local-desktop grant. These are plain IPC handlers, not
  // shared product handlers, so the product server and plugins cannot invoke
  // them, and the renderer never supplies the path that gets trusted.
  const broadcast = (next: AppConfig): AppConfig => {
    const presented = presentAppConfig(next);
    ctx.safeSend(IPC.config.onChanged, presented);
    return presented;
  };
  ctx.safeHandle(
    IPC.config.addTrustedPreviewFolder,
    async () => {
      const win = ctx.mainWindow();
      if (!win) return { config: null };
      const picked = await dialog.showOpenDialog(win, {
        title: 'Trust a folder for file preview',
        properties: ['openDirectory']
      });
      if (picked.canceled || !picked.filePaths[0]) return { config: null };
      try {
        return { config: broadcast(await addPickedTrustedPreviewFolder(picked.filePaths[0], store)) };
      } catch (error) {
        return { config: null, error: error instanceof Error ? error.message : 'Could not trust this folder.' };
      }
    },
    () => ({ config: null, error: 'Could not trust this folder.' })
  );
  ctx.safeHandle(
    IPC.config.removeTrustedPreviewFolder,
    (path: string) => broadcast(removeStoredTrustedPreviewFolder(path, store)),
    () => presentAppConfig(store.getConfig())
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
  productHandle(IPC.projectSettings.set, (id: string, patch: Partial<ProjectSettings>) => {
    const parsed = ProjectSettingsPatchSchema.parse(patch);
    return ctx.runtimeSupervisor
      ? ctx.runtimeSupervisor.setProjectSettings(id, parsed)
      : (() => {
          const settings = store.setProjectSettings(id, parsed);
          ctx.safeSend(IPC.projectSettings.onChanged, id);
          return settings;
        })()
   });
}
