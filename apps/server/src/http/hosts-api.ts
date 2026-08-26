import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createHostJoinCodeRequestSchema,
  hostDirectoryQuerySchema,
  hostProviderCliInstallRequestSchema,
  updateHostPermissionCeilingRequestSchema
} from '@zana-ai/zcc-server-contract';
import {
  destroyHost,
  getHost,
  renameHost,
  updateHostPermissionCeiling
} from '@zana-ai/zcc-db';
import { readJsonBody, sendJson, sendNdjson } from './json.js';
import type { ProductHttpContext } from './product-context.js';
import { listPublicHosts, parseHostRename, toPublicHost } from '../services/hosts/host-public.js';
import { HostUnavailableError } from './host-hub.js';

function routeParams(pathname: string, pattern: string): Record<string, string> | null {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i]!;
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(pathParts[i]!);
    } else if (part !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function emitHostsChanged(ctx: ProductHttpContext): void {
  ctx.hub.emit('hosts:changed', listPublicHosts(ctx.db, ctx.hostHub));
}

function connectedSet(ctx: ProductHttpContext): Set<string> {
  return new Set(ctx.hostHub.connectedHostIds());
}

function requireHost(ctx: ProductHttpContext, id: string) {
  const row = getHost(ctx.db, id);
  if (!row || row.destroyedAt) return null;
  return row;
}

/**
 * Public `/api/v1/hosts` surface. Join codes do not create a host row.
 */
export async function handleHostsApi(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext,
  path: string,
  method: string,
  requestUrl: URL
): Promise<boolean> {
  if (path === '/api/v1/hosts/join-codes' && method === 'POST') {
    let body: unknown = {};
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: 'invalid JSON' });
      return true;
    }
    if (!createHostJoinCodeRequestSchema.safeParse(body).success) {
      sendJson(response, 400, { error: 'invalid join-code request' });
      return true;
    }
    const issued = ctx.joinCodes.mint();
    sendJson(response, 201, issued);
    return true;
  }

  if (path === '/api/v1/hosts' && method === 'GET') {
    sendJson(response, 200, listPublicHosts(ctx.db, ctx.hostHub));
    return true;
  }

  const retry = routeParams(path, '/api/v1/hosts/:id/retry-update');
  if (retry && method === 'POST') {
    const host = requireHost(ctx, retry.id);
    if (!host) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    ctx.hostHub.requestRetryUpdate(host.id);
    sendJson(response, 200, { ok: true as const });
    return true;
  }

  const ceiling = routeParams(path, '/api/v1/hosts/:id/permission-ceiling');
  if (ceiling && method === 'PATCH') {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: 'invalid JSON' });
      return true;
    }
    const parsed = updateHostPermissionCeilingRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid permission ceiling' });
      return true;
    }
    const updated = updateHostPermissionCeiling(ctx.db, ceiling.id, parsed.data.maxPermissionMode);
    if (!updated || updated.destroyedAt) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    emitHostsChanged(ctx);
    sendJson(response, 200, toPublicHost(updated, connectedSet(ctx)));
    return true;
  }

  const directory = routeParams(path, '/api/v1/hosts/:id/directory');
  if (directory && method === 'GET') {
    const host = requireHost(ctx, directory.id);
    if (!host) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    const query = hostDirectoryQuerySchema.safeParse({
      path: requestUrl.searchParams.get('path') ?? undefined
    });
    if (!query.success) {
      sendJson(response, 400, { error: 'invalid directory query' });
      return true;
    }
    const root = query.data.path ?? host.homeDir;
    if (!root) {
      sendJson(response, 409, { error: 'host home directory is unknown' });
      return true;
    }
    try {
      ctx.hostHub.ensureHostSessionReady(host.id);
      const result = await ctx.hostHub.callHostOnlineRpc<{
        entries: Array<{ name: string; kind: 'file' | 'directory'; path: string }>;
      }>({
        hostId: host.id,
        command: { type: 'host.list_dir', root, relPath: '' }
      });
      const parentIndex = root.lastIndexOf('/');
      const parent = root === '/' ? null : (parentIndex <= 0 ? '/' : root.slice(0, parentIndex));
      sendJson(response, 200, {
        directory: root,
        parent,
        entries: result.entries.map((entry) => ({
          kind: entry.kind,
          name: entry.name,
          path: entry.path
        }))
      });
    } catch (error) {
      if (error instanceof HostUnavailableError) {
        sendJson(response, 503, { error: error.message });
        return true;
      }
      sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const clonePath = routeParams(path, '/api/v1/hosts/:id/clone-default-path');
  if (clonePath && method === 'GET') {
    const host = requireHost(ctx, clonePath.id);
    if (!host) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    const projectId = requestUrl.searchParams.get('projectId') ?? 'project';
    try {
      ctx.hostHub.ensureHostSessionReady(host.id);
      const result = await ctx.hostHub.callHostOnlineRpc<{ path: string }>({
        hostId: host.id,
        command: { type: 'project.clone_default_path', projectSlug: projectId }
      });
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof HostUnavailableError) {
        sendJson(response, 503, { error: error.message });
        return true;
      }
      sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const cliStatus = routeParams(path, '/api/v1/hosts/:id/provider-clis/status');
  if (cliStatus && method === 'GET') {
    const host = requireHost(ctx, cliStatus.id);
    if (!host) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    try {
      ctx.hostHub.ensureHostSessionReady(host.id);
      const result = await ctx.hostHub.callHostOnlineRpc({
        hostId: host.id,
        command: { type: 'provider.cli_status' }
      });
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof HostUnavailableError) {
        sendJson(response, 503, { error: error.message });
        return true;
      }
      sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const cliInstall = routeParams(path, '/api/v1/hosts/:id/provider-clis/install');
  if (cliInstall && method === 'POST') {
    const host = requireHost(ctx, cliInstall.id);
    if (!host) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: 'invalid JSON' });
      return true;
    }
    const parsed = hostProviderCliInstallRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid provider CLI install request' });
      return true;
    }
    try {
      ctx.hostHub.ensureHostSessionReady(host.id);
      const result = await ctx.hostHub.callHostOnlineRpc<{ events: unknown[] }>({
        hostId: host.id,
        command: {
          type: 'provider.cli_install',
          provider: parsed.data.provider,
          actionKind: parsed.data.actionKind
        },
        timeoutMs: 11 * 60_000
      });
      sendNdjson(response, result.events);
    } catch (error) {
      if (error instanceof HostUnavailableError) {
        sendJson(response, 503, { error: error.message });
        return true;
      }
      sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const one = routeParams(path, '/api/v1/hosts/:id');
  if (one && method === 'GET') {
    const host = requireHost(ctx, one.id);
    if (!host) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    sendJson(response, 200, toPublicHost(host, connectedSet(ctx)));
    return true;
  }

  if (one && method === 'PATCH') {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: 'invalid JSON' });
      return true;
    }
    const name = parseHostRename(body);
    if (!name) {
      sendJson(response, 400, { error: 'invalid host update' });
      return true;
    }
    const updated = renameHost(ctx.db, one.id, name);
    if (!updated || updated.destroyedAt) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    emitHostsChanged(ctx);
    sendJson(response, 200, toPublicHost(updated, connectedSet(ctx)));
    return true;
  }

  if (one && method === 'DELETE') {
    const host = requireHost(ctx, one.id);
    if (!host) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    if (host.isPrimary) {
      sendJson(response, 403, { error: 'primary host cannot be removed' });
      return true;
    }
    ctx.hostHub.detach(host.id, 'removed');
    destroyHost(ctx.db, host.id);
    emitHostsChanged(ctx);
    sendJson(response, 200, { ok: true as const });
    return true;
  }

  return false;
}
