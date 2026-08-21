// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { listMcpServersAll, revealMcpServer, setMcpServerEnabledById } from '@zana-ai/zcc-server/services/mcp/mcp-catalogue';
import { listMcpServers, setMcpServerEnabled } from '@zana-ai/zcc-server/services/mcp/mcp';
import { listPlugins, revealPlugin, setPluginEnabled } from '@zana-ai/zcc-server/services/extensions/plugins';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import type { Result } from '@zana-ai/zcc-domain/product';

export function registerPluginsIpc(): void {
  
  ctx.safeHandle(
    IPC.mcp.list,
    (projectPath: string) => listMcpServers(projectPath),
    () => []
  );
  ctx.safeHandle(
    IPC.mcp.setEnabled,
    (projectPath: string, name: string, enabled: boolean) =>
      setMcpServerEnabled(projectPath, name, enabled),
    () => undefined
  );
  ctx.safeHandle(
    IPC.mcp.listAll,
    () => listMcpServersAll(store.listProjects()),
    () => []
  );
  ctx.safeHandle(
    IPC.mcp.setEnabledById,
    async (id: string, enabled: boolean) => {
      const res = await setMcpServerEnabledById(id, enabled, store.listProjects());
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
    (id: string) => revealMcpServer(id, store.listProjects()),
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
    async () => ctx.runtimeSupervisor?.listPluginApps() ?? [],
    () => []
  );
}

