/**
 * MicroVmPool — a host-managed pool of PERSISTENT microsandbox guest VMs that a
 * NATIVE (host-side) agent drives from OUTSIDE as a sandboxed playground: clone
 * a repo, run untrusted code, compile, test — with the guest's own kernel +
 * netns keeping it off the host filesystem. This is the inverse of the
 * `microvm` ExecutionEnvironment (which runs the AGENT inside the guest and hits
 * the model-gateway auth wall): here the model call stays on the authed host and
 * only EXECUTION is sandboxed, so there is no auth question at all.
 *
 * TWIN OF `zana/mcp-pool.ts`
 * -------------------------
 * Same lifecycle shape as the host MCP child pool — persistent children keyed by
 * a resolved workspace identity, bounded (LRU-evicted at capacity), idle-TTL
 * reaped, per-request timeout, disposed once on the app shutdown path (Rule 3).
 * The difference is the child: a booted libkrun guest (via the microsandbox SDK)
 * instead of a stdio JSON-RPC server. State PERSISTS across `exec` calls for the
 * same key (clone in one call, build in the next), because we reuse the SAME
 * `Sandbox` object.
 *
 * TRUST (Rule 7)
 * --------------
 * This is the ONLY playground module that touches the microsandbox SDK (the
 * `microvm-environment.ts` adapter is the other SDK seam, for the agent-in-guest
 * path). The SDK is a heavy native addon loaded via a lazy dynamic import, so the
 * app build + the whole test suite stay independent of it — unit tests inject a
 * fake `loadSdk`. The image ref is authorized through `buildMicroVmConfig`
 * (closed allowlist, no `"*"`); an agent-supplied `image` hint can only SELECT an
 * already-allowlisted option, never define one (Rule 1).
 *
 * FAIL CLOSED + HONEST EMPTY STATE
 * --------------------------------
 * Unsupported platform (Intel Mac), SDK absent, feature disabled, or a boot
 * failure all become a typed {@link MicroVmUnavailableError} — surfaced by the
 * MCP tool as `{ ok:false, message }`, never a crash (mirrors `McpUnavailableError`).
 */

import {
  resolveAuthorizedImage,
  MicroVmAuthorizationError,
  DEFAULT_CPU_RANGE,
  DEFAULT_MEM_RANGE,
  type MicroVmPolicy
} from '../harness/microvm-builder.js';
import { microVmPlatformSupported } from '../harness/microvm-environment.js';

// ---------------------------------------------------------------------------
// Minimal typed slice of the microsandbox 0.6.6 API we depend on for the
// playground. Kept in lockstep with the "VERIFIED 0.6.6" findings doc. We use
// the one-shot `shell()` here (not `execStreamWith`) — a playground command is
// run-to-completion, not an interactive tty. `ExecOutput` mixes methods
// (stdout/stderr) and getter PROPERTIES (code/success), so callers must probe.
// ---------------------------------------------------------------------------

interface ExecOutput {
  stdout(): string;
  stderr(): string;
  /** Exit code — a NUMBER PROPERTY (getter) on 0.6.6, not a method. */
  readonly code: number;
  /** Success — a BOOLEAN PROPERTY (getter) on 0.6.6, not a method. */
  readonly success: boolean;
}

interface Sandbox {
  readonly name: string;
  shell(script: string): Promise<ExecOutput>;
  stop(): Promise<void>;
  kill(): Promise<void>;
}

interface SandboxNetworkBuilder {
  policy(policy: unknown): this;
}

interface SandboxBuilder {
  image(ref: string): this;
  cpus(n: number): this;
  memory(mib: number): this;
  workdir(path: string): this;
  ephemeral(enabled: boolean): this;
  network(configure: (b: SandboxNetworkBuilder) => SandboxNetworkBuilder): this;
  /** Recreate over any existing same-named sandbox (a leaked row after a crash). */
  replace(): this;
  create(): Promise<Sandbox>;
}

interface RuleBuilder {
  allowPublic(): this;
  allowHost(): this;
  allowLoopback(): this;
}

interface NetworkPolicyBuilder {
  defaultDeny(): this;
  egress(configure: (e: RuleBuilder) => RuleBuilder): this;
  build(): unknown;
}

interface MicrosandboxModule {
  Sandbox: {
    builder(name: string): SandboxBuilder;
    remove(name: string): Promise<void>;
  };
  NetworkPolicy: { builder(): NetworkPolicyBuilder };
}

/** Network posture for a playground guest. */
export type MicroVmNetwork = 'public' | 'none';

/** The run-to-completion result of one playground command (mirrors RemoteExecResult). */
export interface MicroVmExecResult {
  ok: boolean;
  /** Exit code, or null when the command couldn't run at all. */
  code?: number | null;
  stdout?: string;
  stderr?: string;
  /** True when a stream was clipped at the byte cap. */
  truncated?: boolean;
  /** Present only on `ok:false` — an honest reason. */
  message?: string;
}

/** Options for a single {@link MicroVmPool.exec} call. */
export interface MicroVmExecOptions {
  /** Advisory image hint — re-authorized against the closed allowlist (Rule 1). */
  image?: string;
  /** Per-command timeout (ms). Default 120_000, clamped to [1_000, 600_000]. */
  timeoutMs?: number;
  /** Network posture for a freshly-booted guest (ignored if the guest already exists). */
  network?: MicroVmNetwork;
}

/** The single typed failure for "can't run in a guest at all" (twin of McpUnavailableError). */
export class MicroVmUnavailableError extends Error {
  constructor(detail: string) {
    super(`microVM playground unavailable: ${detail}`);
    this.name = 'MicroVmUnavailableError';
  }
}

/** Injectable deps so the pool is testable without the native addon. */
export interface MicroVmPoolDeps {
  /** Is the feature enabled? (the `microVmEnabled` AppConfig flag). Default: always. */
  enabled?: () => boolean;
  /** Is the platform capable of a microVM? Defaults to the real probe. */
  platformSupported?: () => boolean;
  /** Load the SDK. Defaults to a lazy dynamic import of `microsandbox`. */
  loadSdk?: () => Promise<MicrosandboxModule>;
  /** Rule-1 authorization policy (image allowlist, clamps) passed to buildMicroVmConfig. */
  policy?: MicroVmPolicy;
  /** Max live guests before LRU eviction. Default 4. */
  maxGuests?: number;
  /** Idle-TTL before a guest is reaped. Default 10 min. */
  idleTtlMs?: number;
  /** Default per-command timeout. Default 120s (max 600s). */
  defaultTimeoutMs?: number;
  /** Injectable clock (test seam). */
  now?: () => number;
  /** Error log sink. */
  log?: (msg: string, err?: unknown) => void;
}

const STREAM_CAP_BYTES = 1024 * 1024; // 1 MB per stream (mirrors remote_exec)
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;
const GUEST_WORKDIR = '/root';
const DEFAULT_CPUS = 2;
const DEFAULT_MEM_MIB = 1024;

interface Guest {
  key: string;
  sandbox: Sandbox;
  lastUsed: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Serializes commands on one guest — shell() calls must not interleave. */
  chain: Promise<unknown>;
}

/**
 * The pool. Construct ONCE at app init and dispose on shutdown (Rule 3).
 * `exec` lazily boots a guest for a projectId on first use and reuses it after.
 */
export class MicroVmPool {
  private readonly guests = new Map<string, Guest>();
  private disposed = false;

  private readonly enabled: () => boolean;
  private readonly platformSupported: () => boolean;
  private readonly loadSdk: () => Promise<MicrosandboxModule>;
  private readonly policy?: MicroVmPolicy;
  private readonly maxGuests: number;
  private readonly idleTtlMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly now: () => number;
  private readonly log: (msg: string, err?: unknown) => void;
  /** Cached SDK module — loaded once, reused across boots. */
  private sdk: MicrosandboxModule | null = null;

  constructor(deps: MicroVmPoolDeps = {}) {
    this.enabled = deps.enabled ?? (() => true);
    this.platformSupported = deps.platformSupported ?? microVmPlatformSupported;
    this.loadSdk =
      deps.loadSdk ??
      (async () => {
        // Indirection keeps bundlers/tsc from resolving the optional native dep
        // at build time; loaded only when a guest actually boots.
        const pkg = 'microsandbox';
        return (await import(/* @vite-ignore */ pkg)) as unknown as MicrosandboxModule;
      });
    this.policy = deps.policy;
    this.maxGuests = deps.maxGuests ?? 4;
    this.idleTtlMs = deps.idleTtlMs ?? 10 * 60_000;
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? 120_000;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
  }

  /**
   * Run one command in the project's playground guest (booting it lazily on
   * first use), returning a run-to-completion {@link MicroVmExecResult}. Never
   * throws for an operational failure — a denied image, an unsupported platform,
   * a boot failure, or a command timeout all resolve to `{ ok:false, message }`.
   */
  async exec(projectId: string, command: string, opts: MicroVmExecOptions = {}): Promise<MicroVmExecResult> {
    const cmd = command?.trim();
    if (!cmd) return { ok: false, message: 'empty command' };
    if (cmd.includes('\0')) return { ok: false, message: 'command contains a NUL byte' };

    let guest: Guest;
    try {
      guest = await this.acquire(projectId, opts);
    } catch (err) {
      if (err instanceof MicroVmUnavailableError || err instanceof MicroVmAuthorizationError) {
        return { ok: false, message: err.message };
      }
      this.log('microvm acquire failed', err);
      return { ok: false, message: `guest unavailable (${errMsg(err)})` };
    }

    const timeoutMs = clampTimeout(opts.timeoutMs ?? this.defaultTimeoutMs);
    // Serialize on the guest: chain this command after any in-flight one so two
    // concurrent exec calls on the same playground can't interleave shell state.
    const run = guest.chain.then(() => this.runOne(guest, cmd, timeoutMs));
    // Keep the chain alive regardless of this call's outcome.
    guest.chain = run.catch(() => {});
    return run;
  }

  /** Run a single command against an acquired guest with a timeout. */
  private async runOne(guest: Guest, cmd: string, timeoutMs: number): Promise<MicroVmExecResult> {
    // `cd <workdir>` so relative paths behave and state persists in a stable dir.
    const script = `cd ${GUEST_WORKDIR} 2>/dev/null; ${cmd}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const out = await Promise.race([
        guest.sandbox.shell(script),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new MicroVmUnavailableError(`command timed out after ${timeoutMs}ms`)), timeoutMs);
        })
      ]);
      guest.lastUsed = this.now();
      this.armIdle(guest);
      const { text: stdout, truncated: tOut } = clip(out.stdout());
      const { text: stderr, truncated: tErr } = clip(out.stderr());
      const code = typeof out.code === 'number' ? out.code : null;
      return { ok: true, code, stdout, stderr, truncated: tOut || tErr };
    } catch (err) {
      // A timeout leaves the guest in an unknown state — drop it so the next
      // call boots a clean one (a wedged shell shouldn't poison the playground).
      this.dropGuest(guest, 'command error/timeout');
      return { ok: false, message: errMsg(err) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Tear down and forget a project's guest so the next `exec` boots a fresh one
   * (wipe the playground). Idempotent; never throws.
   */
  async reset(projectId: string): Promise<{ ok: true; existed: boolean }> {
    const guest = this.guests.get(projectId);
    if (!guest) return { ok: true, existed: false };
    // AWAIT the teardown: the next exec for this project reboots a guest with
    // the SAME name, and microsandbox rejects a create() while a same-named
    // sandbox still exists ("sandbox already exists"). Awaiting frees the name
    // first. dropGuest never throws, so this always resolves.
    await this.dropGuest(guest, 'reset');
    return { ok: true, existed: true };
  }

  /** Kill every guest (Rule 3 shutdown). Idempotent. */
  async disposeAll(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.guests.values()].map((guest) => this.dropGuest(guest, 'pool disposed')));
  }

  /** How many guests are live (for status/UI). */
  liveCount(): number {
    return this.guests.size;
  }

  // --- internals -----------------------------------------------------------

  private async acquire(projectId: string, opts: MicroVmExecOptions): Promise<Guest> {
    if (this.disposed) throw new MicroVmUnavailableError('pool disposed');
    if (!this.enabled()) throw new MicroVmUnavailableError('microVM playground is disabled (enable it in Settings)');
    if (!this.platformSupported()) {
      throw new MicroVmUnavailableError(
        process.platform === 'darwin' && process.arch !== 'arm64'
          ? 'requires Apple Silicon (Intel Macs unsupported)'
          : `unsupported platform ${process.platform}/${process.arch} — requires Apple Silicon / KVM / WHP`
      );
    }

    const existing = this.guests.get(projectId);
    if (existing) {
      existing.lastUsed = this.now();
      this.armIdle(existing);
      return existing;
    }

    // Authorize the image against the closed allowlist (Rule 1). The playground
    // has NO host bind mount — a hostile repo runs against the guest's OWN
    // scratch disk and can't see host files — so we authorize ONLY the image
    // (not a mount). File exchange, when needed, is explicit via copyToHost /
    // copyFromHost (PR-C), never an ambient bind. `resolveAuthorizedImage`
    // rejects an unlisted ref (no "*"); an agent's `image` hint can only SELECT
    // an allowlisted option.
    const image = resolveAuthorizedImage(opts.image, this.policy ?? {});
    const cpus = clamp(this.policy?.cpuRange, DEFAULT_CPU_RANGE, DEFAULT_CPUS);
    const memoryMib = clamp(this.policy?.memRange, DEFAULT_MEM_RANGE, DEFAULT_MEM_MIB);

    // Evict LRU if at capacity (bounded — Rule 5).
    if (this.guests.size >= this.maxGuests) {
      let lru: Guest | undefined;
      for (const g of this.guests.values()) if (!lru || g.lastUsed < lru.lastUsed) lru = g;
      if (lru) this.dropGuest(lru, 'evicted (pool at capacity)');
    }

    const sdk = await this.ensureSdk();
    const policyObj = buildNetworkPolicy(sdk, opts.network ?? 'public');
    const name = guestName(projectId);
    let sandbox: Sandbox;
    try {
      sandbox = await sdk.Sandbox.builder(name)
        .image(image.ref)
        .cpus(cpus)
        .memory(memoryMib)
        .workdir(GUEST_WORKDIR)
        .ephemeral(true)
        // Recreate over a leaked same-named row (e.g. a hard crash left one
        // behind) so a project can't get permanently wedged. Our own reset()
        // already awaits teardown; this is the belt-and-braces for the crash case.
        .replace()
        .network((n) => n.policy(policyObj))
        .create();
    } catch (err) {
      throw new MicroVmUnavailableError(`guest boot failed (${errMsg(err)})`);
    }

    const guest: Guest = { key: projectId, sandbox, lastUsed: this.now(), chain: Promise.resolve() };
    this.guests.set(projectId, guest);
    this.armIdle(guest);
    return guest;
  }

  private async ensureSdk(): Promise<MicrosandboxModule> {
    if (this.sdk) return this.sdk;
    try {
      this.sdk = await this.loadSdk();
    } catch (err) {
      throw new MicroVmUnavailableError(`microsandbox SDK not available (${errMsg(err)})`);
    }
    return this.sdk;
  }

  private armIdle(guest: Guest): void {
    if (guest.idleTimer) clearTimeout(guest.idleTimer);
    guest.idleTimer = setTimeout(() => this.dropGuest(guest, 'idle timeout'), this.idleTtlMs);
    // Never keep the process alive just for an idle reaper.
    (guest.idleTimer as { unref?: () => void }).unref?.();
  }

  /**
   * Tear down + forget a guest. Removes the map entry SYNCHRONOUSLY (so
   * liveCount + a same-key reboot see it gone immediately) and returns the
   * best-effort async teardown promise so a caller that must free the guest's
   * NAME before re-booting (reset → re-exec) can await it. Never throws.
   */
  private dropGuest(guest: Guest, reason: string): Promise<void> {
    void reason;
    if (guest.idleTimer) clearTimeout(guest.idleTimer);
    // Only delete the map entry if it still points at THIS guest (a reset +
    // reboot may have replaced it).
    if (this.guests.get(guest.key) === guest) this.guests.delete(guest.key);
    // Best-effort teardown: stop() is the clean path (clears the registry row);
    // fall back to kill()/remove() so a stop failure can't leak a row. Never throws.
    const done = (async () => {
      try {
        await guest.sandbox.stop();
        return;
      } catch {
        /* fall through */
      }
      try {
        await guest.sandbox.kill();
      } catch {
        /* ECHILD expected on an ephemeral guest */
      }
      try {
        const sdk = this.sdk;
        if (sdk) await sdk.Sandbox.remove(guest.sandbox.name);
      } catch {
        /* best-effort registry cleanup */
      }
    })();
    return done;
  }
}

/** Deny-by-default network policy; `public` allows public+host+loopback, `none` allows nothing. */
function buildNetworkPolicy(sdk: MicrosandboxModule, mode: MicroVmNetwork): unknown {
  const b = sdk.NetworkPolicy.builder().defaultDeny();
  if (mode === 'public') b.egress((e) => e.allowPublic().allowHost().allowLoopback());
  return b.build();
}

/** A sandbox name derived from the project id (microsandbox names: [alnum].-_). */
function guestName(projectId: string): string {
  const safe = projectId.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100);
  return `zcc-pg-${safe}`;
}

function clampTimeout(ms: number): number {
  const n = Number.isFinite(ms) ? Math.floor(ms) : 120_000;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, n));
}

/** Clamp a resource request to its [min,max] range, falling back on absent/NaN. */
function clamp(range: { min: number; max: number } | undefined, fallbackRange: { min: number; max: number }, fallback: number): number {
  const r = range ?? fallbackRange;
  return Math.min(r.max, Math.max(r.min, fallback));
}

/** Clip a stream to the byte cap, flagging truncation (mirrors remote_exec). */
function clip(s: string): { text: string; truncated: boolean } {
  if (s.length <= STREAM_CAP_BYTES) return { text: s, truncated: false };
  return { text: s.slice(0, STREAM_CAP_BYTES), truncated: true };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
