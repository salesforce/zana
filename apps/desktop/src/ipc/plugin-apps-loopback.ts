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
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }
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

export async function checkPluginUpdatesFromProductServer(
  baseUrl = loopbackProductServerUrl()
): Promise<Array<{ id: string; current: string; available: string; marketplace: string }>> {
  if (!baseUrl) return [];
  const response = await fetch(new URL('api/v1/plugin-apps/updates', baseUrl));
  if (!response.ok) return [];
  const body = (await response.json()) as { updates?: unknown };
  return Array.isArray(body.updates)
    ? body.updates.filter((row): row is { id: string; current: string; available: string; marketplace: string } =>
      Boolean(
        row &&
        typeof row === 'object' &&
        typeof (row as { id?: unknown }).id === 'string' &&
        typeof (row as { current?: unknown }).current === 'string' &&
        typeof (row as { available?: unknown }).available === 'string' &&
        typeof (row as { marketplace?: unknown }).marketplace === 'string'
      )
    )
    : [];
}

export async function applyPluginUpdateOnProductServer(
  id: string,
  baseUrl = loopbackProductServerUrl()
): Promise<Result<true>> {
  if (!baseUrl) {
    return { ok: false, code: 'UNAVAILABLE', message: 'plugin host is unavailable' };
  }
  const response = await fetch(
    new URL(`api/v1/plugin-apps/${encodeURIComponent(id)}/update`, baseUrl),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }
  );
  if (response.ok) return { ok: true, value: true };
  const message = await productServerError(response, `plugin host returned ${response.status}`);
  return {
    ok: false,
    code: response.status === 404 ? 'NOT_FOUND' : 'WRITE_FAILED',
    message
  };
}

export async function removePluginAppOnProductServer(
  id: string,
  baseUrl = loopbackProductServerUrl()
): Promise<Result<true>> {
  if (!baseUrl) {
    return { ok: false, code: 'UNAVAILABLE', message: 'plugin host is unavailable' };
  }
  const response = await fetch(
    new URL(`api/v1/plugin-apps/${encodeURIComponent(id)}/remove`, baseUrl),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }
  );
  if (response.ok) return { ok: true, value: true };
  const message = await productServerError(response, `plugin host returned ${response.status}`);
  return {
    ok: false,
    code: response.status === 404 ? 'NOT_FOUND' : 'WRITE_FAILED',
    message
  };
}

const EMPTY_PLUGIN_SETTINGS = { descriptors: {}, values: {} } as const;

export async function callPluginRpcOnProductServer(
  pluginId: string,
  method: string,
  args?: unknown,
  baseUrl = loopbackProductServerUrl()
): Promise<unknown> {
  if (!baseUrl) throw new Error('plugin host is unavailable');
  const response = await fetch(
    new URL(`api/v1/plugin-apps/${encodeURIComponent(pluginId)}/rpc`, baseUrl),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, args })
    }
  );
  if (!response.ok) {
    throw new Error(await productServerError(response, 'plugin host is unavailable'));
  }
  const body = (await response.json()) as { value?: unknown };
  return body.value;
}

export async function getPluginSettingsFromProductServer(
  pluginId: string,
  baseUrl = loopbackProductServerUrl()
): Promise<{ descriptors: Record<string, unknown>; values: Record<string, unknown> }> {
  if (!baseUrl) return { ...EMPTY_PLUGIN_SETTINGS };
  const response = await fetch(
    new URL(`api/v1/plugin-apps/${encodeURIComponent(pluginId)}/settings`, baseUrl)
  );
  if (!response.ok) return { ...EMPTY_PLUGIN_SETTINGS };
  const body = (await response.json()) as {
    descriptors?: Record<string, unknown>;
    values?: Record<string, unknown>;
  };
  return {
    descriptors: body.descriptors && typeof body.descriptors === 'object' ? body.descriptors : {},
    values: body.values && typeof body.values === 'object' ? body.values : {}
  };
}

export async function setPluginSettingsOnProductServer(
  pluginId: string,
  values: Record<string, string | boolean | null>,
  baseUrl = loopbackProductServerUrl()
): Promise<{ descriptors: Record<string, unknown>; values: Record<string, unknown> }> {
  if (!baseUrl) throw new Error('plugin host is unavailable');
  const response = await fetch(
    new URL(`api/v1/plugin-apps/${encodeURIComponent(pluginId)}/settings`, baseUrl),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values })
    }
  );
  if (!response.ok) {
    throw new Error(await productServerError(response, 'plugin host is unavailable'));
  }
  const body = (await response.json()) as {
    descriptors?: Record<string, unknown>;
    values?: Record<string, unknown>;
  };
  return {
    descriptors: body.descriptors && typeof body.descriptors === 'object' ? body.descriptors : {},
    values: body.values && typeof body.values === 'object' ? body.values : {}
  };
}

async function productServerError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.message ?? body.error ?? fallback;
  } catch {
    return fallback;
  }
}
