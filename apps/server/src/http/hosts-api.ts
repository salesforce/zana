import type { IncomingMessage, ServerResponse } from 'node:http';
import { readHostPerformance } from './host-performance.js';
import {
  createHostJoinCodeRequestSchema,
  hostDirectoryQuerySchema,
  hostProviderCliInstallRequestSchema,
  hostBootstrapRequestSchema,
  peerIntroductionDecisionRequestSchema,
  removePeerLinkQuerySchema,
  removePeerLinkUseQuerySchema,
  hostSshIdentityRequestSchema,
  hostPathsExistRequestSchema,
  hostPickFolderRequestSchema,
  updateHostPermissionCeilingRequestSchema
} from '@zana-ai/zcc-server-contract';
import {
  destroyHost,
  getHost,
  renameHost,
  updateHostDefaultWorkspacePath,
  updateHostPermissionCeiling,
  updateHostSshIdentity
} from '@zana-ai/zcc-db';
import { readJsonBody, sendJson, beginNdjson, rejectMobilePeerManagement } from './json.js';
import type { ProductHttpContext } from './product-context.js';
import { listPublicHosts, parseHostUpdate, toPublicHost } from '../services/hosts/host-public.js';
import { forgetLeftover, listPeerLeftovers, listPeerLinks, pausePeerLink, peerLinkActivity, removePeerLink, removePeerLinkUse, repairPeerLink, resumePeerLink, type PeerLinkRemoval } from '../services/hosts/peer-link-view.js';
import { relaunchLocalHostDaemon } from '../services/hosts/host-relaunch.js';
import { HostUnavailableError } from './host-hub.js';
import { bootstrapHostBySsh, bootstrapHostForProject, parseSshIdentity, reconcileRemoteProjectBindings, repairHost, type HostBootstrapEvent } from '../services/hosts/host-bootstrap.js';
import { closeTunnelHost } from '../services/hosts/tunnel-hosts.js';
import { issueConnectHostCode, revokeConnectHost, usesConnect, connectInstallCommand } from '../services/hosts/connect-enrollment.js';

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

const FOLDER_PICKER_TIMEOUT_MS = 10 * 60 * 1000;

/** Execution hosts only: a plugin link is never addressable through the machine routes. */
function requireHost(ctx: ProductHttpContext, id: string) {
  const row = getHost(ctx.db, id);
  if (!row || row.destroyedAt || row.purpose.kind !== 'execution') return null;
  return row;
}

function sendPeerLinkRemoval(response: ServerResponse, result: PeerLinkRemoval): void {
  if (result.status === 'ok') sendJson(response, 200, { ok: true as const, linkRemoved: result.linkRemoved });
  else if (result.status === 'not-found') sendJson(response, 404, { error: 'peer link not found' });
  else sendJson(response, 503, { error: 'Could not remove this link right now. Retry when your account connection is available.' });
}

const SAFE_DECISION_ERRORS = /^(peer introduction unavailable|introduction already decided|invalid introduction decision)$/;

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
  if (path === '/api/v1/peer-links' || path.startsWith('/api/v1/peer-links/')) {
    if (rejectMobilePeerManagement(request, response)) return true;
    if (path === '/api/v1/peer-links' && method === 'GET') {
      sendJson(response, 200, listPeerLinks(ctx));
      return true;
    }
    if (path === '/api/v1/peer-links/leftover' && method === 'GET') {
      sendJson(response, 200, listPeerLeftovers(ctx));
      return true;
    }
    const forgetParams = method === 'POST' ? routeParams(path, '/api/v1/peer-links/leftover/:computerId/forget') : null;
    if (forgetParams) {
      const result = await forgetLeftover(ctx, forgetParams.computerId!);
      if (result.status === 'ok') sendJson(response, 200, { ok: true as const });
      else sendJson(response, 404, { error: 'leftover not found' });
      return true;
    }
    const pauseParams = method === 'POST' ? routeParams(path, '/api/v1/peer-links/:hostId/disconnect') : null;
    const resumeParams = method === 'POST' ? routeParams(path, '/api/v1/peer-links/:hostId/reconnect') : null;
    if (pauseParams || resumeParams) {
      const result = pauseParams ? await pausePeerLink(ctx, pauseParams.hostId!) : await resumePeerLink(ctx, resumeParams!.hostId!);
      if (result.status === 'ok') sendJson(response, 200, { ok: true as const, paused: result.paused });
      else if (result.status === 'not-found') sendJson(response, 404, { error: 'peer link not found' });
      else sendJson(response, 503, { error: 'Could not change this link right now. Try again.' });
      return true;
    }
    const repairParams = method === 'POST' ? routeParams(path, '/api/v1/peer-links/:hostId/repair') : null;
    if (repairParams) {
      const result = await repairPeerLink(ctx, repairParams.hostId!);
      if (result.status === 'ok') sendJson(response, 200, { ok: true as const });
      else if (result.status === 'not-found') sendJson(response, 404, { error: 'peer link not found' });
      else sendJson(response, 503, { error: 'Could not repair this link right now. Try again.' });
      return true;
    }
    const useParams = method === 'DELETE' ? routeParams(path, '/api/v1/peer-links/:hostId/uses/:pluginId') : null;
    if (useParams) {
      const query = removePeerLinkUseQuerySchema.safeParse({ scope: requestUrl.searchParams.get('scope') ?? undefined });
      if (!query.success) { sendJson(response, 400, { error: 'invalid peer link use' }); return true; }
      sendPeerLinkRemoval(response, await removePeerLinkUse(ctx, useParams.hostId!, useParams.pluginId!, query.data.scope));
      return true;
    }
    const activityParams = method === 'GET' ? routeParams(path, '/api/v1/peer-links/:hostId/activity') : null;
    if (activityParams) {
      const activity = peerLinkActivity(ctx, activityParams.hostId!);
      if (activity) sendJson(response, 200, activity);
      else sendJson(response, 404, { error: 'peer link not found' });
      return true;
    }
    const linkParams = method === 'DELETE' ? routeParams(path, '/api/v1/peer-links/:hostId') : null;
    if (linkParams) {
      const query = removePeerLinkQuerySchema.safeParse({ force: requestUrl.searchParams.get('force') ?? undefined });
      if (!query.success) { sendJson(response, 400, { error: 'invalid peer link removal' }); return true; }
      const result = await removePeerLink(ctx, linkParams.hostId!, { force: query.data.force === '1' });
      // A failed plugin handler stops before anything is removed: the owner picks Retry or Remove anyway.
      if (result.status === 'hooks-failed') sendJson(response, 200, { ok: false as const, hookFailures: result.failures });
      else sendPeerLinkRemoval(response, result);
      return true;
    }
    sendJson(response, 404, { error: 'not found' });
    return true;
  }
  const performanceHost = routeParams(path, '/api/v1/hosts/:id/performance');
  if (performanceHost && method === 'GET') {
    if (!requireHost(ctx, performanceHost.id!)) {
      sendJson(response, 404, { error: 'host not found' });
    } else {
      sendJson(response, 200, readHostPerformance(ctx, performanceHost.id!));
    }
    return true;
  }
  const enrollmentStatus = /^\/api\/v1\/hosts\/enrollments\/([a-f0-9]{64})$/.exec(path);
  if (enrollmentStatus && method === 'GET') {
    const status = ctx.joinCodes.status(enrollmentStatus[1]!);
    sendJson(response, 200, { status: !status ? 'expired' : status.redeemedAt === null ? 'pending' : connectedSet(ctx).has(status.hostId) ? 'connected' : 'enrolled' });
    return true;
  }
  if (path === '/api/v1/hosts/connect-code' && method === 'POST') {
    try { const issued = await issueConnectHostCode(ctx, await readJsonBody(request)); sendJson(response, 201, { ...issued, installCommand: connectInstallCommand(issued) }); }
    catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : 'Machine enrollment unavailable' }); }
    return true;
  }
  if ((path === '/api/v1/hosts/join-codes' || path === '/api/v1/hosts/join-codes/preferred') && method === 'POST') {
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
    if (path.endsWith('/preferred') && usesConnect(ctx)) {
      try {
        const issued = await issueConnectHostCode(ctx, { name: 'New machine' });
        sendJson(response, 201, { joinCode: issued.code, enrollmentId: issued.enrollmentId, hostId: issued.hostId, expiresAt: issued.expiresAt, installCommand: connectInstallCommand(issued) });
      } catch (error) { sendJson(response, 503, { error: error instanceof Error ? error.message : 'Connect unavailable' }); }
      return true;
    }
    if (path.endsWith('/preferred')) {
      // Without Zana Connect the code redeems through the allowlist-only loopback forwarder,
      // reachable from the remote only via an SSH reverse tunnel the user opens.
      const forwarderPort = ctx.origins?.pairingPort;
      if (!forwarderPort) {
        sendJson(response, 409, { error: 'pairing_unavailable' });
        return true;
      }
      sendJson(response, 201, { ...ctx.joinCodes.mint(), pairingServerUrl: `http://127.0.0.1:${forwarderPort}` });
      return true;
    }
    const issued = ctx.joinCodes.mint();
    sendJson(response, 201, issued);
    return true;
  }

  if (path === '/api/v1/peers/introductions' && method === 'GET') {
    sendJson(response, 200, { introductions: await ctx.peerAuthority.receivedIntroductions() });
    return true;
  }

  const introductionParams = method === 'POST' ? routeParams(path, '/api/v1/peers/introductions/:id/decision') : null;
  if (introductionParams) {
    if (rejectMobilePeerManagement(request, response)) return true;
    let body: unknown;
    try { body = await readJsonBody(request); } catch { sendJson(response, 400, { error: 'invalid JSON' }); return true; }
    const parsed = peerIntroductionDecisionRequestSchema.safeParse(body);
    if (!parsed.success) { sendJson(response, 400, { error: 'invalid introduction decision' }); return true; }
    try {
      const decided = await ctx.peerAuthority.decideIntroduction(introductionParams.id!, parsed.data.decision);
      // Consent is the trigger: a bounded, tracked forward-only enrollment; failures stay visible in installations.
      if (decided.status === 'approved') {
        void ctx.peerInstaller?.enroll(decided.introductionId).catch(error => {
          console.warn(`[zcc] peer enrollment after approval failed for introduction ${decided.introductionId}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      sendJson(response, 200, decided);
    }
    catch (error) {
      const message = error instanceof Error && SAFE_DECISION_ERRORS.test(error.message) ? error.message : 'introduction unavailable';
      sendJson(response, 409, { error: message });
    }
    return true;
  }

  if (path === '/api/v1/hosts/forward-join-codes' && method === 'POST') {
    if (rejectMobilePeerManagement(request, response)) return true;
    let body: unknown = {};
    try { body = await readJsonBody(request); } catch { sendJson(response, 400, { error: 'invalid JSON' }); return true; }
    if (!createHostJoinCodeRequestSchema.safeParse(body).success) { sendJson(response, 400, { error: 'invalid join-code request' }); return true; }
    sendJson(response, 201, ctx.joinCodes.mintForwardOnly());
    return true;
  }

  if (path === '/api/v1/hosts/bootstrap' && method === 'POST') {
    let body: unknown = {};
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: 'invalid JSON' });
      return true;
    }
    const parsed = hostBootstrapRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid bootstrap request' });
      return true;
    }
    const stream = beginNdjson(response);
    try {
      const write = (event: HostBootstrapEvent) => stream.write(event);
      if ('ssh' in parsed.data) await bootstrapHostBySsh(ctx, parsed.data.ssh, write);
      else await bootstrapHostForProject(ctx, parsed.data.projectId, write);
    } catch (error) {
      stream.write({
        type: 'error',
        code: 'unknown',
        message: error instanceof Error ? error.message : 'Host install failed'
      });
    } finally {
      stream.end();
    }
    return true;
  }

  if (path === '/api/v1/hosts/relaunch-local' && method === 'POST') {
    const result = await relaunchLocalHostDaemon(ctx);
    sendJson(response, result.ok ? 200 : 503, result);
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

  const repair = routeParams(path, '/api/v1/hosts/:id/repair');
  if (repair && method === 'POST') {
    const host = requireHost(ctx, repair.id);
    if (!host) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    const stream = beginNdjson(response);
    try {
      await repairHost(ctx, host.id, (event) => stream.write(event));
    } catch (error) {
      stream.write({
        type: 'error',
        code: 'unknown',
        message: error instanceof Error ? error.message : 'Host repair failed'
      });
    } finally {
      stream.end();
    }
    return true;
  }

  const sshIdentity = routeParams(path, '/api/v1/hosts/:id/ssh-identity');
  if (sshIdentity && method === 'PATCH') {
    const host = requireHost(ctx, sshIdentity.id);
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
    const parsed = hostSshIdentityRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid SSH identity' });
      return true;
    }
    let identity: ReturnType<typeof parseSshIdentity>;
    try {
      identity = parseSshIdentity(parsed.data);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'invalid SSH identity' });
      return true;
    }
    const updated = updateHostSshIdentity(ctx.db, host.id, identity);
    if (!updated || updated.destroyedAt) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    emitHostsChanged(ctx);
    // A machine that just learned its SSH identity may now serve existing remote projects.
    await (ctx.remoteProjectReconciler?.request() ?? reconcileRemoteProjectBindings(ctx)).catch((error: unknown) => {
      console.warn(`[zcc] remote project reconcile failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return 0;
    });
    sendJson(response, 200, toPublicHost(updated, connectedSet(ctx)));
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
    if (!requireHost(ctx, ceiling.id)) {
      sendJson(response, 404, { error: 'host not found' });
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
    try {
      ctx.hostHub.ensureHostSessionReady(host.id);
      const result = await ctx.hostHub.callHostOnlineRpc<{
        directory: string;
        parent: string | null;
        entries: Array<{ name: string; kind: 'file' | 'directory'; path: string }>;
      }>({
        hostId: host.id,
        command: query.data.path
          ? { type: 'host.browse_directory', path: query.data.path }
          : { type: 'host.browse_directory' }
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

  const pathsExist = routeParams(path, '/api/v1/hosts/:id/paths/exist');
  if (pathsExist && method === 'POST') {
    const host = requireHost(ctx, pathsExist.id);
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
    const parsed = hostPathsExistRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid paths exist request' });
      return true;
    }
    try {
      ctx.hostHub.ensureHostSessionReady(host.id);
      const result = await ctx.hostHub.callHostOnlineRpc({
        hostId: host.id,
        command: { type: 'host.paths_exist', paths: parsed.data.paths }
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

  const pickFolder = routeParams(path, '/api/v1/hosts/:id/pick-folder');
  if (pickFolder && method === 'POST') {
    const host = requireHost(ctx, pickFolder.id);
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
    const parsed = hostPickFolderRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid pick-folder request' });
      return true;
    }
    if (parsed.data.clientHostId !== host.id) {
      sendJson(response, 409, {
        error: 'native_picker_unavailable',
        message: 'Native folder picker is only available when the browser helper and work host are on the same machine'
      });
      return true;
    }
    try {
      ctx.hostHub.ensureHostSessionReady(host.id);
      const result = await ctx.hostHub.callHostOnlineRpc({
        hostId: host.id,
        timeoutMs: FOLDER_PICKER_TIMEOUT_MS,
        command: { type: 'host.pick_folder' }
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
        sendJson(response, 503, { error: error.message, code: error.code });
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
    } catch (error) {
      if (error instanceof HostUnavailableError) {
        sendJson(response, 503, { error: error.message });
        return true;
      }
      sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
    const stream = beginNdjson(response);
    try {
      const result = await ctx.hostHub.callHostOnlineRpc<{ events: unknown[] }>({
        hostId: host.id,
        command: {
          type: 'provider.cli_install',
          provider: parsed.data.provider,
          actionKind: parsed.data.actionKind
        },
        timeoutMs: 11 * 60_000
      });
      for (const event of result.events ?? []) stream.write(event);
    } catch (error) {
      stream.write({
        type: 'error',
        provider: parsed.data.provider,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      stream.end();
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
    const patch = parseHostUpdate(body);
    if (!patch) {
      sendJson(response, 400, { error: 'invalid host update' });
      return true;
    }
    let updated = requireHost(ctx, one.id);
    if (!updated || updated.destroyedAt) {
      sendJson(response, 404, { error: 'host not found' });
      return true;
    }
    if (patch.defaultWorkspacePath !== undefined && updated.isPrimary) {
      sendJson(response, 400, { error: 'primary host has no SSH workspace default' });
      return true;
    }
    if (patch.name) {
      updated = renameHost(ctx.db, one.id, patch.name);
      if (!updated || updated.destroyedAt) {
        sendJson(response, 404, { error: 'host not found' });
        return true;
      }
    }
    if (patch.defaultWorkspacePath !== undefined) {
      updated = updateHostDefaultWorkspacePath(ctx.db, one.id, patch.defaultWorkspacePath);
      if (!updated || updated.destroyedAt) {
        sendJson(response, 404, { error: 'host not found' });
        return true;
      }
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
    try { await revokeConnectHost(ctx, host.id); }
    catch { sendJson(response, 503, { error: 'Could not revoke account access. Retry removing this machine when Connect is available.' }); return true; }
    ctx.hostHub.getSession(host.id)?.socket.close(4003, 'host-removed');
    ctx.hostHub.detach(host.id, 'removed');
    ctx.joinCodes.invalidateHost(host.id);
    await closeTunnelHost(ctx, host, (text) => console.warn(`[zcc] ${text}`));
    destroyHost(ctx.db, host.id);
    emitHostsChanged(ctx);
    sendJson(response, 200, { ok: true as const });
    return true;
  }

  return false;
}
