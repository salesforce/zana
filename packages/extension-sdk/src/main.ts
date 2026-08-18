/**
 * Main-process side of the extension contract (`@zana-ai/zcc-extension-sdk/main`).
 * Separate from `./renderer` so the main bundle never imports React types.
 *
 * An extension's main module declares named **capabilities** — async functions
 * the renderer reaches via `ModuleHost.call(capability, ...args)`. Core
 * multiplexes every extension over one IPC channel (`modules:call`) keyed by
 * `{ moduleId, capability }`, so an extension adds zero entries to the IPC
 * layer, the preload bridge, or `registerIpc()`.
 *
 * Disk-extension capabilities run in an isolated utility process and communicate
 * with the host over IPC. Built-in capabilities run in Electron main. Keep them
 * pure data in / data out: the return value is structured-cloned across IPC, so
 * it must be JSON-serialisable.
 */

/** A single capability: arbitrary JSON-serialisable args in, value out. */
export type ModuleCapability = (...args: any[]) => Promise<unknown> | unknown;

/**
 * Context handed to an extension's main module at registration time. Gives an
 * extension the host services it can't (and shouldn't) reimplement — same
 * decoupling rule as the renderer: no reaching into core internals.
 */
export interface MainModuleContext {
  /**
   * Per-extension persistent KV store (backs `ModuleHost.storage`).
   *
   * NOTE (P3-A): for built-in modules (in-process) `get` returns synchronously.
   * For a DISK extension running out-of-process in its `utilityProcess`, the
   * store lives host-side and `get` resolves a Promise over the broker port —
   * `await ctx.storage.get(key)` works in both cases. The store is namespaced by
   * the AUTHENTICATED extension id the host binds to the child's port, never an
   * id the extension supplies, so one extension cannot read another's namespace.
   */
  storage: {
    get<T = unknown>(key: string): T | undefined | Promise<T | undefined>;
    set(key: string, value: unknown): void;
  };
  /** Structured logger; messages are tagged with the extension id. */
  log: (message: string, err?: unknown) => void;

  /**
   * Auto-disposing cleanup registry (W1-6) — the main-side twin of
   * {@link ModuleHost.register}. Hand it any teardown function (a
   * `clearInterval`, a watcher `close()`, a `ctx.stream` `close()`) and the host
   * runs it automatically when the extension is torn down (disable / uninstall /
   * hot-reload), IN ADDITION to your {@link MainModule.teardown}. Lets you
   * co-locate acquisition + release instead of tracking every handle to undo it
   * in `teardown`. Idempotent: the host guards against double-free, so a
   * disposable you ALSO release yourself in `teardown` is safe.
   *
   * @example
   * ```ts
   * setup(ctx) {
   *   const t = setInterval(() => poll(), 30_000);
   *   ctx.register(() => clearInterval(t)); // runs on teardown, no bookkeeping
   *   return { … };
   * }
   * ```
   */
  register(disposable: () => void): void;

  /**
   * Brokered capabilities (P3-B). Each is performed HOST-SIDE and gated
   * deny-by-default against the extension's granted permissions + scopes
   * (see `ExtensionManifest.permissions` / `permissionScopes`). For a DISK
   * extension these forward over the `utilityProcess` MessagePort to the host,
   * which checks the permission for the AUTHENTICATED extension id before acting
   * and rejects with a `PermissionDenied`-tagged error otherwise.
   *
   * Built-in modules run in-process and TRUSTED: they may keep using raw Node
   * (`child_process`/`fs`/`fetch`) directly and need not use these. The members
   * are optional so a `{storage, log}`-only module still typechecks.
   *
   * RESIDUAL (honest): the child now installs a Node-builtin denylist
   * (P3-HARDEN: ESM loader hook + CJS `require` patch + neutered
   * `process.binding`), so `import('node:child_process')` / `require('fs')` no
   * longer trivially bypass `exec`. These brokered caps are the SANCTIONED,
   * permission-gated, audited path. This is JS-level deprivation, NOT an OS
   * sandbox — a native addon (`process.dlopen`) or realm escape could still reach
   * raw OS; the true seal (Node `--permission` / OS sandbox) is a follow-up.
   */
  exec?: (req: ExecRequest) => Promise<ExecResult>;
  fs?: {
    readFile(path: string, encoding?: 'utf-8'): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
    /**
     * Delete a file. Gated by `fs:write` permission + `fsRoots` scope (reuses
     * the same permission token as writeFile). Symlink-safe: checks the REAL
     * target against granted roots + sensitive-root blocklist before unlinking.
     * Files-only: rejects when the target is a directory (no rm -rf semantics).
     * Idempotent-missing: resolves quietly (success) when the file doesn't exist
     * — deleting an already-absent file is a no-op, matching poller idiom.
     */
    rm?(path: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
    /**
     * Get file/directory metadata. Gated by `fs:read` permission + `fsRoots`
     * scope. Rejects with `PermissionDenied` when the path is outside granted
     * roots (Rule 1/2: main authorizes, realpath-confine before trust). For a
     * symlink the result describes the link target.
     */
    stat(path: string): Promise<{ size: number; mtimeMs: number; isFile: boolean; isDirectory: boolean }>;
    /**
     * Check if a path exists. Gated by `fs:read` permission + `fsRoots` scope.
     * Returns `false` for a not-yet-existing path UNDER a granted root; rejects
     * with `PermissionDenied` when the path is OUTSIDE granted roots (the
     * permission check runs first, so existence of off-root paths is never
     * leaked). For a symlink returns `true` if the link target exists.
     */
    exists(path: string): Promise<boolean>;
  };
  fetch?: (url: string, init?: BrokeredFetchInit) => Promise<BrokeredFetchResponse>;

  /**
   * Brokered call to a HOST-MANAGED MCP server (stdio JSON-RPC), gated by the
   * `mcp` permission + the `mcpAllowlist` scope (which `serverId`s). The host
   * keeps a persistent, per-workspace stdio child per server id and routes this
   * call to it — an extension can't own such a child itself because the only
   * process primitive it has (`exec`) is one-shot with no stdin stream.
   *
   * - `serverId` — an allowlisted MCP server id (e.g. `"zana"`); maps in CORE to
   *   a resolved server binary (never named in the SDK — generic contract).
   * - `tool` — the MCP tool name to invoke (`tools/call` `name`).
   * - `args` — the tool arguments object (`tools/call` `arguments`).
   * - `opts.projectPath` — a project handle the host realpath-CONFINES against a
   *   registered project (Rules 1+2) to pick the workspace-scoped child; omit
   *   (or pass `useGlobal`) for the fixed global (`~`) workspace child.
   *
   * Resolves the tool's parsed JSON result (the host unwraps the MCP
   * `content[].text` envelope). Rejects with a typed error when the server is
   * unavailable / the tool errors / the permission is denied — the caller maps a
   * reject to an honest empty state, never a crash.
   *
   * Optional like exec/fs/fetch: a `{ storage, log }`-only module still
   * typechecks, and a host without an MCP pool omits it.
   */
  mcp?: (
    serverId: string,
    tool: string,
    args?: Record<string, unknown>,
    opts?: { projectPath?: string; useGlobal?: boolean }
  ) => Promise<unknown>;

  /**
   * Explicit, user-initiated on-disk init for a workspace-scoped MCP server
   * that hasn't created its data dir yet (today: zana's `.zana/`). Gated by the
   * SAME `mcp` permission + `mcpAllowlist` as {@link mcp} — this is the host's
   * one-off write path for that server, not a general tool call. `opts` is the
   * same workspace hint `mcp` takes (host-confined before any write). Resolves
   * `{created}` — `false` when the workspace was already initialized (idempotent).
   *
   * Optional like `mcp`: a host without an MCP pool omits it.
   */
  mcpInitWorkspace?: (opts?: {
    projectPath?: string;
    useGlobal?: boolean;
  }) => Promise<{ created: boolean }>;

  /**
   * Read-only counterpart to {@link mcpInitWorkspace}: whether the workspace's
   * `.zana/` skeleton already exists, without writing anything. Same `mcp`
   * permission + `mcpAllowlist` gate. Optional like `mcpInitWorkspace`.
   */
  mcpIsWorkspaceInitialized?: (opts?: {
    projectPath?: string;
    useGlobal?: boolean;
  }) => Promise<boolean>;

  /**
   * Resolve a renderer/agent-supplied project handle to a CONFINED, authorized
   * `.zana` root (Rules 1+2: main authorizes, realpath-match before trust).
   *
   * - `opts.useGlobal` (or omitting `projectPath`) → the FIXED
   *   `realpath(HOME)/.zana` global anchor (kind 'global'). This anchor is a
   *   fixed HOME-derived path, NOT a registered project, and is never subject
   *   to the registry realpath-match.
   * - `opts.projectPath` → must realpath-match a registered project root (or a
   *   HOME/cloneRoot base) before it is trusted; an unmatched/escaping path
   *   THROWS (no silent global fallback).
   *
   * Optional like exec/fs/fetch: a `{storage, log}`-only module still typechecks,
   * and the disk-ext proxy ctx may omit it (project-root authorization is
   * host-side, not a brokered child capability). Implemented by core for the
   * in-process built-in tier (A3); zana re-points its `resolveSource` onto it (A4).
   */
  resolveProjectRoot?: (opts: {
    projectPath?: string;
    useGlobal?: boolean;
  }) => Promise<ProjectRootResolution>;

  /**
   * Contribute Personas to ZCC's core registry. The host STAMPS provenance
   * (`{ extensionId }` from the AUTHENTICATED calling module — never
   * self-declared) and runs every input through core's shared `sanitizePersona`
   * gate. Registrations are IN-MEMORY and lifecycle-bound: cleared on
   * teardown/disable/hot-reload. Calling `register` again REPLACES this
   * extension's full set (declarative, not additive), bounded at
   * `PERSONAS_PER_EXTENSION_MAX`. Ids are namespaced by the host as
   * `ext:<id>:<rawId>`. Returns the accepted (sanitized) personas.
   *
   * Optional like exec/fs/fetch: a `{ storage, log }`-only module still
   * typechecks, and a host that doesn't supply a persona-team registry omits it.
   */
  personas?: {
    register(personas: PersonaInput[]): Promise<Persona[]>;
    clear(): Promise<void>;
  };
  /**
   * Same contract as {@link personas} for Teams. A team slot's `personaId` may
   * reference one of the extension's own contributed personas (resolved at
   * launch, not registration). Bounded at `TEAMS_PER_EXTENSION_MAX`, with each
   * slot's quantity clamped to `TEAM_SLOT_MAX`.
   */
  teams?: {
    register(teams: TeamInput[]): Promise<Team[]>;
    clear(): Promise<void>;
  };
  /**
   * Register as the active provider for the host-owned remote-project SSH
   * picker. The extension must expose `listSshHosts()` and may expose
   * `syncSshHosts()`; both return structured host entries, not raw ssh config.
   * Registration is lifecycle-bound and cleared on teardown/crash.
   */
  sshHosts?: {
    register(): Promise<void>;
    clear(): Promise<void>;
    list(): Promise<Array<{ alias: string; hostname?: string; user?: string; proxyJump?: string }>>;
  };

  /**
   * Read or update the global fallback start path for remote SSH projects. This
   * is intentionally narrower than general app configuration access: it only
   * affects `AppConfig.remoteDefaultPath`, whose precedence is per-project path
   * → this value → remote `$HOME`.
   */
  remoteDefaults?: {
    get(): Promise<{ remoteDefaultPath?: string }>;
    set(input: { remoteDefaultPath?: string }): Promise<{ remoteDefaultPath?: string }>;
  };

  /**
   * Request installation of an allowlisted git-hosted extension. The host owns
   * cloning, provenance, consent, and process startup; the caller can only name
   * a repository granted in `extensionInstallAllowlist`.
   */
  extensions?: {
    installFromGit(input: { url: string }): Promise<{ id: string }>;
    /**
     * Read-only view of disk extensions currently installed in ZCC. The host
     * exposes only stable ids and recorded Git origins, never filesystem paths or
     * manifests, so a catalogue can identify already-installed entries safely.
     */
    listInstalled(): Promise<Array<{ id: string; repository?: string }>>;
  };

  /**
   * Summarize a live session's latest turn into a short, human-readable note.
   * Generic and capability-shaped like {@link resolveProjectRoot}: the HOST
   * resolves the supplied `sessionId` to a live session it owns and confines it
   * (Rule 1) before reading any transcript — a foreign/stale/ineligible id
   * resolves to `{ ok: false }`, never an error and never a cross-session read.
   * The returned `text` is a 1–3 sentence plain-text summary; absent on failure.
   *
   * Optional like exec/fs/fetch: a `{ storage, log }`-only module still
   * typechecks, and a host that doesn't supply a summarizer omits it.
   */
  summarizeSession?: (
    sessionId: string,
    opts?: { scope?: 'lastTurn' }
  ) => Promise<{ ok: boolean; text?: string }>;

  /**
   * Subscribe to a host-managed LIVE PUSH SOURCE (SSE / socket tail), gated by
   * the `stream` permission + the `streamAllowlist` scope. The streaming twin of
   * {@link mcp}: a persistent server-pushed stream the one-shot {@link exec}/
   * {@link fetch} caps structurally cannot hold. Core owns the connection in a
   * bounded, trusted relay; the extension reaches it ONLY through this cap.
   *
   * The extension names an opaque `endpoint` HANDLE (e.g. `'cu.sessionEvents'`),
   * NEVER a URL or socket path — core resolves + confines the handle host-side
   * (Rules 1+2). **Frames do NOT return through this call**: `ctx.stream` only
   * AUTHORIZES + opens the subscription and resolves an opaque `subId`; the live
   * frames are pushed core→renderer and the panel receives them via
   * `host.subscribe(subId, onFrame, onDone)` in the renderer SDK.
   *
   * The relay is BOUNDED (Rule 5): per-extension + global caps, per-frame size +
   * rate caps, idle-TTL teardown. `close()` unsubscribes (idempotent,
   * ownership-checked). Rejects for a denied permission / off-allowlist handle /
   * unavailable endpoint / capacity. Optional like exec/fs/fetch.
   */
  stream?: (
    endpoint: string,
    opts?: Record<string, unknown>
  ) => Promise<{ subId: string; close(): Promise<void> }>;

  /**
   * Emit an event from main to your extension's renderer panels. Fire-and-forget
   * push for lightweight change-notify (not bulk streaming — use {@link stream}
   * for that). The host namespaces `topic` to your authenticated extension id
   * (`ext:<id>:<topic>`), so panels subscribe via `host.on('ext:<topic>', cb)`.
   *
   * **Bounded (Rule 5):** per-extension rate + payload size cap (mirrors
   * stream-relay's 128KiB/frame, ~50fps, idle-TTL). Frames drop when over cap;
   * no backpressure — emit is fire-and-forget. No permission token (your own data
   * to your own panels; no cross-extension eavesdrop).
   *
   * No delivery ordering guarantee across distinct topics (same rule as
   * `HostEvents`). Handlers auto-cleanup on panel unmount + extension teardown.
   *
   * @param topic - Event topic string (alphanumeric + `-._`, max 64 chars)
   * @param payload - Structured-cloneable JSON value (no functions/symbols/bigints)
   */
  emit?: (topic: string, payload: unknown) => void;

  /**
   * Brokered LLM micro-call (Epic C), gated by the `llm:invoke` permission and
   * the global `AppConfig.extensionLlmEnabled` kill switch. Runs on the HOST's
   * own `LlmService` (the same engine core uses for tab-naming / summaries):
   * disk-extension calls are model-clamped to a cheap tier, input/output
   * size-capped, and rate- + concurrency-limited. When disabled or denied the
   * call resolves to a degraded `{ ok: false }` — never throws for policy.
   *
   * Optional like exec/fs/fetch: a host that doesn't wire it omits it.
   */
  llm?: (req: ExtensionLlmRequest) => Promise<LlmInvokeResult>;

  /**
   * TRUST INVERSION (W1-4). Ask the SHELL to perform a renderer-only action a
   * MAIN module structurally can't do itself. A main module runs headless in its
   * `utilityProcess` with no window, no navigation, no toast surface, and no
   * authority to spawn a pty (Rule 1: main authorizes launches, the renderer
   * drives them). These commands let it REQUEST such an action; the host decides.
   *
   * - `toast` / `navigate` — fire-and-forget UI nudges (no permission token), the
   *   same "your own data to your own shell" model as {@link emit}. `navigate`
   *   names a top-level surface handle (e.g. this extension's own panel id).
   * - `selectProject` — gated by the `projects:select` permission; asks the shell
   *   to switch the active project (the id is re-checked renderer-side).
   * - `requestLaunch` — gated by the `session:launch` permission. Does NOT spawn:
   *   it PARKS a launch request for human confirm by default (the disk-tier
   *   default is ALWAYS park — `autoLaunch` is ignored for a disk extension), and
   *   resolves `{ parked, requestId }`. The launch spec is ADVISORY: the host
   *   re-authorizes projectId/cwd/persona and sanitizes flags before any pty is
   *   created. A launch parked while no panel is listening is delivered on the
   *   next panel attach — never silently dropped.
   *
   * Optional like exec/fs/fetch: a `{ storage, log }`-only module still
   * typechecks, and a host that doesn't wire the shell bridge omits it.
   */
  host?: {
    toast(message: string, kind?: 'info' | 'error'): void;
    navigate(target: string): void;
    selectProject(projectId: string | null): void;
    requestLaunch(spec: HostLaunchSpec): Promise<HostRequestLaunchResult>;
    /**
     * W1-5 host UX, main-reachable subset. Ask the SHELL to render a yes/no
     * confirm to the human and resolve their answer back over the command
     * channel — so a headless main watcher can gate a destructive action on a
     * human `true`. Resolves `false` if dismissed OR if no panel is listening
     * (fail-closed: an unanswered confirm is a "no", never a hang). Pure UI, no
     * permission token. The renderer twin is {@link ModuleHost.confirm}.
     */
    confirm(opts: HostConfirmSpec): Promise<boolean>;
    /**
     * W1-5 host UX, main-reachable subset. Surface a richer, actionable
     * notification and resolve the picked action's `id` (or `null` on dismiss /
     * no listening panel). Pure UI, no permission token. The renderer twin is
     * {@link ModuleHost.alert}.
     */
    alert(opts: HostNotifySpec): Promise<string | null>;
  };

  /**
   * Push a durable entry to the user's Inbox on this extension's behalf, gated
   * by the `inbox:push` permission. Unlike {@link host}'s ephemeral, non-
   * persisted dialogs, this writes a real row into the same durable Inbox the
   * `inbox_push`/`inbox_ask` MCP tools use — it survives a restart, counts
   * toward the unread badge, and is what the bell's notifications drawer reads.
   *
   * The host STAMPS provenance from the AUTHENTICATED calling module id (never
   * self-declared) onto the persisted entry, so the Inbox can attribute the
   * push to this extension. `projectId` is re-authorized host-side against the
   * known project set (Rules 1+2) — a grant to push is not a grant to target an
   * arbitrary/foreign project; an unknown id rejects.
   *
   * Optional like exec/fs/fetch: a `{ storage, log }`-only module still
   * typechecks, and a host that doesn't wire the inbox bridge omits it.
   *
   * `target` lets THIS extension say where clicking the resulting notification
   * (the native OS alert or the bell's drawer row) should land, instead of the
   * default plain Inbox entry. Name your OWN module id — the host re-validates
   * it against the LIVE module registry when the click actually happens (never
   * trusted blindly at push time), and falls back to the default Inbox landing
   * if the module is gone/disabled/lacks a renderable surface by then.
   */
  inbox?: {
    push(input: {
      projectId: string;
      comments?: string;
      docs?: Array<{ path: string }>;
      target?: { moduleId: string };
    }): Promise<{ id: string }>;
  };
}

/**
 * Main-side mirror of the renderer `ConfirmOptions` (W1-5). Duplicated as
 * plain data — `main.ts` must not import the React-bearing `renderer.ts` — the
 * same shape the shell renders. See {@link ModuleHost.confirm}.
 */
export interface HostConfirmSpec {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** One action button on a {@link HostNotifySpec} (W1-5). */
export interface HostNotifyAction {
  id: string;
  label: string;
}

/**
 * Main-side mirror of the renderer `NotifyOptions` (W1-5). Duplicated as plain
 * data (no React import). See {@link ModuleHost.alert}.
 */
export interface HostNotifySpec {
  title: string;
  body?: string;
  kind?: 'info' | 'error';
  actions?: HostNotifyAction[];
}

/**
 * A session launch a main module PROPOSES via `ctx.host.requestLaunch`. Every
 * field is a REQUEST the host may re-authorize, clamp, or reject — never a grant
 * past the human confirm (Rule 1). Mirrors the renderer SDK's `launchSession`
 * options plus an opening `prompt` and a confirm `label`.
 */
export interface HostLaunchSpec {
  /** Project to launch in (re-confined against the known project set host-side). */
  projectId: string;
  /** Launch as this persona (resolved to its flag layer host-side; id only). */
  personaId?: string;
  /** Extra CLI flags — sanitized against the launch denylist before use. */
  extraArgs?: string[];
  /** Tab title. */
  title?: string;
  /** Working-dir hint (re-confined). */
  cwd?: string;
  /** Opening prompt injected once the session is live. */
  prompt?: string;
  /** Human-readable label for the confirm affordance (what fired this launch). */
  label?: string;
  /**
   * ADVISORY request to skip the human confirm. IGNORED for a disk extension
   * (always downgraded to park); honored only for a trusted built-in tier.
   */
  autoLaunch?: boolean;
}

/** Outcome of {@link MainModuleContext.host.requestLaunch}. */
export interface HostRequestLaunchResult {
  /** True when queued for human confirm (the disk-tier default); false if issued. */
  parked: boolean;
  /** Correlation id for the parked / issued request. */
  requestId: string;
}

/**
 * A brokered LLM micro-call request (Epic C). Text in, text out — there is no
 * tool-use, no streaming, no conversation history: one `system` + `user` pair
 * yields one completion. Every field is a REQUEST within host limits, never a
 * grant past them: `system`/`user` are clamped to a host char budget; `model`
 * is an advisory hint the host may silently downgrade to a cheap tier;
 * `maxOutputChars` is clamped to a host ceiling.
 */
export interface ExtensionLlmRequest {
  /** System prompt (instruction/context). Clamped to the host input budget. */
  system: string;
  /** User prompt (the actual task input). Clamped to the host input budget. */
  user: string;
  /**
   * ADVISORY model hint (e.g. `"haiku"`). The host picks the provider and clamps
   * disk-extension calls to a cheap tier regardless. Omit for the host default.
   */
  model?: string;
  /** Desired output cap (chars). Clamped to the host ceiling; omit for default. */
  maxOutputChars?: number;
}

/**
 * A STABLE, enumerated failure code on a `{ ok:false }` {@link LlmInvokeResult}
 * — the machine-branchable companion to the human `error` string.
 *
 * - `disabled`     — the global `extensionLlmEnabled` kill switch is off.
 * - `unavailable`  — no LLM service is wired on this host build.
 * - `rate-limited` — the extension's sliding-window call budget is exhausted.
 * - `busy`         — a call for this extension is already in flight (concurrency 1).
 * - `invalid-request` — `system`/`user` missing or not strings.
 * - `provider-error`  — the underlying provider call failed.
 */
export type LlmInvokeErrorCode =
  | 'disabled'
  | 'unavailable'
  | 'rate-limited'
  | 'busy'
  | 'invalid-request'
  | 'provider-error';

/**
 * Result of a brokered LLM micro-call. Deliberately NARROW — a stripped view of
 * the host's internal run result: no provider name, no model, no token usage.
 * `ok:false` carries a short `error` string PLUS a stable
 * {@link LlmInvokeErrorCode} the caller can branch on.
 */
export interface LlmInvokeResult {
  /** True when a completion was produced. */
  ok: boolean;
  /** The completion text (empty string on failure). */
  text: string;
  /** Short human-readable reason when `ok` is false. */
  error?: string;
  /** Stable, machine-branchable failure code when `ok` is false. */
  code?: LlmInvokeErrorCode;
  /** Wall-clock duration of the call in milliseconds. */
  ms: number;
}

/**
 * SDK-local persona/team shapes used by the {@link MainModuleContext.personas} /
 * {@link MainModuleContext.teams} services. The SDK package is deliberately
 * decoupled from core's `src/shared/types.ts` (it ships standalone to external
 * authors), so these mirror core's `Persona` / `Team` STRUCTURALLY — the same
 * mirroring the SDK already does for `ExtensionManifest`. Core's wiring passes
 * its own `shared/types` values through these signatures, which are
 * structurally identical, so the two never drift in practice (a drift surfaces
 * as a type error at the core wiring site).
 */
export type SdkLaunchProfileId =
  | 'shell'
  | 'claude'
  | 'claude-resume'
  | 'claude-yolo'
  | 'cursor'
  | 'cursor-resume'
  | 'cursor-yolo'
  | 'codex'
  | 'codex-resume'
  | 'codex-yolo'
  | 'pi'
  | 'pi-resume'
  | 'opencode'
  | 'opencode-resume';

/** Provenance stamp — see core's `PersonaSource`. The host stamps `{ extensionId }`. */
export type PersonaSource =
  | 'builtin'
  | 'user'
  | { projectId: string; projectName?: string }
  | { extensionId: string; extensionTitle?: string };

/** A named, reusable `claude` flag bundle — see core's `Persona`. */
export interface Persona {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  baseProfile?: SdkLaunchProfileId;
  /**
   * Model selector, in the base profile's own dialect: claude aliases
   * (`opus`/`sonnet`/`haiku`/`default`), a codex model slug (`gpt-5-codex`, …),
   * etc. `default`/empty means "emit no model flag". Widened to `string` for the
   * harness-agnostic direction — see core's `Persona.model`.
   */
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  /** Codex sandbox policy (`codex -s`) — see core's `Persona.codexSandbox`. */
  codexSandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** Codex approval policy (`codex -a`) — see core's `Persona.codexApproval`. */
  codexApproval?: 'untrusted' | 'on-request' | 'never';
  appendSystemPrompt?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  addDirs?: string[];
  mcpServers?: string[];
  initialPrompt?: string;
  source?: PersonaSource;
}

/** Input shape for {@link MainModuleContext.personas}.register — see core's `PersonaInput`. */
export type PersonaInput = Omit<Persona, 'id' | 'name' | 'source'> & {
  id?: string;
  name: string;
};

/** One row of a {@link Team} — see core's `TeamSlot`. */
export interface TeamSlot {
  personaId: string;
  quantity?: number;
  label?: string;
}

/** A bundle of personas that opens N tabs when launched — see core's `Team`. */
export interface Team {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  orchestratorPersonaId?: string;
  slots: TeamSlot[];
  defaultProjectId?: string;
  initialPrompt?: string;
  source?: PersonaSource;
}

/** Input shape for {@link MainModuleContext.teams}.register — see core's `TeamInput`. */
export type TeamInput = Omit<Team, 'id' | 'source'> & { id?: string };

/**
 * Result of resolving a renderer/agent-supplied project handle to a confined,
 * realpath'd `.zana` root. `root` is always an absolute, realpath-resolved
 * directory the host has authorized (a registered project, or the fixed
 * realpath(HOME)/.zana global anchor). `kind` lets a caller distinguish the
 * two without re-deriving paths.
 */
export interface ProjectRootResolution {
  /** Absolute, realpath-resolved directory the host authorizes reads/writes under. */
  root: string;
  /** Which anchor satisfied the request. */
  kind: 'project' | 'global';
}

/** A no-shell process exec. `bin` is a basename checked against the exec allowlist. */
export interface ExecRequest {
  /** Executable basename (e.g. `"sf"`). NO path separators, NO shell string. */
  bin: string;
  /** Argument vector, passed without a shell. */
  args?: string[];
  /** Working directory; must be within a granted fs root if provided. */
  cwd?: string;
  /** Hard timeout (ms); the host caps it regardless. */
  timeoutMs?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Process exit code, or null if the process exited via a signal. */
  code: number | null;
  /**
   * The signal the process exited on (e.g. `"SIGSEGV"`), when `code` is null;
   * otherwise absent. NOTE: a *spawn failure* (bin not found) or a *host
   * watchdog kill* (timeout / output-cap exceeded) does not return a result at
   * all — `ctx.exec` REJECTS in those cases (S3), so a `{code:null}` result here
   * always means "ran, then died on a signal", never "never ran".
   */
  signal?: string | null;
}

/** Minimal, JSON-serialisable fetch init the broker honours. */
export interface BrokeredFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface BrokeredFetchResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
}

/**
 * An extension's main-process declaration. Registered in the main module
 * registry. `setup` is called once at app boot and returns the capability map
 * that backs `ModuleHost.call`.
 */
export interface MainModule {
  /** Must match the renderer `AppModule.id`. */
  id: string;
  /**
   * Build the capability map. Called once during `app.whenReady`. May be
   * sync or async (e.g. to warm a cache). Throwing here disables the
   * extension's capabilities but never crashes the app.
   */
  setup(ctx: MainModuleContext): Record<string, ModuleCapability> | Promise<Record<string, ModuleCapability>>;
  /**
   * Release any process-level resources the extension acquired in `setup`
   * (timers, fs/file watchers, child processes, open sockets). Called when the
   * extension is disabled or uninstalled — and, for runtime-loaded extensions,
   * before a hot-reload re-imports the module. May be sync or async; the host
   * awaits it. Throwing here is logged and isolated, never crashes the app.
   * Optional: a stateless extension needs no teardown.
   */
  teardown?(): void | Promise<void>;

  /**
   * ONE-TIME install hook — the extension analogue of an editor's post-install
   * step, but sandboxed. Fired EXACTLY ONCE, right after `setup(ctx)` first
   * reports ready following an explicit INSTALL/REINSTALL action (the
   * `extensions:install` IPC), and NEVER on an ordinary boot or hot-reload of an
   * already-installed extension. Use it for first-run provisioning that should
   * happen once, not on every activation: seed default `ctx.storage`, write a
   * starter config under a granted `fs` root, prime a cache.
   *
   * Runs in the SAME sandbox as everything else — it receives the same brokered
   * `ctx` (`storage`/`log`/`exec`/`fs`/`fetch`), so it is gated by the
   * extension's granted permissions and cannot run arbitrary shell. This is the
   * deliberate departure from the npm `postinstall` model (arbitrary host
   * scripts): an install hook is just capability-scoped module code.
   *
   * Ordering: `setup` ALWAYS runs first (the hook needs a live module + ctx);
   * `onInstall` runs after `ready`. Throwing here is logged and isolated — it
   * does NOT roll back the install or tear the extension down; the extension is
   * already live from `setup`. Optional: most extensions need no install hook.
   */
  onInstall?(ctx: MainModuleContext): void | Promise<void>;

  /**
   * Pre-removal hook — the inverse of {@link onInstall}. Fired ONCE while the
   * child is still alive, on an explicit UNINSTALL (the `extensions:uninstall`
   * IPC), BEFORE `teardown()` and before the install dir is removed. Use it to
   * clean up state that outlives the process and the install dir: files the
   * extension wrote OUTSIDE its dir (under a granted `fs` root), external
   * resources it registered, a remote session it should sign out of.
   *
   * NOT for releasing in-process resources (timers/watchers/sockets) — that is
   * `teardown()`'s job, which still runs right after this. The extension's own
   * `ctx.storage` KV is purged by the HOST after removal, so an `onUninstall`
   * need not clear it. Runs in the same brokered sandbox as `onInstall`. Bounded
   * by the host's teardown deadline — a hook that hangs is abandoned so an
   * uninstall never wedges. Throwing here is logged and isolated: the uninstall
   * proceeds regardless (a half-removed extension must never get stuck).
   * Optional.
   */
  onUninstall?(ctx: MainModuleContext): void | Promise<void>;
}
