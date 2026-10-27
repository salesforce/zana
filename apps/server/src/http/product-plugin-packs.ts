import type { IncomingMessage, ServerResponse } from 'node:http';
import { pluginPackIdentitySchema, pluginPackInstallRequestSchema } from '@zana-ai/zcc-domain';
import type { PluginPackService } from '../plugins/plugin-packs.js';
import { readJsonBody, sendJson } from './json.js';

/** Called after the product API's Origin/content-type checks. Sources stay host-owned. */
export async function handlePluginPacksApi(
  request: IncomingMessage,
  response: ServerResponse,
  service: PluginPackService | undefined,
  path: string,
  method: string
): Promise<boolean> {
  const action = path.slice('/api/v1/plugin-packs'.length);
  if (!path.startsWith('/api/v1/plugin-packs') ||
      !((method === 'GET' && (action === '' || action === '/installed')) ||
        (method === 'POST' && ['/plan', '/install', '/forget'].includes(action)))) return false;
  if (!service) {
    sendJson(response, 503, { error: 'plugin host is unavailable' });
    return true;
  }
  try {
    if (method === 'GET') {
      sendJson(response, 200, action === '' ? service.list() : service.listInstalled());
    } else {
      const body = await readJsonBody(request, 32_768);
      if (action === '/install') {
        sendJson(response, 200, await service.install(pluginPackInstallRequestSchema.parse(body)));
      } else {
        const identity = pluginPackIdentitySchema.parse(body);
        sendJson(response, 200, action === '/plan' ? await service.plan(identity) : await service.forget(identity));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Plugin pack operation failed';
    sendJson(response, 400, { error: message });
  }
  return true;
}
