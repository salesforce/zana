import type { IncomingMessage, ServerResponse } from 'node:http';
import { getHost } from '@zana-ai/zcc-db';
import { MachineEnvironmentSaveSchema, MachineEnvironmentSettingsSchema } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from './product-context.js';
import { readJsonBody, sendJson } from './json.js';

/** Owner settings. Called only after the common product Origin and JSON guard. */
export async function handleMachineEnvironmentApi(request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext, url: URL): Promise<boolean> {
  const match = /^\/api\/v1\/system\/machines\/([^/]+)\/environment$/u.exec(url.pathname);
  if (!match) return false;
  if (request.method !== 'GET' && request.method !== 'PUT') {
    sendJson(response, 405, { error: 'method-not-allowed' }); return true;
  }
  try {
    const hostId = decodeURIComponent(match[1]!);
    const host = getHost(ctx.db, hostId);
    if (!host || host.destroyedAt || host.enrollmentCapability !== 'execution') {
      sendJson(response, 403, { error: 'machine-unavailable', message: 'Select an authorized execution machine.' }); return true;
    }
    // The host is explicit: never fall back to a different machine for a secret write.
    ctx.hostHub.ensureHostSessionReady(hostId);
    let result: unknown;
    if (request.method === 'GET') result = await ctx.hostHub.callHostOnlineRpc({ hostId, command: { type: 'host.environment.settings' }, timeoutMs: 10_000 });
    else {
      const parsed = MachineEnvironmentSaveSchema.safeParse(await readJsonBody(request));
      if (!parsed.success) { sendJson(response, 400, { error: 'invalid-environment', message: 'Supply a valid variable name, value and current revision.' }); return true; }
      result = await ctx.hostHub.callHostOnlineRpc({ hostId, command: { type: 'host.environment.save', ...parsed.data }, timeoutMs: 10_000 });
    }
    const publicResult = MachineEnvironmentSettingsSchema.safeParse(result);
    if (!publicResult.success) { sendJson(response, 502, { error: 'invalid-environment-response', message: 'Machine returned an invalid settings response.' }); return true; }
    sendJson(response, 200, { hostId, ...publicResult.data });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    const conflict = code === 'environment_conflict';
    const unsupported = code === 'unknown_command' || code === 'unsupported';
    sendJson(response, conflict ? 409 : unsupported ? 501 : 503, {
      error: conflict ? 'environment-conflict' : unsupported ? 'environment-unsupported' : 'environment-unavailable',
      message: conflict ? 'Settings changed on this machine. Reload before saving again.'
        : unsupported ? 'Update this machine to manage its environment from Settings.'
          : 'Machine settings are unavailable. Reload to check whether your change was saved.',
    });
  }
  return true;
}
