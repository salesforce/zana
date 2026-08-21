/**
 * Local control plane for the `zcc` CLI — a Unix-domain socket the CLI talks to
 * so a human (or a script) can drive the *running* app: list/spawn/close
 * terminals, message agents, fire schedules, read live status.
 *
 * Why a UDS and not another HTTP port (the MCP server already exists):
 *   - The socket path is fixed (`~/.zcc/control.sock`), so there's no ephemeral
 *     port to discover — the MCP server deliberately binds `:0` and we keep it
 *     undiscoverable. A fixed control path is the opposite need.
 *   - Filesystem perms (`0600`, dir `0700`) gate access to the owning uid and
 *     close the entire browser/CSRF/DNS-rebinding class that a loopback TCP port
 *     opens (browsers cannot open AF_UNIX).
 *
 * Trust model (mirrors the rest of main — see CLAUDE.md #1/#2):
 *   - The CLI is just another UNTRUSTED client. It asserts an intent; main
 *     authorizes. Path confinement on `term.create` runs the SAME code the IPC
 *     handler runs (injected as `createTerminal`), so the trust boundary does
 *     not move out to the caller.
 *   - A bearer token (`~/.zcc/control.token`, `0600`) + a per-boot nonce
 *     authenticate "a process that can read a 0600 file in my home AND is
 *     talking to THIS app instance". The nonce makes a stale token from a prior
 *     boot un-replayable.
 *   - That token alone does NOT distinguish a human from an agent the app
 *     spawned. Each pty therefore receives a boot-local, session-bound MAC. The
 *     CLI forwards it with the session id; main verifies it before granting the
 *     bounded orchestrator surface. A missing/invalid MAC never promotes a
 *     caller. Requests with no bound session are operator candidates, but every
 *     mutation requires a native main-process confirmation before dispatch.
 *
 *     HONEST LIMITATION: same-uid processes can still read the shared control
 *     token and omit their session fields. Such a request can reach only the
 *     native confirmation ceremony; it cannot silently mutate. Preventing even
 *     the prompt requires per-process OS isolation or an operator credential
 *     unavailable to all child processes.
 *
 * Protocol: one request per connection. The client connects, writes a single
 * JSON object followed by `\n`, and reads a single JSON response line back; the
 * server then closes. No streaming in v1 — `run --wait` polls `session.status`.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { chmodSync, mkdirSync, rmSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type {
  Result,
  TerminalSession,
  AgentState,
  ScheduledTask,
  PersonaSummary,
  TeamSummary
} from '@zana-ai/zcc-domain/product';
import type { CreateTerminalRequest } from '@zana-ai/zcc-domain/product';
import { parseProfile } from '@zana-ai/zcc-domain/launch-provider';
import { scheduleSummary } from '@zana-ai/zcc-domain/schedule-spec';

/** Caps a single request line so a malformed/hostile client can't balloon memory. */
const MAX_REQUEST_BYTES = 256 * 1024;
/** Slow-loris guard: a client that connects and dribbles is dropped. */
const REQUEST_TIMEOUT_MS = 10_000;
/**
 * Ceiling on simultaneous in-flight connections (CLAUDE.md #5 — bound unbounded
 * work on the main event loop). The CLI is one-request-per-connection and short;
 * a same-uid process opening thousands of sockets is the only way to exceed
 * this, and that's exactly what we cap. Excess connections are destroyed
 * immediately, before any buffering or timer is allocated.
 */
const MAX_INFLIGHT_CONNECTIONS = 64;

/**
 * Constant-time string compare for the bearer token / nonce. `===` short-
 * circuits at the first differing byte, leaking a timing oracle on the secret.
 *
 * We SHA-256 both sides first, then timingSafeEqual the two 32-byte digests.
 * Hashing makes the compared buffers unconditionally equal-length, so there is
 * NO length branch to leak through (an earlier version burned a comparison on a
 * length mismatch, but that compared the *caller's* buffer — it still revealed
 * the secret's length via timing). Digest comparison is uniform regardless of
 * input length and never throws.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a, 'utf8').digest();
  const bh = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ah, bh);
}

/**
 * The dependencies the control plane needs, injected so this module imports no
 * electron and stays unit-testable. Each closure is the SAME authority the IPC
 * handlers use — main authorizes, the CLI just asks.
 */
export interface ControlPlaneDeps {
  /** List registered projects (read surface + name/id resolution). */
  listProjects: () => Array<{ id: string; name: string; tag?: string; path: string }>;
  /** Live terminal sessions for a project (or all when omitted). */
  listTerminals: (projectId?: string) => TerminalSession[];
  /**
   * Spawn a terminal. MUST run the same realpath path-confinement the IPC
   * handler runs — passed in from index.ts so there's one copy of the gate.
   */
  createTerminal: (
    req: CreateTerminalRequest,
    caller: { class: CallerClass; sessionId?: string }
  ) => Result<TerminalSession> | Promise<Result<TerminalSession>>;
  /** Close a live session. Returns false when the id is unknown. */
  closeTerminal: (sessionId: string) => boolean;
  /**
   * Summarize the given sessions' work to the inbox (when `summarize`), then
   * close them — the `term close-summary` op. Confined to `projectId`: only ids
   * resolving to a live session in that project are summarized/closed. Operator-
   * only (not in {@link AGENT_ALLOWED_OPS}).
   */
  summarizeAndCloseTerminals: (
    projectId: string,
    sessionIds: string[],
    summarize: boolean
  ) => Promise<{ closed: number; summarized: number; entryId?: string }>;
  /** Inject a line at a session's prompt (the reply() primitive). */
  replyTerminal: (sessionId: string, text: string) => boolean;
  /** Live agent state for a session — drives `run --wait` and `status`. */
  getAgentStatus: (sessionId: string) => AgentState;
  /** True when the session id is a currently-live pty (caller-class attestation). */
  isLiveSession: (sessionId: string) => boolean;
  /**
   * True when the session id is an app-attested ORCHESTRATOR (host-stamped at
   * team launch, cleared on exit — never self-declared). Promotes an otherwise
   * agent-class caller to the bounded {@link ORCHESTRATOR_ALLOWED_OPS} surface.
   * Optional: when absent, no caller is ever promoted past agent-class, so the
   * gate degrades safe.
   */
  isOrchestratorSession?: (sessionId: string) => boolean;
  /** Verify the boot-local credential main bound to a spawned session. */
  verifySessionCredential?: (sessionId: string, credential: unknown) => boolean;
  /** Native human ceremony for an unbound operator candidate's mutation. */
  confirmOperatorMutation?: (op: string, args: Record<string, unknown>) => Promise<boolean>;
  authorizeOrchestratorMutation?: (
    sessionId: string,
    op: 'term.create' | 'term.close' | 'term.close-summary',
    args: Record<string, unknown>
  ) => { ok: true } | { ok: false; reason: string };
  /**
   * The inter-agent registry, fused with live status for `agent ls`.
   * `handle` is the authoritative name (present only once the agent registered);
   * `displayName` is the live tab title. An auto-seeded agent has only the latter.
   */
  listAgents: () => Array<{
    sessionId: string;
    projectId: string;
    handle?: string;
    displayName?: string;
    role?: string;
    capabilities?: string[];
    cwd: string;
  }>;
  /**
   * Send a peer message (mirrors agent_send: resolve handle/id, inject-if-idle,
   * queue). `handle` in the result is the resolved label actually addressed
   * (authoritative handle, else tab title) — always present on success.
   */
  sendToAgent: (
    to: string,
    message: string
  ) => { ok: true; delivered: boolean; handle: string; id: string } | { ok: false; error: string };
  /**
   * Persona catalogue (built-ins + user/project files), projected to
   * non-sensitive metadata. Read-only and agent-allowed — it carries no system
   * prompts or secrets, and an operator needs it to resolve a `--persona <name>`
   * to its id before `term.create`.
   */
  listPersonas: () => PersonaSummary[];
  /**
   * Team catalogue (built-ins + user/project files + extension registrations),
   * projected to non-sensitive metadata. Read-only and agent-allowed.
   */
  listTeams: () => TeamSummary[];
  /** Scheduler reads + the three gated mutations the CLI exposes. */
  listSchedules: () => ScheduledTask[];
  runScheduleNow: (id: string) => Result<ScheduledTask>;
  setScheduleEnabled: (id: string, enabled: boolean) => Result<ScheduledTask>;
  log?: (msg: string) => void;
}

export interface ControlPlaneOptions extends ControlPlaneDeps {
  /** Absolute path to the socket, e.g. `~/.zcc/control.sock`. */
  socketPath: string;
  /** Absolute path to the token file, e.g. `~/.zcc/control.token`. */
  tokenPath: string;
}

export interface ControlPlaneHandle {
  /** The per-boot nonce, surfaced for tests. */
  nonce: string;
  /** Stop the listener and remove the socket + token file. */
  close(): Promise<void>;
}

/** A request as it arrives on the wire (before validation). */
export interface ControlRequest {
  token?: unknown;
  nonce?: unknown;
  /** The CLI fills this from `ZCC_SESSION_ID` when present (i.e. it's an agent). */
  callerSessionId?: unknown;
  /** Session-bound MAC forwarded from ZCC_SESSION_TOKEN. */
  callerCredential?: unknown;
  op?: unknown;
  args?: unknown;
}

export type CallerClass = 'operator' | 'orchestrator' | 'agent';

/** Ops an agent-class caller may invoke — the read surface only. */
const AGENT_ALLOWED_OPS = new Set<string>([
  'status',
  'project.list',
  'persona.list',
  'team.list',
  'agent.list',
  'term.list',
  'sched.list'
]);

/**
 * Ops an ORCHESTRATOR-class caller may invoke — the agent read surface PLUS the
 * project-targeted open/clean-up ops it needs to drive a fleet: spawn an agent
 * into a project (`term.create`), close one (`term.close`), and
 * summarize-then-close a batch (`term.close-summary`). This is the deliberate,
 * bounded exception to the agent gate (CLAUDE.md #7 in spirit): a privileged
 * app-spawned session may open/close agents, but every such op STILL runs the
 * same `createTerminalConfined` path — cwd is realpath-confined to a registered
 * project, so the exception widens *which ops* an attested caller may invoke,
 * never *where* it may reach. The remaining mutating ops (`term.reply`,
 * `agent.send`, `sched.*`) stay operator-only — the orchestrator coordinates
 * peers through the MCP mesh, not the CLI.
 */
const ORCHESTRATOR_ALLOWED_OPS = new Set<string>([
  ...AGENT_ALLOWED_OPS,
  'term.create',
  'term.close',
  'term.close-summary'
]);

/** Every op the control plane understands. */
const KNOWN_OPS = new Set<string>([
  ...AGENT_ALLOWED_OPS,
  'term.create',
  'term.close',
  'term.close-summary',
  'term.reply',
  'agent.send',
  'session.status',
  'sched.runNow',
  'sched.setEnabled',
  'plugin.install',
  'plugin.enable',
  'plugin.disable',
  'plugin.remove',
  'plugin.reload',
  'marketplace.list',
  'marketplace.add'
]);

/**
 * Decide the caller's class. A request that carries a `callerSessionId`
 * matching a live pty is an AGENT (the CLI read it from `ZCC_SESSION_ID`). A
 * forged/stale id that no longer maps to a live session degrades to `agent`
 * too — fail safe (restrict), never grant operator on an unrecognized id.
 * Absence of the field is the operator path (a human shell has no
 * `ZCC_SESSION_ID`).
 *
 * The ORCHESTRATOR tier is layered between: an app-spawned session is promoted
 * from `agent` to `orchestrator` ONLY when `isOrchestratorSession` attests it.
 * That attestation is host-stamped by main at team launch (never self-declared
 * by the caller and never derived from the wire), so a plain agent shelling out
 * to `zcc` cannot reach it — it stays agent-class and read-only. This keeps the
 * promotion app-attested and fail-safe, matching the operator/agent split.
 */
export function classifyCaller(
  callerSessionId: unknown,
  isOrchestratorSession?: (sessionId: string) => boolean,
  callerCredential?: unknown,
  verifySessionCredential?: (sessionId: string, credential: unknown) => boolean
): CallerClass {
  // Any non-empty caller-session marker means "spawned by the app" → agent.
  // Liveness is intentionally NOT checked: a just-exited agent must not get
  // promoted to operator by racing its own teardown, and a forged/stale id only
  // ever moves a caller toward the MORE restrictive class. Only ABSENCE of the
  // field yields operator (a human shell has no ZCC_SESSION_ID).
  if (typeof callerSessionId === 'string' && callerSessionId.length > 0) {
    // App-attested orchestrator sessions get the bounded open/close surface;
    // every other app-spawned session stays a read-only agent.
    if (
      verifySessionCredential?.(callerSessionId, callerCredential) === true &&
      isOrchestratorSession?.(callerSessionId)
    ) return 'orchestrator';
    return 'agent';
  }
  return 'operator';
}

/** True when an op is refused for the given non-operator caller class. */
function isOpRefusedFor(caller: CallerClass, op: string): boolean {
  if (caller === 'operator') return false;
  if (caller === 'orchestrator') return !ORCHESTRATOR_ALLOWED_OPS.has(op);
  return !AGENT_ALLOWED_OPS.has(op);
}

/** Validate auth + op shape. Returns the parsed op/args or a refusal reason. */
export function authorizeRequest(
  req: ControlRequest,
  expected: { token: string; nonce: string },
  isOrchestratorSession?: (sessionId: string) => boolean,
  verifySessionCredential?: (sessionId: string, credential: unknown) => boolean
):
  | { ok: true; op: string; args: Record<string, unknown>; caller: CallerClass; callerSessionId?: string }
  | { ok: false; code: string; message: string } {
  if (typeof req.token !== 'string' || !constantTimeEqual(req.token, expected.token)) {
    return { ok: false, code: 'UNAUTHORIZED', message: 'bad or missing token' };
  }
  if (typeof req.nonce !== 'string' || !constantTimeEqual(req.nonce, expected.nonce)) {
    // A token from a previous boot (token file is per-launch, but defend anyway).
    return { ok: false, code: 'STALE', message: 'nonce mismatch — restart your shell/app' };
  }
  if (typeof req.op !== 'string' || !KNOWN_OPS.has(req.op)) {
    return { ok: false, code: 'BAD_OP', message: `unknown op: ${String(req.op)}` };
  }
  const caller = classifyCaller(
    req.callerSessionId,
    isOrchestratorSession,
    req.callerCredential,
    verifySessionCredential
  );
  if (isOpRefusedFor(caller, req.op)) {
    // An orchestrator that strays past its open/close surface, or a plain agent
    // attempting any mutation, lands here. Both are FORBIDDEN_AGENT — the code
    // names the gate, and the message tells an orchestrator which ops it owns.
    const orchestratorHint =
      caller === 'orchestrator'
        ? ` An orchestrator may open/close agents (term.create, term.close, ` +
          `term.close-summary) but coordinates peers through the MCP mesh, not ` +
          `this op.`
        : ` An agent must use the MCP mesh (agent_send) or ask the user — the CLI ` +
          `does not grant agents control over the app or sibling agents.`;
    return {
      ok: false,
      code: 'FORBIDDEN_AGENT',
      message: `op "${req.op}" is refused for ${caller}-class callers.${orchestratorHint}`
    };
  }
  const args =
    req.args && typeof req.args === 'object' && !Array.isArray(req.args)
      ? (req.args as Record<string, unknown>)
      : {};
  return {
    ok: true,
    op: req.op,
    args,
    caller,
    callerSessionId: caller === 'orchestrator' && typeof req.callerSessionId === 'string'
      ? req.callerSessionId
      : undefined
  };
}

/** Dispatch an authorized op against the injected deps. Pure-ish (deps do the IO). */
let controlPlanePluginService: Awaited<
  ReturnType<typeof import('@zana-ai/zcc-server/plugins/plugin-service')['createPluginService']>
> | null = null;

function getControlPlanePluginService(
  create: () => NonNullable<typeof controlPlanePluginService>
): NonNullable<typeof controlPlanePluginService> {
  if (!controlPlanePluginService) controlPlanePluginService = create();
  return controlPlanePluginService;
}

export async function dispatchOp(
  op: string,
  args: Record<string, unknown>,
  deps: ControlPlaneDeps,
  caller: { class: CallerClass; sessionId?: string } = { class: 'operator' }
): Promise<Result<unknown>> {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  // Per-field size caps for the values that flow to a live TTY / argv verbatim.
  // The 256KB line cap bounds memory, but a quarter-MB shoved at a prompt or
  // into a pty write is a nuisance/escape vector; keep these well under it.
  const MAX_PROMPT = 32_000;
  const MAX_REPLY = 16_000;
  if (caller.class === 'orchestrator' && caller.sessionId && (
    op === 'term.create' || op === 'term.close' || op === 'term.close-summary'
  )) {
    const scoped = deps.authorizeOrchestratorMutation?.(caller.sessionId, op, args)
      ?? { ok: false as const, reason: 'orchestrator scope unavailable' };
    if (!scoped.ok) return { ok: false, code: 'FORBIDDEN_SCOPE', message: scoped.reason };
  }
  // Clamp a terminal dimension to a sane positive int. `typeof NaN === 'number'`,
  // so a bare typeof check would let NaN/0/negative reach node-pty and wedge it.
  const dim = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 1000) : fallback;
  switch (op) {
    case 'status': {
      const projects = deps.listProjects();
      const agents = deps.listAgents().map((a) => ({
        handle: a.handle,
        sessionId: a.sessionId,
        projectId: a.projectId,
        role: a.role,
        state: deps.getAgentStatus(a.sessionId)
      }));
      const schedules = deps
        .listSchedules()
        .filter((s) => s.enabled)
        // `every` kept for back-compat (undefined for cron schedules);
        // `cadence` is the human summary that works for both cron and interval.
        .map((s) => ({
          id: s.id,
          name: s.name,
          every: s.schedule.every,
          cadence: scheduleSummary(s.schedule)
        }));
      return {
        ok: true,
        value: { projects: projects.length, agents, enabledSchedules: schedules }
      };
    }
    case 'project.list':
      return { ok: true, value: deps.listProjects() };
    case 'persona.list':
      return { ok: true, value: deps.listPersonas() };
    case 'team.list':
      return { ok: true, value: deps.listTeams() };
    case 'term.list':
      return { ok: true, value: deps.listTerminals(str(args.projectId)) };
    case 'agent.list':
      return {
        ok: true,
        value: deps.listAgents().map((a) => ({ ...a, state: deps.getAgentStatus(a.sessionId) }))
      };
    case 'sched.list':
      return { ok: true, value: deps.listSchedules() };
    case 'session.status': {
      const id = str(args.sessionId);
      if (!id) return { ok: false, code: 'BAD_ARGS', message: 'sessionId required' };
      return { ok: true, value: { sessionId: id, state: deps.getAgentStatus(id) } };
    }
    case 'term.create': {
      const projectId = str(args.projectId);
      const profile = str(args.profile) as CreateTerminalRequest['profile'] | undefined;
      if (!projectId || !profile) {
        return { ok: false, code: 'BAD_ARGS', message: 'projectId and profile required' };
      }
      if (!parseProfile(profile)) {
        return { ok: false, code: 'BAD_ARGS', message: `unknown profile: ${profile}` };
      }
      const prompt = str(args.prompt);
      if (prompt !== undefined && prompt.length > MAX_PROMPT) {
        return { ok: false, code: 'BAD_ARGS', message: `prompt exceeds ${MAX_PROMPT} chars` };
      }
      // Confinement of `cwd` happens inside createTerminal (the SAME gate the IPC
      // handler uses) — we do not pre-trust the caller's path here.
      return await deps.createTerminal({
        projectId,
        profile,
        cwd: str(args.cwd),
        personaId: str(args.personaId),
        prompt,
        extraArgs: Array.isArray(args.extraArgs)
          ? (args.extraArgs as unknown[]).filter((x): x is string => typeof x === 'string')
          : undefined,
        title: str(args.title),
        cols: dim(args.cols, 80),
        rows: dim(args.rows, 24)
      }, caller);
    }
    case 'term.close': {
      const id = str(args.sessionId);
      if (!id) return { ok: false, code: 'BAD_ARGS', message: 'sessionId required' };
      const closed = deps.closeTerminal(id);
      if (!closed) return { ok: false, code: 'NOT_FOUND', message: `no live session: ${id}` };
      return { ok: true, value: true };
    }
    case 'term.close-summary': {
      const projectId = str(args.projectId);
      const sessionIds = Array.isArray(args.sessionIds)
        ? (args.sessionIds as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      if (!projectId || sessionIds.length === 0) {
        return { ok: false, code: 'BAD_ARGS', message: 'projectId and at least one sessionId required' };
      }
      // `summarize` defaults true (the whole point of this op); pass false to
      // close without spending summary calls.
      const summarize = args.summarize !== false;
      const result = await deps.summarizeAndCloseTerminals(projectId, sessionIds, summarize);
      if (result.closed === 0) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: `no live sessions in project ${projectId} matched the given ids`
        };
      }
      return { ok: true, value: result };
    }
    case 'term.reply': {
      const id = str(args.sessionId);
      const text = str(args.text);
      if (!id || text === undefined) {
        return { ok: false, code: 'BAD_ARGS', message: 'sessionId and text required' };
      }
      if (text.length > MAX_REPLY) {
        return { ok: false, code: 'BAD_ARGS', message: `text exceeds ${MAX_REPLY} chars` };
      }
      const accepted = deps.replyTerminal(id, text);
      if (!accepted) return { ok: false, code: 'NOT_FOUND', message: `session not replyable: ${id}` };
      return { ok: true, value: true };
    }
    case 'agent.send': {
      const to = str(args.to);
      const message = str(args.message);
      if (!to || message === undefined) {
        return { ok: false, code: 'BAD_ARGS', message: 'to and message required' };
      }
      if (message.length > MAX_REPLY) {
        return { ok: false, code: 'BAD_ARGS', message: `message exceeds ${MAX_REPLY} chars` };
      }
      const r = deps.sendToAgent(to, message);
      return r.ok
        ? { ok: true, value: { delivered: r.delivered, handle: r.handle, id: r.id } }
        : { ok: false, code: 'SEND_FAILED', message: r.error };
    }
    case 'sched.runNow': {
      const id = str(args.id);
      if (!id) return { ok: false, code: 'BAD_ARGS', message: 'id required' };
      return deps.runScheduleNow(id);
    }
    case 'sched.setEnabled': {
      const id = str(args.id);
      if (!id || typeof args.enabled !== 'boolean') {
        return { ok: false, code: 'BAD_ARGS', message: 'id and enabled required' };
      }
      return deps.setScheduleEnabled(id, args.enabled);
    }
    case 'plugin.install':
    case 'plugin.enable':
    case 'plugin.disable':
    case 'plugin.remove':
    case 'plugin.reload':
    case 'marketplace.list':
    case 'marketplace.add': {
      const { createPluginService, defaultBundledRoot, defaultPluginDataDir } = await import('@zana-ai/zcc-server/plugins/plugin-service'
      );
      const { applyPluginAgentCapabilities } = await import('@zana-ai/zcc-server/services/extensions/plugin-agent-sync');
      const service = getControlPlanePluginService(() =>
        createPluginService({
          dataDir: defaultPluginDataDir(),
          bundledRoot: defaultBundledRoot(),
          onAgentCapabilitiesChanged: (contributors) => {
            void applyPluginAgentCapabilities(contributors);
          }
        })
      );
      try {
        if (op === 'plugin.install') {
          const source = str(args.source);
          if (!source) return { ok: false, code: 'BAD_ARGS', message: 'source required' };
          return { ok: true, value: await service.install(source) };
        }
        if (op === 'plugin.enable') {
          const id = str(args.id);
          if (!id) return { ok: false, code: 'BAD_ARGS', message: 'id required' };
          return { ok: true, value: await service.enable(id) };
        }
        if (op === 'plugin.disable') {
          const id = str(args.id);
          if (!id) return { ok: false, code: 'BAD_ARGS', message: 'id required' };
          return { ok: true, value: await service.disable(id) };
        }
        if (op === 'plugin.remove') {
          const id = str(args.id);
          if (!id) return { ok: false, code: 'BAD_ARGS', message: 'id required' };
          await service.remove(id);
          return { ok: true, value: { ok: true } };
        }
        if (op === 'plugin.reload') {
          const id = str(args.id);
          if (!id) return { ok: false, code: 'BAD_ARGS', message: 'id required' };
          return { ok: true, value: await service.reload(id) };
        }
        if (op === 'marketplace.list') {
          return { ok: true, value: service.listMarketplaces() };
        }
        if (op === 'marketplace.add') {
          const url = str(args.url);
          if (!url) return { ok: false, code: 'BAD_ARGS', message: 'url required' };
          return { ok: true, value: await service.addMarketplace(url) };
        }
      } catch (error) {
        return {
          ok: false,
          code: 'PLUGIN_ERROR',
          message: error instanceof Error ? error.message : String(error)
        };
      }
      return { ok: false, code: 'BAD_OP', message: `unhandled op: ${op}` };
    }
    default:
      return { ok: false, code: 'BAD_OP', message: `unhandled op: ${op}` };
  }
}

/**
 * Start the control plane. Mints a fresh token + nonce, writes the token
 * `0600`, unlinks any stale socket, and binds. The nonce is returned (and held
 * in-memory) — the token file carries it too so the CLI sends both back.
 */
export async function startControlPlane(opts: ControlPlaneOptions): Promise<ControlPlaneHandle> {
  const log = opts.log ?? (() => {});
  const token = randomBytes(32).toString('hex');
  const nonce = randomBytes(16).toString('hex');

  // Ensure the data dir exists and is private, then write the token file 0600.
  // The token file carries BOTH secrets the CLI needs (token + nonce) as JSON.
  // Atomic tmp+rename (CLAUDE.md #4): write to a uniquely-suffixed temp with
  // mode 0600 at CREATE time (so there's no window where the secret sits in a
  // looser-permissioned file), then rename into place. A reader never sees a
  // half-written or world-readable token.
  const dir = dirname(opts.tokenPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpToken = `${opts.tokenPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  writeFileSync(tmpToken, JSON.stringify({ token, nonce, socket: opts.socketPath }), {
    mode: 0o600
  });
  chmodSync(tmpToken, 0o600);
  renameSync(tmpToken, opts.tokenPath);

  // A stale socket from an unclean shutdown would make listen() EADDRINUSE.
  try {
    if (existsSync(opts.socketPath)) rmSync(opts.socketPath);
  } catch {
    /* best-effort */
  }

  // Track live sockets so we can (a) cap concurrency and (b) destroy any
  // in-flight slow-loris connection on teardown instead of waiting out its timer.
  const liveSockets = new Set<Socket>();

  // allowHalfOpen: a client that sends a newline-less request and half-closes
  // its write side must still receive our response on the read side (the
  // `end`-path framing). Without this the socket's write side auto-closes on
  // the client's FIN and the response is lost.
  const server: Server = createServer({ allowHalfOpen: true }, (socket) => {
    if (liveSockets.size >= MAX_INFLIGHT_CONNECTIONS) {
      // Over the ceiling — drop immediately, before any buffer/timer is set up.
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      return;
    }
    liveSockets.add(socket);
    socket.once('close', () => liveSockets.delete(socket));
    void handleConnection(socket, { token, nonce }, opts, log);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.socketPath, () => {
      server.off('error', reject);
      // Defense in depth: socket file owner-only.
      try {
        chmodSync(opts.socketPath, 0o600);
      } catch {
        /* not all platforms honor socket perms; dir 0700 still gates */
      }
      resolve();
    });
  });

  log(`[control] listening on ${opts.socketPath}`);

  return {
    nonce,
    async close() {
      // Destroy any in-flight connection so server.close() resolves promptly
      // rather than blocking on a dribbling client until its request timer.
      for (const s of liveSockets) {
        try {
          s.destroy();
        } catch {
          /* already gone */
        }
      }
      liveSockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const p of [opts.socketPath, opts.tokenPath]) {
        try {
          if (existsSync(p)) rmSync(p);
        } catch {
          /* best-effort */
        }
      }
    }
  };
}

async function handleConnection(
  socket: Socket,
  expected: { token: string; nonce: string },
  deps: ControlPlaneDeps,
  log: (msg: string) => void
): Promise<void> {
  const chunks: Buffer[] = [];
  let total = 0;
  let done = false;
  // Set SYNCHRONOUSLY the moment we slice the first line, before the async
  // dispatch runs. Without this, a second `data` event arriving before
  // dispatchOp resolves would find `done` still false and trigger a SECOND
  // concurrent dispatch on the same connection (one request per connection is
  // the contract). `done` only flips after dispatch, so it can't guard this.
  let lineTaken = false;

  const finish = (resp: Result<unknown>) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try {
      socket.end(JSON.stringify(resp) + '\n');
    } catch {
      socket.destroy();
    }
  };

  const timer = setTimeout(() => {
    finish({ ok: false, code: 'TIMEOUT', message: 'request timed out' });
  }, REQUEST_TIMEOUT_MS);

  const takeLine = (line: string) => {
    if (lineTaken) return;
    lineTaken = true;
    void processLine(line);
  };

  socket.on('data', (c: Buffer) => {
    if (done || lineTaken) return;
    total += c.length;
    if (total > MAX_REQUEST_BYTES) {
      finish({ ok: false, code: 'TOO_LARGE', message: 'request too large' });
      return;
    }
    chunks.push(c);
    // One request per connection: process the bytes up to the first newline.
    const buf = Buffer.concat(chunks);
    const nl = buf.indexOf(0x0a);
    if (nl === -1) return;
    takeLine(buf.subarray(0, nl).toString('utf8'));
  });
  socket.on('error', () => finish({ ok: false, code: 'SOCKET_ERR', message: 'socket error' }));
  socket.on('end', () => {
    // No newline arrived but the client half-closed — treat the whole buffer as
    // the request line. Guarded by lineTaken so it never double-dispatches.
    if (!done && !lineTaken && chunks.length) takeLine(Buffer.concat(chunks).toString('utf8'));
  });

  const processLine = async (line: string) => {
    let parsed: ControlRequest;
    try {
      parsed = JSON.parse(line) as ControlRequest;
    } catch {
      finish({ ok: false, code: 'BAD_JSON', message: 'request was not valid JSON' });
      return;
    }
    const authd = authorizeRequest(
      parsed,
      expected,
      deps.isOrchestratorSession,
      deps.verifySessionCredential
    );
    if (!authd.ok) {
      log(`[control] refused ${String(parsed.op)}: ${authd.code}`);
      finish(authd);
      return;
    }
    try {
      if (
        authd.caller === 'operator' &&
        !AGENT_ALLOWED_OPS.has(authd.op) &&
        !(await deps.confirmOperatorMutation?.(authd.op, authd.args))
      ) {
        finish({ ok: false, code: 'CANCELLED', message: 'operator confirmation was not granted' });
        return;
      }
      const result = await dispatchOp(authd.op, authd.args, deps, {
        class: authd.caller,
        sessionId: authd.callerSessionId
      });
      log(`[control] ${authd.caller} ${authd.op} → ${result.ok ? 'ok' : result.code}`);
      finish(result);
    } catch (err) {
      // Surface server-side faults in-app, not only on the wire — otherwise a
      // recurring op-handler failure is invisible in the app's own logs.
      const message = err instanceof Error ? err.message : String(err);
      log(`[control] op ${authd.op} threw: ${message}`);
      finish({ ok: false, code: 'INTERNAL', message });
    }
  };
}
