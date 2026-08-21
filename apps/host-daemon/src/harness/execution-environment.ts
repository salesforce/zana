/**
 * Execution environments — the "WHERE an agent runs" axis of a launch, orthogonal
 * to the `LaunchProvider` "WHAT agent runs" axis (registry.ts). A launch resolves
 * a provider (claude/codex/shell → `{command, args}`) AND an environment
 * (local/sandbox/… → how that command is wrapped before `pty.spawn`).
 *
 * WHY A SEAM
 * ----------
 * `PtyManager.create()` already wraps the resolved `{command, args}` for tmux
 * persistence right before spawning (node-pty stays the client, so
 * onData/write/resize/coalescing all keep working). Isolation is the same shape:
 * wrap the inner command, don't touch the client. This module is the ONE place
 * that owns the wrap, dispatched by a frozen registry so core names no concrete
 * environment in its launch logic (Rule 6). Adding an environment (docker, vm) =
 * one new object + one registry entry, zero caller edits.
 *
 * TIER 1 — KERNEL SANDBOX (grok-build model)
 * ------------------------------------------
 * The `sandbox` environment runs the agent process under an OS kernel sandbox
 * (Apple Seatbelt today; Linux Landlock/bubblewrap is a follow-up behind the same
 * env). Seatbelt is inherited by every child the agent spawns, so wrapping the
 * agent process confines its whole subtree — we do NOT need per-`Bash`-command
 * wrapping the way the command runner does. Unlike that runner (which
 * denies egress for an approved shell command), a pty AGENT legitimately needs the
 * network (LLM API + the local MCP callback server), so the pty-agent sandbox
 * default is workspace-style: writes ⊂ cwd + scratch, reads of the sensitive-root
 * blocklist denied, network ALLOWED.
 *
 * DEGRADATION (decided: grok-style warn-and-run)
 * ----------------------------------------------
 * When the kernel can't enforce the sandbox (non-macOS, missing `sandbox-exec`),
 * `wrap()` returns the command UNCHANGED and `status()` reports
 * `{ isolated: false, reason }`. The launch proceeds; the session surfaces the
 * honest posture. Isolation is never silently assumed, and a missing kernel
 * primitive never blocks an agent from launching.
 *
 * COMMUNICATION
 * -------------
 * A kernel-sandboxed process shares the host network namespace, so the per-session
 * `ZCC_*_URL` callbacks (127.0.0.1:<port>) still resolve — `inbox_push`,
 * `agent_send`, hooks, and `reply()` all work with ZERO env changes.
 * `rewriteCallbackEnv` is the identity here; it exists for a future container/VM
 * environment whose loopback is not the host's (e.g. docker → host.docker.internal).
 *
 * PURE + electron-free: string/path assembly only. The one runtime probe
 * (`sandbox-exec` on PATH) is injectable via SandboxOptions.isAvailable for tests.
 */

import {
  buildSeatbeltProfile,
  sandboxAvailable,
  type SandboxOptions
} from '../zcc-harness/sandbox.js';
import { sensitiveRoots as defaultSensitiveRoots } from '../../../desktop/src/extensions/permission-broker.js';
import { createMicroVmEnvironment } from './microvm-environment.js';
import type { RuntimeSupervisor } from '../../../desktop/src/runtime/runtime-supervisor.js';
import { createRuntimeHostExecutionEnvironment } from './runtime-host-environment.js';

/** The registered execution environments. `local` is the identity element. */
export type ExecEnvId = 'local' | 'sandbox' | 'microvm' | 'runtime-host';

/** A resolved inner launch — the provider's `{command, args}`, tmux-agnostic. */
export interface InnerLaunch {
  command: string;
  args: string[];
}

/** Per-launch context an environment needs to build its wrap. */
export interface ExecEnvContext {
  sessionId: string;
  projectId: string;
  /** The canonical (realpath'd) workspace root — writes are confined here. */
  cwd: string;
  /** Sensitive roots to hard-deny reads of (defaults to the broker's list). */
  denyReadRoots?: readonly string[];
  /** Allow outbound network (default: true for pty agents — they need the LLM API). */
  allowNetwork?: boolean;
  /** Test seam: is the kernel sandbox available? Defaults to the real probe. */
  isAvailable?: () => boolean;
  /**
   * microVM-only ADVISORY hints (env id `microvm`). Each is re-authorized in the
   * `microvm-builder` before use (Rule 1): `microVmImage` is resolved against a
   * closed allowlist, cpus/memory are clamped. Ignored by `local`/`sandbox`.
   */
  microVmImage?: string;
  microVmCpus?: number;
  microVmMemoryMib?: number;
}

/** Honest posture for the session UI: is isolation actually in force? */
export interface IsolationStatus {
  isolated: boolean;
  /** Why isolation is off, when `isolated` is false. */
  reason?: string;
}

/**
 * A pty-like duplex the pty layer can drive in place of a `node-pty` `IPty`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The two built-in environments (`local`, `sandbox`) satisfy the synchronous
 * `wrap()` contract: they return a `{command, args}` node-pty spawns directly,
 * so `Live.proc` is a real `pty.IPty`. A microVM/container environment cannot —
 * booting the guest is ASYNC (`await Sandbox.create()`, may pull an image for
 * seconds) and the SDK OWNS the process (there is no host command node-pty can
 * spawn to attach to a process living inside the guest). Such an environment
 * instead implements the optional {@link ExecutionEnvironment.createSession},
 * returning one of these — the SAME method surface the pty layer already uses on
 * `pty.IPty` (`onData`/`onExit`/`write`/`resize`/`kill`/`pid`), so
 * `PtyManager`'s I/O methods (`write`/`reply`/`resize`/`close`) route through
 * either handle with NO per-call-site branching. See `pty.ts` `Live.proc`.
 */
export interface ExecutionSession {
  /** Guest process id, when the runtime exposes one (advisory — used for badges/logs, never trusted). */
  readonly pid?: number;
  /** Subscribe to guest stdout+stderr (already merged into a single stream, like a pty). */
  onData(cb: (data: string) => void): void;
  /** Fires once when the guest process exits; `exitCode` mirrors node-pty's shape. */
  onExit(cb: (e: { exitCode: number }) => void): void;
  /** Write bytes to the guest stdin (reply-injection maps here, byte-identical to `pty.write`). */
  write(data: string): void;
  /** Resize the guest tty. A runtime without resize may no-op. */
  resize(cols: number, rows: number): void;
  /** Terminate the guest process (and tear down the VM for an attached sandbox). */
  kill(signal?: string): void;
  /** Optional semantic close for runtimes that distinguish expected completion. */
  terminateExpected?(): void;
  /**
   * Release any host resources (masters/fds/child handles). Optional twin of
   * node-pty's `destroy()` — called from `finalizeExit` defensively.
   */
  destroy?(): void;
}

/** One "where it runs" backend. Composes with any LaunchProvider. */
export interface ExecutionEnvironment {
  readonly id: ExecEnvId;
  /** Wrap the inner launch into the command actually handed to (tmux →) pty.spawn. */
  wrap(inner: InnerLaunch, ctx: ExecEnvContext): InnerLaunch;
  /** Rewrite per-session callback env so the agent can still reach the host MCP server. */
  rewriteCallbackEnv(env: Record<string, string>, ctx: ExecEnvContext): Record<string, string>;
  /** Whether isolation is actually enforced for this launch (for the session UI). */
  status(ctx: ExecEnvContext): IsolationStatus;
  /**
   * OPTIONAL async, handle-owning launch mode. When present, the pty layer
   * launches through this INSTEAD of `pty.spawn(wrap(...))`: it boots the
   * backend (VM/container), then attaches the returned {@link ExecutionSession}
   * as the session's `proc`. Absent on `local`/`sandbox` (they use the sync
   * `wrap()` + node-pty path). The returned handle owns the guest process; the
   * pty layer only drives it through the {@link ExecutionSession} surface.
   *
   * `inner` is the resolved provider `{command, args}` (the argv to run INSIDE
   * the guest); `sessionEnv` is the per-session env (callbacks already rewritten
   * by {@link ExecutionEnvironment.rewriteCallbackEnv}).
   */
  createSession?(
    inner: InnerLaunch,
    ctx: ExecEnvContext & {
      cols: number;
      rows: number;
      /** Session-only callback overrides, for guests that must scrub host env. */
      sessionEnv: Record<string, string>;
      /** Complete environment for a host-local execution backend. */
      spawnEnv?: Record<string, string>;
    }
  ): Promise<ExecutionSession>;
}

/** The `local` environment: verbatim launch, host loopback, no isolation claimed. */
const localEnvironment: ExecutionEnvironment = {
  id: 'local',
  wrap: (inner) => inner,
  rewriteCallbackEnv: (env) => env,
  // `isolated: false` with no reason == "no isolation was requested" (vs. sandbox's
  // reason-bearing false, which means "requested but unavailable"). The session UI
  // distinguishes the two by whether the environment id is 'local'.
  status: () => ({ isolated: false })
};

/** Build the SandboxOptions a Seatbelt wrap needs from the launch context. */
function sandboxOptionsFor(ctx: ExecEnvContext): SandboxOptions {
  return {
    root: ctx.cwd,
    denyReadRoots: ctx.denyReadRoots ?? defaultSensitiveRoots(),
    // pty agents need the network (LLM API + local MCP callbacks). Default ON,
    // overridable per launch for untrusted/no-egress work.
    allowNetwork: ctx.allowNetwork ?? true,
    isAvailable: ctx.isAvailable
  };
}

/**
 * The `sandbox` environment: run the agent under an OS kernel sandbox. On macOS
 * this is `sandbox-exec -p <profile> <command> <args…>` — args are passed to
 * sandbox-exec directly (no `/bin/sh -c`), so there is no shell-quoting seam and
 * node-pty's argv handling is unchanged. Off macOS / no sandbox-exec it degrades
 * to the verbatim launch (see status()).
 */
const sandboxEnvironment: ExecutionEnvironment = {
  id: 'sandbox',
  wrap: (inner, ctx) => {
    const available = (ctx.isAvailable ?? sandboxAvailable)();
    if (!available) return inner; // warn-and-run: status() carries the reason
    const profile = buildSeatbeltProfile(sandboxOptionsFor(ctx));
    return {
      command: 'sandbox-exec',
      args: ['-p', profile, inner.command, ...inner.args]
    };
  },
  // Sandboxed process shares the host loopback — callbacks resolve unchanged.
  rewriteCallbackEnv: (env) => env,
  status: (ctx) => {
    const available = (ctx.isAvailable ?? sandboxAvailable)();
    if (available) return { isolated: true };
    return {
      isolated: false,
      reason:
        process.platform === 'darwin'
          ? 'sandbox-exec not found — running without kernel containment'
          : `OS sandbox unsupported on ${process.platform} — running without kernel containment`
    };
  }
};

/**
 * The `microvm` environment: run the agent inside a microsandbox microVM
 * (hardware isolation via libkrun). Async + handle-owning (implements
 * `createSession`, not the sync `wrap()`); the SDK calls live in
 * `microvm-environment.ts` (the one trusted seam, Rule 7). Built once here with
 * the default policy; a future config-driven allowlist plugs in via its deps.
 */
const microVmEnvironment: ExecutionEnvironment = createMicroVmEnvironment();

let runtimeHostEnvironment: ExecutionEnvironment | null = null;

/**
 * The runtime-host lane is injected at desktop startup because it depends on the
 * live authenticated server/host pair. It is intentionally unavailable elsewhere.
 */
export function setRuntimeHostSupervisor(runtime: RuntimeSupervisor | null): void {
  runtimeHostEnvironment = runtime ? createRuntimeHostExecutionEnvironment({ runtime }) : null;
}

/** Whether the trusted desktop has paired the authenticated server-host runtime. */
export function runtimeHostAvailable(): boolean {
  return runtimeHostEnvironment !== null;
}

/** Frozen registry — built once at module load (Rule 3: nothing to subscribe/dispose). */
const EXECUTION_ENVIRONMENTS: Readonly<Record<Exclude<ExecEnvId, 'runtime-host'>, ExecutionEnvironment>> = Object.freeze({
  local: localEnvironment,
  sandbox: sandboxEnvironment,
  microvm: microVmEnvironment
});

/**
 * Resolve an execution environment. Total over `ExecEnvId`; an absent/unknown id
 * falls back to `local` (never crashes a spawn), mirroring `providerFor`.
 */
export function environmentFor(id: ExecEnvId | undefined): ExecutionEnvironment {
  if (id === 'runtime-host') return runtimeHostEnvironment ?? localEnvironment;
  return (id && EXECUTION_ENVIRONMENTS[id]) || localEnvironment;
}
