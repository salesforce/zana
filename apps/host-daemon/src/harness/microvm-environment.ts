/**
 * The `microvm` execution environment — runs an agent inside a microsandbox
 * microVM (libkrun-backed guest, hardware-isolated) instead of the host. This
 * is the ONLY module that touches the `microsandbox` SDK; per Rule 7 the VM
 * runtime is a bounded, trusted core capability, kept out of any sandboxed
 * extension (mirroring `zana/mcp-pool.ts`).
 *
 * SHAPE
 * -----
 * microsandbox is async and OWNS the guest process, so this env implements the
 * seam's optional `createSession()` (added in PR1) rather than the synchronous
 * `wrap()`. `PtyManager.create()` registers the session `starting`, calls
 * `createSession()` in the background, and swaps the returned
 * {@link ExecutionSession} in when the guest is up.
 *
 * VERIFIED against `microsandbox@0.6.6` (see the design doc's "VERIFIED 0.6.6"
 * block): exec events carry `Uint8Array` data (we decode), there is NO tty
 * resize (our `resize()` is a no-op), and the default net policy is "public
 * only" so host access needs an explicit `allowHost()` egress rule.
 *
 * DEPENDENCY
 * ----------
 * The SDK is a heavy NATIVE addon and is loaded via a lazy dynamic import, so
 * the app build + the whole test suite stay independent of it (it isn't a
 * hard dependency and needn't be installed for anything but a live microVM
 * launch). An import failure or an unsupported platform degrades to an honest
 * unavailable `status()` and a fail-closed `createSession()` (design §5).
 *
 * KNOWN CONSTRAINT (go-live, not PR2): the agent binary (`claude`, a shell, …)
 * and its deps must exist INSIDE the guest image — the guest is a separate OS
 * from the host, so `inner.command` is resolved against the guest rootfs, not
 * the host PATH. Choosing/provisioning an agent-bearing image is a PR3/go-live
 * concern; this adapter faithfully runs `inner.command inner.args` in the guest.
 */

import { buildMicroVmConfig, type MicroVmPolicy } from './microvm-builder.js';
import type {
  ExecutionEnvironment,
  ExecutionSession,
  InnerLaunch,
  IsolationStatus
} from './execution-environment.js';

/** The host DNS name a guest uses to reach the host machine (microsandbox 0.6.6). */
export const HOST_INTERNAL = 'host.microsandbox.internal';

// ---------------------------------------------------------------------------
// Minimal typed slice of the microsandbox 0.6.6 API we depend on. The package
// is loaded via a lazy dynamic import (it's an optional native addon, not a
// hard dep), so we mirror just the surface we use rather than importing its
// types. Kept in lockstep with the "VERIFIED 0.6.6" design block.
// ---------------------------------------------------------------------------

type ExecEvent =
  | { kind: 'started'; pid: number }
  | { kind: 'stdout'; data: Uint8Array }
  | { kind: 'stderr'; data: Uint8Array }
  | { kind: 'exited'; code: number };

interface ExecSink {
  write(data: Uint8Array | string): Promise<void>;
  close(): Promise<void>;
}

interface ExecHandle extends AsyncIterable<ExecEvent> {
  takeStdin(): Promise<ExecSink | null>;
  kill(): Promise<void>;
}

interface ExecOptionsBuilder {
  args(args: string[]): this;
  tty(enabled: boolean): this;
  stdinPipe(): this;
  cwd(cwd: string): this;
  envs(vars: Record<string, string>): this;
}

interface MountBuilder {
  bind(host: string): this;
  readonly(): this;
}

interface SandboxNetworkBuilder {
  policy(policy: unknown): this;
}

interface SandboxBuilder {
  image(ref: string): this;
  cpus(n: number): this;
  memory(mib: number): this;
  workdir(path: string): this;
  envs(vars: Record<string, string>): this;
  ephemeral(enabled: boolean): this;
  volume(guest: string, configure: (b: MountBuilder) => MountBuilder): this;
  network(configure: (b: SandboxNetworkBuilder) => SandboxNetworkBuilder): this;
  create(): Promise<Sandbox>;
}

interface Sandbox {
  /** The sandbox name (used to reap its `~/.microsandbox/db` registry row). */
  readonly name: string;
  execStreamWith(cmd: string, configure: (b: ExecOptionsBuilder) => ExecOptionsBuilder): Promise<ExecHandle>;
  /** Graceful teardown — reclaims the guest AND clears its registry row (verified 0.6.6). */
  stop(): Promise<void>;
  /** Forceful teardown — throws `ECHILD` once the ephemeral child is reaped, and leaks the registry row. */
  kill(): Promise<void>;
}

interface NetworkPolicyBuilder {
  defaultDeny(): this;
  egress(configure: (e: RuleBuilder) => RuleBuilder): this;
  build(): unknown;
}

interface RuleBuilder {
  /** Allow egress to public (internet) destinations. */
  allowPublic(): this;
  /** Allow egress to the HOST (reaches `host.microsandbox.internal`). */
  allowHost(): this;
  /** Allow egress to loopback — required for in-guest DNS resolution of the host name. */
  allowLoopback(): this;
}

interface MicrosandboxModule {
  Sandbox: {
    builder(name: string): SandboxBuilder;
    /** Remove a stopped sandbox's registry row (fallback cleanup after a forceful kill). */
    remove(name: string): Promise<void>;
  };
  NetworkPolicy: { builder(): NetworkPolicyBuilder };
}

/** Injectable deps so the adapter is testable without the native addon. */
export interface MicroVmDeps {
  /** Load the SDK. Defaults to a lazy dynamic import of `microsandbox`. */
  loadSdk?: () => Promise<MicrosandboxModule>;
  /** Authorization policy passed to the Rule-1 builder. */
  policy?: MicroVmPolicy;
  /** Test seam: is the platform capable of running a microVM? */
  platformSupported?: () => boolean;
}

/**
 * Is the current platform capable of a microsandbox microVM? 0.6.6 ships
 * native addons for darwin-arm64, linux-{x64,arm64}, win32-{x64,arm64}. Intel
 * Mac (darwin-x64) is explicitly unsupported (design §5 → fail-closed).
 */
export function microVmPlatformSupported(): boolean {
  const { platform, arch } = process;
  if (platform === 'darwin') return arch === 'arm64';
  if (platform === 'linux') return arch === 'x64' || arch === 'arm64';
  if (platform === 'win32') return arch === 'x64' || arch === 'arm64';
  return false;
}

/** Rewrite a single callback URL's host loopback → the guest-reachable host name. */
function rewriteLoopback(url: string): string {
  // Only rewrite the HOST; the port is the real host server port and stays.
  return url.replace(/127\.0\.0\.1|localhost/g, HOST_INTERNAL);
}

/**
 * Host env vars whose VALUES are host-filesystem / host-OS specific and are
 * MEANINGLESS (or actively harmful) inside the Linux guest — the guest is a
 * separate OS with its own rootfs. The per-session env the pty layer assembles
 * is a HOST env (macOS `PATH=/Users/…/.local/bin:…`, `HOME=/Users/<user>`, a
 * host `TMPDIR`, …); passing these into the guest overrides the guest's own
 * defaults and breaks command resolution.
 *
 * VERIFIED on 0.6.6 (this is exactly the bug the full-app integration test
 * caught): with a host `PATH` set, the guest cannot resolve even `sh`, and the
 * SDK yields a malformed/`undefined` exec event → the process "exits 1" with no
 * output. Dropping these lets the guest OS defaults (`/bin:/usr/bin:…`, the
 * image's own `HOME`) apply, while every ZCC callback var (which we DO want —
 * already loopback-rewritten) passes through untouched.
 */
const GUEST_STRIPPED_ENV = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'PWD', 'OLDPWD', 'SHELL', 'LOGNAME', 'USER']);

/** Drop host-filesystem/host-OS env vars so the guest OS defaults apply (see {@link GUEST_STRIPPED_ENV}). */
function scrubGuestEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!GUEST_STRIPPED_ENV.has(k)) out[k] = v;
  }
  return out;
}

/** Basenames of interactive login shells the `shell` launch profile may resolve to on the HOST. */
const HOST_SHELL_BASENAMES = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'ksh']);

/**
 * Remap a HOST shell command to a guest-resolvable one. The `shell` launch
 * profile resolves to the host's configured login shell — an ABSOLUTE HOST path
 * (`/bin/zsh`, `/opt/homebrew/bin/zsh`, …) that does not exist in the Linux
 * guest rootfs, so the guest can't launch it (the same failure class as the
 * host-PATH bug: 0.6.6 yields a malformed event → silent exit 1). Every POSIX
 * image ships `/bin/sh`, so we remap any absolute-path host shell to it,
 * preserving args. NON-shell commands pass through untouched — notably a bare
 * `claude` (resolved via the guest PATH) and any agent binary the guest image
 * provides — so this only rescues the plain-shell case, never masks a genuinely
 * missing agent binary.
 */
function remapGuestCommand(inner: InnerLaunch): InnerLaunch {
  const base = inner.command.split('/').pop() ?? inner.command;
  if (inner.command.startsWith('/') && HOST_SHELL_BASENAMES.has(base)) {
    return { command: '/bin/sh', args: inner.args };
  }
  return inner;
}

/**
 * Adapt a microsandbox {@link ExecHandle}/{@link ExecSink} pair to the pty
 * layer's {@link ExecutionSession}. Decodes `Uint8Array` events to UTF-8,
 * fans exit through `onExit`, and tears the whole guest VM down on `kill`.
 */
class MicroVmSession implements ExecutionSession {
  pid?: number;
  private dataCbs: Array<(d: string) => void> = [];
  private exitCbs: Array<(e: { exitCode: number }) => void> = [];
  private readonly decoder = new TextDecoder();
  private exited = false;
  private killed = false;
  private tornDown = false;

  constructor(
    private readonly handle: ExecHandle,
    private readonly sink: ExecSink | null,
    private readonly sandbox: Sandbox,
    /** Static `Sandbox.remove` — best-effort registry cleanup if `stop()` fails. */
    private readonly removeSandbox: (name: string) => Promise<void>
  ) {
    void this.pump();
  }

  /** Drain the guest exec event stream into the registered callbacks. */
  private async pump(): Promise<void> {
    try {
      for await (const ev of this.handle) {
        // Defensive: the SDK yields a malformed/`undefined` event when the guest
        // can't launch the command at all (e.g. an unresolvable PATH). Treat it
        // as an abnormal exit rather than crashing the pump on `ev.kind`
        // (verified on 0.6.6 — see the PATH-scrub note in createSession).
        if (!ev || typeof ev.kind !== 'string') {
          this.fireExit(1);
          return;
        }
        if (ev.kind === 'started') {
          this.pid = ev.pid;
        } else if (ev.kind === 'stdout' || ev.kind === 'stderr') {
          const text = this.decoder.decode(ev.data, { stream: true });
          if (text) for (const cb of this.dataCbs) cb(text);
        } else if (ev.kind === 'exited') {
          this.fireExit(ev.code);
          return;
        }
      }
      // Stream ended without an explicit `exited` event.
      this.fireExit(0);
    } catch {
      // A transport error looks like an abnormal exit to the pty layer.
      this.fireExit(1);
    } finally {
      // The guest process is done — tear the VM down so it can't orphan.
      void this.teardownVm();
    }
  }

  /**
   * Reclaim the guest VM AND its `~/.microsandbox/db` registry row. Verified on
   * Apple Silicon (0.6.6): the ephemeral guest child is auto-reaped when its
   * exec exits, so `sandbox.kill()` then throws `ECHILD` ("No child processes")
   * AND leaves a STALE `Sandbox.list()` entry behind — an unbounded accumulating
   * store (Rule 5). `sandbox.stop()` tears down cleanly and clears the row with
   * no error. We fall back to `kill()` + `Sandbox.remove(name)` so a stop
   * failure still can't leak a registry row. Idempotent + never throws (best-
   * effort teardown on a session that's already logically dead).
   */
  private async teardownVm(): Promise<void> {
    if (this.tornDown) return;
    this.tornDown = true;
    try {
      await this.sandbox.stop();
      return;
    } catch {
      // fall through to the forceful path
    }
    try {
      await this.sandbox.kill();
    } catch {
      // ECHILD is expected once the ephemeral child is already reaped.
    }
    try {
      await this.removeSandbox(this.sandbox.name);
    } catch {
      // best-effort registry cleanup
    }
  }

  private fireExit(code: number): void {
    if (this.exited) return;
    this.exited = true;
    for (const cb of this.exitCbs) cb({ exitCode: code });
  }

  onData(cb: (data: string) => void): void {
    this.dataCbs.push(cb);
  }
  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitCbs.push(cb);
  }
  write(data: string): void {
    // ExecSink.write is async; the pty write contract is fire-and-forget.
    if (this.sink) void this.sink.write(data).catch(() => {});
  }
  resize(): void {
    // microsandbox 0.6.6 exposes NO tty resize — the guest keeps its initial
    // dimensions. Documented no-op (design "VERIFIED 0.6.6" §2).
  }
  kill(): void {
    if (this.killed) return;
    this.killed = true;
    void this.handle.kill().catch(() => {});
    void this.teardownVm();
  }
  destroy(): void {
    this.kill();
  }
}

/**
 * Build the `microvm` execution environment. Returns an
 * {@link ExecutionEnvironment} whose `createSession()` boots a microsandbox VM
 * and returns a pty-like {@link ExecutionSession}. `wrap()` is the identity (an
 * async env never spawns via node-pty); `rewriteCallbackEnv()` swaps host
 * loopback → `host.microsandbox.internal` so the guest can reach the host MCP /
 * hook servers; `status()` reports whether a VM can actually run here.
 */
export function createMicroVmEnvironment(deps: MicroVmDeps = {}): ExecutionEnvironment {
  const supported = deps.platformSupported ?? microVmPlatformSupported;
  const loadSdk =
    deps.loadSdk ??
    (async () => {
      // Indirection keeps bundlers/tsc from trying to resolve the optional
      // native dep at build time; it's loaded only on a live microVM launch.
      const pkg = 'microsandbox';
      return (await import(/* @vite-ignore */ pkg)) as unknown as MicrosandboxModule;
    });

  return {
    id: 'microvm',
    // An async, handle-owning env never spawns via node-pty; wrap is the
    // identity so the seam contract (wrap always present) still holds.
    wrap: (inner) => inner,
    // Guest loopback ≠ host loopback — rewrite every callback URL's host to the
    // guest-reachable host name (port unchanged, it's the real host port).
    rewriteCallbackEnv: (env) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) {
        out[k] = k.startsWith('ZCC_') && k.endsWith('_URL') ? rewriteLoopback(v) : v;
      }
      return out;
    },
    status: (): IsolationStatus => {
      if (!supported()) {
        return {
          isolated: false,
          reason:
            process.platform === 'darwin' && process.arch !== 'arm64'
              ? 'microVM runtime unavailable — requires Apple Silicon (Intel Macs unsupported)'
              : `microVM runtime unavailable on ${process.platform}/${process.arch} — requires Apple Silicon / KVM / WHP`
        };
      }
      // Availability of the msb runtime itself is confirmed at boot time by
      // createSession (it throws → fail-closed); status only reflects the
      // platform gate synchronously here.
      return { isolated: true };
    },
    createSession: async (inner: InnerLaunch, ctx) => {
      if (!supported()) {
        throw new Error(
          'microVM runtime unavailable on this platform (requires Apple Silicon / KVM / WHP)'
        );
      }
      const cfg = buildMicroVmConfig(
        { image: ctx.microVmImage, cwd: ctx.cwd, cpus: ctx.microVmCpus, memoryMib: ctx.microVmMemoryMib },
        deps.policy
      );
      const sdk = await loadSdk();

      // Default policy is "public only" (host DENIED). Under deny-by-default,
      // allow egress to public + the host group (reaches
      // host.microsandbox.internal) + loopback (in-guest DNS resolution of that
      // name). VERIFIED on Apple Silicon (0.6.6): the matchers chain on ONE
      // egress rule builder — separate `.egress()` calls per matcher throw
      // `invalidConfig`, and there is NO top-level `.allowDns()` (loopback covers
      // it). A guest wget to the host server returns HOST-OK with this policy;
      // the default (host-denied) policy refuses the connection.
      const policy = sdk.NetworkPolicy.builder()
        .defaultDeny()
        .egress((e) => e.allowPublic().allowHost().allowLoopback())
        .build();

      // Strip host-filesystem/host-OS env vars (PATH, HOME, …) so the guest OS
      // defaults apply — passing the host's macOS PATH into the Linux guest
      // makes it unable to resolve even `sh` (see scrubGuestEnv). The ZCC
      // callback vars (already loopback-rewritten) survive the scrub.
      const guestEnv = scrubGuestEnv(ctx.sessionEnv);

      // Remap a host login shell (`/bin/zsh`, …) to the guest's `/bin/sh` — the
      // host path doesn't exist in the guest rootfs. Non-shell commands (a bare
      // `claude`, …) pass through unchanged (see remapGuestCommand).
      const guestInner = remapGuestCommand(inner);

      const builder = sdk.Sandbox.builder(sandboxName(ctx.sessionId))
        .image(cfg.image.ref)
        .cpus(cfg.cpus)
        .memory(cfg.memoryMib)
        .workdir(cfg.workdir)
        .ephemeral(true)
        .envs(guestEnv)
        .volume(cfg.workspaceMount.guestPath, (b) => {
          const bound = b.bind(cfg.workspaceMount.hostPath);
          return cfg.workspaceMount.readonly ? bound.readonly() : bound;
        })
        .network((n) => n.policy(policy));

      const sandbox = await builder.create();
      const handle = await sandbox.execStreamWith(guestInner.command, (b) =>
        b.args(guestInner.args).tty(true).stdinPipe().cwd(cfg.workdir).envs(guestEnv)
      );
      const sink = await handle.takeStdin();
      return new MicroVmSession(handle, sink, sandbox, (name) => sdk.Sandbox.remove(name));
    }
  };
}

/** A sandbox name derived from the session id (<=128 UTF-8 bytes; ids are UUIDs). */
function sandboxName(sessionId: string): string {
  return `zcc-${sessionId}`.slice(0, 128);
}
