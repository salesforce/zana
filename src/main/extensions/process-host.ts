/**
 * Out-of-process host for untrusted DISK extensions (P3-A). One Electron
 * `utilityProcess` per disk extension; the extension's main `setup()` and its
 * capabilities run in that child (see `host-child.ts`), never in the Electron
 * main process. This is the parallel path to `MainModuleHost` (which keeps the
 * trusted built-in gus/zana in-process); a unified router (`module-router.ts`)
 * picks between them by moduleId.
 *
 * Responsibilities:
 *   - spawn(entry): fork the child bootstrap, hand it a MessagePort + the
 *     entry path + moduleId; wait for `ready` (setup done) or `setup-error`.
 *   - dispatch(moduleId, capability, args): RPC to that child WITH A TIMEOUT —
 *     a hung/crashed child rejects, it never wedges main.
 *   - teardown(moduleId): teardown RPC (short deadline) then kill the child.
 *   - liveModuleIds(): ids whose child is live AND completed setup.
 *   - crash/exit handling: mark the module inactive, reject in-flight calls,
 *     isolate from main + siblings.
 *   - serve the storage/log broker requests FROM the host, keyed by the
 *     AUTHENTICATED moduleId the host bound to that child's port (anti-spoof,
 *     design §3d) — NOT a value the child supplies.
 *
 * The transport is injected (`SpawnFn` → `ChildEndpoint`) so the RPC routing,
 * timeout, teardown, and crash-isolation logic is unit-testable with a mock
 * endpoint, no real utilityProcess required. The production `spawnUtilityChild`
 * factory lives at the bottom and is the only Electron-coupled part.
 */

import {
  errToString,
  type BrokerMethod,
  type ChildToHost,
  type HostToChild,
  type LifecycleHook
} from './host-protocol.js';
import type {
  ExecRequest,
  ExecResult,
  BrokeredFetchInit,
  BrokeredFetchResponse,
  ExtensionLlmRequest,
  LlmInvokeResult,
  HostLaunchSpec,
  HostRequestLaunchResult,
  HostConfirmSpec,
  HostNotifySpec
} from '../../shared/module-main.js';
import type { Persona, PersonaInput, Team, TeamInput } from '../../shared/types.js';
import type { SshHostEntry } from '../../shared/types.js';

type LogFn = (message: string, err?: unknown) => void;

/** Host-side per-extension storage (the namespaced KV the broker serves). */
export interface HostStorage {
  get(moduleId: string, key: string): unknown;
  set(moduleId: string, key: string, value: unknown): void;
}

/**
 * The gated performer for the brokered caps (P3-B). Each method receives the
 * AUTHENTICATED `moduleId` (the id the host bound to the child's port — the
 * child cannot forge it), checks the permission + scope against that id, and
 * performs the op host-side. It MUST throw (PermissionDenied or any Error) when
 * ungranted/out-of-scope; the process host turns a throw into an `ok:false`
 * broker-result so the child's `await` rejects. Injected so the process host
 * stays Electron-free + unit-testable with a mock performer.
 */
export interface BrokerCapabilities {
  /** Gate and return the generic, sanitized SSH host catalogue. */
  sshHosts?(moduleId: string): Promise<SshHostEntry[]>;
  /** Read or update the single global remote start-path default. */
  getRemoteDefaults?(moduleId: string): Promise<{ remoteDefaultPath?: string }>;
  setRemoteDefaults?(moduleId: string, input: { remoteDefaultPath?: string }): Promise<{ remoteDefaultPath?: string }>;
  installExtensionFromGit?(moduleId: string, input: { url: string }): Promise<{ id: string }>;
  exec(moduleId: string, req: ExecRequest): Promise<ExecResult>;
  readFile(moduleId: string, path: string, encoding?: 'utf-8'): Promise<string>;
  writeFile(moduleId: string, path: string, data: string): Promise<void>;
  rm(moduleId: string, path: string): Promise<void>;
  readdir(moduleId: string, path: string): Promise<string[]>;
  stat(moduleId: string, path: string): Promise<{ size: number; mtimeMs: number; isFile: boolean; isDirectory: boolean }>;
  exists(moduleId: string, path: string): Promise<boolean>;
  fetch(moduleId: string, url: string, init?: BrokeredFetchInit): Promise<BrokeredFetchResponse>;
  /**
   * Call a host-managed MCP server tool on the extension's behalf. Gated by the
   * `mcp` permission + `mcpAllowlist` scope against `moduleId`; the workspace
   * hint in `opts` is host-confined before the pool spawns/reuses a child.
   */
  mcp(
    moduleId: string,
    serverId: string,
    tool: string,
    args?: Record<string, unknown>,
    opts?: { projectPath?: string; useGlobal?: boolean }
  ): Promise<unknown>;
  /**
   * Create the on-disk `.zana/` skeleton for a workspace that doesn't have one
   * (the explicit "Init Zana" button). Same `mcp` permission + `mcpAllowlist`
   * gate as {@link mcp}, and the same host-confined workspace hint — this is
   * the pool's one-off write path, not a general tool call, so it's a separate
   * method rather than a `tool`/`serverId` pair.
   */
  mcpInitWorkspace(
    moduleId: string,
    opts?: { projectPath?: string; useGlobal?: boolean }
  ): Promise<{ created: boolean }>;
  /**
   * Read-only counterpart to {@link mcpInitWorkspace}: whether `.zana/` already
   * has its full skeleton for a workspace, without writing anything. Same gate.
   */
  mcpIsWorkspaceInitialized(
    moduleId: string,
    opts?: { projectPath?: string; useGlobal?: boolean }
  ): Promise<boolean>;
  /**
   * Run a bounded LLM micro-call on the extension's behalf (Epic C). Gated by
   * the `llm:invoke` permission against `moduleId` (and the global kill switch,
   * enforced at wiring time); the performer clamps input/output size, model
   * tier, rate, and concurrency, then runs it on the host's own LlmService.
   * Resolves a stripped {ok,text,error?,ms} — never throws on a provider/rate
   * failure (those come back as `ok:false`); only a denied permission throws.
   */
  llm(moduleId: string, req: ExtensionLlmRequest): Promise<LlmInvokeResult>;
  /**
   * Open a subscription to a host-managed live push source on the extension's
   * behalf, resolving the opaque subscription id. Gated by the `stream` permission
   * + `streamAllowlist` scope against `moduleId`; the endpoint HANDLE is resolved
   * to a real transport in core (the ext never supplies a URL — Rule 1/2). Frames
   * do NOT return over the broker port — they are pushed core→renderer directly.
   */
  streamOpen(moduleId: string, endpoint: string, opts?: Record<string, unknown>): Promise<string>;
  /**
   * Unsubscribe a stream the extension opened. Ownership-checked host-side (an ext
   * can only close a subId it owns). Resolves whether or not the id existed.
   */
  streamClose(moduleId: string, subId: string): Promise<void>;
  /**
   * Release EVERY live subscription owned by `moduleId` — called on teardown /
   * crash / kill so a dead child leaks no host-side connection (Rule 3). Optional:
   * absent in a caps performer that doesn't back streaming. Never throws.
   */
  streamCloseAll?(moduleId: string): void;
  /**
   * Fire-and-forget push from main to renderer (W1-3). Sends a `payload` on the
   * namespaced `ext:<moduleId>:<topic>` channel. No permission token (an extension
   * pushing its own data to its own panels), but bounded: frames ≤128KiB, rate
   * ~50fps per module (Rule 5), idle-TTL cleanup. Frames route core→renderer via
   * the StreamSink relay (NOT back over the broker port). Never throws.
   */
  emit?(moduleId: string, topic: string, payload: unknown): void;
  /**
   * W1-4 trust inversion. Ask the SHELL, on the extension's behalf, to perform a
   * renderer-only action a headless main module can't. `hostToast`/`hostNavigate`
   * are unconditional fire-and-forget UI nudges; `hostSelectProject` is gated by
   * `projects:select`; `hostRequestLaunch` is gated by `session:launch` and PARKS
   * a launch (never spawns) — main authorizes, the renderer drives (Rule 1).
   * Optional so a caps performer that omits the shell bridge still typechecks.
   */
  hostToast?(moduleId: string, message: string, kind?: 'info' | 'error'): void;
  hostNavigate?(moduleId: string, target: string): void;
  hostSelectProject?(moduleId: string, projectId: string | null): void;
  hostRequestLaunch?(moduleId: string, spec: HostLaunchSpec): Promise<HostRequestLaunchResult>;
  /**
   * W1-5 main-reachable host UX. Ask the shell to render a confirm / alert
   * to the human and resolve their answer back over the command channel. No
   * permission token (pure UI). Fail closed (`false` / `null`) when no renderer
   * can receive it — never hangs. Optional so a caps performer without the shell
   * bridge still typechecks (a child's request degrades to the fail-closed value).
   */
  hostConfirm?(moduleId: string, spec: HostConfirmSpec): Promise<boolean>;
  hostAlert?(moduleId: string, spec: HostNotifySpec): Promise<string | null>;
  /**
   * Phase B: `ctx.inbox.push`, gated by the `inbox:push` permission. Pushes a
   * durable Inbox entry stamped with the AUTHENTICATED `moduleId`. Optional so
   * a caps performer that omits the inbox bridge still typechecks (a child's
   * request then fails closed with a "bridge unavailable" reply).
   */
  inboxPush?(
    moduleId: string,
    input: {
      projectId: string;
      comments?: string;
      docs?: Array<{ path: string }>;
      target?: { moduleId: string };
    }
  ): Promise<{ id: string }>;
}

/**
 * The slice of the shared `PersonaTeamRegistry` the process host needs. Injected
 * (not imported as a class) so the host stays Electron-free + unit-testable with
 * a mock. The host always passes `state.moduleId` (the AUTHENTICATED id bound to
 * the child's port) as the first arg — the child cannot forge it.
 */
export interface PersonaTeamRegistryLike {
  setPersonas(moduleId: string, raw: PersonaInput[]): Persona[];
  setTeams(moduleId: string, raw: TeamInput[]): Team[];
  clearModule(moduleId: string): void;
}

export interface SshHostProviderRegistryLike {
  register(moduleId: string): void;
  clear(moduleId: string): void;
}

/**
 * The transport seam. A `ChildEndpoint` is one live child process the host can
 * talk to. The production impl wraps an Electron `utilityProcess` + its data
 * `MessagePort`; tests pass a mock. The host attaches `onMessage`/`onExit`
 * synchronously after `spawn()` returns, before any message is delivered.
 */
export interface ChildEndpoint {
  /** Deliver a host→child message over the data port. */
  postMessage(msg: HostToChild): void;
  /** Register the child→host message sink (called once by the host). */
  onMessage(listener: (msg: ChildToHost) => void): void;
  /** Register the exit/crash sink (called once by the host). */
  onExit(listener: (code: number | null) => void): void;
  /** Kill the child process unconditionally. */
  kill(): void;
}

/** Factory that starts a child for `{entryPath, moduleId}` and returns its endpoint. */
export type SpawnFn = (entryPath: string, moduleId: string) => ChildEndpoint;

/** A disk extension to spawn: its id + the resolved absolute main entry path. */
export interface DiskExtensionSpec {
  moduleId: string;
  entryPath: string;
}

export interface ProcessHostOptions {
  spawn: SpawnFn;
  storage: HostStorage;
  log: LogFn;
  /**
   * Gated brokered capabilities (P3-B). Optional: when absent, an exec/fs/fetch
   * broker request is rejected (deny-by-default) — useful in tests that only
   * exercise storage/log + routing.
   */
  caps?: BrokerCapabilities;
  /**
   * Shared persona/team registry (design §2d). Optional: when absent, a
   * `personas.*`/`teams.*` broker request is rejected. The host stamps
   * provenance from `state.moduleId`, never a payload value.
  */
  registry?: PersonaTeamRegistryLike;
  sshHosts?: SshHostProviderRegistryLike;
  listSshHosts?: (moduleId: string) => Promise<SshHostEntry[]>;
  /** Read-only installed-extension catalogue, scoped by the host rather than the child. */
  listInstalledExtensions?: () => Array<{ id: string; repository?: string }>;
  /** Per-dispatch timeout (ms). A child that doesn't answer is rejected. Default 30s. */
  callTimeoutMs?: number;
  /** Teardown-RPC deadline (ms) before the child is killed regardless. Default 2s. */
  teardownTimeoutMs?: number;
  /** Setup deadline (ms): a child that never reports `ready` is killed. Default 15s. */
  setupTimeoutMs?: number;
  /**
   * Lifecycle-hook (`onInstall`/`onUninstall`) deadline (ms). A hook that
   * doesn't answer resolves (never rejects) so an install/uninstall can't wedge.
   * Default 10s — install provisioning may legitimately take longer than a
   * capability call, but is still bounded.
   */
  lifecycleTimeoutMs?: number;
}

interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One managed child. */
interface ChildState {
  moduleId: string;
  endpoint: ChildEndpoint;
  /** Flipped true once the child reports `ready` (setup() resolved). */
  ready: boolean;
  /** True after exit/crash or teardown — dispatch must reject, not hang. */
  dead: boolean;
  pending: Map<number, PendingCall>;
  nextCallId: number;
  /** Resolvers for the spawn()'s ready/error wait. */
  onReady?: () => void;
  onSetupError?: (error: string) => void;
  setupTimer?: ReturnType<typeof setTimeout>;
}

export class ExtensionProcessHost {
  private readonly children = new Map<string, ChildState>();
  /**
   * Ids whose child exited unsolicited (crash/segfault/process.exit), so a
   * later `dispatch` rejects with a clear "crashed" message instead of falling
   * through the router to the in-process host's misleading "Unknown module".
   * Cleared on a fresh `spawn` of the same id (relaunch). Intentional teardown
   * does NOT add to this set — that's a clean removal.
   */
  private readonly crashed = new Set<string>();
  /**
   * Ids marked for a ONE-TIME `onInstall` fire. Set by `markPendingInstall`
   * (from the `extensions:install` handler, BEFORE the install reconciles and
   * spawns the child) and consumed the next time that id reports `ready` — so
   * the hook fires exactly once, on an explicit install, and NEVER on an
   * ordinary boot/reload spawn (which never marks the id).
   *
   * We deliberately do NOT clear the mark on a failed spawn (setup-error / crash
   * before ready): if the just-installed ext fails to come up now but activates
   * on a later reload, firing `onInstall` on that first SUCCESSFUL activation is
   * the correct behaviour. The mark is keyed by id and only ever set by an
   * explicit install, so a never-consumed mark (e.g. the ext is uninstalled
   * before it ever readies) is inert — it can only ever fire that same id's
   * hook. This also makes a REINSTALL over a running ext work: the mark set
   * before the reconcile survives the respawn's teardown-first and is consumed
   * by the fresh child's `ready`.
   */
  private readonly pendingInstall = new Set<string>();
  private readonly callTimeoutMs: number;
  private readonly teardownTimeoutMs: number;
  private readonly setupTimeoutMs: number;
  private readonly lifecycleTimeoutMs: number;

  constructor(private readonly opts: ProcessHostOptions) {
    this.callTimeoutMs = opts.callTimeoutMs ?? 30_000;
    this.teardownTimeoutMs = opts.teardownTimeoutMs ?? 2_000;
    this.setupTimeoutMs = opts.setupTimeoutMs ?? 15_000;
    this.lifecycleTimeoutMs = opts.lifecycleTimeoutMs ?? 10_000;
  }

  /**
   * Spawn one disk extension's child and wait for setup. Resolves true when the
   * child reports `ready`, false on setup-error / spawn failure / setup timeout.
   * Never throws — boot isolation: one bad ext must not break others.
   */
  async spawn(spec: DiskExtensionSpec): Promise<boolean> {
    const { moduleId, entryPath } = spec;
    // Defensive: never run two children for the same id.
    if (this.children.has(moduleId)) await this.teardown(moduleId);
    // A relaunch clears any prior crash record.
    this.crashed.delete(moduleId);

    let endpoint: ChildEndpoint;
    try {
      endpoint = this.opts.spawn(entryPath, moduleId);
    } catch (err) {
      this.opts.log(`extension ${moduleId}: child spawn failed`, err);
      return false;
    }

    const state: ChildState = {
      moduleId,
      endpoint,
      ready: false,
      dead: false,
      pending: new Map(),
      nextCallId: 1
    };
    this.children.set(moduleId, state);

    endpoint.onMessage((msg) => this.onChildMessage(state, msg));
    endpoint.onExit((code) => this.onChildExit(state, code));

    const settled = new Promise<boolean>((resolve) => {
      state.onReady = () => resolve(true);
      state.onSetupError = () => resolve(false);
      state.setupTimer = setTimeout(() => {
        this.opts.log(`extension ${moduleId}: setup timed out after ${this.setupTimeoutMs}ms`);
        resolve(false);
        // The child never reached `ready`, so its install mark (if any) was
        // never consumed. Clear it here: this is a give-up path with no
        // auto-respawn, so an un-consumed mark would otherwise leak to an
        // unrelated later spawn of the same id (see markPendingInstall doc).
        this.pendingInstall.delete(moduleId);
        // Kill — a child stuck in setup is not usable.
        this.killAndForget(moduleId);
      }, this.setupTimeoutMs);
    });

    // Hand the child its identity + entry. The endpoint's port is already wired
    // by the spawn factory; this is the first protocol message.
    endpoint.postMessage({ type: 'init', entryPath, moduleId });

    return settled;
  }

  /** RPC a capability to the right child, with a timeout. Rejects if dead/hung. */
  dispatch(moduleId: string, capability: string, args: unknown[]): Promise<unknown> {
    if (this.crashed.has(moduleId)) {
      return Promise.reject(new Error(`Extension ${moduleId} crashed — relaunch to retry`));
    }
    const state = this.children.get(moduleId);
    if (!state || state.dead) {
      return Promise.reject(new Error(`Unknown module: ${moduleId}`));
    }
    if (!state.ready) {
      return Promise.reject(new Error(`Module not ready: ${moduleId}`));
    }
    const callId = state.nextCallId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(callId);
        reject(new Error(`Capability timed out: ${moduleId}.${capability}`));
      }, this.callTimeoutMs);
      state.pending.set(callId, { resolve, reject, timer });
      try {
        state.endpoint.postMessage({ type: 'call', callId, capability, args });
      } catch (err) {
        clearTimeout(timer);
        state.pending.delete(callId);
        reject(err instanceof Error ? err : new Error(errToString(err)));
      }
    });
  }

  /**
   * Mark an id so its NEXT `ready` fires the one-time `onInstall` hook. Called
   * by the `extensions:install` handler right before it reconciles (which spawns
   * the child). Idempotent. If the id is already live (e.g. a reinstall over a
   * running ext where the reconcile respawns it), the mark is still consumed on
   * the respawn's `ready`. A mark that never reaches `ready` (setup-error/crash)
   * is cleared on the exit path so it can't leak to an unrelated later spawn.
   */
  markPendingInstall(moduleId: string): void {
    this.pendingInstall.add(moduleId);
  }

  /**
   * Fire a lifecycle hook (`onInstall`/`onUninstall`) on a LIVE child and await
   * its reply, bounded by `lifecycleTimeoutMs`. Unlike `dispatch` this NEVER
   * rejects: a missing/dead/not-ready child, a hook throw, or a timeout all
   * resolve — an install/uninstall must proceed regardless of a misbehaving
   * hook. `onInstall` is normally auto-fired on `ready` (see `firePendingInstall`);
   * this method is the explicit path the uninstall handler uses for
   * `onUninstall`, while the child is still alive and before teardown.
   * Returns true iff the hook ran and reported success.
   */
  async dispatchLifecycle(moduleId: string, hook: LifecycleHook): Promise<boolean> {
    const state = this.children.get(moduleId);
    if (!state || state.dead || !state.ready) return false;
    const callId = state.nextCallId++;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        state.pending.delete(callId);
        this.opts.log(`extension ${moduleId}: ${hook} timed out after ${this.lifecycleTimeoutMs}ms`);
        resolve(false);
      }, this.lifecycleTimeoutMs);
      // Reuse the pending-call machinery: the child answers with a `result` by
      // callId, which resolves this waiter. A rejection (hook threw → ok:false)
      // is downgraded to `false` here — never a throw the caller must catch.
      state.pending.set(callId, {
        resolve: () => resolve(true),
        reject: (err) => {
          this.opts.log(`extension ${moduleId}: ${hook} failed`, err);
          resolve(false);
        },
        timer
      });
      try {
        state.endpoint.postMessage({ type: 'lifecycle', callId, hook });
      } catch (err) {
        clearTimeout(timer);
        state.pending.delete(callId);
        this.opts.log(`extension ${moduleId}: ${hook} post failed`, err);
        resolve(false);
      }
    });
  }

  /**
   * If `moduleId` was marked for install, consume the mark and fire `onInstall`
   * once. Fire-and-forget: the extension is already live from `setup`, so a slow
   * or throwing install hook must not block the `ready` path or the reconcile.
   */
  private firePendingInstall(moduleId: string): void {
    if (!this.pendingInstall.delete(moduleId)) return;
    void this.dispatchLifecycle(moduleId, 'onInstall');
  }

  /**
   * Tear down one child: teardown RPC (short deadline), then kill unconditionally.
   * No-op for an unknown id. Mirrors `MainModuleHost.teardown`'s contract.
   */
  async teardown(moduleId: string): Promise<void> {
    // A disable/uninstall of a crashed ext clears its crash record too. We do
    // NOT clear `pendingInstall` here: `spawn()` calls `teardown()` first when
    // respawning a live child (reinstall-over-running / hot-reload), and the
    // mark must survive that so the fresh child's `ready` still fires onInstall.
    // An un-consumed mark is inert (see the field doc), so leaving it is safe.
    this.crashed.delete(moduleId);
    // Drop any personas/teams the extension contributed — registrations die
    // with the module (in-memory + lifecycle-bound).
    this.opts.registry?.clearModule(moduleId);
    this.opts.sshHosts?.clear(moduleId);
    // Release every host-side stream subscription this ext held (Rule 3).
    this.opts.caps?.streamCloseAll?.(moduleId);
    const state = this.children.get(moduleId);
    if (!state) return;
    if (!state.dead && state.ready) {
      await this.teardownRpc(state).catch((err) =>
        this.opts.log(`extension ${moduleId}: teardown rpc failed`, err)
      );
    }
    this.killAndForget(moduleId);
  }

  private teardownRpc(state: ChildState): Promise<void> {
    const callId = state.nextCallId++;
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        state.pending.delete(callId);
        resolve();
      };
      const timer = setTimeout(done, this.teardownTimeoutMs);
      // Resolve on either the result or the deadline — we kill regardless after.
      state.pending.set(callId, { resolve: () => done(), reject: () => done(), timer });
      try {
        state.endpoint.postMessage({ type: 'teardown', callId });
      } catch {
        done();
      }
    });
  }

  /** Tear down every child (app quit). Best-effort, parallel. */
  async teardownAll(): Promise<void> {
    await Promise.all([...this.children.keys()].map((id) => this.teardown(id)));
  }

  /** Ids whose child is live AND completed setup — the `mainActive:true` set. */
  liveModuleIds(): Set<string> {
    const live = new Set<string>();
    for (const [id, st] of this.children) {
      if (st.ready && !st.dead) live.add(id);
    }
    return live;
  }

  /**
   * True if this host owns this id — a live/dead child OR a crash record. The
   * router uses it to keep routing a crashed disk-ext id HERE (so dispatch
   * returns the clear "crashed" message) rather than falling through to the
   * in-process host's "Unknown module".
   */
  has(moduleId: string): boolean {
    return this.children.has(moduleId) || this.crashed.has(moduleId);
  }

  // ---- internals -----------------------------------------------------------

  private onChildMessage(state: ChildState, msg: ChildToHost): void {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'ready':
        state.ready = true;
        if (state.setupTimer) clearTimeout(state.setupTimer);
        state.onReady?.();
        // Fire the one-time install hook AFTER resolving spawn()'s ready waiter,
        // so the reconcile isn't held on install provisioning (fire-and-forget).
        this.firePendingInstall(state.moduleId);
        break;
      case 'setup-error':
        this.opts.log(`extension ${state.moduleId}: setup failed: ${msg.error}`);
        if (state.setupTimer) clearTimeout(state.setupTimer);
        state.onSetupError?.(msg.error);
        // Setup failed → the child is useless; drop it (isolated, no respawn).
        this.killAndForget(state.moduleId);
        break;
      case 'result': {
        const pending = state.pending.get(msg.callId);
        if (!pending) return; // already timed out / unknown — ignore
        clearTimeout(pending.timer);
        state.pending.delete(msg.callId);
        if (msg.ok) pending.resolve(msg.result);
        else pending.reject(new Error(msg.error ?? 'capability failed'));
        break;
      }
      case 'broker':
        this.handleBroker(state, msg.reqId, msg.method, msg.args);
        break;
    }
  }

  /**
   * Serve a child's broker request HOST-SIDE. The authenticated id is
   * `state.moduleId` — the id the host bound to this child's port, NOT any value
   * in the payload — so a child cannot read/write a sibling's namespace nor
   * borrow a sibling's grants (design §3d). storage/log are unconditional (they
   * are inherently namespaced by id); exec/fs/fetch are gated by the injected
   * `caps` performer, which checks the permission + scope against `state.moduleId`
   * and throws (→ `ok:false`) when ungranted.
   */
  private handleBroker(state: ChildState, reqId: number, method: BrokerMethod, args: unknown[]): void {
    const reply = (ok: boolean, result?: unknown, error?: string) =>
      state.endpoint.postMessage({ type: 'broker-result', reqId, ok, result, error });
    const id = state.moduleId;
    const caps = this.opts.caps;
    // exec/fs/fetch resolve asynchronously through the gated performer.
    const brokered = (op: () => Promise<unknown>) => {
      if (!caps) {
        reply(false, undefined, `PermissionDenied: ${id} — broker capability unavailable`);
        return;
      }
      op().then(
        (result) => reply(true, result),
        (err) => reply(false, undefined, errToString(err))
      );
    };
    try {
      switch (method) {
        case 'storage.get':
          reply(true, this.opts.storage.get(id, String(args[0])));
          break;
        case 'storage.set':
          this.opts.storage.set(id, String(args[0]), args[1]);
          reply(true);
          break;
        case 'extensions.listInstalled':
          reply(true, this.opts.listInstalledExtensions?.() ?? []);
          break;
        case 'log':
          this.opts.log(`[ext:${id}] ${String(args[0])}`, args[1]);
          reply(true);
          break;
        case 'exec':
          brokered(() => caps!.exec(id, args[0] as ExecRequest));
          break;
        case 'fs.readFile':
          brokered(() => caps!.readFile(id, String(args[0]), args[1] as 'utf-8' | undefined));
          break;
        case 'fs.writeFile':
          brokered(() => caps!.writeFile(id, String(args[0]), String(args[1])));
          break;
        case 'fs.rm':
          brokered(() => caps!.rm(id, String(args[0])));
          break;
        case 'fs.readdir':
          brokered(() => caps!.readdir(id, String(args[0])));
          break;
        case 'fs.stat':
          brokered(() => caps!.stat(id, String(args[0])));
          break;
        case 'fs.exists':
          brokered(() => caps!.exists(id, String(args[0])));
          break;
        case 'fetch':
          brokered(() => caps!.fetch(id, String(args[0]), args[1] as BrokeredFetchInit | undefined));
          break;
        case 'mcp':
          brokered(() =>
            caps!.mcp(
              id,
              String(args[0]),
              String(args[1]),
              args[2] as Record<string, unknown> | undefined,
              args[3] as { projectPath?: string; useGlobal?: boolean } | undefined
            )
          );
          break;
        case 'mcp.initWorkspace':
          brokered(() =>
            caps!.mcpInitWorkspace(id, args[0] as { projectPath?: string; useGlobal?: boolean } | undefined)
          );
          break;
        case 'mcp.isWorkspaceInitialized':
          brokered(() =>
            caps!.mcpIsWorkspaceInitialized(
              id,
              args[0] as { projectPath?: string; useGlobal?: boolean } | undefined
            )
          );
          break;
        case 'llm.run':
          brokered(() => caps!.llm(id, args[0] as ExtensionLlmRequest));
          break;
        case 'stream.open':
          brokered(() =>
            caps!.streamOpen(id, String(args[0]), args[1] as Record<string, unknown> | undefined)
          );
          break;
        case 'stream.close':
          brokered(() => caps!.streamClose(id, String(args[0])));
          break;
        case 'emit': {
          // W1-3: fire-and-forget push main→renderer. No reply (void return).
          // Degraded if no caps.emit (test mock that omits it).
          if (!caps?.emit) {
            reply(true, undefined);
            break;
          }
          const [topic, payload] = args;
          caps.emit(id, String(topic), payload);
          reply(true, undefined); // Always succeeds (best-effort, never throws).
          break;
        }
        // W1-4 trust inversion. The action is performed by the injected caps
        // performer against the AUTHENTICATED id (`id` = state.moduleId, NOT any
        // value in args — anti-spoof). toast/navigate/selectProject are
        // fire-and-forget (void reply, best-effort); requestLaunch resolves the
        // host's {parked, requestId} verdict through the async `brokered` path
        // (where the session:launch gate lives, in broker-caps). Degraded to a
        // success no-op when the caps performer omits the shell bridge.
        case 'host.toast':
          caps?.hostToast?.(id, String(args[0]), args[1] as 'info' | 'error' | undefined);
          reply(true, undefined);
          break;
        case 'host.navigate':
          caps?.hostNavigate?.(id, String(args[0]));
          reply(true, undefined);
          break;
        case 'host.selectProject':
          caps?.hostSelectProject?.(id, (args[0] as string | null) ?? null);
          reply(true, undefined);
          break;
        case 'host.requestLaunch':
          if (!caps?.hostRequestLaunch) {
            reply(false, undefined, `PermissionDenied: ${id} — host launch bridge unavailable`);
            break;
          }
          brokered(() => caps.hostRequestLaunch!(id, args[0] as HostLaunchSpec));
          break;
        // W1-5 main-reachable host UX. Round-trip like requestLaunch: the answer
        // flows back through the async `brokered` path (the relay resolves the
        // pending Promise when the renderer replies, or fails it closed). Degraded
        // to the fail-closed value when the caps performer omits the bridge.
        case 'host.confirm':
          if (!caps?.hostConfirm) {
            reply(true, false); // Fail closed: no bridge → "no".
            break;
          }
          brokered(() => caps.hostConfirm!(id, args[0] as HostConfirmSpec));
          break;
        case 'host.alert':
          if (!caps?.hostAlert) {
            reply(true, null); // Fail closed: no bridge → dismissed.
            break;
          }
          brokered(() => caps.hostAlert!(id, args[0] as HostNotifySpec));
          break;
        // Phase B: `ctx.inbox.push`. The performer gates `inbox:push` + the
        // target projectId; a rejection surfaces as `ok:false` via `brokered`.
        case 'inbox.push':
          if (!caps?.inboxPush) {
            reply(false, undefined, `PermissionDenied: ${id} — inbox bridge unavailable`);
            break;
          }
          brokered(() =>
            caps.inboxPush!(
              id,
              args[0] as {
                projectId: string;
                comments?: string;
                docs?: Array<{ path: string }>;
                target?: { moduleId: string };
              }
            )
          );
          break;
        // Persona/team contribution. Provenance is stamped from `id`
        // (state.moduleId — the anti-spoof anchor), NOT from the payload. Like
        // storage/log these are unconditional (no `caps` gate): registration is
        // inert data; the teeth are at the already-gated launch path. Rejected
        // when no registry was injected (deny-by-default, like a missing perf).
        case 'personas.register': {
          const reg = this.opts.registry;
          if (!reg) {
            reply(false, undefined, `${id} — persona registry unavailable`);
            break;
          }
          reply(true, reg.setPersonas(id, (args[0] as PersonaInput[]) ?? []));
          break;
        }
        case 'personas.clear': {
          this.opts.registry?.clearModule(id);
          reply(true);
          break;
        }
        case 'teams.register': {
          const reg = this.opts.registry;
          if (!reg) {
            reply(false, undefined, `${id} — team registry unavailable`);
            break;
          }
          reply(true, reg.setTeams(id, (args[0] as TeamInput[]) ?? []));
          break;
        }
        case 'teams.clear': {
          this.opts.registry?.clearModule(id);
          reply(true);
          break;
        }
        case 'sshHosts.register': {
          const listHosts = caps?.sshHosts;
          if (!this.opts.sshHosts || !listHosts) {
            reply(false, undefined, `${id} — SSH host provider unavailable`);
            break;
          }
          brokered(async () => {
            await listHosts(id);
            this.opts.sshHosts!.register(id);
          });
          break;
        }
        case 'sshHosts.clear':
          this.opts.sshHosts?.clear(id);
          reply(true);
          break;
        case 'sshHosts.list': {
          if (!caps?.sshHosts) {
            reply(false, undefined, `PermissionDenied: ${id} — SSH host provider unavailable`);
            break;
          }
          brokered(() => caps.sshHosts!(id));
          break;
        }
        case 'remoteDefaults.get': {
          if (!caps?.getRemoteDefaults) {
            reply(false, undefined, `PermissionDenied: ${id} — remote defaults unavailable`);
            break;
          }
          brokered(() => caps.getRemoteDefaults!(id));
          break;
        }
        case 'remoteDefaults.set': {
          if (!caps?.setRemoteDefaults) {
            reply(false, undefined, `PermissionDenied: ${id} — remote defaults unavailable`);
            break;
          }
          brokered(() => caps.setRemoteDefaults!(id, (args[0] as { remoteDefaultPath?: string }) ?? {}));
          break;
        }
        case 'extensions.installFromGit': {
          if (!caps?.installExtensionFromGit) {
            reply(false, undefined, `PermissionDenied: ${id} — extension installation unavailable`);
            break;
          }
          brokered(() => caps.installExtensionFromGit!(id, (args[0] as { url: string }) ?? { url: '' }));
          break;
        }
        default:
          reply(false, undefined, `Unknown broker method: ${String(method)}`);
      }
    } catch (err) {
      reply(false, undefined, errToString(err));
    }
  }

  private onChildExit(state: ChildState, code: number | null): void {
    if (state.dead) return; // teardown already handled it
    state.dead = true;
    state.ready = false;
    if (state.setupTimer) clearTimeout(state.setupTimer);
    // Spontaneous death (crash / setup-error / segfault) — NOT an explicit
    // teardown (those set `state.dead` first and short-circuit above, so this
    // line never runs on the reinstall-over-running respawn path). If the child
    // died before its `ready` consumed the install mark, clear it: there's no
    // auto-respawn from here, so an orphaned mark would otherwise fire onInstall
    // spuriously on an unrelated later spawn of the same id.
    this.pendingInstall.delete(state.moduleId);
    // Reject every in-flight call — never leave a renderer promise hanging.
    for (const [, pending] of state.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Extension ${state.moduleId} exited (code ${code})`));
    }
    state.pending.clear();
    // If it died before setup completed, unblock the spawn() waiter.
    state.onSetupError?.(`exited before ready (code ${code})`);
    this.opts.log(`extension ${state.moduleId}: child exited (code ${code})`);
    // A crash MUST clear too, else a dead ext leaves zombie personas/teams.
    this.opts.registry?.clearModule(state.moduleId);
    this.opts.sshHosts?.clear(state.moduleId);
    // …and zombie stream subscriptions: release every one it held (Rule 3).
    this.opts.caps?.streamCloseAll?.(state.moduleId);
    // Record the crash so a later dispatch gives a clear message (and the
    // router keeps routing the id here). Cleared on relaunch via spawn().
    this.crashed.add(state.moduleId);
    this.children.delete(state.moduleId);
  }

  /** Mark dead, kill, and drop from the map. Safe to call repeatedly. */
  private killAndForget(moduleId: string): void {
    // Clear registrations on every kill path (setup-timeout, setup-error, kill).
    this.opts.registry?.clearModule(moduleId);
    this.opts.sshHosts?.clear(moduleId);
    // Release every host-side stream subscription this ext held (Rule 3).
    this.opts.caps?.streamCloseAll?.(moduleId);
    const state = this.children.get(moduleId);
    if (!state) return;
    state.dead = true;
    state.ready = false;
    if (state.setupTimer) clearTimeout(state.setupTimer);
    for (const [, pending] of state.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Extension ${moduleId} torn down`));
    }
    state.pending.clear();
    try {
      state.endpoint.kill();
    } catch (err) {
      this.opts.log(`extension ${moduleId}: kill failed`, err);
    }
    this.children.delete(moduleId);
  }
}
