/**
 * Main-process module host. Owns the lifecycle of every app module's
 * main side: runs each module's `setup()` once at boot, holds the resulting
 * capability maps, and exposes a single `dispatch()` the IPC layer calls.
 *
 * Modules are listed in `./index.ts`. Core touches nothing per-module —
 * adding a module means appending one line to that array.
 */

import { app } from 'electron';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveZccDataDir } from '@zana-ai/zcc-host-daemon/host-config';
import type {
  MainModule,
  MainModuleContext,
  ModuleCapability,
  ExecRequest,
  ExecResult,
  BrokeredFetchInit,
  BrokeredFetchResponse
} from '@zana-ai/zcc-extension-sdk/main';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { PersonaTeamRegistry } from '../extensions/persona-team-registry.js';
import { resolveProjectRoot } from '@zana-ai/zcc-server/services/projects/resolve-project-root';
import {
  followManualRedirects,
  readCappedText,
  FETCH_MAX_BODY
} from '../extensions/broker-caps.js';

/**
 * Hard ceiling on a built-in's exec, regardless of its requested timeout.
 * Built-ins are trusted, but a bound still prevents a hung `sf` wedging boot.
 */
const BUILTIN_EXEC_MAX_TIMEOUT_MS = 60_000;
/** Cap built-in exec output so a runaway child can't OOM main. */
const BUILTIN_EXEC_MAX_BUFFER = 16 * 1024 * 1024;
/**
 * Wall-clock ceiling on a built-in fetch (request + redirect chasing + body
 * read). Without it a hung/slow host stalls the call — and any boot/notify path
 * that awaits it — forever. Enforced via an AbortController whose signal is
 * threaded into the shared redirect helper; cleared on completion.
 */
const BUILTIN_FETCH_TIMEOUT_MS = 30_000;

/**
 * TRUSTED, UNGATED `exec` for BUILT-IN (in-process) modules.
 *
 * Built-ins are the trusted tier: they run in the main process and could call
 * `node:child_process` directly. We give them `ctx.exec` anyway so the
 * `MainModuleContext` contract is UNIFORM — the SAME `ctx.exec({ bin: 'sf' })`
 * a built-in calls today also works verbatim when that module later moves to a
 * disk extension (GUS-EXT-B), where it forwards to the permission-GATED broker
 * (`createBrokerCapabilities`). This path is deliberately NOT gated: no
 * permission check, no bin-allowlist — that gating belongs to the disk-ext
 * broker, a SEPARATE ctx-construction site (host-child.ts → broker-caps.ts),
 * which this must not weaken.
 *
 * It mirrors the broker's S3 reject semantics so the two execs are behaviourally
 * interchangeable: a spawn failure (ENOENT) or watchdog kill (timeout / output
 * cap) REJECTS; a process that ran and exited non-zero RESOLVES with `code !== 0`.
 */
function builtinExec(req: ExecRequest): Promise<ExecResult> {
  if (!req || typeof req.bin !== 'string' || !req.bin) {
    return Promise.reject(new Error('exec: missing bin'));
  }
  const timeout = Math.min(req.timeoutMs ?? BUILTIN_EXEC_MAX_TIMEOUT_MS, BUILTIN_EXEC_MAX_TIMEOUT_MS);
  return new Promise<ExecResult>((resolveP, rejectP) => {
    // shell:false + explicit argv → no shell interpretation, no injection.
    execFile(
      req.bin,
      Array.isArray(req.args) ? req.args : [],
      { cwd: req.cwd, timeout, maxBuffer: BUILTIN_EXEC_MAX_BUFFER, shell: false },
      (err, stdout, stderr) => {
        if (err) {
          // @types mislabels `code`: numeric exit code on a non-zero exit, but a
          // STRING errno ('ENOENT'…) on a spawn failure. Read it as unknown.
          const e = err as Error & { code?: unknown; killed?: boolean; signal?: string };
          const exitCode = typeof e.code === 'number' ? e.code : null;
          if (exitCode === null) {
            // Never ran / watchdog-killed → reject (S3), matching the broker.
            if (e.killed) {
              rejectP(new Error(`exec: "${req.bin}" killed after ${timeout}ms (timeout or output cap exceeded)`));
              return;
            }
            if (typeof e.code === 'string') {
              rejectP(new Error(`exec: failed to start "${req.bin}" (${e.code})`));
              return;
            }
            // Ran, then died on a signal — surface as a non-error code:null result.
            resolveP({ stdout: String(stdout), stderr: String(stderr), code: null, signal: e.signal ?? null });
            return;
          }
          resolveP({ stdout: String(stdout), stderr: String(stderr), code: exitCode });
          return;
        }
        resolveP({ stdout: String(stdout), stderr: String(stderr), code: 0 });
      }
    );
  });
}

/**
 * TRUSTED, UNGATED `fetch` for BUILT-IN (in-process) modules.
 *
 * Same rationale as {@link builtinExec}: built-ins are the trusted tier and
 * could call Node's global `fetch` directly, but we hand them `ctx.fetch` so
 * the `MainModuleContext` contract is UNIFORM — the SAME `ctx.fetch(url, init)`
 * a built-in calls also works verbatim when that module ships as a disk
 * extension, where it forwards to the permission-GATED broker
 * (`createBrokerCapabilities`) with an `egressAllowlist`.
 *
 * This path is deliberately NOT gated on the egress allowlist: no `net`
 * permission check, no per-host check — a built-in can reach any host (that
 * enforcement is the disk-ext broker's job, a SEPARATE ctx-construction site
 * this must not weaken). The trade-off is intentional: built-ins are curated,
 * audited core code.
 *
 * Everything ELSE is identical to the broker, by SHARING its code rather than
 * duplicating it (which previously drifted):
 *   - {@link followManualRedirects} chases 30x hops with `redirect: 'manual'`,
 *     capped at FETCH_MAX_REDIRECTS, so a redirect can't be followed silently
 *     to an arbitrary host. We pass NO `onHop` hook — that hook is exactly
 *     where the broker re-asserts `net`, and the absence of it here is the
 *     single, intended trust difference.
 *   - {@link readCappedText} STREAMS the body and aborts past FETCH_MAX_BODY,
 *     so a huge/streaming response can't OOM main BEFORE the cap (the old code
 *     `await res.arrayBuffer()`-ed the whole body first, defeating the cap).
 * The response is normalised to the SDK's plain {@link BrokeredFetchResponse}
 * shape so module code is tier-agnostic.
 */
async function builtinFetch(url: string, init?: BrokeredFetchInit): Promise<BrokeredFetchResponse> {
  // No onHop hook: built-ins are ungated on the allowlist (the only intended
  // difference from the broker's fetch). Same manual redirect chasing + caps.
  // A timeout AbortController guards against a hung host stalling main forever;
  // the signal is the only thing the built-in path adds over the broker's call.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUILTIN_FETCH_TIMEOUT_MS);
  try {
    const res = await followManualRedirects(url, init, undefined, controller.signal);
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const body = await readCappedText(res, FETCH_MAX_BODY);
    return { status: res.status, ok: res.ok, headers, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Per-module JSON KV store under `~/.zcc/modules/<id>.json`. */
class ModuleStorage {
  private cache: Record<string, unknown>;
  private readonly file: string;

  constructor(private readonly moduleId: string, dir: string) {
    this.file = join(dir, `${moduleId}.json`);
    this.cache = this.load();
  }

  private load(): Record<string, unknown> {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, 'utf-8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  get<T = unknown>(key: string): T | undefined {
    return this.cache[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.cache[key] = value;
    const tmp = `${this.file}.tmp.${randomBytes(4).toString('hex')}`;
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2));
    renameSync(tmp, this.file);
  }

  /**
   * Drop this module's entire namespace — in-memory cache AND the backing
   * `<id>.json` file. Called on UNINSTALL so a later reinstall of the same id
   * starts clean instead of inheriting the removed extension's stale state.
   * Best-effort: a missing file is fine; an rm failure is swallowed (the caller
   * logs). NOT called on disable/teardown — those preserve state for re-enable.
   */
  clear(): void {
    this.cache = {};
    rmSync(this.file, { force: true });
  }
}

export interface ModuleHostDeps {
  log: (message: string, err?: unknown) => void;
  /**
   * Registered project list, used to back the built-in `ctx.resolveProjectRoot`
   * confinement gate. Optional/additive: when absent (e.g. a test host), the
   * ctx simply omits `resolveProjectRoot` — a `{storage, log}`-only module is
   * unaffected.
   */
  listProjects?: () => Project[];
  /** Absolute HOME dir — the fixed base for the `.zana` global anchor. */
  home?: string;
  /**
   * Shared in-memory registry backing `ctx.personas` / `ctx.teams`. Optional /
   * additive: when absent (e.g. a test host) the ctx omits both services. The
   * host stamps provenance from `mod.id` here — the extension never names itself.
   */
  registry?: PersonaTeamRegistry;
  /**
   * Backs the built-in `ctx.summarizeSession` capability. Optional / additive:
   * when absent (e.g. a test host) the ctx omits it. Unlike personas/teams this
   * does NOT use `mod.id` — it takes a sessionId directly and the core impl
   * confines it — so it's a flat dep, forwarded verbatim.
   */
  summarizeSession?: (
    sessionId: string,
    opts?: { scope?: 'lastTurn' }
  ) => Promise<{ ok: boolean; text?: string }>;
  /**
   * Host-managed MCP pool backing `ctx.mcp` for the in-process built-in tier.
   * Ungated here (built-ins are trusted, tier on provenance) — the workspace is
   * still confined by the pool's own `resolveWorkspace`. Optional/additive: when
   * absent the ctx omits `mcp`.
   */
  mcpPool?: { call(serverId: string, tool: string, args: Record<string, unknown> | undefined, opts: { projectPath?: string; useGlobal?: boolean }): Promise<unknown> };
}

export class MainModuleHost {
  private readonly caps = new Map<string, Record<string, ModuleCapability>>();
  private readonly stores = new Map<string, ModuleStorage>();
  /** Keep the module instances so `teardown(id)` can call their `teardown?()`. */
  private readonly modules = new Map<string, MainModule>();
  /**
   * W1-6 — `ctx.register` disposables per built-in module, run on `teardown(id)`
   * after the module's own `teardown?()`. Idempotent per disposable (ran-flag)
   * so a disposable an author ALSO releases in `teardown` can't double-free.
   */
  private readonly disposables = new Map<string, Set<() => void>>();
  private readonly storageDir: string;

  constructor(private readonly deps: ModuleHostDeps) {
    this.storageDir = join(resolveZccDataDir(process.env, app.getPath('home')), 'modules');
    try {
      mkdirSync(this.storageDir, { recursive: true });
    } catch (err) {
      this.deps.log('module storage mkdir', err);
    }
  }

  /**
   * W1-6 — track a `ctx.register` disposable for `moduleId`, wrapped in a
   * ran-flag so it fires at most once (the double-free guard). Ignores
   * non-functions. Fired by {@link teardown} after the module's `teardown?()`.
   */
  private registerDisposable(moduleId: string, disposable: () => void): void {
    if (typeof disposable !== 'function') return;
    let set = this.disposables.get(moduleId);
    if (!set) {
      set = new Set<() => void>();
      this.disposables.set(moduleId, set);
    }
    let ran = false;
    set.add(() => {
      if (ran) return;
      ran = true;
      disposable();
    });
  }

  /** Run + drop every `ctx.register` disposable for a module (throw-isolated). */
  private runDisposables(moduleId: string): void {
    const set = this.disposables.get(moduleId);
    if (!set) return;
    this.disposables.delete(moduleId);
    for (const d of set) {
      try {
        d();
      } catch (err) {
        this.deps.log(`module disposable failed: ${moduleId}`, err);
      }
    }
  }

  private storageFor(moduleId: string): ModuleStorage {
    let s = this.stores.get(moduleId);
    if (!s) {
      s = new ModuleStorage(moduleId, this.storageDir);
      this.stores.set(moduleId, s);
    }
    return s;
  }

  /** Run every module's setup once. Failures are isolated per module. */
  async setupAll(modules: MainModule[]): Promise<void> {
    for (const mod of modules) {
      const ctx: MainModuleContext = {
        storage: this.storageFor(mod.id),
        log: (msg, err) => this.deps.log(`[module:${mod.id}] ${msg}`, err),
        // W1-6: collect ctx.register disposables per module; run on teardown(id).
        register: (disposable: () => void) => this.registerDisposable(mod.id, disposable),
        // Trusted, ungated exec + fetch for the in-process built-in tier. Gives
        // the built-in ctx the SAME `exec`/`fetch` shape a disk extension gets
        // from the broker, so module code (e.g. gus's `ctx.exec({ bin: 'sf' })`,
        // slack's `ctx.fetch(slackUrl)`) is identical across both tiers. NOT
        // gated here — that's the disk-ext broker's job (a separate ctx,
        // untouched).
        exec: builtinExec,
        fetch: builtinFetch,
        // Host-managed MCP pool (ungated for the trusted built-in tier). Wired
        // only when a pool was injected; the pool still confines the workspace.
        ...(this.deps.mcpPool
          ? {
              mcp: (
                serverId: string,
                tool: string,
                args?: Record<string, unknown>,
                opts?: { projectPath?: string; useGlobal?: boolean }
              ) => this.deps.mcpPool!.call(serverId, tool, args, opts ?? {})
            }
          : {}),
        // Host-side project-root authorization (Rules 1+2). Adapts the pure,
        // throwing core resolver to the SDK's `ProjectRootResolution` shape.
        // Only wired when the host was given a project list + HOME; a rejected
        // path propagates as a rejected promise (never a silent global anchor).
        ...(this.deps.listProjects && this.deps.home
          ? {
              resolveProjectRoot: async (opts: { projectPath?: string; useGlobal?: boolean }) => {
                const root = resolveProjectRoot(opts, {
                  listProjects: this.deps.listProjects!,
                  home: this.deps.home!
                });
                return { root, kind: opts.useGlobal ? ('global' as const) : ('project' as const) };
              }
            }
          : {}),
        // Persona/team contribution (in-process built-in tier). The extension
        // passes ONLY input; the host supplies the authenticated `mod.id` so
        // provenance is stamped from the id the host owns — zero id literals,
        // never self-declared (Rule 6). Wired only when a registry was injected.
        ...(this.deps.registry
          ? {
              personas: {
                register: (list) =>
                  Promise.resolve(this.deps.registry!.setPersonas(mod.id, list)),
                clear: () => Promise.resolve(this.deps.registry!.clearModule(mod.id))
              },
              teams: {
                register: (list) => Promise.resolve(this.deps.registry!.setTeams(mod.id, list)),
                clear: () => Promise.resolve(this.deps.registry!.clearModule(mod.id))
              }
            }
          : {}),
        // Generic, Slack-agnostic turn summarizer (Rule 6: core never names the
        // consumer). Forwarded verbatim when the host was given it; the core
        // impl resolves + confines the sessionId before reading (Rule 1).
        ...(this.deps.summarizeSession
          ? { summarizeSession: this.deps.summarizeSession }
          : {})
      };
      try {
        const caps = await mod.setup(ctx);
        this.caps.set(mod.id, caps);
        this.modules.set(mod.id, mod);
      } catch (err) {
        this.deps.log(`module setup failed: ${mod.id}`, err);
        this.caps.set(mod.id, {});
        // Still track the module so a later teardown can attempt cleanup of
        // anything `setup` half-acquired before it threw.
        this.modules.set(mod.id, mod);
      }
    }
  }

  /**
   * Tear down one module: call its `teardown?()` (awaited, throw isolated +
   * logged), then drop it from the caps + modules maps so a subsequent
   * `dispatch` rejects with "Unknown module". Used on extension disable /
   * uninstall. No-op for an unknown id. The per-module storage is left intact
   * so a re-enable keeps its state.
   */
  async teardown(moduleId: string): Promise<void> {
    const mod = this.modules.get(moduleId);
    if (mod?.teardown) {
      try {
        await mod.teardown();
      } catch (err) {
        this.deps.log(`module teardown failed: ${moduleId}`, err);
      }
    }
    // W1-6: run ctx.register disposables after the module's own teardown().
    this.runDisposables(moduleId);
    // Drop any personas/teams this module contributed — registrations die with
    // the module (in-memory + lifecycle-bound). No-op when nothing registered.
    this.deps.registry?.clearModule(moduleId);
    this.caps.delete(moduleId);
    this.modules.delete(moduleId);
  }

  /**
   * Tear down EVERY live module — called on app quit so a built-in's in-process
   * timers and in-flight fetches don't leak until the OS reaps the process. Per-id `teardown()` only fires on
   * disable/uninstall, never on quit, so without this the built-in tier was
   * left running at shutdown (the disk-ext tier already had
   * `extProcessHost.teardownAll()`).
   *
   * Each module's teardown runs concurrently and is isolated: one throwing (or
   * rejecting) doesn't block the rest, mirroring `extProcessHost.teardownAll()`.
   * Snapshot the ids first since `teardown()` mutates the `modules` map.
   */
  async teardownAll(): Promise<void> {
    const ids = [...this.modules.keys()];
    await Promise.all(ids.map((id) => this.teardown(id)));
  }

  /**
   * Ids of the modules currently live (set up, not torn down). The extension
   * loader stamps each main-bearing extension's `mainActive` from this on
   * re-discovery, so the renderer knows whether `host.call` will resolve.
   */
  liveModuleIds(): Set<string> {
    return new Set(this.modules.keys());
  }

  /** Dispatch a renderer `ModuleHost.call`. Throws on unknown id/capability. */
  async dispatch(moduleId: string, capability: string, args: unknown[]): Promise<unknown> {
    const caps = this.caps.get(moduleId);
    if (!caps) throw new Error(`Unknown module: ${moduleId}`);
    const fn = caps[capability];
    if (typeof fn !== 'function') {
      throw new Error(`Unknown capability: ${moduleId}.${capability}`);
    }
    return await fn(...args);
  }

  storageGet(moduleId: string, key: string): unknown {
    return this.storageFor(moduleId).get(key);
  }

  storageSet(moduleId: string, key: string, value: unknown): void {
    this.storageFor(moduleId).set(key, value);
  }

  /**
   * Purge a module's persistent storage (cache + `<id>.json`) and forget the
   * in-memory store. Called on UNINSTALL (not disable) so a reinstall of the
   * same id starts clean. Goes through `storageFor` so it clears the file even
   * when the module wrote nothing THIS session (a store from a prior run still
   * has a file on disk). Best-effort; isolated + logged, never throws.
   */
  storageClear(moduleId: string): void {
    try {
      this.storageFor(moduleId).clear();
    } catch (err) {
      this.deps.log(`module storage clear failed: ${moduleId}`, err);
    }
    this.stores.delete(moduleId);
  }
}
