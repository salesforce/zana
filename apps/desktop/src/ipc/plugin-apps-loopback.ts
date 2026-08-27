import { PluginAppSnapshotSchema } from '@zana-ai/zcc-contracts/runtime';
import type { PluginAppEntry, Result } from '@zana-ai/zcc-domain/product';

/** Loopback product server started by `scripts/dev-local.mjs` (`listen.ts`). */
export function loopbackProductServerUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.ZCC_SERVER_URL?.trim();
  if (!raw) return null;
  try {
    const href = raw.endsWith('/') ? raw : `${raw}/`;
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function listPluginAppsFromProductServer(
  baseUrl = loopbackProductServerUrl()
): Promise<PluginAppEntry[]> {
  if (!baseUrl) return [];
  const response = await fetch(new URL('api/v1/plugin-apps', baseUrl));
  if (!response.ok) return [];
  const body = (await response.json()) as { apps?: unknown };
  if (!Array.isArray(body.apps)) return [];
  return body.apps.flatMap((item) => {
    const parsed = PluginAppSnapshotSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function setPluginAppEnabledOnProductServer(
  id: string,
  enabled: boolean,
  baseUrl = loopbackProductServerUrl()
): Promise<Result<true>> {
  if (!baseUrl) {
    return { ok: false, code: 'UNAVAILABLE', message: 'plugin host is unavailable' };
  }
  const action = enabled ? 'enable' : 'disable';
  const response = await fetch(
    new URL(`api/v1/plugin-apps/${encodeURIComponent(id)}/${action}`, baseUrl),
    { method: 'POST' }
  );
  if (response.ok) return { ok: true, value: true };
  let message = `plugin host returned ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    message = body.message ?? body.error ?? message;
  } catch {
    /* keep status text */
  }
  return {
    ok: false,
    code: response.status === 404 ? 'NOT_FOUND' : 'WRITE_FAILED',
    message
  };
}
