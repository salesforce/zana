import type { ControlPlaneDeps } from './control-plane.js';
import { loopbackProductServerUrl } from '../ipc/plugin-apps-loopback.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Keep dev CLI execution and lifecycle in the runtime that owns live plugin policy. */
export function createLoopbackPluginCommands(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): NonNullable<ControlPlaneDeps['pluginCommands']> {
  const origin = loopbackProductServerUrl({ ZCC_SERVER_URL: baseUrl });
  if (!origin) throw new Error('Plugin commands require a loopback product server');

  async function request(path: string, body?: unknown): Promise<unknown> {
    const response = await fetchImpl(new URL(path, origin!), {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(300_000),
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error('Plugin command response exceeds 1 MB');
          }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { message?: string; error?: string };
    if (!response.ok) throw new Error(result.message ?? result.error ?? `Plugin host returned ${response.status}`);
    return result;
  }

  async function mutatePlugin(id: string, action: 'enable' | 'disable' | 'reload' | 'update'): Promise<unknown> {
    await request(`api/v1/plugin-apps/${encodeURIComponent(id)}/${action}`, {});
    // Lifecycle CLI responses retain the installed row shape used by the local host.
    const result = await request('api/v1/plugins') as { plugins?: Array<{ id: string }> };
    const row = result.plugins?.find(plugin => plugin.id === id);
    if (!row) throw new Error(`Plugin host did not return updated plugin: ${id}`);
    return row;
  }

  return {
    cliContributions: () => request('api/v1/plugins/contributions'),
    runCliCommand: (id, argv, context) => request(`api/v1/plugins/${encodeURIComponent(id)}/cli`, { argv, ...context }),
    enable: id => mutatePlugin(id, 'enable'),
    disable: id => mutatePlugin(id, 'disable'),
    reload: id => mutatePlugin(id, 'reload'),
    update: id => mutatePlugin(id, 'update'),
    remove: id => request(`api/v1/plugin-apps/${encodeURIComponent(id)}/remove`, {}),
    updateAll: async () => (await request('api/v1/plugin-apps/update-all', {}) as { value: unknown }).value
  };
}
