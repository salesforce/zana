import { product } from '../lib/product-client.js';
/**
 * Builds a `ModuleHost` for a given module id. Each method routes through the
 * generic `product.modules` bridge (multiplexed IPC) or existing core
 * surfaces (inbox push, toasts), keeping modules decoupled from core wiring.
 */

import type { ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';
import type { HostEvents, ExtensionPermission, ProjectInfo } from '@zana-ai/zcc-extension-sdk/renderer';
import type { Project } from '@zana-ai/zcc-domain/product';
import { useData, useUi, usePersonas } from '../store.js';
import { getScopedProjectId } from '../lib/windowScope.js';
import { toSessionInfo } from './sessionInfo.js';
import { sanitizeExtraArgs } from '@zana-ai/zcc-domain/launch-sanitize';

/**
 * P3-B — renderer-side permission gate for DISK extensions.
 *
 * IMPORTANT (honest scope): this gate is **ADVISORY**, not authoritative. All
 * panels today share one `window.cc` and one IPC connection, so a malicious
 * panel can bypass `ModuleHost` and call `product.terminals.create` /
 * `product.openers.openIn` directly — the renderer cannot authenticate which
 * extension made a call. Authoritative renderer attribution (origin-based, per
 * sandboxed-iframe panel) is design §4 / a later "open the UI to strangers"
 * ticket (P3-C). Until then this gate:
 *   - stops a COOPERATIVE/curated disk ext from using a capability it didn't
 *     declare (catches honest mistakes, documents intent), and
 *   - sanitizes `launchSession` extraArgs against the denylist regardless (the
 *     sanitizer is shared with any future main-side gate).
 * The strong main-side gates in P3-B are brokered exec/fs/fetch caps on the
 * authenticated `utilityProcess` child path. Renderer calls that carry a
 * `moduleId` remain claims, not identity. Security-sensitive launches therefore
 * ride generic `terminals.create` and require a native main confirmation.
 *
 * Built-in modules (gus/zana) are NOT in the grant map → unrestricted (trusted
 * by provenance).
 */
interface ModuleGrant {
  permissions: ReadonlySet<ExtensionPermission>;
}
const extensionGrants = new Map<string, ModuleGrant>();

/**
 * Publish the disk-extension grant map (called from the extension loader on
 * each reconcile). A built-in module's id is deliberately absent → its host is
 * unrestricted. Keyed by id; the value is the declared permission set.
 */
export function setExtensionGrants(
  grants: Array<{ id: string; permissions: readonly string[] }>
): void {
  extensionGrants.clear();
  for (const g of grants) {
    extensionGrants.set(g.id, {
      permissions: new Set(g.permissions as ExtensionPermission[])
    });
  }
}

/**
 * Project → {@link ProjectInfo} projection handed across the extension boundary.
 * Carries only id/name/path plus a coarse `remote` marker (host alias + optional
 * user) so a picker can tell a remote SSH project from a local folder — never
 * core's full `Project`. The alias is a label, not a trust anchor: the SSH argv
 * is built host-side at launch.
 */
function toProjectInfo(p: Project): ProjectInfo {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    ...(p.remote ? { remote: { host: p.remote.host, user: p.remote.user } } : {})
  };
}

/** True if `moduleId` is a disk ext AND lacks `permission`. Built-ins never gated. */
function diskExtLacks(moduleId: string, permission: ExtensionPermission): boolean {
  const grant = extensionGrants.get(moduleId);
  if (!grant) return false; // not a disk ext (built-in) → unrestricted
  return !grant.permissions.has(permission);
}

/**
 * Shared guard for the two session-input capabilities (replyToSession +
 * writeToSession): advisory `session:reply` permission gate, type check, and
 * session-scope check (the id must be a session the shell knows about — incl.
 * headless ones — keyed by project in `terminals`). Returns false (and toasts
 * on a missing permission) when the write must not proceed.
 */
function sessionInputAllowed(moduleId: string, sessionId: unknown, data: unknown): boolean {
  if (diskExtLacks(moduleId, 'session:reply')) {
    useUi.getState().pushToast(`${moduleId}: missing "session:reply" permission`, 'error');
    return false;
  }
  if (typeof sessionId !== 'string' || typeof data !== 'string') return false;
  const terminals = useData.getState().terminals;
  return Object.values(terminals).some((list) => (list ?? []).some((s) => s.id === sessionId));
}

/**
 * Per-module in-memory scratch caches, held at MODULE scope (not inside
 * `createModuleHost`) so a module's cache survives BOTH panel unmount AND
 * host re-creation for the same id — `createModuleHost('gus')` called twice
 * returns hosts that share one cache. Evicted via {@link clearModuleCache},
 * which Phase 1's `evictHost(moduleId)` should call alongside dropping the host.
 */
const moduleCaches = new Map<string, Map<string, unknown>>();

function cacheFor(moduleId: string): Map<string, unknown> {
  let m = moduleCaches.get(moduleId);
  if (!m) {
    m = new Map<string, unknown>();
    moduleCaches.set(moduleId, m);
  }
  return m;
}

/**
 * Evict a module's in-memory `host.cache`. Call from `ModulePanelHost`'s
 * `evictHost(moduleId)` (Phase 1) so the cache lifecycle matches the host's —
 * a disabled/uninstalled extension shouldn't leave stale scratch data behind.
 * (Wiring the call lives in ModulePanelHost, owned by P2-C.)
 */
export function clearModuleCache(moduleId: string): void {
  moduleCaches.delete(moduleId);
  // W1-6: run every disposable the module's singleton host (background /
  // commands) registered, so a disabled/removed extension leaks no subscription.
  moduleScopes.get(moduleId)?.dispose();
  moduleScopes.delete(moduleId);
}

/**
 * W1-6 — auto-disposing cleanup registry. A `DisposeScope` is an idempotent bag
 * of teardown fns: `dispose()` runs each exactly once, and a disposable added
 * AFTER dispose runs immediately (a late subscribe never leaks). Every add is
 * wrapped in a ran-flag so the SAME disposable can't fire twice — that's the
 * double-free guard that makes `host.register(off)` safe to combine with the
 * author ALSO calling the returned unsubscribe (both resolve to one run).
 */
function safeRun(d: () => void): void {
  try {
    d();
  } catch {
    // A throwing disposable must not abort the rest of the sweep.
  }
}

class DisposeScope {
  private readonly items = new Set<() => void>();
  private disposed = false;

  /** Add a disposable; returns an idempotent runner that also drops it from the scope. */
  add(d: () => void): () => void {
    let ran = false;
    const once = () => {
      if (ran) return;
      ran = true;
      this.items.delete(once);
      safeRun(d);
    };
    if (this.disposed) {
      once();
      return once;
    }
    this.items.add(once);
    return once;
  }

  /** Track an unsubscribe fn: auto-run on dispose, but still callable by the author (once). */
  track(unsub: () => void): () => void {
    return this.add(unsub);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const all = [...this.items];
    this.items.clear();
    for (const once of all) once();
  }
}

/**
 * Per-module cleanup scope for the SINGLETON base host — disposables registered
 * from a `background` component (or `commands`) run when the extension is
 * disabled/removed (`evictHost` → {@link clearModuleCache}). Panels get their
 * OWN mount scope via {@link createMountScopedHost}, disposed on unmount.
 */
const moduleScopes = new Map<string, DisposeScope>();
function moduleScopeFor(moduleId: string): DisposeScope {
  let s = moduleScopes.get(moduleId);
  if (!s) {
    s = new DisposeScope();
    moduleScopes.set(moduleId, s);
  }
  return s;
}

/**
 * Monotonic id source for W1-5 host dialogs. Module-scoped so ids stay unique
 * across every host instance in the renderer (a dialog queued by one panel and
 * one queued by a main-command handler must never collide).
 */
let hostDialogSeq = 0;
function nextDialogId(): string {
  return `hd-${++hostDialogSeq}`;
}
/** Exposed so the App-side main-command handler mints ids from the same source. */
export function nextHostDialogId(): string {
  return nextDialogId();
}

/**
 * Wire one `host.on(event, cb)` subscription. Returns the unsubscribe fn for
 * exactly this subscription; multiple subscribers to the same event coexist
 * (each owns its own underlying stream/store subscription). Leak-safe: the
 * returned fn disposes everything this call set up.
 */
function subscribeHostEvent<E extends keyof HostEvents>(
  event: E,
  cb: (payload: HostEvents[E]) => void
): () => void {
  // A local cast helper: each branch builds the event's specific payload, and
  // we hand it to the (generically-typed) cb. The branch narrows E, so the
  // payload shape is checked against HostEvents[that key].
  const fire = cb as (payload: HostEvents[keyof HostEvents]) => void;

  switch (event) {
    case 'session:updated':
      return product.terminals.onUpdated((session) => {
        fire({ session: toSessionInfo(session) });
      });
    case 'session:agentStatus':
      return product.terminals.onAgentStatus((sessionId, state) => {
        // The SDK's public HostEvents union predates the internal `'waiting'`
        // AgentState (agent at rest awaiting model/delivery). It reads "at rest
        // alongside idle" everywhere in the renderer, so collapse it to `'idle'`
        // rather than widen the stable extension contract.
        fire({ sessionId, state: state === 'waiting' ? 'idle' : state });
      });
    case 'session:exit':
      return product.terminals.onExit((sessionId, code) => {
        fire({ sessionId, code });
      });
    case 'inbox:appended':
      return product.inbox.onAppended((entry) => {
        fire({ id: entry.id });
      });
    case 'inbox:removed':
      return product.inbox.onRemoved((id) => {
        fire({ id });
      });
    case 'schedule:changed':
      return product.scheduler.onChanged(() => fire({}));
    case 'mcp:changed':
      return product.mcp.onChanged(() => fire({}));
    case 'skills:changed':
      return product.skills.onChanged(() => fire({}));
    case 'project:changed': {
      // Derive from the shell's selected project. Subscribe to the whole UI
      // store (zustand v5 vanilla subscribe fires on every change) and diff the
      // selectedProjectId ourselves so we only fire on an actual project switch
      // — never the inline-selector-returning-a-fresh-object trap (that's a
      // React render hazard; this is a vanilla store subscription).
      let prevId = useUi.getState().selectedProjectId;
      const resolve = (id: string | null) => {
        if (!id) return null;
        const p = useData.getState().projects.find((proj) => proj.id === id);
        return p ? toProjectInfo(p) : null;
      };
      return useUi.subscribe((state) => {
        const id = state.selectedProjectId;
        if (id === prevId) return;
        prevId = id;
        fire({ project: resolve(id) });
      });
    }
    case 'nav:changed': {
      let prevNav = useUi.getState().nav;
      return useUi.subscribe((state) => {
        const nav = state.nav;
        if (nav === prevNav) return;
        prevNav = nav;
        fire({ nav });
      });
    }
    default:
      // Unknown event id — no stream to wire. Returning a no-op keeps the
      // contract (always returns an unsubscribe fn) without throwing.
      return () => {};
  }
}

/**
 * Per-subId fan-out for the `ctx.stream` push channels (SDK streaming
 * capability). Frames arrive core→renderer on ONE pair of IPC channels
 * (`modules:streamFrame` / `modules:streamDone`) keyed by the opaque subId; this
 * registry demultiplexes them to the panel handler(s) that subscribed to that
 * subId. The two underlying `product.modules.on*` listeners are attached LAZILY
 * on the first subscribe and detached when the last handler unsubscribes, so a
 * shell with no live stream holds no listener.
 */
interface StreamHandlers {
  onFrame: (frame: unknown) => void;
  onDone?: (reason: { ok: boolean; error?: string }) => void;
}
const streamSubs = new Map<string, Set<StreamHandlers>>();
let streamOffFrame: (() => void) | null = null;
let streamOffDone: (() => void) | null = null;

function detachStreamListenersIfIdle(): void {
  if (streamSubs.size > 0) return;
  streamOffFrame?.();
  streamOffDone?.();
  streamOffFrame = null;
  streamOffDone = null;
}

function ensureStreamListeners(): void {
  if (streamOffFrame) return; // already attached
  streamOffFrame = product.modules.onStreamFrame((subId, frame) => {
    const set = streamSubs.get(subId);
    if (!set) return;
    // Snapshot before firing: a handler may unsubscribe during dispatch.
    for (const h of [...set]) h.onFrame(frame);
  });
  streamOffDone = product.modules.onStreamDone((subId, reason) => {
    const set = streamSubs.get(subId);
    if (!set) return;
    // Terminal: fire onDone, then drop every handler for this subId — no more
    // frames will arrive, so the subscription is spent.
    for (const h of [...set]) h.onDone?.(reason);
    streamSubs.delete(subId);
    detachStreamListenersIfIdle();
  });
}

/** Register a per-subId frame/done handler; returns the unsubscribe fn. */
function subscribeStream(
  subId: string,
  onFrame: (frame: unknown) => void,
  onDone?: (reason: { ok: boolean; error?: string }) => void
): () => void {
  ensureStreamListeners();
  const handlers: StreamHandlers = { onFrame, onDone };
  let set = streamSubs.get(subId);
  if (!set) {
    set = new Set<StreamHandlers>();
    streamSubs.set(subId, set);
  }
  set.add(handlers);
  return () => {
    const s = streamSubs.get(subId);
    if (!s) return;
    s.delete(handlers);
    if (s.size === 0) streamSubs.delete(subId);
    detachStreamListenersIfIdle();
  };
}

/**
 * Build a host for `moduleId`. `scope` is the cleanup scope its `on` /
 * `subscribe` / `register` auto-register into (W1-6): the singleton base host
 * uses the module scope (disposed on disable/remove), while a mounted panel gets
 * a per-mount scope via {@link createMountScopedHost} (disposed on unmount).
 */
export function createModuleHost(
  moduleId: string,
  scope: DisposeScope = moduleScopeFor(moduleId)
): ModuleHost {
  return {
    moduleId,
    call: <T = unknown>(capability: string, ...args: unknown[]) =>
      product.modules.call(moduleId, capability, args) as Promise<T>,
    storage: {
      get: <T = unknown>(key: string) =>
        product.modules.storageGet(moduleId, key) as Promise<T | undefined>,
      set: (key: string, value: unknown) => product.modules.storageSet(moduleId, key, value)
    },
    openExternal: (url: string) => {
      // Gate: external:open (advisory) + scheme allowlist (http/https only).
      if (diskExtLacks(moduleId, 'external:open')) {
        useUi.getState().pushToast(`${moduleId}: missing "external:open" permission`, 'error');
        return;
      }
      let scheme: string;
      try {
        scheme = new URL(url).protocol;
      } catch {
        useUi.getState().pushToast(`${moduleId}: invalid URL`, 'error');
        return;
      }
      if (scheme !== 'http:' && scheme !== 'https:') {
        useUi.getState().pushToast(`${moduleId}: only http(s) URLs may be opened`, 'error');
        return;
      }
      void product.openers.openIn('browser', url);
    },
    pushInbox: async (msg) => {
      // Gate: inbox:push. (Main-side pushInbox also receives moduleId and can
      // gate authoritatively against the claimed id — see index.ts.)
      if (diskExtLacks(moduleId, 'inbox:push')) {
        throw new Error(`PermissionDenied: ${moduleId} lacks "inbox:push"`);
      }
      // Default to the shell's active project, mirroring getActiveProject().
      const projectId = msg.projectId ?? useUi.getState().selectedProjectId;
      if (!projectId) {
        throw new Error('pushInbox: no projectId and no active project');
      }
      return product.modules.pushInbox(moduleId, { ...msg, projectId });
    },
    toast: (message: string, kind?: 'info' | 'error') => {
      useUi.getState().pushToast(message, kind);
    },
    relaunchSelf: async () => {
      // Scoped to the caller — an extension can only relaunch ITSELF (main keys
      // the respawn off this `moduleId`, not a renderer-supplied one). A built-in
      // has no separate child, so main returns ok:false → false here.
      try {
        const res = await product.extensions.relaunch(moduleId);
        return res.ok ? res.value : false;
      } catch {
        return false;
      }
    },
    getActiveProject: () => {
      const id = useUi.getState().selectedProjectId;
      if (!id) return null;
      const p = useData.getState().projects.find((p) => p.id === id);
      return p ? toProjectInfo(p) : null;
    },
    getScopedProjectId: () => getScopedProjectId(),
    listProjects: () => useData.getState().projects.map(toProjectInfo),
    listPersonas: () =>
      usePersonas.getState().personas.map((p) => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        description: p.description
      })),
    ensureQuickAgent: async () => {
      // Bridge to the same core IPC the Settings Doctor uses — main creates +
      // registers the scratch project (~/.zcc-workspace) if it's missing, so this
      // is the always-available launchSession anchor even on an empty shell.
      //
      // ensureQuickAgent does NOT broadcast projects:onChanged, so the renderer's
      // projects list wouldn't otherwise learn about a freshly-created scratch
      // project. Reload it here so a caller can immediately launchSession() into
      // the returned id — its project-scope guard (`projects.some`) reads
      // useData's list and would reject an id the renderer hasn't seen yet.
      try {
        const res = await product.projects.ensureQuickAgent();
        if (!res.ok) {
          useUi.getState().pushToast(`${moduleId}: ${res.message}`, 'error');
          return null;
        }
        await useData.getState().loadProjects();
        return toProjectInfo(res.value);
      } catch (e) {
        useUi
          .getState()
          .pushToast(`${moduleId}: ${e instanceof Error ? e.message : String(e)}`, 'error');
        return null;
      }
    },
    selectProject: (projectId: string | null) => {
      useUi.getState().selectProject(projectId);
    },
    launchSession: async ({ projectId, personaId, extraArgs, title, cwd }) => {
      // Gate: session:launch (advisory) + sanitize extraArgs against the denylist
      // (--dangerously-skip-permissions, --mcp-config, …) so a disk ext can't
      // launch an auto-approving / hijacked agent in the user's repo (design §1c).
      if (diskExtLacks(moduleId, 'session:launch')) {
        useUi.getState().pushToast(`${moduleId}: missing "session:launch" permission`, 'error');
        return null;
      }
      // Project-scope: only launch into a project the shell actually knows.
      const known = useData.getState().projects.some((p) => p.id === projectId);
      if (!known) return null;
      // ALWAYS sanitize extraArgs against the denylist — for EVERY module, not
      // just disk exts. The gate is "this module's input may be untrusted", which
      // is true of any module: a compiled-in module can take remotely influenced
      // input via `launchSession`, so its launch path is attacker-influenced just
      // like a disk plugin's. No module — compiled-in or disk — has a legitimate reason to inject --dangerously-skip-permissions
      // / --mcp-config / --permission-mode / --add-dir etc. via launchSession, and
      // the denylist only strips those known-dangerous FLAGS (not prompt/positional
      // args), so a real `run <prompt>` launch is unaffected. Gating on
      // disk-ext provenance let remotely-controlled built-ins bypass the guard.
      // NOTE: MAIN (createTerminalConfined) is now the authoritative enforcer of this denylist for EVERY entry point (IPC + zcc control plane); this renderer pass is advisory and exists only for the per-flag toast above.
      const { args: safeArgs, removed } = sanitizeExtraArgs(extraArgs);
      if (removed.length > 0) {
        useUi
          .getState()
          .pushToast(`${moduleId}: blocked unsafe launch flags: ${removed.join(', ')}`, 'error');
      }
      // A persona's baseProfile (if it declares one) becomes the base profile;
      // otherwise launch the bare `claude` profile as before. Core re-resolves
      // the persona's full flag layer from personaId at create time (single
      // source of truth in pty.ts) — the extension only names it.
      const persona = personaId
        ? usePersonas.getState().personas.find((p) => p.id === personaId)
        : undefined;
      const baseProfile = persona?.baseProfile ?? 'claude';
      // Mirror CommandPalette.launch: spawn a tab, then bring the shell
      // to it (nav → projects, select the project + new tab, show terminals).
      // Shared renderer origin cannot authenticate module identity. Use the one
      // generic renderer launch seam; main presents native confirmation and
      // treats this as interactive renderer intent, never extension attribution.
      const launched = await product.terminals.create({
        projectId,
        profile: baseProfile,
        cols: 80,
        rows: 24,
        personaId: persona?.id,
        extraArgs: safeArgs,
        title,
        cwd
      });
      if (!launched.ok) {
        useUi.getState().pushToast(`${moduleId}: ${launched.message}`, 'error');
        return null;
      }
      const session = launched.value;
      const ui = useUi.getState();
      ui.enterProjectFocus(projectId);
      ui.selectTab(projectId, session.id);
      ui.setWorkspaceMode(projectId, 'terminals');
      return { id: session.id };
    },
    replyToSession: async (sessionId: string, text: string) => {
      // Submits a LINE: writes text, core appends Enter. For control keys that
      // must not submit, use writeToSession (no Enter).
      if (!sessionInputAllowed(moduleId, sessionId, text)) return false;
      try {
        await product.terminals.reply(sessionId, text);
        return true;
      } catch {
        return false;
      }
    },
    writeToSession: async (sessionId: string, data: string) => {
      // Raw write, NO trailing Enter (Esc, Ctrl-C, …). Same gate + scope.
      if (!sessionInputAllowed(moduleId, sessionId, data)) return false;
      try {
        await product.terminals.write(sessionId, data);
        return true;
      } catch {
        return false;
      }
    },
    on: (event: any, cb: any) => {
      // W1-3: if event starts with `ext:`, treat it as an extension-emitted topic
      // and subscribe via the stream mechanism (topic namespaced to `ext:<moduleId>:<topic>`).
      // W1-6: the unsubscribe is auto-registered into this host's scope, so a
      // panel that forgets to unwire on unmount does not leak — and the returned
      // fn is the SAME idempotent runner, so calling it AND the scope disposing
      // does not double-free.
      if (typeof event === 'string' && event.startsWith('ext:')) {
        const topic = event.slice(4); // Strip "ext:" prefix
        const namespacedTopic = `ext:${moduleId}:${topic}`;
        // Subscribe to frames on the namespaced topic. The main side sends frames
        // via the sink (broker-caps.ts emit → streamSink → IPC.modules.streamFrame).
        return scope.track(subscribeStream(namespacedTopic, cb));
      }
      // Otherwise, core HostEvents — delegate to the existing switch-based handler.
      return scope.track(subscribeHostEvent(event, cb));
    },
    subscribe: (
      subId: string,
      onFrame: (frame: unknown) => void,
      onDone?: (reason: { ok: boolean; error?: string }) => void
    ) => scope.track(subscribeStream(subId, onFrame, onDone)),
    register: (disposable: () => void) => {
      scope.add(disposable);
    },
    cache: {
      get: <T = unknown>(key: string) => cacheFor(moduleId).get(key) as T | undefined,
      set: (key: string, value: unknown) => {
        cacheFor(moduleId).set(key, value);
      },
      delete: (key: string) => {
        cacheFor(moduleId).delete(key);
      },
      refreshBadge: () => {
        useUi.getState().refreshModuleBadges();
      }
    },
    // ---- W1-5 host UX primitives ------------------------------------------
    // Each enqueues a host-rendered dialog into the shared `hostDialogs` queue
    // (drawn by <HostDialogs/>) and returns a Promise the queue resolves with
    // the user's answer. No permission token (pure UI). Dismiss resolves the
    // "no answer" value (false/null) — never rejects.
    confirm: (opts) =>
      new Promise<boolean>((resolve) => {
        useUi.getState().pushHostDialog({
          id: nextDialogId(),
          moduleId,
          kind: 'confirm',
          opts: {
            title: String(opts.title ?? ''),
            body: opts.body,
            confirmLabel: opts.confirmLabel,
            cancelLabel: opts.cancelLabel,
            danger: opts.danger
          },
          resolve
        });
      }),
    prompt: (opts) =>
      new Promise<string | null>((resolve) => {
        useUi.getState().pushHostDialog({
          id: nextDialogId(),
          moduleId,
          kind: 'prompt',
          opts: {
            title: String(opts.title ?? ''),
            label: opts.label,
            hint: opts.hint,
            placeholder: opts.placeholder,
            initialValue: opts.initialValue,
            confirmLabel: opts.confirmLabel
          },
          resolve
        });
      }),
    quickPick: <T = unknown>(
      items: Array<{ label: string; description?: string; value: T }>,
      opts?: { title?: string; placeholder?: string }
    ) =>
      new Promise<T | null>((resolve) => {
        // Strip the (arbitrary, possibly non-serialisable) `value` out of the
        // queued entry — the queue only needs label/description to render and an
        // index to map back. Resolve with the original value by index.
        const safeItems = items.map((it, index) => ({
          label: String(it.label ?? ''),
          description: it.description,
          index
        }));
        useUi.getState().pushHostDialog({
          id: nextDialogId(),
          moduleId,
          kind: 'quickPick',
          opts: { title: opts?.title, placeholder: opts?.placeholder },
          items: safeItems,
          resolve: (index) => resolve(index == null ? null : (items[index]?.value ?? null))
        });
      }),
    alert: (opts) =>
      new Promise<string | null>((resolve) => {
        useUi.getState().pushHostDialog({
          id: nextDialogId(),
          moduleId,
          kind: 'alert',
          opts: {
            title: String(opts.title ?? ''),
            body: opts.body,
            kind: opts.kind === 'error' ? 'error' : 'info',
            actions: opts.actions?.map((a) => ({ id: String(a.id), label: String(a.label) }))
          },
          resolve
        });
      }),
    withProgress: async <T>(
      task: (signal: AbortSignal) => Promise<T>,
      opts: { title: string; cancellable?: boolean }
    ): Promise<T> => {
      const controller = new AbortController();
      const id = nextDialogId();
      useUi.getState().pushHostDialog({
        id,
        moduleId,
        kind: 'progress',
        opts: { title: String(opts.title ?? ''), cancellable: !!opts.cancellable },
        abort: () => controller.abort(),
        resolve: () => {}
      });
      try {
        return await task(controller.signal);
      } finally {
        // Tear down the affordance whether the task resolved, rejected, or was
        // cancelled. settleHostDialog is a no-op if the entry already went.
        useUi.getState().settleHostDialog(id, undefined);
      }
    }
  };
}

/**
 * W1-6 — wrap a cached base host in a per-MOUNT cleanup scope. The returned host
 * delegates EVERYTHING to `base` (call/storage/cache/UX/…) EXCEPT `on` /
 * `subscribe` / `register`, which auto-register into a fresh {@link DisposeScope}
 * this call owns; running the returned `dispose()` (on panel unmount) tears down
 * every subscription that panel made — so a panel that forgets to unwire never
 * leaks across remounts. Delegates via `Object.create` so any host method not
 * overridden here (incl. ones added later) keeps working and `this`-bound base
 * methods still see the base.
 *
 * The base host's OWN scope (module scope) is untouched — `background`/`commands`
 * disposables still live for the extension's lifetime; only per-panel work is
 * scoped to the mount.
 */
export function createMountScopedHost(base: ModuleHost): { host: ModuleHost; dispose: () => void } {
  const scope = new DisposeScope();
  const host = Object.assign(Object.create(base) as ModuleHost, {
    on: (event: any, cb: any) => scope.track((base.on as any)(event, cb)),
    subscribe: (
      subId: string,
      onFrame: (frame: unknown) => void,
      onDone?: (reason: { ok: boolean; error?: string }) => void
    ) => scope.track(base.subscribe(subId, onFrame, onDone)),
    register: (disposable: () => void) => {
      scope.add(disposable);
    }
  });
  return { host, dispose: () => scope.dispose() };
}
