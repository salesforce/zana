/**
 * Renderer-facing extension contract — the surface an extension's **panel**
 * imports (`@zana-ai/zcc-extension-sdk/renderer`). React types live here, so the
 * main bundle never pulls them in (main-side types are in `./main`).
 *
 * An extension is a self-contained feature (e.g. GUS) that plugs a nav entry
 * and a panel into the app shell without editing core wiring. It reaches the
 * host **only** through `ModuleHost` below — there is deliberately no escape
 * hatch to `window.cc` or core stores, so an extension stays portable.
 */

import type { ComponentType } from 'react';
import type { ExtensionPermission, ProjectTabContribution } from './index.js';

// Re-export so renderer-side consumers (e.g. the host permission gate) can
// import the permission vocabulary from the renderer subpath directly.
export type { ExtensionPermission } from './index.js';

/**
 * A SMALL, stable session shape owned by the SDK and surfaced in
 * {@link HostEvents}. Deliberately *not* core's `TerminalSession` — the SDK
 * stays dependency-light and decoupled from core's internal model, so this is
 * the minimal projection an extension can rely on across versions. Core maps
 * its richer session onto this shape before emitting `'session:updated'`.
 */
export interface SessionInfo {
  /** Stable session id (the terminal/tab id). */
  id: string;
  /** Id of the project the session belongs to. */
  projectId: string;
  /** Human-readable tab title at the time of the event. */
  title: string;
  /** Opaque status string (core's session status; not a fixed union here). */
  status: string;
}

/**
 * A SMALL, stable projection of a launchable persona, surfaced by
 * {@link ModuleHost.listPersonas}. Deliberately not core's full `Persona` — an
 * extension only needs to know a persona exists, its id (to pass to
 * {@link ModuleHost.launchSession}), and enough to label it in a picker. The
 * persona's actual flags are resolved core-side at launch, so they never cross
 * the isolation boundary.
 */
export interface PersonaInfo {
  /** Stable persona id; pass to `launchSession({ personaId })`. */
  id: string;
  /** Display name. */
  name: string;
  /** Lucide icon name, if the persona declares one. */
  icon?: string;
  /** One-line description, if any. */
  description?: string;
}

/**
 * A SMALL, stable projection of a project, surfaced by
 * {@link ModuleHost.getActiveProject} and {@link ModuleHost.listProjects}.
 * Enough to identify a project, scope to its directory, and label it in a
 * picker — without exposing core's full `Project` across the isolation boundary.
 */
export interface ProjectInfo {
  /** Stable project id; pass to {@link ModuleHost.launchSession}. */
  id: string;
  /** Display name. */
  name: string;
  /** Absolute path: the local root, or for a remote project the remote start path. */
  path: string;
  /**
   * Present when this project's sessions open as SSH sessions to a remote host
   * (the `host` alias as it appears in `~/.ssh/config`, plus an optional `user`
   * override) instead of local processes. Absent = a local-folder project. Lets
   * a picker label a target as "remote · ssh" vs a local folder without the
   * extension reaching into core stores. The actual SSH argv is built host-side
   * at launch — the alias never crosses as a trust anchor.
   */
  remote?: { host: string; user?: string };
}

/**
 * The event catalogue an extension can subscribe to via {@link ModuleHost.on}.
 * Each key maps to a **read-only notification** core already emits; payloads are
 * plain, JSON-serialisable objects (they cross the IPC boundary or derive from
 * a store snapshot). Handlers must treat payloads as immutable and must not
 * assume any delivery ordering between distinct event types.
 *
 * Always unsubscribe (call the function `on` returns) in your effect cleanup —
 * a panel that subscribes on mount and never unsubscribes leaks handlers across
 * remounts.
 *
 * Mapping to the streams core emits today:
 *   - `'project:changed'` / `'nav:changed'` — store-derived (shell selection / active nav).
 *   - `'session:updated'`        ← `terminals.onUpdated`
 *   - `'session:agentStatus'`    ← `terminals.onAgentStatus`
 *   - `'session:exit'`           ← `terminals.onExit`
 *   - `'inbox:appended'`         ← `inbox.onAppended`
 *   - `'inbox:removed'`          ← `inbox.onRemoved`
 *   - `'schedule:changed'`       ← `scheduler.onChanged`
 *   - `'mcp:changed'`            ← `mcp.onChanged`
 *   - `'skills:changed'`         ← `skills.onChanged`
 */
export interface HostEvents {
  /**
   * The shell's globally-selected project changed (or was cleared). Mirrors
   * what {@link ModuleHost.getActiveProject} would now return — subscribe to
   * react to project switches instead of reading the active project once.
   */
  'project:changed': { project: ProjectInfo | null };
  /** The active nav (sidebar selection) changed; `nav` is the new NavId. */
  'nav:changed': { nav: string };
  /** A session's metadata changed (title, status, …). */
  'session:updated': { session: SessionInfo };
  /** A session's Claude agent transitioned between activity states. */
  'session:agentStatus': {
    sessionId: string;
    state: 'working' | 'blocked' | 'done' | 'idle' | 'unknown';
  };
  /** A session's process exited; `code` is the exit code. */
  'session:exit': { sessionId: string; code: number };
  /** A new inbox entry was appended; `id` is the new entry's id. */
  'inbox:appended': { id: string };
  /** An inbox entry was removed; `id` is the removed entry's id. */
  'inbox:removed': { id: string };
  /** The set/state of scheduled tasks changed. Empty payload — re-read as needed. */
  'schedule:changed': Record<string, never>;
  /** MCP server configuration changed. Empty payload — re-read as needed. */
  'mcp:changed': Record<string, never>;
  /** The installed skills set changed. Empty payload — re-read as needed. */
  'skills:changed': Record<string, never>;
}

// ---- Host UX primitives (W1-5) ---------------------------------------------
// Promise-based, host-rendered dialog/affordance options. Host-rendered means
// they inherit the app's theme + a11y (focus-trap, Escape, aria) and need NO
// CSS injection from the extension. All are pure UI — NO permission token.

/** Options for {@link ModuleHost.confirm} — a yes/no dialog. */
export interface ConfirmOptions {
  /** Dialog title (the question). */
  title: string;
  /** Optional longer body under the title. */
  body?: string;
  /** Confirm-button label. Default `"OK"`. */
  confirmLabel?: string;
  /** Cancel-button label. Default `"Cancel"`. */
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). Default false. */
  danger?: boolean;
}

/** Options for {@link ModuleHost.prompt} — a single-line text input dialog. */
export interface PromptOptions {
  /** Dialog title. */
  title: string;
  /** Label shown above the input. */
  label?: string;
  /** Optional helper line under the title. */
  hint?: string;
  /** Input placeholder. */
  placeholder?: string;
  /** Pre-filled value (auto-selected, matching native prompt on rename). */
  initialValue?: string;
  /** Confirm-button label. Default `"OK"`. */
  confirmLabel?: string;
}

/** One choice in a {@link ModuleHost.quickPick} list. */
export interface QuickPickItem<T = unknown> {
  /** Primary text shown for the item. */
  label: string;
  /** Optional dimmer secondary text. */
  description?: string;
  /** The value resolved when this item is picked. */
  value: T;
}

/** Options for {@link ModuleHost.quickPick}. */
export interface QuickPickOptions {
  /** Dialog title. */
  title?: string;
  /** Filter-input placeholder. */
  placeholder?: string;
}

/** A button on a {@link NotifyOptions} — resolved back to the caller by `id`. */
export interface NotifyAction {
  /** Stable id resolved back to the {@link ModuleHost.alert} caller. */
  id: string;
  /** Button label. */
  label: string;
}

/** Options for {@link ModuleHost.alert} — a richer, actionable toast. */
export interface NotifyOptions {
  /** Notification title. */
  title: string;
  /** Optional body text. */
  body?: string;
  /** Visual kind. Default `"info"`. */
  kind?: 'info' | 'error';
  /** Optional action buttons; the picked one's `id` resolves the promise. */
  actions?: NotifyAction[];
}

/** Options for {@link ModuleHost.withProgress}. */
export interface ProgressOptions {
  /** Title shown in the progress affordance. */
  title: string;
  /**
   * Show a Cancel affordance that aborts the task's `AbortSignal`. Default
   * false. The task decides what "cancel" means; the host only fires the signal.
   */
  cancellable?: boolean;
}

/**
 * Capability bridge handed to an extension's panel. Everything an extension
 * needs from the host goes through here.
 */
export interface ModuleHost {
  /** Stable id of the owning extension (e.g. `'gus'`). */
  readonly moduleId: string;

  /**
   * Invoke one of the extension's own main-process capabilities (declared in
   * its `MainModule.capabilities`). Multiplexed over a single core IPC
   * channel keyed by `moduleId` + `capability`; the extension never registers
   * its own `ipcMain.handle`.
   *
   * @returns the capability's resolved value, or throws with its error message.
   */
  call<T = unknown>(capability: string, ...args: unknown[]): Promise<T>;

  /**
   * Persistent key/value storage namespaced to this extension. Backed by a
   * JSON file under the app data dir; values must be JSON-serialisable.
   * Use for view preferences (selected sprint, collapsed columns, …).
   */
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };

  /** Open a URL in the user's default browser. */
  openExternal(url: string): void;

  /**
   * Push a message to the user's inbox (markdown + optional project docs).
   * `projectId` defaults to the shell's active project; rejects if neither is
   * available. At least one of `comments`/`docs` must be present.
   *
   * @returns the new inbox entry's id.
   */
  pushInbox(msg: {
    projectId?: string;
    comments?: string;
    docs?: Array<{ path: string }>;
  }): Promise<{ id: string }>;

  /** Surface a transient toast in the app shell. */
  toast(message: string, kind?: 'info' | 'error'): void;

  /**
   * Relaunch THIS extension's main-process service — tear down its child and
   * spawn a fresh one. Use to recover from a crashed/hung backend (the host
   * rejects `call`s with "Extension <id> crashed — relaunch to retry" once its
   * child has died); offering the user a "Restart service" button beats making
   * them restart the whole app.
   *
   * Scoped to the calling extension — an extension can only relaunch itself, not
   * a sibling. A built-in (in-process) module has no separate child to respawn,
   * so this resolves `false` for those. Resolves `true` once the fresh child
   * reports ready, `false` on spawn/setup failure. After a `true`, re-run
   * whatever load failed (the panel's own retry) — the capability restarts the
   * service; it doesn't refetch your data.
   */
  relaunchSelf(): Promise<boolean>;

  /**
   * The project currently selected in the app shell, or null when none / on a
   * core view. Lets an extension scope its data to the active project's directory.
   */
  getActiveProject(): ProjectInfo | null;

  /**
   * In a per-project window (one opened "in a new window" for a single project),
   * the id of the project this whole window is locked to. `null` in the normal,
   * unscoped main window — and immutable for the window's lifetime (unlike
   * {@link getActiveProject}, which tracks the shell's mutable selection).
   *
   * Project-aware extensions can read this to render only the scoped project's
   * data in a scoped window. Reading it is OPT-IN: ignore it and your panel
   * renders exactly as before in every window.
   */
  getScopedProjectId(): string | null;

  /**
   * All projects open in the app shell. Lets an extension offer a project
   * picker — including telling remote (SSH) projects apart from local-folder
   * ones via {@link ProjectInfo.remote} — without reaching into core stores.
   */
  listProjects(): ProjectInfo[];

  /**
   * Ensure the built-in scratch project (the Quick Agent anchor, `~/.zcc-workspace`)
   * exists and return it, creating + registering it on first call. Use this when an
   * extension needs SOMEWHERE to {@link launchSession} but the user has no project
   * selected and may have none registered at all — e.g. a repair/Doctor agent that
   * should run even on an empty shell. Prefer {@link getActiveProject} /
   * {@link listProjects} when a real user project is the right home; fall back to
   * this only as the always-available anchor.
   *
   * Resolves the scratch {@link ProjectInfo} on success, or null if it couldn't be
   * created (surfaced as a toast). The returned project is a normal entry in
   * {@link listProjects} once ensured.
   */
  ensureQuickAgent(): Promise<ProjectInfo | null>;

  /**
   * Make a project the app's globally-selected project — the same effect as
   * clicking it in the core Projects sidebar. Lets an extension keep the shell's
   * selection in sync with its own in-panel project picker. No-op for an
   * unknown id. Pass null to clear the selection.
   */
  selectProject(projectId: string | null): void;

  /**
   * Launch an interactive Claude session in a project and navigate the shell to
   * the new tab. Always launches the base `claude` launch profile — an extension
   * shapes the run (model, system prompt, allowed/denied tools, permission
   * mode, opening prompt) by passing the corresponding CLI flags via
   * `extraArgs`, which are appended last and so win over global/project
   * defaults.
   *
   * @returns the new session's id, or null when it couldn't be created (e.g.
   *          no project matches `projectId`).
   */
  launchSession(opts: {
    projectId: string;
    /**
     * Launch as this persona (see {@link ModuleHost.listPersonas}). Core
     * resolves the persona to its flag layer host-side — the extension only
     * names it, so persona resolution stays single-sourced and the flags never
     * cross the isolation boundary. The persona's `baseProfile` (if any) becomes
     * the base; `extraArgs` are still appended last and win over the persona.
     * Unknown id = launched as the bare `claude` profile (no persona).
     */
    personaId?: string;
    extraArgs?: string[];
    title?: string;
    cwd?: string;
  }): Promise<{ id: string } | null>;

  /**
   * List the launchable personas available in the shell (builtin ⊕ user ⊕
   * project), as small {@link PersonaInfo} projections. Lets an extension offer
   * a persona picker (e.g. "investigate this bug as…") without reaching into
   * core stores. The full persona flags stay core-side; pass a chosen `id` to
   * {@link ModuleHost.launchSession}.
   */
  listPersonas(): PersonaInfo[];

  /**
   * Send a line of text to a running session's terminal, followed by Enter —
   * the same effect as typing into the tab and pressing return. The text is
   * delivered to the session's pty; what it does depends on what the session is
   * waiting for (answering a permission prompt, a free-form hint, an AskUser
   * response, …).
   *
   * Requires the `session:reply` permission (declared in the extension
   * manifest). Returns `true` when the input was delivered, `false` when the
   * permission is missing or the session id is unknown/closed.
   *
   * Use sparingly and only for sessions the extension is responsible for
   * (e.g. ones it launched via {@link ModuleHost.launchSession}) — this writes
   * raw input into a live agent, so an extension blasting unsolicited text into
   * arbitrary sessions is an abuse. There is no read-back of the session's
   * output across the boundary; pair this with {@link ModuleHost.on}
   * `'session:agentStatus'` to know when a session is waiting (`'blocked'`).
   *
   * SECURITY (honest scope): this is a HIGHER-privilege capability than
   * {@link ModuleHost.launchSession} — typing into a `'blocked'` session can
   * answer a permission prompt and thereby approve tool use (file writes, shell
   * commands) in that session. The host-side check only verifies the session id
   * is one the shell currently knows about (any project), NOT that THIS
   * extension launched it — there is no per-extension session-ownership
   * tracking yet, and like the other renderer gates it is ADVISORY (a disk
   * extension shares one IPC channel and could call the underlying core IPC
   * directly). Treat `session:reply` as a trusted-provenance grant until an
   * authoritative, ownership-keyed gate lands.
   */
  replyToSession(sessionId: string, text: string): Promise<boolean>;

  /**
   * Write RAW bytes to a running session's terminal — NO trailing Enter, unlike
   * {@link ModuleHost.replyToSession}. Use for control keys / escape sequences
   * that must not be submitted as a line: Esc (`\x1b`) to interrupt, Ctrl-C
   * (`\x03`), arrow keys. A line of text you want the agent to read should use
   * `replyToSession` (which appends Enter); use this only when that Enter would
   * be wrong.
   *
   * Same gating + scope as {@link ModuleHost.replyToSession} (requires
   * `session:reply`; the session must be one the shell knows about). Returns
   * `true` when delivered, `false` when the permission is missing or the
   * session id is unknown/closed.
   */
  writeToSession(sessionId: string, data: string): Promise<boolean>;

  /**
   * Subscribe to a host event (see {@link HostEvents}). The handler fires with
   * the event's typed, JSON-serialisable payload on every occurrence until you
   * unsubscribe. These are **read-only notifications** — they tell the panel
   * something changed; they don't mutate anything.
   *
   * Follows core's `on*` convention: returns an **unsubscribe function**. Call
   * it in your effect cleanup so handlers don't leak across remounts.
   *
   * @example
   * ```ts
   * React.useEffect(() => {
   *   const off = host.on('project:changed', ({ project }) => setProject(project));
   *   return off; // unsubscribe on unmount
   * }, []);
   * ```
   */
  on<E extends keyof HostEvents>(event: E, cb: (payload: HostEvents[E]) => void): () => void;
  /**
   * Listen to extension-emitted events (W1-3). Topics are namespaced to your
   * extension: calling `host.on('myTopic', cb)` subscribes to `ext:<moduleId>:myTopic`
   * and receives payloads pushed by your MAIN module's `ctx.emit('myTopic', payload)`.
   * Fire-and-forget push main→renderer, bounded (≤128KiB/frame, ~50fps). Returns
   * unsubscribe function. Prefix your topic with `ext:` for clarity (optional).
   */
  on(event: `ext:${string}`, cb: (payload: unknown) => void): () => void;

  /**
   * Receive the live frames of a stream the extension's MAIN module opened via
   * `ctx.stream(endpoint)` (SDK streaming capability). The main capability
   * authorizes + opens the subscription and returns its opaque `subId` (typically
   * via {@link ModuleHost.call}); pass that `subId` here to receive the frames.
   *
   * Frames are pushed **core→renderer directly** (they never pass through the
   * sandboxed child), keyed by `subId` — this method filters the shared push
   * channel down to just this subscription. `onFrame` fires for every validated
   * frame (a plain, JSON-parsed object; the relay drops malformed/oversized/
   * over-rate frames host-side so a panel never sees them). `onDone` fires ONCE
   * with the terminal reason — `{ok:true}` on a clean end, `{ok:false, error}` on
   * a transport error / idle timeout / the relay tearing the stream down — after
   * which no more frames arrive.
   *
   * Follows core's `on*` convention: returns an **unsubscribe function**. Call it
   * in your effect cleanup so the handler doesn't leak across remounts.
   * Unsubscribing here only stops THIS renderer from receiving frames — it does
   * NOT close the host-side connection; call the `close()` from `ctx.stream`
   * (usually via a `host.call('stopStream', subId)` capability) to release the
   * relay. In practice a panel does both: `close()` the subscription AND
   * unsubscribe its handler on unmount.
   *
   * @example
   * ```ts
   * React.useEffect(() => {
   *   let subId: string | undefined;
   *   let offFrames: (() => void) | undefined;
   *   (async () => {
   *     subId = await host.call<string>('startSessionStream', sessionId);
   *     offFrames = host.subscribe(subId,
   *       (frame) => appendFrame(frame),
   *       (reason) => { if (!reason.ok) setError(reason.error); });
   *   })();
   *   return () => {
   *     offFrames?.();
   *     if (subId) void host.call('stopSessionStream', subId);
   *   };
   * }, [sessionId]);
   * ```
   */
  subscribe(
    subId: string,
    onFrame: (frame: unknown) => void,
    onDone?: (reason: { ok: boolean; error?: string }) => void
  ): () => void;

  /**
   * Synchronous, in-memory scratch store, private to this extension. Reads and
   * writes are immediate (no Promise) and the contents **survive panel unmount**
   * — unlike React state, which is torn down when the nav switches away and the
   * panel is unmounted. It does **not** persist to disk and is gone when the app
   * (or the extension) restarts — unlike {@link ModuleHost.storage}, which is
   * async and durable.
   *
   * Purpose: replace the module-global `let cache` workaround extensions use to
   * keep computed/fetched data across remounts. Use `storage` for anything that
   * must outlive a restart (view preferences); use `cache` for ephemeral,
   * cheap-to-lose working data (a fetched list you don't want to refetch on
   * every remount).
   */
  cache: {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
    delete(key: string): void;
    /**
     * Request immediate re-evaluation of this extension's navigation badge.
     *
     * Call after changing cache data read by `navBadge`. Cache mutations stay
     * synchronous and silent, so this separates updating data from asking the
     * host UI to render its new badge value.
     */
    refreshBadge(): void;
  };

  /**
   * Auto-disposing cleanup registry (W1-6). Hand `register` any teardown
   * function (an unsubscribe from a non-host source, a `clearInterval`, a
   * `removeEventListener`) and the host runs it automatically when your panel
   * unmounts — so you never have to thread it through an effect cleanup.
   *
   * The common host subscriptions ({@link ModuleHost.on} /
   * {@link ModuleHost.subscribe}) **auto-register** when called on the host your
   * panel is mounted with, so the leak-prone pattern (subscribe on mount, forget
   * to unsubscribe) is handled for you. You may STILL wire the returned
   * unsubscribe into your own effect cleanup — the registry is idempotent, so
   * calling it yourself AND having the host run it does not double-free.
   *
   * Scope: disposables registered from a mounted panel run on that panel's
   * unmount. Registered from a `background` component (or outside any panel), they
   * run on extension disable/uninstall. Returning-and-wiring the old way still
   * works — `register` is purely additive.
   *
   * @example
   * ```ts
   * React.useEffect(() => {
   *   host.on('project:changed', ({ project }) => setProject(project)); // auto-disposed
   *   const t = setInterval(poll, 5000);
   *   host.register(() => clearInterval(t)); // also auto-disposed on unmount
   * }, []);
   * ```
   */
  register(disposable: () => void): void;

  // ---- Host UX primitives (W1-5) -------------------------------------------
  // Promise-based, host-rendered dialogs/affordances so an extension stops
  // falling back to `window.confirm` (disabled in Electron's renderer) or
  // injecting raw `<style>`. Each inherits the app theme + a11y and needs no
  // CSS injection. NONE require a permission token (pure UI, no capability).
  // All are cancellable/dismissable: dismissing resolves to the "no answer"
  // value (`false` / `null`) rather than rejecting.

  /**
   * Host-rendered yes/no confirmation. Replaces `window.confirm` for
   * destructive actions. Resolves `true` if the user confirms, `false` if they
   * cancel/dismiss (Escape, backdrop, ✕). The confirm button can be styled
   * destructive via `opts.danger`.
   *
   * Also reachable MAIN-side via `ctx.host.confirm` (W1-4's command channel),
   * so a headless main watcher can ask the human a yes/no.
   */
  confirm(opts: ConfirmOptions): Promise<boolean>;

  /**
   * Host-rendered searchable list picker. Resolves the picked item's `value`,
   * or `null` on dismiss. Items carry a `label` (+ optional `description`) and
   * an arbitrary `value` returned verbatim.
   */
  quickPick<T = unknown>(items: QuickPickItem<T>[], opts?: QuickPickOptions): Promise<T | null>;

  /**
   * Host-rendered single-line text input. Resolves the trimmed string, or
   * `null` on dismiss. Replaces `window.prompt` (which Electron disables).
   */
  prompt(opts: PromptOptions): Promise<string | null>;

  /**
   * Richer than {@link ModuleHost.toast}: a titled notification with an optional
   * body and optional action buttons. Resolves the picked action's `id`, or
   * `null` if dismissed with no action (or it had none). Use `toast` for the
   * terse, fire-and-forget path; use `alert` when you need a title/body or a
   * user choice.
   *
   * Also reachable MAIN-side via `ctx.host.alert`.
   */
  alert(opts: NotifyOptions): Promise<string | null>;

  /**
   * Run an async `task` behind a host-rendered progress affordance, resolving
   * (or rejecting) with the task's result. The task receives an `AbortSignal`
   * that fires if the user cancels (only offered when `opts.cancellable`), so a
   * cooperative task can bail early; the host does not force-kill it. The
   * affordance is torn down when the task settles regardless of outcome.
   *
   * @example
   * ```ts
   * const rows = await host.withProgress(
   *   (signal) => fetchAll(signal),
   *   { title: 'Loading…', cancellable: true }
   * );
   * ```
   */
  withProgress<T>(task: (signal: AbortSignal) => Promise<T>, opts: ProgressOptions): Promise<T>;
}

/**
 * A command an extension contributes to the app's command palette. Built by
 * {@link AppModule.commands} (given the live {@link ModuleHost}), so its `run`
 * can close over host capabilities. Shaped to be adaptable to core's internal
 * `PaletteItem` ({ key, label, run, … }) — core supplies the icon/hint when it
 * lifts these into the palette.
 */
export interface ExtensionCommand {
  /** Stable id, unique within the extension. Core namespaces it by `moduleId`. */
  id: string;
  /** Text shown in the command palette. */
  label: string;
  /** Invoked when the user picks the command. Fire-and-forget. */
  run: () => void;
  /** Extra fuzzy-match terms beyond `label` (aliases, synonyms). */
  keywords?: string[];
  /**
   * Lucide icon name (e.g. `'Ticket'`, `'Search'`), resolved core-side against
   * `lucide-react` — the same string-name convention as {@link AppModule.icon},
   * so the contract carries no dependency on the icon library's types. Unknown
   * names fall back to a neutral glyph. Omit to use the default command icon.
   */
  icon?: string;
  /**
   * Grouping label shown in the palette's empty-query view. Defaults to the
   * owning extension's title. Use it to bucket several commands under a custom
   * heading (e.g. `'GUS: Sprints'`).
   */
  category?: string;
  /**
   * Declarative visibility expression evaluated **host-side** against a fixed,
   * coarse, non-sensitive context. This is a **string**, never a function — a
   * predicate closure can't cross the extension isolation boundary, and
   * host-evaluating extension code would defeat the broker model. When the
   * expression is false the command is omitted from the palette; an unknown key
   * or a parse error also hides it (**fail-closed**). Absent → always shown.
   *
   * Grammar: `key`, `key == value`, `key != value`, combined with `!`, `&&`,
   * `||`, and parentheses. A bare `key` is truthy-tested, so
   * `when: 'hasActiveProject'` suffices.
   *
   * Available context keys (coarse & non-sensitive by design — they answer
   * yes/no/which questions, never expose paths, names, or contents):
   *   - `activeNav` — active sidebar nav id (string), e.g. `'projects'`, `'settings'`, or your module id
   *   - `hasActiveProject` — is a project selected? (boolean)
   *   - `hasActiveTab` — is there an active tab? (boolean)
   *   - `tabCount` — number of visible tabs in the selected project (number)
   *   - `activeTabStatus` — active tab status string (e.g. `'running'`, `'exited'`), or `''`
   *   - `activeTabProfile` — active tab launch profile (e.g. `'claude'`, `'shell'`), or `''`
   *   - `projectView` — `'terminals' | 'explorer' | 'preview' | 'library'` (legacy alias: `workspaceMode`)
   *   - `platform` — `'darwin' | 'win32' | 'linux'`
   *   - `panelFocused` — is THIS extension's own panel the active nav? (boolean)
   *
   * @example `when: "hasActiveProject && projectView == terminals"`
   * @example `when: "activeNav == projects || panelFocused"`
   */
  when?: string;
}

/**
 * An extension's renderer-side declaration. Registered in the renderer module
 * registry; core renders the nav entry and lazily mounts `panel` when the
 * extension's nav is active.
 *
 * A module contributes through visible extension points — {@link AppModule.panel},
 * {@link AppModule.commands}, and {@link AppModule.navBadge} — plus optional
 * headless {@link AppModule.background} work. At least one visible contribution is
 * expected; a module with none
 * registers a nav entry that does nothing useful.
 */
export interface AppModule {
  /** Stable, URL-safe id. Doubles as the NavId and the storage namespace. */
  id: string;
  /** Sidebar label. */
  title: string;
  /**
   * Lucide icon name (resolved by core against `lucide-react`). Kept as a
   * string so the contract has no dependency on the icon library's types.
   */
  icon: string;
  /** Window-title suffix when active; defaults to `title`. */
  titleLabel?: string;
  /**
   * Where the module's panel lives in the shell:
   *   - `'sidebar'` (default) — a global panel launched from the Extensions hub.
   *   - `'settings'` — the module is a Settings sub-section instead: it gets a
   *     row in the Settings list (not the sidebar), and its `panel` mounts
   *     inside the Settings content area. Use for configuration-style modules
   *     that belong with the app's other settings rather than as a top-level
   *     tool. The module still runs its {@link AppModule.background} regardless
   *     of placement.
   */
  placement?: 'sidebar' | 'settings';
  /**
   * Opt-in to ALSO mounting {@link AppModule.panel} as a PER-PROJECT TAB,
   * alongside core's built-in project tabs (Terminals / Explorer / Tickets / …),
   * IN ADDITION to the module's global Extensions-hub launch. The panel surfaces
   * in two scopes: the global panel ({@link ModuleHost.getScopedProjectId}
   * is `null`) and the per-project tab (core mounts the panel with a host whose
   * {@link ModuleHost.getScopedProjectId} returns that project's id). A
   * project-aware panel reads that to filter to one project; a panel that
   * ignores it renders identically in both, so opting in needs no panel change.
   *
   * For a runtime-loaded extension this is populated by the loader from the
   * manifest's `projectTab` block. See {@link ProjectTabContribution}.
   */
  projectTab?: ProjectTabContribution;
  /**
   * The panel component. `host` is injected by core. Plain (not lazy) — the
   * registry decides whether to wrap it in `React.lazy`. Extensions that want
   * code-splitting can export a lazy component here themselves.
   *
   * **Optional** as of the Phase 2 contract: a module may contribute only
   * `commands` and/or a `navBadge` without a panel. When omitted, the module
   * remains available through its commands/badge but has no global panel.
   */
  panel?: ComponentType<{ host: ModuleHost }>;
  /**
   * Optional settings UI for this module. When present, core surfaces the module
   * in the **Settings → Extensions** hub and mounts this component (injected with
   * the live {@link ModuleHost}) as the module's settings page — independent of
   * {@link AppModule.placement} and {@link AppModule.panel}.
   *
   * This is the decoupling boundary for configuration: an extension owns its own
   * settings screen, and core only provides the container + a generic "About"
   * fallback (title, version/status, enable toggle) for modules that ship none.
   * A sidebar-placed tool (e.g. Zana) can keep its dashboard `panel` while still
   * exposing a focused settings page here.
   */
  settingsPanel?: ComponentType<{ host: ModuleHost }>;
  /**
   * Commands this module contributes to the app's command palette. Called with
   * the live {@link ModuleHost} so each command's `run` can use host
   * capabilities. Returns a (possibly empty) array; core merges them into the
   * palette as `PaletteItem`s, namespaced by `id`.
   */
  commands?: (host: ModuleHost) => ExtensionCommand[];
  /**
   * A badge to render on this module's sidebar nav entry — a count (`number`)
   * or short label (`string`), or `null`/`0`/`''` for no badge. Called with the
   * live {@link ModuleHost}; core renders the result in the `.nav-badge` slot.
   * Keep it cheap and synchronous — it may be invoked on re-render. To keep the
   * badge live, recompute off {@link ModuleHost.cache} or store state updated
   * from a {@link ModuleHost.on} subscription.
   */
  navBadge?: (host: ModuleHost) => number | string | null;
  /**
   * A HEADLESS, ALWAYS-MOUNTED component. Unlike {@link AppModule.panel} (which
   * mounts only while the module's nav is active and unmounts on nav change),
   * `background` is mounted once at app start and stays mounted for the whole
   * session, regardless of which view is on screen. It receives the same
   * `{ host }` prop and should render `null` — its purpose is side effects that
   * must outlive the panel: long-lived subscriptions ({@link ModuleHost.on}),
   * polling bridges, anything that drives the module while the user is looking
   * elsewhere.
   *
   * Use this for work that must not pause when the user navigates away. A
   * settings panel that owns a background loop is a bug — the loop dies on the
   * first nav switch. Put the loop here and keep the panel for UI only.
   */
  background?: ComponentType<{ host: ModuleHost }>;
  /**
   * Capabilities this extension intends to use. **Declared now, not yet
   * enforced** — curated extensions are trusted, so this is documentation and
   * forward-compatibility. Enforcement (a permission broker at the dispatch
   * boundary) lands when the platform opens to untrusted third parties.
   */
  permissions?: ExtensionPermission[];
}

/**
 * The shape a **runtime-loaded** panel bundle must `default`-export. This is the
 * disk-loading counterpart to `AppModule.panel`: where a built-in module hands
 * core a ready React `ComponentType`, a runtime-loaded extension instead exports
 * a factory that core calls to *build* that component.
 *
 * **Why a factory instead of exporting the component directly?**
 * A runtime-loaded panel is a separately-built ESM bundle. If it did
 * `import 'react'` of its own, the bundler would either inline a *second* copy
 * of React or rely on a fragile import-map to dedupe against the host's copy.
 * Two React instances in one tree break hooks ("Invalid hook call" / mismatched
 * dispatcher) because hook state lives in module-level singletons. To avoid
 * that, the host passes **its own React instance** into `activate`; the panel
 * builds its component closed over that instance, so every hook the panel runs
 * resolves against the host's React tree. The extension's bundle externalizes
 * `react` entirely and never ships or imports one.
 *
 * `activate` is called once per mount by the host loader; the returned component
 * receives the same `{ host }` prop contract as `AppModule.panel`, so a panel's
 * body is identical whether it's built-in or runtime-loaded.
 *
 * Built-in modules keep using `AppModule.panel` unchanged — this factory is the
 * *runtime* code path, not a replacement for it.
 *
 * **Contributing settingsPanel / background / commands / navBadge from a runtime bundle.**
 * `activate` may return EITHER the panel component directly (the original,
 * still-supported shape) OR an {@link ActivateResult} carrying `panel` alongside
 * `settingsPanel`, `background`, `commands`, and/or `navBadge`. `background`
 * stays mounted by the host independently of active navigation. `commands` /
 * `navBadge` use the
 * **same `(host) => …` signatures** as {@link AppModule.commands} /
 * {@link AppModule.navBadge}, `settingsPanel` matches
 * {@link AppModule.settingsPanel}, so the host loader forwards them all onto the
 * built `AppModule` with no adaptation — a disk-installed extension reaches
 * the command palette, the sidebar badge slot, and the Settings → Extensions
 * settings page exactly like a built-in, while its background work remains active
 * outside its panel. A bare component return is normalized to
 * `{ panel }`.
 *
 * @example
 * ```ts
 * // extension's renderer entry, built as ESM with `react` externalized
 * import type { RendererEntry } from '@zana-ai/zcc-extension-sdk/renderer';
 *
 * const entry: RendererEntry = {
 *   activate({ React, host }) {
 *     return function Panel() {
 *       const [n, setN] = React.useState(0); // host's React → hooks work
 *       return React.createElement('button', { onClick: () => setN(n + 1) }, `${host.moduleId}: ${n}`);
 *     };
 *   },
 * };
 * export default entry;
 * ```
 *
 * @example
 * ```ts
 * // richer return: panel + a palette command + a nav badge
 * const entry: RendererEntry = {
 *   activate({ React, host }) {
 *     const Panel = () => React.createElement('div', null, host.moduleId);
 *     return {
 *       panel: Panel,
 *       commands: (h) => [{ id: 'ping', label: 'Hello: ping', run: () => h.toast('pong') }],
 *       navBadge: (h) => h.listProjects().length,
 *     };
 *   },
 * };
 * export default entry;
 * ```
 */
export interface RendererEntry {
  /**
   * Build the extension's renderer contributions. The host injects its own React
   * instance and the capability bridge.
   *
   * Returns EITHER the panel `ComponentType<{ host }>` directly (normalized by
   * the loader to `{ panel }`) OR an {@link ActivateResult} carrying any subset
   * of `panel` / `settingsPanel` / `background` / `commands` / `navBadge`. The returned panel is
   * mounted with `{ host }`.
   */
  activate(
    ctx: { React: typeof import('react'); host: ModuleHost }
  ): ComponentType<{ host: ModuleHost }> | ActivateResult;
}

/**
 * The richer object an extension's {@link RendererEntry.activate} may return so a
 * **runtime-loaded** bundle can contribute the same extension points a built-in
 * {@link AppModule} does — panel, settingsPanel, background, commands, navBadge — not just a
 * panel. Every field is optional; the host loader normalizes a bare
 * `ComponentType` return into `{ panel }` and copies these fields straight onto
 * the built `AppModule`.
 *
 * `commands` / `navBadge` deliberately reuse the **exact `(host) => …`
 * signatures** of {@link AppModule.commands} / {@link AppModule.navBadge}, so the
 * loader forwards them with zero adaptation and the shell wiring (command
 * palette, sidebar `.nav-badge`) treats a runtime extension identically to a
 * built-in.
 */
export interface ActivateResult {
  /** The panel component, mounted with `{ host }`. Optional — a module may contribute only commands/navBadge/settingsPanel. */
  panel?: ComponentType<{ host: ModuleHost }>;
  /**
   * Optional settings UI for this module — the runtime-loaded twin of
   * {@link AppModule.settingsPanel}. When present, the host copies it straight
   * onto the built `AppModule` so the **Settings → Extensions** hub mounts it
   * (injected with the live {@link ModuleHost}) as this extension's settings
   * page, independent of `panel`. Same `{ host }` prop contract as `panel`; the
   * host builds it closed over the host's React instance, so its hooks resolve
   * against the host React tree. A settings-only extension (settingsPanel and
   * nothing else) is a valid contribution.
   */
  settingsPanel?: ComponentType<{ host: ModuleHost }>;
  /**
   * Headless, always-mounted work for this runtime extension. The host preserves
   * valid components through activation normalization and mounts them outside nav
   * conditions for the app session. Background alone is not a visible contribution.
   */
  background?: ComponentType<{ host: ModuleHost }>;
  /**
   * Commands contributed to the command palette. Same contract as
   * {@link AppModule.commands}: called with the live {@link ModuleHost}, returns
   * a (possibly empty) `ExtensionCommand[]`.
   */
  commands?: (host: ModuleHost) => ExtensionCommand[];
  /**
   * Sidebar nav badge. Same contract as {@link AppModule.navBadge}: called with
   * the live {@link ModuleHost}; return a `number | string` or `null`/`0`/`''`
   * for no badge. Keep it cheap and synchronous.
   */
  navBadge?: (host: ModuleHost) => number | string | null;
}

// ---------------------------------------------------------------------------
// W1-7 — non-React host accessor (`getModuleHost`)
// ---------------------------------------------------------------------------
//
// Some extension code lives OUTSIDE the React tree and so can't receive `host`
// as a prop: a module-singleton store (zustand), a data seam a store calls, a
// timer/loop kicked off at module-eval. Before this, every such extension
// hand-rolled its own `host-holder.ts` (zana did; gus/cu have the same shape) —
// a `let host` + `setHost`/`getHost` pair, copied per extension.
//
// This blesses ONE copy. The extension's `activate({ host })` primes the module
// accessor via {@link primeModuleHost}, and any non-React code in the SAME
// bundle reads the live host lazily via {@link getModuleHost}.
//
// SEMANTICS (mirrors the `__ZCC_HOST_REACT__` React-priming pattern):
//   - **One instance per extension.** The holder is a MODULE-LEVEL singleton of
//     THIS bundle. Because each disk extension is blob-imported as its own
//     module graph, the `let` below is private to that one extension — the host
//     it returns is already the per-extension `ModuleHost` (same bounded scope
//     as the React holder), so a global accessor gives away no more than the
//     `host` prop already does.
//   - **Never throws.** `getModuleHost()` returns `null` before `activate` has
//     primed it (a genuine loader ordering bug, or a unit test that forgot to
//     prime) — callers MUST null-check. This deliberately differs from the
//     per-extension `host-holder`s that threw; a null-return is friendlier to
//     module-eval-time reads that legitimately race activate.
//
// The host loader still calls `activate({ host })` exactly as before; the entry
// just calls `primeModuleHost(host)` in `activate` instead of its own setter.

let moduleHost: ModuleHost | null = null;

/**
 * Prime the module-scoped host accessor. Call this ONCE from your
 * `RendererEntry.activate({ host })`, before returning, so non-React code in the
 * same bundle can reach the host via {@link getModuleHost}.
 *
 * ```ts
 * activate({ React, host }) {
 *   primeModuleHost(host);
 *   return { panel: MyPanel };
 * }
 * ```
 */
export function primeModuleHost(host: ModuleHost): void {
  moduleHost = host;
}

/**
 * The live {@link ModuleHost} for THIS extension, or `null` if
 * {@link primeModuleHost} hasn't run yet (before `activate`, or in a test that
 * didn't prime). NEVER throws — callers must null-check:
 *
 * ```ts
 * const host = getModuleHost();
 * if (!host) return; // activate hasn't primed the bridge yet
 * const rows = await host.call<Row[]>('listRows');
 * ```
 *
 * Use this ONLY for same-extension, non-React reads (a store, a data seam, a
 * loop). React panels already receive `host` as a prop — don't reach for this
 * there. This supersedes the per-extension `host-holder.ts` hack.
 */
export function getModuleHost(): ModuleHost | null {
  return moduleHost;
}

/**
 * TEST-ONLY seam: set (or clear, with `null`) the module host a test's
 * {@link getModuleHost} returns, so a store/data-seam unit test can inject a
 * `createMockHost()` without running `activate`. Behaviourally identical to
 * {@link primeModuleHost} but named to signal test intent; pair it with a
 * `setModuleHostForTesting(null)` in teardown so tests don't leak a host into
 * one another.
 */
export function setModuleHostForTesting(host: ModuleHost | null): void {
  moduleHost = host;
}
