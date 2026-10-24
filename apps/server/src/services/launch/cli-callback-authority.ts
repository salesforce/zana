import {
  CLI_CALLBACK_MAX_ACTIVE_NATIVE_TOOL, CLI_CALLBACK_MAX_BODY_BYTES, CLI_CALLBACK_MAX_RESPONSE_BYTES, CliCallbackGrantSchema,
  CliCallbackRequestSchema, CliCallbackResponseSchema, cliCallbackPaths, isCliNativeToolPath,
  type CliCallbackGrant, type CliCallbackWireResponse
} from '@zana-ai/zcc-contracts/cli-callbacks';
import { getHost } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { createNativeToolPolicyHook } from '../../plugins/native-tool-hook.js';
import { decideMainOwnedToolPolicy } from '../../plugins/native-tool-policy.js';

/** Below the relay's `curl -m 5`, leaving time for the proxy, daemon client and transit. */
const NATIVE_TOOL_POLICY_TIMEOUT_MS = 3_000;
/** Per session; a global ceiling still bounds all sessions together. */
const MAX_PENDING_NATIVE_TOOL_PER_SESSION = 8;
const MAX_PENDING_NATIVE_TOOL = CLI_CALLBACK_MAX_ACTIVE_NATIVE_TOOL;

interface SessionOwner { projectId: string; hostId: string; daemonInstanceId: string; active: boolean; profile?: string }
interface Grant {
  identity: CliCallbackGrant;
  owner: SessionOwner;
  paths: ReadonlySet<string>;
  active: Set<AbortController>;
}

export function createProductCliCallbackAuthority(ctx: ProductHttpContext, mcpBaseUrl: () => string | null): CliCallbackAuthority {
  return new CliCallbackAuthority({ mcpBaseUrl, plugins: () => ctx.plugins, owner(sessionId) {
    const session = ctx.terminalSessions.get(sessionId);
    if (!session || session.profile === 'shell' || !session.daemonInstanceId || session.status === 'exited'
      || !ctx.projects.list().some(project => project.id === session.projectId)) return undefined;
    const host = getHost(ctx.db, session.hostId), connected = ctx.hostHub.getSession(session.hostId);
    if (!host || host.destroyedAt || connected?.instanceId !== session.daemonInstanceId) return undefined;
    return { projectId: session.projectId, hostId: session.hostId, daemonInstanceId: session.daemonInstanceId, active: true, profile: session.profile };
  } });
}
function decodeBody(bodyBase64: string): Buffer {
  const body = Buffer.from(bodyBase64, 'base64');
  if (body.length > CLI_CALLBACK_MAX_BODY_BYTES || body.toString('base64') !== bodyBase64) throw new Error('Invalid CLI callback body');
  return body;
}
export class CliCallbackError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Main grants one session after reserving its product record. A daemon cannot
 * register grants through HTTP or choose the owner callback destination. Grants
 * are process-local and must be reauthorized after the product owner restarts. */
export class CliCallbackAuthority {
  private grants = new Map<string, Grant>();
  private pending = 0;
  private pendingNativeTool = 0;
  private pendingNativeToolBySession = new Map<string, number>();
  private disposed = false;
  constructor(private readonly options: {
    owner(sessionId: string): SessionOwner | undefined;
    mcpBaseUrl(): string | null;
    /** Read late: plugins attach to the product context after the authority exists. */
    plugins?(): Parameters<typeof decideMainOwnedToolPolicy>[0];
    /** Policy failures are denials; this records why. Defaults to console.warn. */
    log?(message: string): void;
    fetch?: typeof fetch;
    timeoutMs?: number;
  }) {}

  register(input: CliCallbackGrant): void {
    if (this.disposed) throw new Error('CLI callbacks are closed');
    const identity = CliCallbackGrantSchema.parse(input), owner = this.options.owner(identity.sessionId);
    if (!owner?.active || owner.projectId !== identity.projectId) throw new Error('CLI session ownership is unavailable');
    const existing = this.grants.get(identity.sessionId);
    if (existing) {
      if (JSON.stringify(existing.identity) !== JSON.stringify(identity) || !this.current(existing)) throw new Error('CLI callback grant cannot be replaced');
      return;
    }
    for (const [id, grant] of this.grants) if (!this.current(grant)) this.revoke(id);
    if (this.grants.size >= 128) throw new Error('CLI callback capacity reached');
    this.grants.set(identity.sessionId, { identity, owner: { ...owner }, paths: cliCallbackPaths(identity), active: new Set() });
  }

  revoke(sessionId: string): void {
    const grant = this.grants.get(sessionId); this.grants.delete(sessionId);
    for (const controller of grant?.active ?? []) controller.abort();
  }

  /** A transport loss cancels active callbacks. The same daemon may reconnect;
   * its recorded grant still has to pass current-owner checks on the next call. */
  abortHost(hostId: string): void {
    for (const grant of this.grants.values()) {
      if (grant.owner.hostId === hostId) for (const controller of grant.active) controller.abort();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const id of this.grants.keys()) this.revoke(id);
  }

  private current(grant: Grant): boolean {
    const owner = this.options.owner(grant.identity.sessionId);
    return !!owner?.active && owner.projectId === grant.owner.projectId && owner.hostId === grant.owner.hostId
      && owner.daemonInstanceId === grant.owner.daemonInstanceId;
  }

  /** The tool-call policy is answered here: main only resolves PTYs it owns, never a host-daemon's.
   * Identity is the grant plus the server's own session record, never the agent's request body. */
  private async forwardNativeTool(grant: Grant, bodyBase64: string, signal: AbortSignal): Promise<CliCallbackWireResponse> {
    const { projectId, sessionId } = grant.identity, session = this.pendingNativeToolBySession.get(sessionId) ?? 0;
    if (this.pendingNativeTool >= MAX_PENDING_NATIVE_TOOL || session >= MAX_PENDING_NATIVE_TOOL_PER_SESSION) throw new CliCallbackError(429, 'CLI native tool capacity reached');
    const body = decodeBody(bodyBase64);
    this.pendingNativeTool++; this.pendingNativeToolBySession.set(sessionId, session + 1);
    let timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined;
    try {
      const hook = createNativeToolPolicyHook({
        getSession: id => {
          const owner = this.options.owner(id);
          return id === sessionId && owner?.active && owner.profile && this.current(grant)
            ? { id, projectId, profile: owner.profile, status: 'running' } : null;
        },
        log: message => (this.options.log ?? console.warn)(`[cli-callback] ${message}`),
        decider: () => request => decideMainOwnedToolPolicy(this.options.plugins?.(), request)
      });
      const verdict = await Promise.race([
        hook(projectId, sessionId, body.toString('utf8')).then(
          result => result ?? { decision: 'deny' as const, reason: 'no native tool policy decision' },
          () => ({ decision: 'deny' as const, reason: 'native tool policy error' })
        ),
        new Promise<{ decision: 'deny'; reason: string }>(resolve => {
          timer = setTimeout(() => resolve({ decision: 'deny', reason: 'native tool policy timed out' }), NATIVE_TOOL_POLICY_TIMEOUT_MS);
        }),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error('callback aborted'));
          if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
        })
      ]);
      if (this.grants.get(sessionId) !== grant || !this.current(grant)) throw new CliCallbackError(403, 'CLI callback ownership changed');
      const reply = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } };
      return CliCallbackResponseSchema.parse({
        status: 200, contentType: 'application/json; charset=utf-8', bodyBase64: Buffer.from(JSON.stringify(reply)).toString('base64')
      });
    } finally {
      clearTimeout(timer); if (onAbort) signal.removeEventListener('abort', onAbort);
      this.pendingNativeTool--;
      const left = (this.pendingNativeToolBySession.get(sessionId) ?? 1) - 1;
      if (left > 0) this.pendingNativeToolBySession.set(sessionId, left); else this.pendingNativeToolBySession.delete(sessionId);
    }
  }

  async forward(authenticatedHostId: string, input: unknown, signal: AbortSignal): Promise<CliCallbackWireResponse> {
    const request = CliCallbackRequestSchema.parse(input);
    const grant = this.grants.get(request.sessionId);
    if (!grant || !this.current(grant) || grant.owner.hostId !== authenticatedHostId || !grant.paths.has(request.path)) throw new CliCallbackError(403, 'CLI callback is not authorized');
    if (isCliNativeToolPath(request.path)) return this.forwardNativeTool(grant, request.bodyBase64, signal);
    if (this.pending >= 8) throw new CliCallbackError(429, 'CLI callback capacity reached');
    const body = decodeBody(request.bodyBase64);
    const base = this.options.mcpBaseUrl();
    if (!base) throw new CliCallbackError(503, 'CLI callback owner is unavailable');
    const url = new URL(base);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid CLI callback owner');
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(this.options.timeoutMs ?? 15 * 60_000)]);
    combined.throwIfAborted();
    this.pending++; grant.active.add(controller);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await (this.options.fetch ?? fetch)(url.origin + request.path, {
        method: 'POST', headers: request.headers, body: new Uint8Array(body), signal: combined, redirect: 'error'
      });
      const advertised = response.headers.get('content-length');
      if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > CLI_CALLBACK_MAX_RESPONSE_BYTES)) throw new Error('CLI callback response exceeds limit');
      const chunks: Buffer[] = []; let size = 0;
      reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const item = await reader.read(); if (item.done) break;
          size += item.value.byteLength;
          if (size > CLI_CALLBACK_MAX_RESPONSE_BYTES) throw new Error('CLI callback response exceeds limit');
          chunks.push(Buffer.from(item.value));
        }
      }
      combined.throwIfAborted();
      if (this.grants.get(request.sessionId) !== grant || !this.current(grant)) throw new Error('CLI callback ownership changed');
      return CliCallbackResponseSchema.parse({ status: response.status, contentType: response.headers.get('content-type') ?? undefined, bodyBase64: Buffer.concat(chunks, size).toString('base64') });
    } finally {
      controller.abort(); await reader?.cancel().catch(() => undefined);
      grant.active.delete(controller); this.pending--;
    }
  }
}
