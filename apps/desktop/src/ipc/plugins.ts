// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { listMcpServersAll, revealMcpServer, setMcpServerEnabledById } from '@zana-ai/zcc-server/services/mcp/mcp-catalogue';
import { listMcpServers, setMcpServerEnabled } from '@zana-ai/zcc-server/services/mcp/mcp';
import { listPlugins, revealPlugin, setPluginEnabled } from '@zana-ai/zcc-server/services/extensions/plugins';
import { wantsSecretsOmitted, withoutSecretValues } from '@zana-ai/zcc-server/plugins/plugin-settings-redaction';
import type { Result } from '@zana-ai/zcc-domain/product';
import {
  listPluginAppsFromProductServer,
  setPluginAppEnabledOnProductServer,
  checkPluginUpdatesFromProductServer,
  applyPluginUpdateOnProductServer,
  removePluginAppOnProductServer,
  reloadPluginAppOnProductServer,
  callPluginRpcOnProductServer,
  getPluginSettingsFromProductServer,
  setPluginSettingsOnProductServer
} from './plugin-apps-loopback.js';

export function registerPluginsIpc(): void {
  
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
    () => []
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
      if (ctx.runtimeSupervisor) return ctx.runtimeSupervisor.callPluginRpc(pluginId, method, args);
      return callPluginRpcOnProductServer(pluginId, method, args);
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
