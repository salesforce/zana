import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getHost, getPrimaryHost } from '@zana-ai/zcc-db';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { providerReadinessResultSchema, providerSignInRequestSchema, type ProviderReadinessResponse } from '@zana-ai/zcc-server-contract';
import { bridgeLaunchForProvider, getThreadProvider } from '../services/threads/thread-provider-catalog.js';
import { isUnknownProviderHealthCommand } from '../services/threads/provider-health-probe.js';
import type { ProductHttpContext, ProductTerminalRecord } from './product-context.js';
import { readJsonBody, sendJson } from './json.js';
import { recoverFailedTerminalStart } from './terminal-start-recovery.js';
import { registerProductTerminal } from './terminal-retention.js';
import { AmbiguousHostError, HostUnavailableError } from './host-hub.js';

const starts = new WeakMap<ProductHttpContext, Map<string, Promise<TerminalSession>>>();
class ProviderReadinessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const problem = (status: number, code: string, message: string) => new ProviderReadinessError(status, code, message);
function publicSession(record: ProductTerminalRecord): TerminalSession {
  const { outputText: _text, outputTruncated: _truncated, outputEndOffset: _offset, ...session } = record;
  return session;
}

export async function getProviderReadiness(ctx: ProductHttpContext, providerId: string, requestedHostId?: string): Promise<ProviderReadinessResponse> {
  const provider = getThreadProvider(providerId);
  if (!provider || provider.unavailableReason) throw problem(404, 'provider-unavailable', 'Provider plugin is unavailable.');
  const hostId = ctx.hostHub.resolveHostId(requestedHostId);
  const host = getHost(ctx.db, hostId);
  if (!host || host.destroyedAt || host.enrollmentCapability !== 'execution') throw problem(403, 'host-unavailable', 'Machine is not authorized for execution.');
  try {
    const raw = await ctx.hostHub.callHostOnlineRpc({
      hostId, timeoutMs: 10_000,
      command: { type: 'provider.health', providerId, bridgeLaunch: bridgeLaunchForProvider(providerId, ctx.pluginHostArtifacts),
        ...(host.homeDir ? { cwd: host.homeDir } : {}) },
    });
    const parsed = providerReadinessResultSchema.safeParse(raw);
    if (!parsed.success) throw problem(502, 'invalid-provider-health', 'Provider returned an invalid readiness response.');
    return { providerId, hostId, result: parsed.data };
  } catch (error) {
    if (isUnknownProviderHealthCommand(error)) return { providerId, hostId, result: { supported: false } };
    throw error;
  }
}

export function startProviderSignIn(ctx: ProductHttpContext, providerId: string, hostId: string, localBrowser: boolean): Promise<TerminalSession> {
  let pending = starts.get(ctx);
  if (!pending) { pending = new Map(); starts.set(ctx, pending); }
  const key = JSON.stringify([hostId, providerId]);
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 4) return Promise.reject(problem(429, 'sign-in-busy', 'Wait for the current sign-in requests to finish.'));
  const start = (async () => {
    const instance = ctx.hostHub.ensureHostSessionReady(hostId).instanceId;
    const { result } = await getProviderReadiness(ctx, providerId, hostId);
    if (!result.supported || !['unauthenticated', 'expired'].includes(result.health.status)) {
      throw problem(409, 'sign-in-not-required', 'Sign-in is only available when the provider reports missing or expired credentials.');
    }
    const command = localBrowser && getPrimaryHost(ctx.db)?.id === hostId
      ? result.health.localLoginCommand ?? result.health.loginCommand : result.health.loginCommand;
    if (!command) throw problem(409, 'sign-in-unavailable', 'This provider manages authentication externally.');
    if (ctx.hostHub.ensureHostSessionReady(hostId).instanceId !== instance) throw problem(409, 'host-changed', 'Machine reconnected. Check status and try again.');
    const active = [...ctx.terminalSessions.values()].find((session) => session.hostId === hostId && session.providerSignIn?.providerId === providerId && session.status !== 'exited');
    if (active) return publicSession(active);
    const home = getHost(ctx.db, hostId)?.homeDir;
    if (!home) throw problem(409, 'home-unavailable', 'Machine home directory is unavailable. Reconnect and try again.');
    const record: ProductTerminalRecord = {
      id: randomUUID(), projectId: `provider-sign-in:${hostId}`, hostId, daemonInstanceId: instance,
      providerSignIn: { providerId }, title: `${getThreadProvider(providerId)!.displayName} sign-in`,
      profile: 'shell', cwd: home, status: 'starting', createdAt: Date.now(), launchCommand: command,
    };
    registerProductTerminal(ctx.terminalSessions, record);
    try {
      const started = await ctx.hostHub.callHostOnlineRpc<{ pid?: number }>({
        hostId, command: { type: 'terminal.start', sessionId: record.id, root: home, cwd: home, cols: 100, rows: 24, command },
      });
      record.pid = started.pid;
      if (record.status === 'starting') record.status = 'running';
    } catch (error) {
      await recoverFailedTerminalStart(record, () => ctx.hostHub.callHostOnlineRpc({ hostId, command: { type: 'terminal.stop', sessionId: record.id }, timeoutMs: 5_000 }));
      throw error;
    } finally {
      ctx.terminalSessions.set(record.id, record);
      ctx.hub.emit('terminals:updated', publicSession(record));
    }
    return publicSession(record);
  })();
  pending.set(key, start);
  void start.finally(() => pending.delete(key)).catch(() => {});
  return start;
}

/** Called after the common product API Origin / JSON guard. No renderer commands or paths. */
export async function handleProviderReadinessApi(request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext, url: URL): Promise<boolean> {
  const match = /^\/api\/v1\/system\/providers\/([^/]+)\/(health|sign-in)$/u.exec(url.pathname);
  if (!match) return false;
  try {
    const providerId = decodeURIComponent(match[1]!);
    if (match[2] === 'health' && request.method === 'GET') {
      sendJson(response, 200, await getProviderReadiness(ctx, providerId, url.searchParams.get('hostId') ?? undefined));
      return true;
    }
    if (match[2] === 'sign-in' && request.method === 'POST') {
      const body = providerSignInRequestSchema.safeParse(await readJsonBody(request));
      if (!body.success) throw problem(400, 'invalid-request', 'Supply a machine ID and optional localBrowser flag.');
      sendJson(response, 201, { ok: true, value: await startProviderSignIn(ctx, providerId, body.data.hostId, body.data.localBrowser === true) });
      return true;
    }
    return false;
  } catch (error) {
    const status = error instanceof ProviderReadinessError ? error.status
      : error instanceof HostUnavailableError ? 503 : error instanceof AmbiguousHostError ? 409 : 502;
    sendJson(response, status, { ok: false, code: error instanceof ProviderReadinessError ? error.code : 'provider-unavailable',
      message: error instanceof ProviderReadinessError ? error.message : 'Could not reach the provider on this machine. Reconnect and try again.' });
    return true;
  }
}
