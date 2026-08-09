/**
 * Host-managed MCP server pool (trusted core subsystem).
 *
 * A disk extension can only reach a subprocess through the broker's ONE-SHOT
 * `ctx.exec` — no stdin stream, no long-lived handle. An MCP server over stdio
 * is a PERSISTENT JSON-RPC session (one `initialize` handshake, then many
 * `tools/call`s), so the child cannot own it. This pool owns those children in
 * MAIN, on the extension's behalf, exposed through the brokered `ctx.mcp`
 * capability (gated by the `mcp` permission + `mcpAllowlist` scope in
 * `permission-broker.ts`; wired in `broker-caps.ts`).
 *
 * Design constraints honored here:
 *   - Rule 1/2 — a renderer/ext-supplied `projectPath` is NEVER trusted as a
 *     spawn cwd/env directly: it is realpath-confined against a registered
 *     project (via the injected `resolveWorkspace` dep, which wraps core's
 *     `resolveProjectRoot`) BEFORE a child is spawned or reused. An unresolvable
 *     path degrades to a typed "unavailable" — never a spawn at an arbitrary path.
 *   - Rule 3 — children are long-lived emitters: the pool is constructed ONCE at
 *     app init and `disposeAll()` is called on the single shutdown path. Each
 *     child also has an idle timer so an unused workspace's lock is released.
 *   - Rule 5 — bounded: at most `MAX_CHILDREN` live children (LRU-evicted), and
 *     every request has a hard timeout so a wedged server can't hang a caller.
 *   - Degrade gracefully — bin-not-found / handshake-fail / tool-error all
 *     REJECT with a typed {@link McpUnavailableError} (or a tool error); the pool
 *     itself never throws out of `call()` for an operational failure, and a dead
 *     child is dropped so the next call re-spawns.
 *
 * This file is Electron-free and dependency-injected (spawn + workspace resolver
 * + clock) so it is unit-testable with a mock child, no real process required.
 * The production spawn factory lives at the bottom (`spawnStdioServer`).
 */

import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** How a server id resolves to a runnable binary. */
export interface McpServerDef {
  /** Stable server id an extension names in `mcpAllowlist` / `ctx.mcp(serverId, …)`. */
  id: string;
  /**
   * Resolve the absolute binary path (+ base args) for this server, or null if
   * it isn't installed. Called lazily on first spawn and cached per child. Kept a
   * function so the (volta-shimmed, PATH-dependent) resolution runs at spawn time,
   * not at pool-construction time.
   */
  resolveBin: () => { bin: string; args: string[] } | null;
  /** Human label for logs / unavailable messages (e.g. "zana"). */
  label: string;
}

/** Thrown (message surfaced to the ext) when a server can't be reached at all. */
export class McpUnavailableError extends Error {
  constructor(serverId: string, detail: string) {
    super(`MCP server "${serverId}" unavailable: ${detail}`);
    this.name = 'McpUnavailableError';
  }
}

/** A spawned stdio server the pool can speak newline-delimited JSON-RPC to. */
export interface StdioChild {
  /** Write one already-serialized JSON-RPC frame + trailing newline to stdin. */
  write(frame: string): void;
  /** Register the line sink; the pool splits stdout on `\n` and calls this per line. */
  onLine(listener: (line: string) => void): void;
  /** Register the exit/spawn-error sink. Fires at most once. */
  onExit(listener: (reason: string) => void): void;
  /** Kill the child unconditionally. Idempotent. */
  kill(): void;
}

/** Factory: start a server binary with `ZANA_WORKSPACE=workspace`. Throws on spawn failure. */
export type StdioSpawnFn = (def: McpServerDef, workspace: string) => StdioChild;

export interface McpPoolDeps {
  /** Server registry (id → binary resolver). */
  servers: McpServerDef[];
  /**
   * Confine a renderer/ext-supplied project handle to an authorized workspace
   * ROOT (Rules 1/2). `useGlobal` (or no projectPath) → the fixed HOME anchor.
   * A rejected path THROWS — the pool maps that to an unavailable result and
   * never spawns. NOTE: this returns the WORKSPACE ROOT (the dir the zana server
   * manages `.zana` under via `ZANA_WORKSPACE`), not the `.zana` dir itself.
   */
  resolveWorkspace: (opts: { projectPath?: string; useGlobal?: boolean }) => string;
  /** Structured logger (tagged host-side). */
  log: (message: string, err?: unknown) => void;
  /** Injected spawn (production: {@link spawnStdioServer}); mockable in tests. */
  spawn?: StdioSpawnFn;
  /** Monotonic clock (ms). Injectable so tests control idle expiry. Default Date.now. */
  now?: () => number;
  /** Per-request timeout (ms). Default 30s — a zana boot + tool call fits comfortably. */
  requestTimeoutMs?: number;
  /** Idle TTL (ms): a child unused this long is torn down. Default 5 min. */
  idleTtlMs?: number;
  /** Max live children before LRU eviction. Default 6. */
  maxChildren?: number;
}

interface PendingRpc {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One live server child keyed by `${serverId}\0${workspace}`. */
interface PoolChild {
  key: string;
  serverId: string;
  workspace: string;
  child: StdioChild;
  /** Resolves once `initialize` succeeds; rejects if the handshake fails. */
  ready: Promise<void>;
  /** JSON-RPC id → waiter. */
  pending: Map<number, PendingRpc>;
  nextId: number;
  /** Partial stdout carry between line chunks. */
  buf: string;
  dead: boolean;
  lastUsed: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

const CLIENT_INFO = { name: 'zcc-host', version: '1.0' } as const;
const PROTOCOL_VERSION = '2024-11-05';

export class McpPool {
  private readonly servers = new Map<string, McpServerDef>();
  private readonly children = new Map<string, PoolChild>();
  private readonly spawnFn: StdioSpawnFn;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly idleTtlMs: number;
  private readonly maxChildren: number;
  private disposed = false;

  constructor(private readonly deps: McpPoolDeps) {
    for (const s of deps.servers) this.servers.set(s.id, s);
    this.spawnFn = deps.spawn ?? spawnStdioServer;
    this.now = deps.now ?? (() => Date.now());
    this.requestTimeoutMs = deps.requestTimeoutMs ?? 30_000;
    this.idleTtlMs = deps.idleTtlMs ?? 5 * 60_000;
    this.maxChildren = deps.maxChildren ?? 6;
  }

  /**
   * Invoke `tool` on `serverId`'s workspace-scoped child, returning the tool's
   * PARSED JSON result (the MCP `content[].text` envelope is unwrapped here).
   *
   * `opts` selects the workspace via the confining `resolveWorkspace` dep. A
   * bin-not-found / handshake-fail rejects with {@link McpUnavailableError}; a
   * server-reported tool error rejects with that error's message. Never throws
   * synchronously for an operational failure.
   */
  async call(
    serverId: string,
    tool: string,
    args: Record<string, unknown> | undefined,
    opts: { projectPath?: string; useGlobal?: boolean }
  ): Promise<unknown> {
    if (this.disposed) throw new McpUnavailableError(serverId, 'pool disposed');
    const def = this.servers.get(serverId);
    if (!def) throw new McpUnavailableError(serverId, 'unknown server id');

    // Rule 1/2: confine the supplied handle to an authorized workspace root
    // BEFORE spawning/reusing a child. A rejected path → unavailable, never a
    // spawn at an arbitrary location.
    let workspace: string;
    try {
      workspace = this.deps.resolveWorkspace(opts);
    } catch (err) {
      throw new McpUnavailableError(serverId, `workspace not authorized (${errMsg(err)})`);
    }

    const entry = this.acquire(def, workspace);
    try {
      await entry.ready;
    } catch (err) {
      // Handshake failed — drop the child so a later call re-spawns cleanly.
      this.dropChild(entry, `handshake failed: ${errMsg(err)}`);
      throw err instanceof McpUnavailableError ? err : new McpUnavailableError(serverId, errMsg(err));
    }

    entry.lastUsed = this.now();
    this.armIdle(entry);
    const raw = await this.rpc(entry, 'tools/call', { name: tool, arguments: args ?? {} });
    return unwrapToolResult(raw);
  }

  /**
   * Create the on-disk `.zana/` skeleton for a workspace that doesn't have one
   * yet (the "Init Zana" button). This does NOT spawn/reuse a pool child —
   * `zana-mcp-server` is deliberately spawned with `ZANA_AUTO_INIT: '0'`
   * (see {@link spawnStdioServer}) so ticket/sprint/artifact list calls never
   * silently materialize `.zana/` as a side effect of just opening the board.
   * This is the one EXPLICIT, user-initiated path that's allowed to write it.
   *
   * Confined via the SAME `resolveWorkspace` dep `call()` uses (Rule 1/2) — no
   * new path-trust logic. Idempotent: a workspace that already has `.zana/`
   * with all the expected subdirs + `config.json` is a no-op. Never throws for
   * an already-initialized workspace; throws only when the path is unauthorized
   * or the write itself fails (a user-initiated action must surface failure).
   */
  async initWorkspace(opts: { projectPath?: string; useGlobal?: boolean }): Promise<{ created: boolean }> {
    if (this.disposed) throw new McpUnavailableError('zana', 'pool disposed');
    let workspace: string;
    try {
      workspace = this.deps.resolveWorkspace(opts);
    } catch (err) {
      throw new McpUnavailableError('zana', `workspace not authorized (${errMsg(err)})`);
    }
    return initZanaWorkspaceDir(workspace);
  }

  /**
   * Read-only counterpart to {@link initWorkspace}: whether `.zana/` already
   * has its full skeleton (config.json + all subdirs) for a workspace, WITHOUT
   * writing anything. Lets a caller (the panel's empty-state gate) distinguish
   * "never initialized" from "initialized but genuinely has zero tickets" —
   * `getSnapshot`'s ticket/sprint/artifact calls degrade both cases to the same
   * empty arrays, so this is the only honest signal for that UI decision.
   * Same confinement as `initWorkspace`/`call` (Rule 1/2); never throws for an
   * unauthorized path — resolves `false` instead, since "can't confirm it's
   * initialized" and "isn't initialized" are the same UI outcome here.
   */
  async isWorkspaceInitialized(opts: { projectPath?: string; useGlobal?: boolean }): Promise<boolean> {
    if (this.disposed) return false;
    let workspace: string;
    try {
      workspace = this.deps.resolveWorkspace(opts);
    } catch {
      return false;
    }
    return isZanaWorkspaceInitialized(workspace);
  }

  /** Tear down every child (app quit). Idempotent; safe on the shutdown path. */
  disposeAll(): void {
    this.disposed = true;
    for (const entry of [...this.children.values()]) {
      this.dropChild(entry, 'pool disposed');
    }
  }

  /** Live child count — for diagnostics/tests. */
  size(): number {
    return this.children.size;
  }

  // ---- internals -----------------------------------------------------------

  private acquire(def: McpServerDef, workspace: string): PoolChild {
    const key = `${def.id} ${workspace}`;
    const existing = this.children.get(key);
    if (existing && !existing.dead) return existing;

    // Evict LRU if at capacity (bounded — Rule 5).
    if (this.children.size >= this.maxChildren) {
      let lru: PoolChild | undefined;
      for (const c of this.children.values()) {
        if (!lru || c.lastUsed < lru.lastUsed) lru = c;
      }
      if (lru) this.dropChild(lru, 'evicted (pool at capacity)');
    }

    const resolved = def.resolveBin();
    const entry: PoolChild = {
      key,
      serverId: def.id,
      workspace,
      // Placeholder child replaced synchronously below; keeps the field non-null.
      child: null as unknown as StdioChild,
      ready: Promise.resolve(),
      pending: new Map(),
      nextId: 1,
      buf: '',
      dead: false,
      lastUsed: this.now()
    };

    if (!resolved) {
      // Not installed — a synchronous, self-dropping unavailable child so the
      // shared reject path in call() handles it uniformly.
      entry.ready = Promise.reject(new McpUnavailableError(def.id, `${def.label} binary not found`));
      // Swallow the unhandled-rejection: call() attaches the real handler.
      entry.ready.catch(() => {});
      entry.dead = true;
      return entry;
    }

    let child: StdioChild;
    try {
      child = this.spawnFn(def, workspace);
    } catch (err) {
      entry.ready = Promise.reject(new McpUnavailableError(def.id, `spawn failed: ${errMsg(err)}`));
      entry.ready.catch(() => {});
      entry.dead = true;
      return entry;
    }
    entry.child = child;
    this.children.set(key, entry);

    child.onLine((line) => this.onLine(entry, line));
    child.onExit((reason) => this.onExit(entry, reason));

    // Handshake: initialize → notifications/initialized. Ready resolves when the
    // server answers initialize; a spawn-time exit rejects it via onExit.
    entry.ready = this.rpc(entry, 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO
    }).then(() => {
      // A JSON-RPC notification (no id, no reply expected).
      this.notify(entry, 'notifications/initialized', {});
    });
    entry.ready.catch(() => {}); // real handler attached in call()
    this.armIdle(entry);
    return entry;
  }

  private rpc(entry: PoolChild, method: string, params: unknown): Promise<unknown> {
    if (entry.dead) return Promise.reject(new McpUnavailableError(entry.serverId, 'child dead'));
    const id = entry.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(id);
        reject(new McpUnavailableError(entry.serverId, `${method} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      entry.pending.set(id, { resolve, reject, timer });
      try {
        entry.child.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        entry.pending.delete(id);
        reject(new McpUnavailableError(entry.serverId, `write failed: ${errMsg(err)}`));
      }
    });
  }

  private notify(entry: PoolChild, method: string, params: unknown): void {
    if (entry.dead) return;
    try {
      entry.child.write(JSON.stringify({ jsonrpc: '2.0', method, params }));
    } catch (err) {
      this.deps.log(`mcp ${entry.serverId}: notify ${method} failed`, err);
    }
  }

  private onLine(entry: PoolChild, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: { id?: unknown; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Non-JSON stdout (a stray log the server wrote to stdout) — ignore.
      return;
    }
    if (msg.id === undefined || msg.id === null) return; // a notification/log — no waiter
    const waiter = entry.pending.get(msg.id as number);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    entry.pending.delete(msg.id as number);
    if (msg.error) {
      waiter.reject(new Error(msg.error.message ?? 'MCP error'));
    } else {
      waiter.resolve(msg.result);
    }
  }

  private onExit(entry: PoolChild, reason: string): void {
    this.dropChild(entry, `child exited: ${reason}`);
  }

  private armIdle(entry: PoolChild): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      this.dropChild(entry, 'idle timeout');
    }, this.idleTtlMs);
    // Don't keep the process alive just for an idle-reaper timer.
    (entry.idleTimer as { unref?: () => void }).unref?.();
  }

  private dropChild(entry: PoolChild, reason: string): void {
    if (entry.dead && !this.children.has(entry.key)) {
      // Already fully dropped; still ensure pending are cleared once.
    }
    entry.dead = true;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    for (const [, p] of entry.pending) {
      clearTimeout(p.timer);
      p.reject(new McpUnavailableError(entry.serverId, reason));
    }
    entry.pending.clear();
    try {
      entry.child?.kill();
    } catch (err) {
      this.deps.log(`mcp ${entry.serverId}: kill failed`, err);
    }
    if (this.children.get(entry.key) === entry) this.children.delete(entry.key);
  }
}

/** Unwrap the standard MCP `tools/call` result — `{content:[{type:'text',text}]}` → parsed JSON. */
export function unwrapToolResult(raw: unknown): unknown {
  const r = raw as { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | null;
  if (!r || !Array.isArray(r.content)) return raw ?? null;
  const text = r.content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('');
  if (r.isError) throw new Error(text || 'MCP tool error');
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    // A tool that returns plain (non-JSON) text — hand back the string verbatim.
    return text;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Production spawn: launch a stdio MCP server binary with `ZANA_WORKSPACE` set,
 * splitting stdout into newline-delimited frames. stderr is drained to the void
 * (the server logs there); only stdout carries JSON-RPC. Uses `spawn` (streaming
 * stdin/stdout) — NOT the broker's one-shot execFile — because the session is
 * long-lived.
 */
export function spawnStdioServer(def: McpServerDef, workspace: string): StdioChild {
  const resolved = def.resolveBin();
  if (!resolved) throw new Error(`${def.label} binary not found`);
  const proc: ChildProcessWithoutNullStreams = nodeSpawn(resolved.bin, resolved.args, {
    // Only ZANA_WORKSPACE is layered on the inherited env — the server is a
    // trusted, user-installed binary (volta shim), so it gets the host's PATH
    // to resolve its Node. It is NOT the untrusted-ext tier.
    env: { ...process.env, ZANA_WORKSPACE: workspace, ZANA_AUTO_INIT: '0' },
    stdio: ['pipe', 'pipe', 'pipe']
  }) as ChildProcessWithoutNullStreams;

  const lineListeners: Array<(line: string) => void> = [];
  const exitListeners: Array<(reason: string) => void> = [];
  let carry = '';
  let exited = false;
  const fireExit = (reason: string) => {
    if (exited) return;
    exited = true;
    for (const l of exitListeners) l(reason);
  };

  proc.stdout.setEncoding('utf-8');
  proc.stdout.on('data', (chunk: string) => {
    carry += chunk;
    let nl: number;
    while ((nl = carry.indexOf('\n')) >= 0) {
      const line = carry.slice(0, nl);
      carry = carry.slice(nl + 1);
      for (const l of lineListeners) l(line);
    }
  });
  proc.stderr.setEncoding('utf-8');
  proc.stderr.on('data', () => {
    /* server diagnostics — deliberately dropped; stdout is the RPC channel */
  });
  proc.on('error', (err) => fireExit(err instanceof Error ? err.message : String(err)));
  proc.on('exit', (code, signal) => fireExit(`code=${code ?? 'null'} signal=${signal ?? 'null'}`));

  return {
    write(frame: string) {
      proc.stdin.write(frame + '\n');
    },
    onLine(listener) {
      lineListeners.push(listener);
    },
    onExit(listener) {
      exitListeners.push(listener);
      if (exited) listener('already exited');
    },
    kill() {
      try {
        proc.kill();
      } catch {
        /* already dead */
      }
    }
  };
}

/**
 * Resolve the `zana-mcp-server` binary via PATH (`which`), honoring a
 * `ZANA_MCP_BIN` override. Returns null when unresolvable so the pool degrades
 * to an honest "not installed" state. The bin is a volta shim in dev; `which`
 * finds it on the user's PATH. No args — the server reads its workspace from
 * `ZANA_WORKSPACE` (set by the spawn env), not argv.
 */
export function resolveZanaMcpBin(): { bin: string; args: string[] } | null {
  const override = process.env.ZANA_MCP_BIN;
  if (override && override.trim()) return { bin: override.trim(), args: [] };
  try {
    const found = execFileSync('which', ['zana-mcp-server'], { encoding: 'utf-8' }).trim();
    return found ? { bin: found, args: [] } : null;
  } catch {
    return null;
  }
}

/** The `zana` server definition — the only registered server today. */
export const ZANA_SERVER_DEF: McpServerDef = {
  id: 'zana',
  label: 'zana',
  resolveBin: resolveZanaMcpBin
};

/**
 * Subdirs `@zana-ai/core`'s `initProjectDir` creates under `.zana/`. `tickets`,
 * `sprints`, `artifacts`, `audit`, `events`, `scheduler`, `sessions` already
 * self-heal via `ensureTicketsDir`/`ensureSprintsDir`-style calls the app's
 * existing `zana_*_list` MCP calls trigger; `plans`/`runs`/`tmp` do not, so
 * they're the actual gap this closes. Creating the full set (rather than just
 * the gap) keeps this workspace's layout identical to what the real `zana`
 * CLI would produce.
 */
const ZANA_SUBDIRS = [
  'tickets',
  'sprints',
  'artifacts',
  'plans',
  'audit',
  'sessions',
  'runs',
  'events',
  'scheduler',
  'tmp'
] as const;

/** Minimal shape mirroring upstream's `project/init.js` `config.json`. */
function buildZanaConfig(workspace: string): Record<string, unknown> {
  const name = workspace.split('/').filter(Boolean).pop() || 'workspace';
  return {
    version: 1,
    name,
    createdAt: new Date().toISOString(),
    createdBy: 'zcc-init',
    settings: {
      maxConcurrentAgents: 10,
      hookPort: 47400,
      autoArchiveSessions: true,
      archiveAfterDays: 30
    }
  };
}

/**
 * Create `.zana/` + its subdirs + a `config.json` (only if missing) under
 * `workspace`. `workspace` MUST already be an authorized, realpath-confined
 * root (callers confine via `resolveWorkspace` — this function does no
 * confinement itself). `config.json` is written atomically (tmp + rename,
 * Rule 4); directory creation via `mkdir(recursive:true)` is naturally
 * idempotent. Returns `{created:false}` when everything already existed.
 */
async function initZanaWorkspaceDir(workspace: string): Promise<{ created: boolean }> {
  const zanaDir = join(workspace, '.zana');
  const configPath = join(zanaDir, 'config.json');
  const alreadyInitialized =
    existsSync(configPath) && ZANA_SUBDIRS.every((d) => existsSync(join(zanaDir, d)));

  await mkdir(zanaDir, { recursive: true });
  await Promise.all(ZANA_SUBDIRS.map((d) => mkdir(join(zanaDir, d), { recursive: true })));

  let wroteConfig = false;
  try {
    await readFile(configPath, 'utf-8');
  } catch {
    const tmp = `${configPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(buildZanaConfig(workspace), null, 2), 'utf-8');
    await rename(tmp, configPath);
    wroteConfig = true;
  }

  return { created: !alreadyInitialized || wroteConfig };
}

/** Pure existence check mirroring `initZanaWorkspaceDir`'s `alreadyInitialized` test. */
function isZanaWorkspaceInitialized(workspace: string): boolean {
  const zanaDir = join(workspace, '.zana');
  return existsSync(join(zanaDir, 'config.json')) && ZANA_SUBDIRS.every((d) => existsSync(join(zanaDir, d)));
}
