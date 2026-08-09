/**
 * Concrete, permission-GATED implementation of the brokered capabilities
 * (P3-B): process-spawn / fs / fetch performed host-side for a disk extension's
 * child. Each method gates against the {@link PermissionBroker} keyed by the
 * AUTHENTICATED moduleId (passed by the process host — the child cannot forge
 * it), then performs the op with raw Node. A denied request throws
 * {@link PermissionDenied}; the process host turns the throw into an `ok:false`
 * broker-result, so the child's `await ctx.exec(...)` rejects with the message.
 *
 * Process spawning uses `execFile` with `shell: false` and an explicit argv —
 * NO shell string is ever accepted (no command injection surface); the `bin` is
 * a basename checked against the per-extension allowlist.
 *
 * This is the SANCTIONED path. As of P3-HARDEN the child also installs a
 * Node-builtin denylist (`host-child-guard.ts`), so a malicious ext can no longer
 * trivially `import('node:child_process')` to skip this gate — the brokered path
 * is now the only *practical* capability path. See `host-child-guard.ts` for the
 * honest residual (JS-level, not an OS sandbox; `process.dlopen` remains).
 *
 * fs scoping is symlink-safe: each path is checked lexically AND after
 * `realpath()` (P3-HARDEN), so a symlink inside a granted root pointing at a
 * sensitive target (e.g. `~/.ssh`) cannot escape. exec failures/timeouts REJECT
 * (S3) rather than resolving a misleading `{code:null}`.
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile, readdir, realpath, stat, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import type {
  ExecRequest,
  ExecResult,
  BrokeredFetchInit,
  BrokeredFetchResponse,
  ExtensionLlmRequest,
  LlmInvokeResult,
  LlmInvokeErrorCode,
  HostLaunchSpec,
  HostRequestLaunchResult,
  HostConfirmSpec,
  HostNotifySpec
} from '../../shared/module-main.js';
import type { BrokerCapabilities } from './process-host.js';
import { PermissionBroker, PermissionDenied } from './permission-broker.js';
import { buildChildEnv } from './child-env.js';
import type { McpPool } from '../zana/mcp-pool.js';
import type { StreamRelay } from './stream-relay.js';
import type { HostCommandRelay } from './host-command-relay.js';
import type { LlmService } from '../llm-service.js';
import type { LlmPromptEntry } from '../../shared/types.js';
import { parseSshConfig } from '../ssh-config.js';
import { pushInboxOnBehalfOf, type InboxBrokerDeps } from './inbox-broker.js';

/** Hard ceiling on a brokered spawn, regardless of the ext's requested timeout. */
const MAX_SPAWN_TIMEOUT_MS = 60_000;
/**
 * Cap brokered spawn output so an ext can't OOM main with a huge stdout.
 * 16 MiB to match the trusted built-in exec (registry.ts BUILTIN_EXEC_MAX_BUFFER)
 * and the pre-isolation behavior — a large `sf data query` (e.g. a 2000-row
 * sprint pull) can exceed 8 MiB, and an under-cap would watchdog-kill it into a
 * misleading "CLI unavailable" reject rather than returning the data.
 */
const SPAWN_MAX_BUFFER = 16 * 1024 * 1024;
/**
 * Max redirect hops a brokered fetch will follow (each re-checks `net`).
 * Exported so the trusted built-in fetch (registry.ts) shares the SAME source
 * of truth — the two paths must follow redirects identically, differing only in
 * whether they re-assert `net` per hop.
 */
export const FETCH_MAX_REDIRECTS = 5;
/**
 * Cap on a fetch response body — a hostile/large response can't OOM main.
 * Exported for the same reason as {@link FETCH_MAX_REDIRECTS}: the built-in
 * fetch caps to the identical bound.
 */
export const FETCH_MAX_BODY = 8 * 1024 * 1024;

// ---- Epic C: brokered LLM micro-call clamps -------------------------------
//
// These bound a disk extension's `ctx.llm` call on every dimension the Epic C
// council flagged. The two BINDING conditions from
// `.zcc/library/decisions/epic-c-ctx-llm-council-2026-07-11.md`:
//   #1 clamp the INPUT (system+user) size, not just the output — a rate limit
//      bounds the COUNT of calls, the input cap bounds the exfiltration PAYLOAD
//      per call. Both {@link EXT_LLM_SYSTEM_MAX_CHARS}/{@link EXT_LLM_USER_MAX_CHARS}.
//   #2 enforce prompt-injection CONTAINMENT structurally at the single
//      synthetic-prompt choke-point ({@link buildContainedLlmEntry} +
//      {@link assertContainedEntry}), backed by a CI provider-contract test —
//      never prose alone.

/** System-prompt input clamp (chars). Condition #1 — bounds exfil payload. */
const EXT_LLM_SYSTEM_MAX_CHARS = 4_000;
/** User-prompt input clamp (chars). Condition #1 — bounds exfil payload. */
const EXT_LLM_USER_MAX_CHARS = 8_000;
/** Default output cap when the ext omits `maxOutputChars`. */
const EXT_LLM_OUTPUT_DEFAULT_CHARS = 2_000;
/** Hard output ceiling; an ext's larger `maxOutputChars` is clamped to this. */
const EXT_LLM_OUTPUT_MAX_CHARS = 4_000;
/** Fixed host timeout for a brokered micro-call (ms). NOT ext-overridable. */
const EXT_LLM_TIMEOUT_MS = 30_000;
/**
 * The ONLY model tier a disk-extension LLM call runs on — a cheap tier, chosen
 * by the HOST regardless of any `model` hint the ext passes (cost clamp). Kept
 * as an alias the providers understand (`--model haiku`).
 */
const EXT_LLM_MODEL = 'haiku';
/** Sliding rate-limit window (ms) — 5 minutes. */
const EXT_LLM_RATE_WINDOW_MS = 5 * 60_000;
/** Max brokered LLM calls per extension within {@link EXT_LLM_RATE_WINDOW_MS}. */
const EXT_LLM_RATE_MAX = 20;

/** Per-extension emit rate limit window (ms) — 1 second. */
const EXT_EMIT_RATE_WINDOW_MS = 1000;
/** Max emit calls per extension within {@link EXT_EMIT_RATE_WINDOW_MS} (~50fps). */
const EXT_EMIT_RATE_MAX = 50;

/**
 * The EXACT set of {@link LlmPromptEntry} fields a brokered extension call may
 * carry. The choke-point builds an entry with ONLY these; the containment
 * assertion rejects any other key. This is the structural teeth of condition
 * #2: none of these fields can carry a `--mcp-config` / `--settings` /
 * `--add-dir` / project reach — and if `LlmPromptEntry` ever grows a field that
 * COULD, an entry carrying it trips {@link assertContainedEntry} (and the CI
 * contract test) rather than silently widening the micro-call's reach.
 */
const CONTAINED_ENTRY_KEYS: ReadonlySet<string> = new Set([
  'id',
  'label',
  'model',
  'systemPrompt',
  'userTemplate',
  'maxOutputChars',
  'timeoutMs'
]);

/**
 * Assert a synthetic extension LLM entry is CONTAINED (condition #2). Throws on
 * any field outside {@link CONTAINED_ENTRY_KEYS}, an un-clamped model, or an
 * extension-chosen provider. Called by {@link buildContainedLlmEntry} at the
 * single choke-point AND exported for the CI provider-contract regression test.
 */
export function assertContainedEntry(entry: LlmPromptEntry): void {
  for (const key of Object.keys(entry)) {
    if (!CONTAINED_ENTRY_KEYS.has(key)) {
      throw new Error(`llm: containment violation — unexpected entry field "${key}"`);
    }
  }
  if (entry.model !== EXT_LLM_MODEL) {
    throw new Error('llm: containment violation — model must be host-clamped');
  }
  // provider is deliberately never set: the host default (app-configured) is
  // used, never an extension-chosen vendor. A present provider is a violation.
  if ((entry as { provider?: unknown }).provider !== undefined) {
    throw new Error('llm: containment violation — provider must be the host default');
  }
}

/**
 * Build the synthetic {@link LlmPromptEntry} for a brokered extension call at
 * the ONE choke-point (condition #2). The `user` text is placed in
 * `userTemplate` and run with an EMPTY vars map, so `{{…}}` sequences in
 * attacker-influenced text are left literal (no template injection). The model
 * is hard-clamped to {@link EXT_LLM_MODEL}; provider is left unset (host
 * default). The result is assert-contained before it can reach a provider.
 */
function buildContainedLlmEntry(
  moduleId: string,
  system: string,
  user: string,
  maxOutputChars: number
): LlmPromptEntry {
  const entry: LlmPromptEntry = {
    id: `ext:${moduleId}:llm`,
    label: 'extension micro-call',
    model: EXT_LLM_MODEL,
    systemPrompt: system,
    userTemplate: user,
    maxOutputChars,
    timeoutMs: EXT_LLM_TIMEOUT_MS
  };
  assertContainedEntry(entry);
  return entry;
}

/**
 * Read a fetch Response body as text, aborting once it exceeds `cap` bytes.
 * Streams chunk-by-chunk so an unbounded/hostile response can't exhaust memory
 * before we notice (unlike `res.text()`, which buffers the whole thing first).
 *
 * Exported so the trusted built-in fetch (registry.ts) streams+caps via the
 * SAME code path as the broker — no duplicated, drift-prone copy.
 */
export async function readCappedText(res: Response, cap: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > cap) {
          await reader.cancel();
          throw new Error(`fetch: response body exceeds ${cap} bytes`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Follow a fetch's redirects MANUALLY, hop by hop, and return the final
 * (non-redirect) `Response`. This is the single shared implementation behind
 * BOTH fetch tiers:
 *
 *   - the permission-GATED broker fetch (below) passes an `onHop` that does
 *     `broker.assert(moduleId, 'net', { kind:'net', host })` so the egress
 *     allowlist is re-checked on EVERY hop — a single attacker 30x redirect
 *     from an allowlisted host to e.g. 169.254.169.254 (cloud-metadata / SSRF)
 *     cannot escape the allowlist;
 *   - the trusted built-in fetch (registry.ts) passes NO `onHop` — built-ins
 *     are the curated, audited tier and are intentionally ungated on the
 *     allowlist. That trust difference is the ONLY behavioral difference
 *     between the two paths; everything else (manual redirect chasing, the hop
 *     cap, relative-Location resolution) is provably identical because it lives
 *     here once.
 *
 * `onHop` is invoked with the resolved hostname BEFORE each network request
 * (including the first), so a denied host throws before any connection is made.
 * Relative `Location` headers are resolved against the current URL. Caps at
 * {@link FETCH_MAX_REDIRECTS} hops, throwing `too many redirects` past it.
 *
 * An optional `signal` is forwarded to every hop's `fetch`, so a caller can
 * impose a timeout/abort (the built-in fetch does this; the broker passes none,
 * leaving its behavior unchanged).
 */
export async function followManualRedirects(
  url: string,
  init: BrokeredFetchInit | undefined,
  onHop?: (host: string) => void,
  signal?: AbortSignal
): Promise<Response> {
  let current = url;
  let res: Response | undefined;
  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop++) {
    let host: string;
    try {
      host = new URL(current).hostname;
    } catch {
      throw new Error('fetch: invalid url');
    }
    onHop?.(host);
    res = await fetch(current, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      redirect: 'manual',
      // Optional abort/timeout. The broker passes none (unchanged behavior); the
      // trusted built-in fetch (registry.ts) wires a timeout AbortController so a
      // hung host can't stall main forever. The signal applies to EVERY hop.
      ...(signal ? { signal } : {})
    });
    if (res.status < 300 || res.status >= 400) break;
    const location = res.headers.get('location');
    if (!location) break; // a 3xx with no Location — treat as terminal
    if (hop === FETCH_MAX_REDIRECTS) {
      throw new Error('fetch: too many redirects');
    }
    // Resolve relative redirects against the current URL, then loop to
    // re-run `onHop` on the resolved host.
    current = new URL(location, current).toString();
  }
  if (!res) throw new Error('fetch: no response');
  return res;
}

/**
 * Symlink-safe canonicalization (P3-HARDEN). The lexical `resolve()` used for the
 * first scope check does NOT follow symlinks, so a symlink *inside* a granted
 * root pointing at `~/.ssh` would pass the lexical `isWithin` yet read/write the
 * link target. We `realpath()` the path and return the REAL on-disk location so
 * the caller can re-assert the scope against it.
 *
 * For a path that doesn't exist yet (a write to a new file), `realpath` of the
 * full path ENOENTs; we instead realpath the nearest existing ancestor dir and
 * re-attach the trailing not-yet-existing segments. This still resolves a
 * symlinked *parent* (the escape vector for new-file writes) while tolerating the
 * leaf not existing. If even the root is missing we fall back to the lexical
 * resolve (nothing to escape through — the path simply isn't reachable).
 *
 * TOCTOU: the gate then operates on the RETURNED real path (not the caller's
 * path), closing the leaf/parent swap window; a swap of an intermediate
 * component of a deep existing path between this realpath and the fs op is the
 * standard, unavoidable filesystem TOCTOU residual.
 */
async function realpathForCheck(lexical: string): Promise<string> {
  try {
    return await realpath(lexical);
  } catch {
    // Walk up to the first existing ancestor, realpath it, re-join the rest.
    let dir = dirname(lexical);
    const tail: string[] = [basename(lexical)];
    for (;;) {
      try {
        const realDir = await realpath(dir);
        // tail is [leaf, …, nearest-missing]; reverse → outermost-first for join.
        // `reverse()` mutates in place but is the last op before return, so safe.
        return join(realDir, ...tail.reverse());
      } catch {
        const parent = dirname(dir);
        if (parent === dir) return lexical; // hit the fs root, nothing existed
        tail.push(basename(dir));
        dir = parent;
      }
    }
  }
}

/**
 * Optional host services the broker caps forward to. `mcpPool` backs the `mcp`
 * capability; `llmService` backs the Epic C `llm` capability. Each is absent in
 * a test host that doesn't exercise it → that request is denied with an honest
 * "unavailable" message rather than crashing.
 *
 * `llmEnabled` is the global {@link import('../../shared/types.js').AppConfig}
 * kill switch (`extensionLlmEnabled`, ships OFF). It's a thunk so a live config
 * change flips it without re-wiring the caps. Absent ⇒ treated as OFF.
 */
export interface BrokerCapDeps {
  mcpPool?: Pick<McpPool, 'call' | 'initWorkspace' | 'isWorkspaceInitialized'>;
  llmService?: Pick<LlmService, 'run'>;
  llmEnabled?: () => boolean;
  /**
   * Host-managed live-stream relay backing the `stream` capability (the
   * streaming twin of `mcpPool`). Absent in a test host that doesn't exercise
   * streaming → a `stream.open` request degrades to an honest "no relay" throw
   * (→ `ok:false` broker-result) rather than crashing. Constructed ONCE at app
   * init and disposed on shutdown (Rule 3), same as `mcpPool`.
   */
  streamRelay?: Pick<StreamRelay, 'subscribe' | 'unsubscribe' | 'closeForModule'>;
  /**
   * Frame sink (W1-3): backs the `emit` cap so an extension can fire-and-forget
   * push events from main→renderer. Sends frames directly core→renderer via the
   * IPC stream-frame channel, NOT over the broker port. Reuses the same sink
   * `streamRelay` sends through. Optional: if absent, emit is a no-op.
   */
  sink?: { frame(subId: string, frame: unknown): void };
  /**
   * W1-4 trust-inversion bridge: the core-owned {@link HostCommandRelay} that
   * performs the renderer-only actions a headless main module requests
   * (`ctx.host.toast/navigate/selectProject/requestLaunch`). Park-by-default +
   * the durable per-module launch queue live in the relay; the caps layer here
   * is the single GATE site (`projects:select` / `session:launch`). Constructed
   * ONCE at app init and cleared per module on child exit (Rule 3), same as
   * `streamRelay`. Absent in a test host → the host.* caps are omitted, so a
   * child's request degrades to a success no-op (toast/navigate/selectProject) or
   * a "bridge unavailable" reply (requestLaunch), never a crash.
   */
  hostCommands?: Pick<
    HostCommandRelay,
    | 'toast'
    | 'navigate'
    | 'selectProject'
    | 'requestLaunch'
    | 'confirm'
    | 'alert'
    | 'closeForModule'
  >;
  /**
   * Phase B: backs `ctx.inbox.push` — the shared validation helper (also used
   * by the renderer-panel IPC path) that re-authorizes the target projectId
   * before appending. Absent in a test host that doesn't exercise the inbox
   * bridge → the cap degrades to a "bridge unavailable" reply, never a crash.
   */
  inbox?: InboxBrokerDeps;
}

export function createBrokerCapabilities(
  broker: PermissionBroker,
  deps: BrokerCapDeps = {}
): BrokerCapabilities {
  /**
   * Per-extension sliding-window call timestamps (rate limit) + in-flight flag
   * (concurrency 1) for the Epic C `llm` cap. Bounded: each id keeps at most
   * {@link EXT_LLM_RATE_MAX} timestamps, pruned to the window on every call, and
   * the map only ever holds ids that have made a call — retention is inherently
   * capped by the finite, installed extension set (Rule 5).
   */
  const llmCalls = new Map<string, number[]>();
  const llmInFlight = new Set<string>();

  /**
   * Per-extension sliding-window emit timestamps (W1-3 rate limit). Bounded: each
   * id keeps at most {@link EXT_EMIT_RATE_MAX} timestamps, pruned on every emit,
   * and the map only holds ids that emitted (finite installed set, Rule 5).
   */
  const emitCalls = new Map<string, number[]>();

  return {
    async sshHosts(moduleId) {
      broker.assert(moduleId, 'ssh:hosts');
      return parseSshConfig();
    },
    async exec(moduleId, req: ExecRequest): Promise<ExecResult> {
      if (!req || typeof req.bin !== 'string' || !req.bin) {
        throw new Error('exec: missing bin');
      }
      // Gate: `exec` granted AND bin on the allowlist. assert() throws on deny.
      broker.assert(moduleId, 'exec', { kind: 'exec', bin: req.bin });
      // If a cwd is requested it must be within a granted fs root (lexical then
      // realpath, so a symlinked cwd can't escape — P3-HARDEN). We spawn with the
      // RESOLVED path (`checkedCwd`), not the raw `req.cwd`: passing the raw string
      // reopens a TOCTOU window where a symlink swapped between this check and the
      // execFile below would let the child spawn in a directory the grant never
      // authorized. Spawning the already-realpath'd path closes that window.
      let checkedCwd: string | undefined;
      if (req.cwd) {
        checkedCwd = await realpathForCheck(resolve(req.cwd));
        broker.assert(moduleId, 'fs:read', {
          kind: 'fs',
          path: checkedCwd
        });
      }
      const timeout = Math.min(req.timeoutMs ?? MAX_SPAWN_TIMEOUT_MS, MAX_SPAWN_TIMEOUT_MS);
      return await new Promise<ExecResult>((resolveP, rejectP) => {
        // shell:false + explicit argv → no shell interpretation, no injection.
        // NOTE (S2 residual): `bin` is a basename resolved against the host's
        // PATH at spawn time — whatever's FIRST on PATH wins. The allowlist gates
        // the *name*, not the on-disk binary. See docs/extensions-authoring.md
        // "exec PATH residual". We do not pin a controlled PATH here because the
        // host's PATH is the user's own trusted environment; an attacker who can
        // prepend a hostile dir to the user's PATH already has local code-exec.
        execFile(
          req.bin, // basename; resolved against PATH.
          Array.isArray(req.args) ? req.args : [],
          // env by ALLOWLIST, not inherit (0.4). `execFile` with no `env` clones
          // main's FULL process.env into the child — every secret the host holds
          // (ANTHROPIC_API_KEY, AWS_*, SSH agent vars, SF/GitHub tokens). A disk
          // ext calling `ctx.exec('printenv')` would read them verbatim. We pass
          // the SAME trimmed env as the extension's utilityProcess child, so the
          // brokered exec sees only PATH/HOME/locale/etc. — never a credential.
          { cwd: checkedCwd, timeout, maxBuffer: SPAWN_MAX_BUFFER, shell: false, env: buildChildEnv() },
          (err, stdout, stderr) => {
            // S3: distinguish a *failure to run / watchdog kill* from a process
            // that ran and exited (cleanly or by its own non-zero code / a signal
            // it caught). The former MUST reject so the ext's `await ctx.exec`
            // surfaces an error instead of a misleading `{code:null}` success.
            if (err) {
              // `execFile`'s error puts the numeric exit code in `code` for a
              // non-zero exit, but a STRING errno ('ENOENT'…) there on a spawn
              // failure — the @types union mislabels it, so read it as unknown.
              const e = err as Error & { code?: unknown; killed?: boolean; signal?: string };
              const exitCode = typeof e.code === 'number' ? e.code : null;
              if (exitCode === null) {
                // No numeric exit code means the process did not exit normally:
                //   - spawn failure: e.code is a string errno ('ENOENT', 'EACCES'…)
                //   - timeout/maxBuffer kill: e.killed === true (Node's watchdog)
                //   - killed by a signal: e.signal set, e.killed false
                // Reject for spawn-failure and watchdog-timeout (the hung-child
                // case the ticket calls out); a watchdog timeout is `killed:true`.
                if (e.killed) {
                  rejectP(
                    new Error(
                      `exec: "${req.bin}" killed after ${timeout}ms (timeout or output cap exceeded)`
                    )
                  );
                  return;
                }
                if (typeof e.code === 'string') {
                  rejectP(new Error(`exec: failed to start "${req.bin}" (${e.code})`));
                  return;
                }
                // Exited via an uncaught signal (e.g. crashed) — surface the
                // signal as a non-error result with code:null so a caller can
                // still inspect stdout/stderr, distinct from the reject paths.
                resolveP({
                  stdout: String(stdout),
                  stderr: String(stderr),
                  code: null,
                  signal: e.signal ?? null
                });
                return;
              }
              // Ran and exited non-zero — a normal, reportable result.
              resolveP({ stdout: String(stdout), stderr: String(stderr), code: exitCode });
              return;
            }
            resolveP({ stdout: String(stdout), stderr: String(stderr), code: 0 });
          }
        );
      });
    },

    async readFile(moduleId, path, encoding) {
      // Check the REAL path: `realpathForCheck` resolves symlinks AND collapses
      // `..`, so a symlink inside a granted root pointing outside it (e.g. →
      // ~/.ssh) is caught — the grant's roots are realpath'd to match
      // (P3-HARDEN). This single check subsumes the lexical one.
      const real = await realpathForCheck(resolve(path));
      broker.assert(moduleId, 'fs:read', { kind: 'fs', path: real });
      return await readFile(real, encoding ?? 'utf-8');
    },

    async writeFile(moduleId, path, data) {
      // For a new file the leaf may not exist yet, so `realpathForCheck` resolves
      // the (possibly symlinked) parent dir — the escape vector for a new-file
      // write — and re-attaches the leaf.
      const real = await realpathForCheck(resolve(path));
      broker.assert(moduleId, 'fs:write', { kind: 'fs', path: real });
      await writeFile(real, data, 'utf-8');
    },

    async rm(moduleId, path) {
      // Symlink-safe delete: resolve the REAL target and check it against
      // fs:write roots + sensitive-root blocklist (reuses writeFile's pattern).
      const real = await realpathForCheck(resolve(path));
      broker.assert(moduleId, 'fs:write', { kind: 'fs', path: real });

      // Files-only: reject directory targets (no rm -rf semantics).
      try {
        const stats = await stat(real);
        if (stats.isDirectory()) {
          throw new Error('Cannot delete directory (files only): ' + path);
        }
      } catch (err: any) {
        // Idempotent-missing: if the file doesn't exist, that's success.
        if (err?.code === 'ENOENT') return;
        throw err;
      }

      // Permission-gated unlink.
      try {
        await unlink(real);
      } catch (err: any) {
        // Idempotent-missing: resolve quietly on ENOENT.
        if (err?.code === 'ENOENT') return;
        throw err;
      }
    },

    async readdir(moduleId, path) {
      const real = await realpathForCheck(resolve(path));
      broker.assert(moduleId, 'fs:read', { kind: 'fs', path: real });
      return await readdir(real);
    },

    async stat(moduleId, path) {
      // Check the REAL path (symlink-safe). Gate under fs:read — this is
      // introspection only, not mutation.
      const real = await realpathForCheck(resolve(path));
      broker.assert(moduleId, 'fs:read', { kind: 'fs', path: real });
      const stats = await stat(real);
      return {
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory()
      };
    },

    async exists(moduleId, path) {
      // Permission check MUST run FIRST (Rule 1), so existence of off-root
      // paths is never leaked. For a path UNDER a granted root that doesn't
      // exist yet, return false (not throw). For a path OUTSIDE granted roots,
      // throw PermissionDenied.
      const real = await realpathForCheck(resolve(path));
      broker.assert(moduleId, 'fs:read', { kind: 'fs', path: real });
      try {
        await stat(real);
        return true;
      } catch (err: any) {
        if (err?.code === 'ENOENT') return false;
        throw err; // Other errors (permission, I/O) propagate
      }
    },

    async fetch(moduleId, url, init?: BrokeredFetchInit): Promise<BrokeredFetchResponse> {
      // Follow redirects MANUALLY so the egress allowlist is re-checked on every
      // hop. `redirect: 'follow'` (the WHATWG default) would let a net-granted
      // ext request an allowlisted host that 30x-redirects to an arbitrary one
      // (e.g. 169.254.169.254 cloud-metadata / internal SSRF) — the allowlist is
      // only the entire `net` capability, so a single attacker redirect must not
      // escape it. The per-hop `net` re-assertion is supplied as the `onHop`
      // hook to the SHARED redirect helper, which the trusted built-in fetch
      // uses too (without a hook) — so the two paths can't drift.
      const res = await followManualRedirects(url, init, (host) => {
        broker.assert(moduleId, 'net', { kind: 'net', host });
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      // Cap the body so an off-allowlist (or hostile) response can't OOM main,
      // mirroring exec's maxBuffer. Read as a stream and abort past the cap.
      const body = await readCappedText(res, FETCH_MAX_BODY);
      return { status: res.status, ok: res.ok, headers, body };
    },

    async mcp(moduleId, serverId, tool, args, opts): Promise<unknown> {
      if (typeof serverId !== 'string' || !serverId) throw new Error('mcp: missing serverId');
      if (typeof tool !== 'string' || !tool) throw new Error('mcp: missing tool');
      // Gate: `mcp` granted AND serverId on the allowlist. Throws on deny. The
      // workspace confinement (which `.zana` root the call touches) is enforced
      // separately by the pool's `resolveWorkspace` — this gate only decides
      // WHICH server the ext may reach.
      broker.assert(moduleId, 'mcp', { kind: 'mcp', serverId });
      if (!deps.mcpPool) {
        throw new Error(`mcp: no MCP pool available for "${serverId}"`);
      }
      return await deps.mcpPool.call(serverId, tool, args, opts ?? {});
    },

    async mcpInitWorkspace(moduleId, opts): Promise<{ created: boolean }> {
      // Same gate as `mcp` — this is the pool's one-off write path (create
      // `.zana/` for a workspace that has none), not a general tool call, but it
      // reaches the same `mcp` permission + `mcpAllowlist: ["zana"]` scope.
      broker.assert(moduleId, 'mcp', { kind: 'mcp', serverId: 'zana' });
      if (!deps.mcpPool) {
        throw new Error('mcp: no MCP pool available for "zana"');
      }
      return await deps.mcpPool.initWorkspace(opts ?? {});
    },

    async mcpIsWorkspaceInitialized(moduleId, opts): Promise<boolean> {
      // Read-only counterpart to `mcpInitWorkspace` — same gate, no write.
      broker.assert(moduleId, 'mcp', { kind: 'mcp', serverId: 'zana' });
      if (!deps.mcpPool) return false;
      return await deps.mcpPool.isWorkspaceInitialized(opts ?? {});
    },

    async streamOpen(moduleId, endpoint, opts): Promise<string> {
      if (typeof endpoint !== 'string' || !endpoint) throw new Error('stream: missing endpoint');
      // Gate: `stream` granted AND the endpoint HANDLE on the allowlist. Throws
      // on deny (→ the child's `await ctx.stream` rejects). The handle is
      // resolved to a real transport target — and confined — inside the relay
      // (Rule 1/2): the extension names an opaque handle, never a URL/socket.
      broker.assert(moduleId, 'stream', { kind: 'stream', endpoint });
      if (!deps.streamRelay) {
        throw new Error(`stream: no stream relay available for "${endpoint}"`);
      }
      // `subscribe` throws StreamUnavailableError synchronously for a bad
      // handle / capacity / resolve-fail; a transport error AFTER open is a
      // terminal `done`, not a throw. Frames do NOT return here — the relay
      // pushes them core→renderer directly (wiring (a)); this only mints the id.
      return deps.streamRelay.subscribe(moduleId, endpoint, opts ?? {});
    },

    async streamClose(moduleId, subId): Promise<void> {
      if (typeof subId !== 'string' || !subId) return; // nothing to close
      // Ownership-checked in the relay: an ext can only close a subId it owns
      // (a forged/other id is a silent no-op). No permission re-check — closing
      // your own subscription is always allowed. Idempotent.
      deps.streamRelay?.unsubscribe(moduleId, subId);
    },

    streamCloseAll(moduleId): void {
      // Called on teardown / crash / kill so a dead child leaks no host-side
      // connection (Rule 3). Best-effort + never throws.
      try {
        deps.streamRelay?.closeForModule(moduleId);
        // Clear rate-limit tracking for this module (W1-3 emit) — a dead child
        // should not leak timestamps in the emitCalls map (Rule 3).
        emitCalls.delete(moduleId);
        // Drop any launches this dead child parked (W1-4) — a crashed extension
        // must not leave a confirm affordance dangling in the shell (Rule 3).
        deps.hostCommands?.closeForModule(moduleId);
      } catch {
        /* teardown path — never let a relay cleanup error escape */
      }
    },

    emit(moduleId, topic, payload): void {
      // W1-3: fire-and-forget push main→renderer. Topic namespaced to
      // `ext:<moduleId>:<topic>` using the AUTHENTICATED moduleId (Rule 1) —
      // the child cannot forge it. No permission token (an extension pushing its
      // own data to its own panels), but bounded: frames ≤128KiB, rate ~50fps
      // per module (Rule 5).
      if (!deps.sink) return; // No sink? Silent no-op.
      if (typeof topic !== 'string' || !topic) return; // Invalid topic? No-op.

      // Sliding-window rate limit (~50fps). Prune to the window, then check cap.
      const now = Date.now();
      const recent = (emitCalls.get(moduleId) ?? []).filter(
        (ts) => now - ts < EXT_EMIT_RATE_WINDOW_MS
      );
      if (recent.length >= EXT_EMIT_RATE_MAX) {
        // Over rate cap — drop silently (best-effort, Rule 5).
        emitCalls.set(moduleId, recent);
        return;
      }

      // Namespace topic: ext:<moduleId>:<topic>. The moduleId is authenticated,
      // so the extension can only emit on its own namespace.
      const namespacedTopic = `ext:${moduleId}:${topic}`;

      // Frame structure: { topic, payload }. The renderer's host.on will filter
      // by topic prefix to deliver only to the extension's own panels.
      const frame = { topic: namespacedTopic, payload };

      // Size cap: 128KiB (same as stream relay). Serialize to measure BYTES (not chars).
      try {
        const serialized = JSON.stringify(frame);
        // Use Buffer.byteLength to measure UTF-8 bytes (not string.length chars) — a
        // multibyte payload could exceed 128KiB bytes even if under the char count.
        if (Buffer.byteLength(serialized, 'utf-8') > 128 * 1024) return; // Over cap? Drop silently.

        // Send frame directly core→renderer via the sink. Uses the namespaced
        // topic as the "subId" so the renderer can route it. The sink is the
        // SAME one StreamRelay uses (index.ts:1669), so frames go through the
        // existing IPC.modules.streamFrame channel (no new wiring needed).
        deps.sink.frame(namespacedTopic, payload);

        // Record timestamp AFTER successful send (only count delivered frames).
        recent.push(now);
        emitCalls.set(moduleId, recent);
      } catch {
        // Serialization failure or sink error? Best-effort, never throw.
      }
    },

    // ---- W1-4 trust inversion — the SINGLE gate site for host.* commands ----
    // Each performs a renderer-only action on the extension's behalf via the
    // core-owned HostCommandRelay. `moduleId` is the AUTHENTICATED id the process
    // host bound to the child's port (anti-spoof) — never a value from args.
    // toast/navigate carry NO permission token (inert UI nudges, like `emit`);
    // selectProject asserts `projects:select`; requestLaunch asserts
    // `session:launch`. broker-caps stays the ONLY enforcement site — the
    // process-host dispatch adds no second gate (same discipline as `mcp`).

    hostToast(moduleId, message, kind): void {
      // Unconditional (advisory UI to the extension's own shell). No-op if no relay.
      deps.hostCommands?.toast(moduleId, String(message), kind);
    },

    hostNavigate(moduleId, target): void {
      // Unconditional (advisory UI). The target is a top-level surface handle the
      // renderer re-validates before routing.
      deps.hostCommands?.navigate(moduleId, String(target));
    },

    hostSelectProject(moduleId, projectId): void {
      // Gate: `projects:select` (unscoped grant). assert() throws on deny — the
      // process-host turns that into an ok:false reply. The pushed id is advisory;
      // the renderer re-checks it against its known project set (Rule 1).
      broker.assert(moduleId, 'projects:select');
      deps.hostCommands?.selectProject(moduleId, (projectId as string | null) ?? null);
    },

    async hostRequestLaunch(moduleId, spec: HostLaunchSpec): Promise<HostRequestLaunchResult> {
      // Gate: `session:launch` (unscoped grant). Throws on deny. Park-by-default +
      // the durable per-module queue live in the relay: a disk-tier request is
      // ALWAYS parked (autoLaunch ignored), and main NEVER spawns here — the
      // renderer authorizes + drives the confined launch path (Rule 1).
      broker.assert(moduleId, 'session:launch');
      if (!deps.hostCommands) {
        throw new Error(`host.requestLaunch: no host command bridge available`);
      }
      if (!spec || typeof spec !== 'object' || typeof spec.projectId !== 'string' || !spec.projectId) {
        throw new Error('host.requestLaunch: spec.projectId is required');
      }
      return deps.hostCommands.requestLaunch(moduleId, spec);
    },

    // W1-5 main-reachable host UX. NO permission token (pure UI, like hostToast).
    // The relay renders the dialog to the human and resolves their answer, or
    // fails closed (false / null) when no renderer can receive it. A host without
    // the bridge degrades to the fail-closed value here (never throws).
    async hostConfirm(moduleId, spec: HostConfirmSpec): Promise<boolean> {
      if (!deps.hostCommands?.confirm) return false;
      if (!spec || typeof spec !== 'object' || typeof spec.title !== 'string' || !spec.title) {
        throw new Error('host.confirm: spec.title is required');
      }
      return deps.hostCommands.confirm(moduleId, spec);
    },

    async hostAlert(moduleId, spec: HostNotifySpec): Promise<string | null> {
      if (!deps.hostCommands?.alert) return null;
      if (!spec || typeof spec !== 'object' || typeof spec.title !== 'string' || !spec.title) {
        throw new Error('host.alert: spec.title is required');
      }
      return deps.hostCommands.alert(moduleId, spec);
    },

    // Phase B: `ctx.inbox.push`. Gate `inbox:push` FIRST (deny-by-default, like
    // every other permissioned cap), then delegate to the shared validation
    // helper with `extensionSource` stamped from the AUTHENTICATED moduleId —
    // never a payload value (Rule 1), mirroring the persona/team stamp pattern.
    async inboxPush(
      moduleId,
      input: {
        projectId: string;
        comments?: string;
        docs?: Array<{ path: string }>;
        target?: { moduleId: string };
      }
    ): Promise<{ id: string }> {
      broker.assert(moduleId, 'inbox:push');
      if (!deps.inbox) {
        throw new Error('inbox.push: no inbox bridge available');
      }
      if (!input || typeof input !== 'object' || typeof input.projectId !== 'string' || !input.projectId) {
        throw new Error('inbox.push: projectId is required');
      }
      return pushInboxOnBehalfOf(deps.inbox, moduleId, input, {
        extensionSource: { extensionId: moduleId }
      });
    },

    async llm(moduleId, req: ExtensionLlmRequest): Promise<LlmInvokeResult> {
      const startedAt = Date.now();
      const failed = (code: LlmInvokeErrorCode, error: string): LlmInvokeResult => ({
        ok: false,
        text: '',
        error,
        code,
        ms: Date.now() - startedAt
      });

      // Gate: `llm:invoke` granted. No scope allowlist — the vendor/provider is
      // app-configured, not extension-chosen, so there is nothing per-call to
      // scope. assert() throws PermissionDenied on deny (→ the child's await
      // rejects, distinct from the ok:false degraded results below).
      broker.assert(moduleId, 'llm:invoke');

      // Global kill switch (ships OFF). A denied-by-config call is a DEGRADED
      // state (ok:false), not a permission error — the feature simply isn't on.
      if (!(deps.llmEnabled?.() ?? false)) {
        return failed('disabled', 'llm: extension LLM calls are disabled (extensionLlmEnabled is off)');
      }
      if (!deps.llmService) {
        return failed('unavailable', 'llm: no LLM service available');
      }
      if (!req || typeof req.system !== 'string' || typeof req.user !== 'string') {
        return failed('invalid-request', 'llm: system and user must be strings');
      }

      // Concurrency 1 per extension — one in-flight brokered call at a time.
      if (llmInFlight.has(moduleId)) {
        return failed('busy', 'llm: a call is already in flight for this extension');
      }

      // Sliding-window rate limit. Prune to the window, then check the cap.
      const now = Date.now();
      const recent = (llmCalls.get(moduleId) ?? []).filter(
        (ts) => now - ts < EXT_LLM_RATE_WINDOW_MS
      );
      if (recent.length >= EXT_LLM_RATE_MAX) {
        llmCalls.set(moduleId, recent);
        return failed(
          'rate-limited',
          `llm: rate limit exceeded (${EXT_LLM_RATE_MAX} calls / ${EXT_LLM_RATE_WINDOW_MS / 60_000}min)`
        );
      }
      recent.push(now);
      llmCalls.set(moduleId, recent);

      // Condition #1: clamp INPUT size (bounds exfil payload per call). Condition
      // #2: build the provider entry at the single contained choke-point (model
      // hard-clamped to haiku, provider host-default, no project/tool/argv reach)
      // — `buildContainedLlmEntry` asserts containment before it can run.
      const system = req.system.slice(0, EXT_LLM_SYSTEM_MAX_CHARS);
      const user = req.user.slice(0, EXT_LLM_USER_MAX_CHARS);
      const maxOutputChars = Math.min(
        typeof req.maxOutputChars === 'number' && req.maxOutputChars > 0
          ? req.maxOutputChars
          : EXT_LLM_OUTPUT_DEFAULT_CHARS,
        EXT_LLM_OUTPUT_MAX_CHARS
      );
      const entry = buildContainedLlmEntry(moduleId, system, user, maxOutputChars);

      llmInFlight.add(moduleId);
      try {
        // Empty vars map: the user text lives in userTemplate and any `{{…}}` in
        // attacker-influenced text stays literal (no template injection). Dedupe
        // key scopes coalescing to this extension.
        const result = await deps.llmService.run(entry, {}, `ext:${moduleId}:llm`);
        if (!result.ok) {
          // Any provider-side failure (timeout, non-zero exit, no provider
          // registered) maps to the single `provider-error` code — the ext
          // can't act on the specific vendor reason, only that the call failed.
          return failed('provider-error', result.error ?? 'llm: provider call failed');
        }
        // Strip the internal result to the narrow SDK shape — no provider name,
        // model, or token usage leaks to the extension. `error`/`code` are
        // absent on success, keeping the success shape minimal.
        return {
          ok: true,
          text: result.text,
          ms: Date.now() - startedAt
        };
      } catch (err) {
        // LlmService.run is documented never-throw, but defend anyway so a bug
        // there degrades to ok:false rather than rejecting the child's await.
        return failed('provider-error', err instanceof Error ? err.message : String(err));
      } finally {
        llmInFlight.delete(moduleId);
      }
    }
  };
}
