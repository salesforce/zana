import { IPC, type CcApi } from '@zana-ai/zcc-desktop-contract';
import { pluginPackIdentitySchema, pluginPackInstallRequestSchema } from '@zana-ai/zcc-domain';
import type { RuntimeSupervisor } from '../runtime/runtime-supervisor.js';
import { loopbackProductServerUrl } from './plugin-apps-loopback.js';
import { ctx } from './ctx.js';

type PluginPacksApi = CcApi['pluginPacks'];

/** Development uses the same product service over its configured loopback HTTP endpoint. */
export function createPluginPacksLoopback(baseUrl = loopbackProductServerUrl()): PluginPacksApi {
  async function request<T>(action: '' | '/installed' | '/plan' | '/install' | '/forget', payload?: unknown): Promise<T> {
    if (!baseUrl) throw new Error('plugin host is unavailable');
    const response = await fetch(new URL(`api/v1/plugin-packs${action}`, baseUrl), {
      signal: AbortSignal.timeout(action === '/install' ? 300_000 : 20_000),
      ...(payload !== undefined ? {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      } : {})
    });
    if (!response.ok) {
      let message = `plugin host returned ${response.status}`;
      try {
        const body = await response.json() as { message?: unknown; error?: unknown };
        if (typeof body.message === 'string') message = body.message;
        else if (typeof body.error === 'string') message = body.error;
      } catch { /* Keep the status when the host did not return JSON. */ }
      throw new Error(message);
    }
    return await response.json() as T;
  }
  return {
    list: () => request(''),
    plan: (identity) => request('/plan', identity),
    install: (input) => request('/install', input),
    listInstalled: () => request('/installed'),
    forget: (identity) => request('/forget', identity)
  };
}

/** Inputs remain advisory until the product service resolves and checks the reviewed plan. */
export function registerPluginPacksIpc(): void {
  const api = (): PluginPacksApi => {
    const supervisor = ctx.runtimeSupervisor as RuntimeSupervisor | null;
    if (!supervisor) return createPluginPacksLoopback();
    return {
      list: () => supervisor.listPluginPacks(),
      plan: (identity) => supervisor.planPluginPack(identity),
      install: (input) => supervisor.installPluginPack(input),
      listInstalled: () => supervisor.listInstalledPluginPacks(),
      forget: (identity) => supervisor.forgetPluginPack(identity)
    };
  };
  const rethrow = (error: unknown): never => { throw error; };
  ctx.safeHandle(IPC.pluginPacks.list, () => api().list(), rethrow);
  ctx.safeHandle(IPC.pluginPacks.plan, (identity: unknown) => api().plan(pluginPackIdentitySchema.parse(identity)), rethrow);
  ctx.safeHandle(IPC.pluginPacks.install, (input: unknown) => api().install(pluginPackInstallRequestSchema.parse(input)), rethrow);
  ctx.safeHandle(IPC.pluginPacks.listInstalled, () => api().listInstalled(), rethrow);
  ctx.safeHandle(IPC.pluginPacks.forget, (identity: unknown) => api().forget(pluginPackIdentitySchema.parse(identity)), rethrow);
}
