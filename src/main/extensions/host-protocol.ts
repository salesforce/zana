/**
 * Wire protocol for the per-extension `utilityProcess` host (P3-A).
 *
 * Electron-free + dependency-free on purpose: this file is imported by BOTH the
 * Electron-side process host (`process-host.ts`) AND the Node-side child
 * bootstrap (`host-child.ts`), and by the vitest router/dispatch tests. Keep it
 * pure types + tiny pure helpers so it can be imported anywhere.
 *
 * Two directions cross the `MessagePort`:
 *
 *   host → child
 *     {type:'init',      entryPath, moduleId}       // one-shot, first message
 *     {type:'call',      callId, capability, args}  // dispatch a ModuleHost.call
 *     {type:'lifecycle', callId, hook}              // fire onInstall / onUninstall
 *     {type:'teardown',  callId}                    // ask the child to teardown
 *
 *   child → host
 *     {type:'ready',    moduleId, capabilities}     // setup() resolved; lists cap names
 *     {type:'setup-error', moduleId, error}         // setup() threw → child stays dead
 *     {type:'result',   callId, ok:true,  result}   // a call/teardown resolved
 *     {type:'result',   callId, ok:false, error}    // a call/teardown rejected/threw
 *     {type:'broker',   reqId, method, args}        // ctx.storage/log forwarded to host
 *
 *   host → child (reply to a broker request)
 *     {type:'broker-result', reqId, ok:true,  result}
 *     {type:'broker-result', reqId, ok:false, error}
 *
 * The child NEVER supplies its own moduleId on broker requests: the host owns
 * the port↔moduleId mapping (anti-spoof, design §3d), so storage is namespaced
 * by the AUTHENTICATED id the host associates with that child's port, not a
 * value the child sends. `init` carries the moduleId only so the child can tag
 * its own logs; it is not trusted for storage routing.
 */

/**
 * Names of the brokered `MainModuleContext` methods the child can call. The
 * `exec`/`fs.*`/`fetch` methods (P3-B) are gated host-side against the
 * extension's permissions BEFORE the host performs the op; an ungranted request
 * comes back as a `broker-result` with `ok:false` + a PermissionDenied message.
 */
export type BrokerMethod =
  | 'storage.get'
  | 'storage.set'
  | 'log'
  | 'exec'
  | 'fs.readFile'
  | 'fs.writeFile'
  | 'fs.rm'
  | 'fs.readdir'
  | 'fs.stat'
  | 'fs.exists'
  | 'fetch'
  // Brokered call to a HOST-MANAGED MCP server (stdio JSON-RPC). Gated host-side
  // by the `mcp` permission + `mcpAllowlist` scope before the pool is touched.
  | 'mcp'
  // Brokered EXPLICIT workspace init (creates `.zana/` + subdirs + config.json
  // for a workspace that has none). Same `mcp` permission + `mcpAllowlist` gate
  // as `mcp` — it's the pool's one-off write path, not a general MCP tool call —
  // and the same host-confined workspace hint. Deliberately a SEPARATE method
  // (not folded into `mcp`'s tool-call shape) since it has no `serverId`/`tool`.
  | 'mcp.initWorkspace'
  // Read-only counterpart to `mcp.initWorkspace`: whether `.zana/` already has
  // its full skeleton for a workspace, without writing anything. Same gate.
  | 'mcp.isWorkspaceInitialized'
  // Brokered LLM micro-call (Epic C). Gated host-side by the `llm:invoke`
  // permission + the global `extensionLlmEnabled` kill switch; the host clamps
  // input/output size, model tier, rate, and concurrency before running it on
  // its own LlmService.
  | 'llm.run'
  // Brokered subscribe/unsubscribe to a HOST-MANAGED live push source (SSE /
  // socket tail). Gated host-side by the `stream` permission + `streamAllowlist`
  // scope before the relay opens a connection. `stream.open` resolves the opaque
  // subscription id; the FRAMES do NOT flow back over this port — they are pushed
  // core→renderer directly (see the stream-relay note), keeping the fire-hose out
  // of the child process. `stream.close` unsubscribes (ownership-checked).
  | 'stream.open'
  | 'stream.close'
  // W1-3: fire-and-forget push main→renderer on a namespaced topic. Frames go
  // core→renderer via the StreamSink relay (NOT back over this port), same path
  // as `stream.open` frames. No permission token (extension pushing its own data
  // to its own panels), but bounded: ≤128KiB/frame, ~50fps, idle-TTL.
  | 'emit'
  // W1-4 (trust inversion): a MAIN module asks the HOST to perform a
  // renderer-only shell action it structurally can't do itself. `host.toast` /
  // `host.navigate` are fire-and-forget UI nudges (void reply, no token, like
  // `emit`); `host.selectProject` is gated host-side by `projects:select`;
  // `host.requestLaunch` is gated by `session:launch` and PARKS the request in a
  // durable, bounded per-module queue in MAIN — main NEVER spawns a session
  // directly (Rule 1) — resolving `{ parked, requestId }` so the child learns the
  // outcome. The ACTION is delivered core→renderer over the
  // `IPC.modules.hostCommand` push channel (a parked launch also drains via a
  // pull IPC so a launch queued while no panel is listening is never dropped),
  // NOT back over the broker port — the child only fires the intent + reply.
  | 'host.toast'
  | 'host.requestLaunch'
  | 'host.navigate'
  | 'host.selectProject'
  // W1-5 main-reachable host UX: a MAIN module asks the shell to render a
  // confirm/alert to the human and awaits their answer over this port's
  // round-trip (unlike the fire-and-forget host.toast/navigate). No permission
  // token (pure UI). The shell delivers the dialog core→renderer over the
  // `IPC.modules.hostCommand` push and replies the answer via a dialog-reply
  // pull IPC → the relay resolves this pending broker request. Fails closed
  // (`false`/`null`) when no renderer can receive it — never hangs.
  | 'host.confirm'
  | 'host.alert'
  // Persona/team contribution (in-memory, host-stamped provenance). Like
  // storage/log these are UNCONDITIONAL (not `caps`-gated): registration is
  // inert declarative data, the teeth are at the already-gated launch path.
  | 'personas.register'
  | 'personas.clear'
  | 'teams.register'
  | 'teams.clear'
  | 'sshHosts.register'
  | 'sshHosts.clear'
  | 'sshHosts.list'
  // Phase B: push a durable Inbox entry on behalf of a MAIN module, gated by
  // the `inbox:push` permission. The host stamps `extensionSource` from the
  // AUTHENTICATED moduleId bound to this port — never a payload value.
  | 'inbox.push';

// ---- host → child ----------------------------------------------------------

export interface InitMessage {
  type: 'init';
  /** Absolute path to the extension's main entry the child will `import()`. */
  entryPath: string;
  /** The extension id, for the child's own log tagging only (NOT trusted). */
  moduleId: string;
}

export interface CallMessage {
  type: 'call';
  callId: number;
  capability: string;
  args: unknown[];
}

export interface TeardownMessage {
  type: 'teardown';
  callId: number;
}

/**
 * Fire an install/uninstall lifecycle hook on the child's module. Separate from
 * `call` (a renderer-driven capability) — these are HOST-driven, one-shot, and
 * carry no user args: the child invokes `module[hook]?.(ctx)`. The reply reuses
 * {@link ResultMessage} (by `callId`), like teardown.
 */
export interface LifecycleMessage {
  type: 'lifecycle';
  callId: number;
  /** Which `MainModule` lifecycle method to invoke. */
  hook: 'onInstall' | 'onUninstall';
}

/** The lifecycle hooks a {@link LifecycleMessage} can fire. */
export type LifecycleHook = LifecycleMessage['hook'];

export interface BrokerResultMessage {
  type: 'broker-result';
  reqId: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type HostToChild =
  | InitMessage
  | CallMessage
  | LifecycleMessage
  | TeardownMessage
  | BrokerResultMessage;

// ---- child → host ----------------------------------------------------------

export interface ReadyMessage {
  type: 'ready';
  moduleId: string;
  /** Capability names the module's setup() returned (for diagnostics). */
  capabilities: string[];
}

export interface SetupErrorMessage {
  type: 'setup-error';
  moduleId: string;
  error: string;
}

export interface ResultMessage {
  type: 'result';
  callId: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface BrokerMessage {
  type: 'broker';
  reqId: number;
  method: BrokerMethod;
  args: unknown[];
}

export type ChildToHost =
  | ReadyMessage
  | SetupErrorMessage
  | ResultMessage
  | BrokerMessage;

// ---- helpers ---------------------------------------------------------------

/** Normalize an unknown thrown value to a string the other side can render. */
export function errToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
