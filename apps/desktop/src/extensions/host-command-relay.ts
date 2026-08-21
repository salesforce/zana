/**
 * Host-command relay (W1-4, trust inversion) — the MAIN-side backing for the
 * `ctx.host.*` capabilities a MAIN module uses to ask the SHELL to perform a
 * renderer-only action it structurally can't do itself (toast, navigate, select
 * a project, launch a session).
 *
 * Two delivery shapes, deliberately different in durability:
 *
 *  - **Ephemeral nudges** (`toast` / `navigate` / `selectProject`) are pushed
 *    straight core→renderer over the `IPC.modules.hostCommand` channel. If no
 *    panel is mounted to receive one it's dropped — acceptable, they're advisory
 *    UI on the extension's own behalf.
 *
 *  - **`requestLaunch` is DURABLE.** A launch is security-sensitive and must not
 *    be silently lost if the renderer isn't currently listening (the orchestrator's
 *    fail-closed fold-in). So a disk-tier request is ENQUEUED into a bounded
 *    per-module FIFO here in main and a content-free nudge is pushed; the renderer
 *    DRAINS the queue (pull IPC) both on mount and on each nudge. A launch parked
 *    while no panel was attached is therefore delivered on the next attach — never
 *    dropped. Main NEVER spawns a session itself (Rule 1): the renderer's
 *    `launchSession` path re-gates `session:launch`, sanitizes flags, and confines
 *    projectId/cwd/persona via `createTerminalConfined` — the extension's spec is
 *    strictly ADVISORY.
 *
 * Park-by-default is enforced HERE, not by the extension: a disk-tier module is
 * ALWAYS parked and any extension-supplied `autoLaunch` is ignored (downgraded to
 * park). Only a BUILT-IN (trusted-tier) module may issue an immediate `launch`
 * command — and even then the pty authorization still happens renderer→main, so
 * "bypass" means "no human confirm", never "no authorization".
 *
 * Bounded (Rule 5): at most {@link HOST_LAUNCH_QUEUE_CAP} parked launches per
 * module (drop-oldest). Cleared per module on child exit (Rule 3), piggybacking
 * the same teardown hook the stream relay uses.
 */

/** Max parked launches held per module before the oldest is dropped (Rule 5). */
export const HOST_LAUNCH_QUEUE_CAP = 50;

/**
 * A launch an extension PROPOSES via `ctx.host.requestLaunch`. Every field is
 * advisory — main re-authorizes projectId/cwd/persona at spawn time (Rule 1/2).
 * Mirrors the renderer SDK's `launchSession` options plus an opening `prompt`.
 */
export interface HostLaunchSpec {
  /** Project to launch in (re-confined against the known project set in main). */
  projectId: string;
  /** Persona to launch as (resolved to its flag layer host-side). */
  personaId?: string;
  /** Extra CLI flags (sanitized against the launch denylist before use). */
  extraArgs?: string[];
  /** Tab title. */
  title?: string;
  /** Working dir hint (re-confined). */
  cwd?: string;
  /** Opening prompt to inject once the session is live. */
  prompt?: string;
  /** Human-readable label for the confirm affordance (e.g. what fired this). */
  label?: string;
  /**
   * ADVISORY request to skip the human confirm. IGNORED for a disk-tier module
   * (always downgraded to park) — the extension cannot set a field that bypasses
   * the human. Honored only for a built-in/trusted-tier module.
   */
  autoLaunch?: boolean;
}

/** A launch parked awaiting the renderer to pick it up + confirm it. */
export interface ParkedLaunch {
  /** Correlation id returned to the requesting extension. */
  requestId: string;
  /** The AUTHENTICATED module that requested it (never self-declared). */
  moduleId: string;
  /** The advisory launch spec. */
  spec: HostLaunchSpec;
  /** ISO time it was parked (for display in the confirm surface). */
  parkedAt: string;
}

/** The command kinds pushed core→renderer over `IPC.modules.hostCommand`. */
export type HostCommandKind =
  | 'toast'
  | 'navigate'
  | 'selectProject'
  | 'launch'
  | 'launchParked'
  // W1-5 main-reachable host UX: a headless main module asks the shell to render
  // a confirm/alert and reply the human's answer back over the dialog-reply IPC.
  | 'confirm'
  | 'alert';

/** Max in-flight main-reachable dialogs held per module before the oldest fails closed (Rule 5). */
export const HOST_DIALOG_QUEUE_CAP = 50;

/** Main-side mirror of the renderer `ConfirmOptions` (W1-5) — plain data pushed to the shell. */
export interface HostConfirmSpec {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Main-side mirror of the renderer `NotifyOptions` (W1-5). */
export interface HostNotifySpec {
  title: string;
  body?: string;
  kind?: 'info' | 'error';
  actions?: Array<{ id: string; label: string }>;
}

/** One command pushed to the renderer. `moduleId` is the authenticated id. */
export interface HostCommand {
  moduleId: string;
  kind: HostCommandKind;
  payload: unknown;
}

/** Result of a `requestLaunch` — the child learns whether it was parked. */
export interface RequestLaunchResult {
  /** True when queued for human confirm; false when issued immediately (built-in). */
  parked: boolean;
  /** Correlation id (matches the pushed command / parked entry). */
  requestId: string;
}

export interface HostCommandRelayOpts {
  /** Push a command core→renderer (backed by `safeSend(IPC.modules.hostCommand)`). */
  send: (cmd: HostCommand) => void;
  /** Whether a module id is a trusted built-in (may issue an immediate launch). */
  isBuiltin: (moduleId: string) => boolean;
  /** Mint a correlation id (injected so the relay is unit-testable — index passes randomUUID). */
  genId: () => string;
  /** Current ISO time (injected for deterministic tests; index passes a Date thunk). */
  now?: () => string;
  /** Per-module park cap (default {@link HOST_LAUNCH_QUEUE_CAP}). */
  maxPerModule?: number;
  /**
   * W1-5: can a main-reachable dialog (`confirm`/`alert`) actually reach a
   * renderer right now? Injected so the relay stays testable; index passes
   * "is there ≥1 live window". When false, {@link HostCommandRelay.confirm} /
   * {@link HostCommandRelay.alert} resolve the "no answer" value IMMEDIATELY
   * (fail-closed: an unanswerable confirm is a `false`, never a hung Promise).
   * Absent → assumed deliverable (test hosts drive the reply directly).
   */
  canDeliverDialog?: () => boolean;
  /** Native main-process confirm. Renderer code cannot forge its answer. */
  showConfirm?: (moduleId: string, spec: HostConfirmSpec) => Promise<boolean>;
}

/**
 * Owns the ephemeral push + the durable per-module parked-launch queue. One
 * instance, constructed once at app init and cleared per module on child exit
 * (Rule 3).
 */
export class HostCommandRelay {
  private readonly parked = new Map<string, ParkedLaunch[]>();
  /** Monotonic counter → stable FIFO ordering on drain without relying on wall-clock. */
  private order = 0;
  private readonly orderOf = new WeakMap<ParkedLaunch, number>();

  /**
   * W1-5 main-reachable dialogs (`confirm`/`alert`) awaiting the human's answer.
   * Keyed by requestId → the resolver of the child's pending Promise, plus the
   * owning moduleId (so a dead child's dialogs can be failed-closed). Bounded
   * per module (Rule 5): a flood of unanswered dialogs can't grow unbounded — the
   * oldest is failed-closed (resolved to the "no answer" value) past the cap.
   */
  private readonly dialogs = new Map<
    string,
    { moduleId: string; resolve: (answer: unknown) => void; seq: number; failClosed: unknown }
  >();
  private dialogSeq = 0;

  constructor(private readonly opts: HostCommandRelayOpts) {}

  private get cap(): number {
    return this.opts.maxPerModule ?? HOST_LAUNCH_QUEUE_CAP;
  }

  /** Fire a toast in the shell (unconditional — advisory UI). */
  toast(moduleId: string, message: string, kind?: 'info' | 'error'): void {
    if (typeof message !== 'string' || !message) return;
    this.opts.send({ moduleId, kind: 'toast', payload: { message, kind: kind === 'error' ? 'error' : 'info' } });
  }

  /** Ask the shell to navigate to a top-level surface (unconditional — advisory UI). */
  navigate(moduleId: string, target: string): void {
    if (typeof target !== 'string' || !target) return;
    this.opts.send({ moduleId, kind: 'navigate', payload: { target } });
  }

  /**
   * Ask the shell to select a project (gated by `projects:select` at the caps
   * layer BEFORE this is reached). Advisory push — the renderer re-checks the id
   * against its known project set.
   */
  selectProject(moduleId: string, projectId: string | null): void {
    this.opts.send({ moduleId, kind: 'selectProject', payload: { projectId: projectId ?? null } });
  }

  /**
   * Request a session launch (gated by `session:launch` at the caps layer). A
   * disk-tier module is ALWAYS parked (autoLaunch ignored); a built-in may issue
   * an immediate launch. Either way main never spawns — the command is delivered
   * to the renderer, which authorizes + spawns via the confined launch path.
   */
  requestLaunch(moduleId: string, spec: HostLaunchSpec): RequestLaunchResult {
    const requestId = this.opts.genId();
    // Park-by-default: only a trusted built-in may skip the human confirm, and
    // only decided HERE off the authenticated id — never off an ext-supplied flag.
    const immediate = this.opts.isBuiltin(moduleId) && spec?.autoLaunch === true;
    if (immediate) {
      this.opts.send({ moduleId, kind: 'launch', payload: { requestId, spec } });
      return { parked: false, requestId };
    }
    const entry: ParkedLaunch = {
      requestId,
      moduleId,
      spec,
      parkedAt: (this.opts.now ?? (() => new Date().toISOString()))()
    };
    this.orderOf.set(entry, ++this.order);
    const q = this.parked.get(moduleId) ?? [];
    q.push(entry);
    // Bounded: drop-oldest past the cap (Rule 5). A flood can't grow unbounded.
    while (q.length > this.cap) q.shift();
    this.parked.set(moduleId, q);
    // Nudge a listening renderer to drain promptly; a renderer that isn't mounted
    // drains this same queue on its next attach, so the launch is never dropped.
    this.opts.send({ moduleId, kind: 'launchParked', payload: { requestId } });
    return { parked: true, requestId };
  }

  /**
   * W1-5 main-reachable `ctx.host.confirm`. Push a confirm to the shell and
   * resolve the human's yes/no back. Fails closed to `false` when no renderer is
   * listening (an unanswerable confirm is a "no", never a hang) — so a headless
   * watcher's destructive-action gate degrades safe on a windowless host.
   */
  confirm(moduleId: string, spec: HostConfirmSpec): Promise<boolean> {
    if (this.opts.showConfirm) return this.opts.showConfirm(moduleId, spec);
    return this.dialog<boolean>(moduleId, 'confirm', { spec }, false);
  }

  /**
   * W1-5 main-reachable `ctx.host.alert`. Push a rich notification to the shell
   * and resolve the picked action's id (or `null` on dismiss / no listener).
   */
  alert(moduleId: string, spec: HostNotifySpec): Promise<string | null> {
    return this.dialog<string | null>(moduleId, 'alert', { spec }, null);
  }

  /**
   * Resolve a pending main-reachable dialog with the renderer-reported answer.
   * Called from the dialog-reply IPC handler. No-op for an unknown/already-settled
   * requestId (double-answer / late-reply guard).
   */
  resolveDialog(requestId: string, answer: unknown): void {
    const entry = this.dialogs.get(requestId);
    if (!entry) return;
    this.dialogs.delete(requestId);
    entry.resolve(answer);
  }

  /** Shared confirm/alert machinery: park a resolver, push, or fail closed. */
  private dialog<T>(
    moduleId: string,
    kind: 'confirm' | 'alert',
    payloadExtra: Record<string, unknown>,
    failClosedValue: T
  ): Promise<T> {
    // Fail closed when we structurally can't deliver to a human right now.
    if (this.opts.canDeliverDialog && !this.opts.canDeliverDialog()) {
      return Promise.resolve(failClosedValue);
    }
    const requestId = this.opts.genId();
    return new Promise<T>((resolve) => {
      this.dialogs.set(requestId, {
        moduleId,
        resolve: resolve as (answer: unknown) => void,
        seq: ++this.dialogSeq,
        failClosed: failClosedValue
      });
      // Bounded per module (Rule 5): past the cap, fail-close the OLDEST of this
      // module's in-flight dialogs so a flood can't grow the map unbounded.
      this.enforceDialogCap(moduleId);
      this.opts.send({ moduleId, kind, payload: { requestId, ...payloadExtra } });
    });
  }

  /** Drop-oldest per-module cap for in-flight dialogs (fails the evicted one closed). */
  private enforceDialogCap(moduleId: string): void {
    const mine = [...this.dialogs.entries()]
      .filter(([, v]) => v.moduleId === moduleId)
      .sort((a, b) => a[1].seq - b[1].seq);
    while (mine.length > this.cap) {
      const [oldestId, entry] = mine.shift()!;
      // Resolve the evicted dialog with ITS OWN declared fail-closed value (a
      // confirm→false, an alert→null), not the incoming one's.
      this.dialogs.delete(oldestId);
      entry.resolve(entry.failClosed);
    }
  }

  /**
   * Return + CLEAR every parked launch across all modules, oldest first. The
   * renderer's pull IPC drives this on mount + on each `launchParked` nudge;
   * draining removes them so a later drain doesn't re-deliver.
   */
  drainParked(): ParkedLaunch[] {
    const all: ParkedLaunch[] = [];
    for (const q of this.parked.values()) all.push(...q);
    this.parked.clear();
    return all.sort((a, b) => (this.orderOf.get(a) ?? 0) - (this.orderOf.get(b) ?? 0));
  }

  /**
   * Drop a dead module's parked launches AND fail-close its in-flight dialogs
   * (Rule 3 — called on child exit). A crashed child's awaited confirm/alert
   * Promise is already rejected by the process host, but we must still drop the
   * relay's resolver so it doesn't leak (and never resolve a zombie).
   */
  closeForModule(moduleId: string): void {
    this.parked.delete(moduleId);
    for (const [id, entry] of [...this.dialogs.entries()]) {
      if (entry.moduleId === moduleId) {
        this.dialogs.delete(id);
        entry.resolve(entry.failClosed);
      }
    }
  }
}
