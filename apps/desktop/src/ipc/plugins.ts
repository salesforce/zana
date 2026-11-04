// @ts-nocheck
import { ipcMain, BrowserWindow } from 'electron';
import { repairPluginSource } from './plugin-source-repair.js';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { listMcpServersAll, revealMcpServer, setMcpServerEnabledById } from '@zana-ai/zcc-server/services/mcp/mcp-catalogue';
import { listMcpServers, setMcpServerEnabled } from '@zana-ai/zcc-server/services/mcp/mcp';
import { listPlugins, revealPlugin, setPluginEnabled } from '@zana-ai/zcc-server/services/extensions/plugins';
import { wantsSecretsOmitted, withoutSecretValues } from '@zana-ai/zcc-server/plugins/plugin-settings-redaction';
import type { Result } from '@zana-ai/zcc-domain/product';
import { classifyExpectedRpcError, toRpcErrorEnvelope } from '@zana-ai/zcc-contracts/rpc-error';
import { registerPluginPacksIpc } from './plugin-packs.js';
import {
  listPluginAppsFromProductServer,
  setPluginAppEnabledOnProductServer,
  checkPluginUpdatesFromProductServer,
  applyPluginUpdateOnProductServer,
  applyAllPluginUpdatesOnProductServer,
  removePluginAppOnProductServer,
  reloadPluginAppOnProductServer,
  callPluginRpcOnProductServer,
  getPluginSettingsFromProductServer,
  setPluginSettingsOnProductServer
} from './plugin-apps-loopback.js';

export function registerPluginsIpc(): void {
  registerPluginPacksIpc();
  ctx.safeHandle(IPC.pluginApps.repair,
    (id: unknown, action: unknown) => repairPluginSource(ctx.runtimeSupervisor, id, action, BrowserWindow.getFocusedWindow() ?? ctx.mainWindow()),
    (error): Result<true> => ({ ok: false, code: 'REPAIR_FAILED', message: error instanceof Error ? error.message : String(error) })
  );
  
  ctx.safeHandle(
    IPC.mcp.list,
    (projectPath: string) => listMcpServers(requireLocalProjectPath(projectPath)),
    () => []
  );
  ctx.safeHandle(
    IPC.mcp.setEnabled,
    (projectPath: string, name: string, enabled: boolean) =>
      setMcpServerEnabled(requireLocalProjectPath(projectPath), name, enabled),
    () => undefined
  );
  ctx.safeHandle(
    IPC.mcp.listAll,
    () => listMcpServersAll(ctx.localProjects()),
    () => []
  );
  ctx.safeHandle(
    IPC.mcp.setEnabledById,
    async (id: string, enabled: boolean) => {
      const res = await setMcpServerEnabledById(id, enabled, ctx.localProjects());
      if (res.ok) void ctx.emitMcpChanged();
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  ctx.safeHandle(
    IPC.mcp.reveal,
    (id: string) => revealMcpServer(id, ctx.localProjects()),
    (err): Result<true> => ({
      ok: false,
      code: 'REVEAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  ctx.safeHandle(IPC.plugins.list, () => listPlugins(), () => []);
  ctx.safeHandle(
    IPC.plugins.setEnabled,
    async (id: string, enabled: boolean) => {
      const res = await setPluginEnabled(id, enabled);
      if (res.ok) {
        void ctx.emitPluginsChanged();
        // Plugin enable/disable cascades to plugin-source MCPs; refresh.
        void ctx.emitMcpChanged();
      }
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  ctx.safeHandle(
    IPC.plugins.reveal,
    (id: string) => revealPlugin(id),
    (err): Result<true> => ({
      ok: false,
      code: 'REVEAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  ctx.safeHandle(
    IPC.pluginApps.list,
    async () => {
      if (ctx.runtimeSupervisor) return ctx.runtimeSupervisor.listPluginApps();
      return listPluginAppsFromProductServer();
    },
    () => []
  );
  ctx.safeHandle(
    IPC.pluginApps.setEnabled,
    async (id: string, enabled: boolean) => {
      if (ctx.runtimeSupervisor) {
        try {
          if (enabled) await ctx.runtimeSupervisor.enablePlugin(id);
          else await ctx.runtimeSupervisor.disablePlugin(id);
          return { ok: true as const, value: true as const };
        } catch (err) {
          return {
            ok: false as const,
            code: 'WRITE_FAILED',
            message: err instanceof Error ? err.message : String(err)
          };
        }
      }
      const result = await setPluginAppEnabledOnProductServer(id, enabled);
      if (result.ok) {
        const apps = await listPluginAppsFromProductServer();
        ctx.safeSend(IPC.pluginApps.onChanged, apps);
      }
      return result;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  ctx.safeHandle(
    IPC.pluginApps.checkUpdates,
    async () => {
      if (ctx.runtimeSupervisor) return ctx.runtimeSupervisor.outdatedPlugins();
      return checkPluginUpdatesFromProductServer();
    },
    (error) => { throw error; }
  );
  ctx.safeHandle(
    IPC.pluginApps.applyAllUpdates,
    async () => {
      if (!ctx.runtimeSupervisor) return applyAllPluginUpdatesOnProductServer();
      try { return { ok: true, value: await ctx.runtimeSupervisor.updateAllPlugins() }; }
      catch (error) { return { ok: false, code: 'WRITE_FAILED', message: error instanceof Error ? error.message : String(error) }; }
    },
    (error) => ({ ok: false, code: 'WRITE_FAILED', message: error instanceof Error ? error.message : String(error) })
  );
  ctx.safeHandle(
    IPC.pluginApps.applyUpdate,
    async (id: string) => {
      if (ctx.runtimeSupervisor) {
        try {
          await ctx.runtimeSupervisor.updatePlugin(id);
          return { ok: true as const, value: true as const };
        } catch (err) {
          return {
            ok: false as const,
            code: 'WRITE_FAILED',
            message: err instanceof Error ? err.message : String(err)
          };
        }
      }
      return applyPluginUpdateOnProductServer(id);
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  ctx.safeHandle(
    IPC.pluginApps.remove,
    async (id: string) => {
      if (ctx.runtimeSupervisor) {
        try {
          await ctx.runtimeSupervisor.removePlugin(id);
          return { ok: true as const, value: true as const };
        } catch (err) {
          return {
            ok: false as const,
            code: 'WRITE_FAILED',
            message: err instanceof Error ? err.message : String(err)
          };
        }
      }
      const result = await removePluginAppOnProductServer(id);
      if (result.ok) {
        const apps = await listPluginAppsFromProductServer();
        ctx.safeSend(IPC.pluginApps.onChanged, apps);
      }
      return result;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  ctx.safeHandle(
    IPC.pluginApps.reload,
    async (id: string) => {
      if (ctx.runtimeSupervisor) {
        try {
          await ctx.runtimeSupervisor.reloadPlugin(id);
          return { ok: true as const, value: true as const };
        } catch (err) {
          return {
            ok: false as const,
            code: 'WRITE_FAILED',
            message: err instanceof Error ? err.message : String(err)
          };
        }
      }
      const result = await reloadPluginAppOnProductServer(id);
      if (result.ok) {
        const apps = await listPluginAppsFromProductServer();
        ctx.safeSend(IPC.pluginApps.onChanged, apps);
      }
      return result;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  ctx.safeHandle(
    IPC.pluginApps.callRpc,
    async (pluginId: string, method: string, args?: unknown) => {
      try {
        if (ctx.runtimeSupervisor) return await ctx.runtimeSupervisor.callPluginRpc(pluginId, method, args);
        return await callPluginRpcOnProductServer(pluginId, method, args);
      } catch (err) {
        // Expected domain errors (validation guards etc.) resolve as an envelope so ipcMain does not
        // log them as main-process failures; preload turns the envelope back into a clean rejection.
        const expected = classifyExpectedRpcError(err);
        if (expected) return toRpcErrorEnvelope(expected);
        throw err;
      }
    },
    (err) => {
      throw err;
    }
  );
  ctx.safeHandle(
    IPC.pluginApps.getSettings,
    async (pluginId: string, options?: unknown) => {
      const snapshot = ctx.runtimeSupervisor
        ? await ctx.runtimeSupervisor.getPluginSettings(pluginId)
        : await getPluginSettingsFromProductServer(pluginId);
      // Same redaction as the HTTP route: Settings search asks for it, so stored
      // secrets never reach the (untrusted) renderer just to be discarded there.
      return wantsSecretsOmitted(options) ? withoutSecretValues(snapshot) : snapshot;
    },
    () => ({ descriptors: {}, values: {} })
  );
  ctx.safeHandle(
    IPC.pluginApps.setSettings,
    async (pluginId: string, values: Record<string, string | number | boolean | undefined>) => {
      const payload: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(values)) {
        payload[key] = value === undefined ? null : value;
      }
      if (ctx.runtimeSupervisor) return ctx.runtimeSupervisor.setPluginSettings(pluginId, payload);
      return setPluginSettingsOnProductServer(pluginId, payload);
    },
    (err) => {
      throw err;
    }
  );
}

function requireLocalProjectPath(projectPath: string): string {
  const options = ctx.projectPathToOptions(projectPath);
  if (!options.projectPath) throw new Error('Choose a project on this machine');
  return options.projectPath;
}
