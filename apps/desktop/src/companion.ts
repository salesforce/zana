import { BrowserWindow, screen, type Display, type WebContents } from 'electron';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { DEFAULT_RENDERER_ZOOM_FACTOR } from './window/window-zoom.js';
import { rendererUrl } from './window/renderer-url.js';
import { isRepliable } from './menu.js';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { SchedulerManager } from '@zana-ai/zcc-server/services/scheduler/scheduler';
import type { AgentStatusTracker } from '@zana-ai/zcc-server/services/agents/agent-status';
import type { IInboxStore } from '@zana-ai/zcc-server/services/inbox/inbox-store';
import type { MenubarThreadAgent } from '@zana-ai/zcc-domain';
import {
  inboxQuestions,
  type AgentState,
  type CompanionAgent,
  type CompanionAnswerResult,
  type CompanionEdge,
  type CompanionOpenTarget,
  type CompanionPanelKind,
  type CompanionPanelState,
  type CompanionPlacement,
  type CompanionRequest,
  type CompanionSchedule,
  type CompanionSnapshot,
  type CompanionTooltip,
  type CompanionTooltipView,
  type IdleTriageResult,
  type InboxEntry,
  type TerminalSession
} from '@zana-ai/zcc-domain/product';

/**
 * Command Center companion — the compact "remote control" for Zana. "Minimize
 * to Command Center" hides the main window(s) and shows a slim floating rail on
 * a screen edge instead of a Dock tile; clicking a rail icon opens ONE quick
 * panel beside it (Needs You / Agents / Scheduler / Status).
 *
 * Frameless, transparent, always-on-top `panel` windows (NSPanel on macOS:
 * float over full-screen apps, every Space, never activate the app on click):
 *  - the RAIL — fixed ~52px column, shown inactive so it never steals focus;
 *  - the PANEL — fixed-size transparent window beside the rail; the card inside
 *    hugs the rail side and sizes itself, so the window never resizes (no
 *    flicker). Agents hover previews this same card without focus or input;
 *    clicking pins it. A pinned card closes on backdrop click, Esc, or blur;
 *  - the TOOLTIP — tiny click-through window beside a hovered rail icon (the
 *    rail window is only as wide as the rail, so it can't draw one itself).
 *
 * Every snapshot is built HERE from main's own pty / agent-state / inbox /
 * scheduler singletons plus the product server's Modern-thread feed, and every action the renderer fires is re-authorized
 * against that state (Rule 1). Subscriptions are wired once in `start()` and
 * released in `stop()` (Rule 3); the inbox cache is bounded (Rule 5).
 */
export interface CompanionDeps {
  ptys: PtyManager;
  scheduler: SchedulerManager;
  agentStatus: AgentStatusTracker;
  inboxStore: IInboxStore;
  projectName: (projectId: string) => string;
  projectColor: (projectId: string) => string | undefined;
  /** Cached idle-triage verdict (what a blocked agent is waiting for), or null. */
  triage: (sessionId: string) => IdleTriageResult | null;
  /** Live Modern (conversation) threads — the same feed the menu-bar popover reads. */
  listThreads?: () => Promise<MenubarThreadAgent[]>;
  onThreadsChanged?: (listener: () => void) => () => void;
  /** Bring the main window forward on a Modern thread. */
  openThread?: (threadId: string, projectId: string) => void;
  theme: () => 'dark' | 'light';
  /** `companionEnabled` config flag (opt-in). */
  isEnabled: () => boolean;
  getPlacement: () => CompanionPlacement | undefined;
  savePlacement: (placement: CompanionPlacement) => void;
  /** Live app windows to hide on enter (never the companion's own). */
  mainWindows: () => BrowserWindow[];
  /** Bring the full-shell window forward (recreating it if needed). */
  showMainWindow: () => void;
  /** Re-show the app windows `enter()` put away (scoped project / plugin windows too). */
  restoreWindows: (wins: BrowserWindow[]) => void;
  /** Send a navigation event to the app windows (`safeSend`). */
  sendToApp: (channel: string, ...args: unknown[]) => void;
  preloadPath: string;
  logger?: (context: string, err: unknown) => void;
  /** Injected clock (tests). */
  now?: () => number;
}

/** Visible rail column. */
export const RAIL_WIDTH = 52;
// Natural CSS height: five 38px buttons, five 4px gaps, a 9px divider,
// 16px padding and 2px border. Native bounds use the shell's shared zoom.
export const RAIL_HEIGHT = Math.ceil(237 * DEFAULT_RENDERER_ZOOM_FACTOR);
/** Transparent pad around the rail so its CSS shadow isn't clipped. */
export const RAIL_PAD = 10;
/** Gap between the rail and the screen edge. */
export const EDGE_MARGIN = 10;
/** Panel window: wide enough for the expanded question card (≤ 480px). */
export const PANEL_WIDTH = 500;
export const PANEL_MAX_HEIGHT = 620;
/** Gap between the rail and the panel card. */
const PANEL_GAP = 8;
/** Inbox questions older than this drop off Needs You (matches the pinned band). */
export const REQUEST_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/**
 * Cap on question entries held in memory (Rule 5). The snapshot ships all of
 * them (plus one row per blocked live agent): the answered set lives in the
 * renderer, so capping here would let answered questions crowd out pending ones.
 */
export const INBOX_CACHE_MAX = 50;
/** Scan a larger inbox tail because most entries are not questions. */
export const INBOX_SEED_READ_LIMIT = 200;
const PUSH_DEBOUNCE_MS = 120;
/** A working → idle/done edge within this window counts as "recently completed". */
export const RECENT_DONE_MS = 10 * 60 * 1000;
/** Answers are bounded so the write path can't be flooded. */
export const ANSWER_MAX_CHARS = 4000;
const SCHEDULES_MAX = 30;
/** Tooltip window — sized per hover; the pill inside hugs the rail side. */
export const TOOLTIP_WIDTH = 260;
export const TOOLTIP_HEIGHT = 56;
/** Modern threads held for the snapshot (Rule 5). */
export const THREADS_MAX = 100;
const TOOLTIP_GAP = 6;
const TOOLTIP_LABEL_MAX = 60;
const TOOLTIP_DETAIL_MAX = 120;
/** A drag whose pointerup never arrives (renderer crash) self-ends (Rule 5). */
const DRAG_MAX_MS = 60_000;

const AGENT_RANK: Record<string, number> = { blocked: 0, waiting: 1, working: 2, done: 3, idle: 4, unknown: 5 };

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ----- pure placement math (exported for tests) --------------------------------

/**
 * Visible rail rect for a placement inside a work area: hugging the chosen edge,
 * `offsetY` below the work-area top (default: slightly above centre), clamped so
 * the rail never leaves the screen.
 */
export function railRect(work: Rect, placement: CompanionPlacement | undefined): Rect {
  const edge = placement?.edge ?? 'right';
  const x = edge === 'right'
    ? work.x + work.width - EDGE_MARGIN - RAIL_WIDTH
    : work.x + EDGE_MARGIN;
  const defaultOffset = Math.round((work.height - RAIL_HEIGHT) * 0.42);
  const offset = placement?.offsetY ?? defaultOffset;
  const y = clamp(work.y + offset, work.y + EDGE_MARGIN, work.y + work.height - RAIL_HEIGHT - EDGE_MARGIN);
  return { x, y, width: RAIL_WIDTH, height: RAIL_HEIGHT };
}

/** The rail WINDOW bounds (visible rect + shadow pad). */
export function railWindowBounds(rail: Rect): Rect {
  return {
    x: rail.x - RAIL_PAD,
    y: rail.y - RAIL_PAD,
    width: rail.width + RAIL_PAD * 2,
    height: rail.height + RAIL_PAD * 2
  };
}

/**
 * Where a dropped rail snaps: the nearer vertical edge of the display it was
 * dropped on, keeping its vertical position (clamped). Returns the placement to
 * persist.
 */
export function snapPlacement(rail: Rect, display: { id: number; workArea: Rect }): CompanionPlacement {
  const work = display.workArea;
  const centre = rail.x + rail.width / 2;
  const edge: CompanionEdge = centre < work.x + work.width / 2 ? 'left' : 'right';
  const offsetY = clamp(rail.y - work.y, EDGE_MARGIN, Math.max(EDGE_MARGIN, work.height - RAIL_HEIGHT - EDGE_MARGIN));
  return { edge, displayId: display.id, offsetY: Math.round(offsetY) };
}

/**
 * Panel window bounds beside the rail (left of a right-edge rail, right of a
 * left-edge one), vertically centred on the rail and clamped to the work area.
 * `anchorY` is the rail top relative to the panel window — the card aligns to it.
 */
export function panelLayout(rail: Rect, work: Rect, edge: CompanionEdge): Rect & { anchorY: number } {
  const height = Math.min(PANEL_MAX_HEIGHT, work.height - EDGE_MARGIN * 2);
  const width = PANEL_WIDTH;
  const x = edge === 'right' ? rail.x - PANEL_GAP - width : rail.x + rail.width + PANEL_GAP;
  const idealY = rail.y + rail.height / 2 - height / 2;
  const y = clamp(Math.round(idealY), work.y + EDGE_MARGIN, work.y + work.height - height - EDGE_MARGIN);
  return { x: Math.round(x), y, width, height, anchorY: Math.max(0, rail.y - y) };
}

/**
 * Tooltip window bounds beside the rail, vertically centred on the hovered
 * icon (`iconY` = px from the rail WINDOW top, pad included), kept on screen.
 */
export function tooltipBounds(rail: Rect, work: Rect, edge: CompanionEdge, iconY: number, height = TOOLTIP_HEIGHT): Rect {
  const x = edge === 'right' ? rail.x - TOOLTIP_GAP - TOOLTIP_WIDTH : rail.x + rail.width + TOOLTIP_GAP;
  const idealY = rail.y - RAIL_PAD + iconY - height / 2;
  const y = clamp(Math.round(idealY), work.y, work.y + work.height - height);
  return { x: Math.round(x), y, width: TOOLTIP_WIDTH, height };
}

/**
 * Match the app's lanes: errors are at rest, while pending interactions need
 * user input. Keep the failure separately for the Agents row's error label.
 */
export function threadAgentState(t: Pick<MenubarThreadAgent, 'status' | 'hasPendingInteraction'>): AgentState {
  if (t.status === 'error') return 'idle';
  if (t.hasPendingInteraction) return 'blocked';
  return 'working';
}

/**
 * Put the full windows away while the rail is up. A minimized one (the yellow
 * traffic light routes here) is hidden too, so it leaves the Dock. Returns the
 * windows it hid, so leaving the rail can bring exactly those back.
 */
export function hideAppWindows<W extends Pick<BrowserWindow, 'isDestroyed' | 'isVisible' | 'isMinimized' | 'hide'>>(
  wins: W[]
): W[] {
  const hidden: W[] = [];
  for (const win of wins) {
    if (!win.isDestroyed() && (win.isVisible() || win.isMinimized())) {
      win.hide();
      hidden.push(win);
    }
  }
  return hidden;
}

/** Validate a renderer-sent tooltip: short strings, finite y inside the rail window. */
export function sanitizeTooltip(tip: unknown): CompanionTooltip | null {
  if (!tip || typeof tip !== 'object') return null;
  const { label, detail, y, panel } = tip as Record<string, unknown>;
  if (typeof label !== 'string' || !label.trim()) return null;
  if (typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > RAIL_HEIGHT + 2 * RAIL_PAD) return null;
  return {
    label: label.trim().slice(0, TOOLTIP_LABEL_MAX),
    detail: typeof detail === 'string' && detail.trim() ? detail.trim().slice(0, TOOLTIP_DETAIL_MAX) : undefined,
    panel: PANEL_KINDS.includes(panel as CompanionPanelKind) ? (panel as CompanionPanelKind) : undefined,
    y
  };
}

/** Pick the display a placement belongs on: saved → fallback (main window's) → primary. */
export function resolveDisplay<D extends { id: number }>(
  displays: D[],
  placement: CompanionPlacement | undefined,
  fallback: D | null,
  primary: D
): D {
  if (placement?.displayId !== undefined) {
    const saved = displays.find((d) => d.id === placement.displayId);
    if (saved) return saved;
  }
  return fallback ?? primary;
}

/** Up to two initials from an OS user name ("p.camprubi" → "PC", "ana" → "AN"). */
export function initialsFor(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? '?').slice(0, 2).toUpperCase();
}

/**
 * Bound + sanitize an answer before it reaches a pty. CRs and other control
 * characters are stripped (the pty write appends its own Enter, and an ESC
 * could end the TUI's bracketed paste early); newlines are kept only when
 * `multiline` (the labelled multi-question reply), otherwise collapsed to spaces.
 */
export function sanitizeAnswer(text: unknown, multiline: boolean): string {
  if (typeof text !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let clean = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
  clean = multiline ? clean.replace(/\n{3,}/g, '\n\n') : clean.replace(/\n+/g, ' ');
  return clean.trim().slice(0, ANSWER_MAX_CHARS);
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, v));
}

const PANEL_KINDS: readonly CompanionPanelKind[] = ['needs-you', 'agents', 'scheduler', 'status'];

// ----- controller -------------------------------------------------------------

export class CompanionController {
  private deps: CompanionDeps;
  private rail: BrowserWindow | null = null;
  private panel: BrowserWindow | null = null;
  private tip: BrowserWindow | null = null;
  /** Tooltip showing now — the tooltip window pulls it on mount (first hover). */
  private tipView: CompanionTooltipView | null = null;
  private active = false;
  /** App windows `enter()` (or a later minimize) put away, re-shown on `exit()`. */
  private hidden = new Set<BrowserWindow>();
  private panelState: CompanionPanelState | null = null;
  /** Unanswered-question inbox entries, newest last; bounded (Rule 5). */
  private questions = new Map<string, InboxEntry>();
  private inboxGeneration = 0;
  /** Last observed state per session, to detect working → done edges. */
  private lastState = new Map<string, AgentState>();
  private completedAt = new Map<string, number>();
  /** Modern threads from the product server, refreshed while the rail is up. */
  private threads: MenubarThreadAgent[] = [];
  private threadsInFlight: number | null = null;
  private threadsDirty = false;
  private threadsGeneration = 0;
  private offs: Array<() => void> = [];
  private pushTimer: NodeJS.Timeout | null = null;
  private dragTimer: NodeJS.Timeout | null = null;
  private dragOffset: { dx: number; dy: number } | null = null;
  private dragStartedAt = 0;
  private blurCloseTimer: NodeJS.Timeout | null = null;
  private initials: string;

  constructor(deps: CompanionDeps) {
    this.deps = deps;
    let name = 'you';
    try {
      name = userInfo().username || name;
    } catch {
      // Some sandboxes have no passwd entry; the avatar just shows "YO".
    }
    this.initials = initialsFor(name);
  }

  /** Wire data subscriptions once at app init (Rule 3). */
  start() {
    if (this.offs.length > 0) return;
    const onFleet = () => this.refresh();
    const onStatus = (sessionId: string, state: AgentState) => {
      const prev = this.lastState.get(sessionId);
      if (prev === 'working' && (state === 'idle' || state === 'done')) {
        this.completedAt.set(sessionId, this.now());
      } else if (state === 'working' || state === 'blocked') {
        this.completedAt.delete(sessionId);
      }
      this.lastState.set(sessionId, state);
      this.refresh();
    };
    const onExit = (sessionId?: unknown) => {
      if (typeof sessionId === 'string') {
        this.lastState.delete(sessionId);
        this.completedAt.delete(sessionId);
      }
      this.refresh();
    };
    const { ptys, agentStatus, scheduler, inboxStore } = this.deps;
    ptys.on('exit', onExit);
    ptys.on('sessionUpdated', onFleet);
    agentStatus.on('status', onStatus);
    scheduler.on('changed', onFleet);
    this.offs.push(
      () => ptys.off('exit', onExit),
      () => ptys.off('sessionUpdated', onFleet),
      () => agentStatus.off('status', onStatus),
      () => scheduler.off('changed', onFleet)
    );
    if (this.deps.onThreadsChanged) {
      // The feed is a cross-process read: only follow it while the rail is up.
      this.offs.push(this.deps.onThreadsChanged(() => {
        if (this.active) void this.refreshThreads();
      }));
    }
    this.subscribeInbox(inboxStore);
    const onDisplays = () => this.reposition();
    // A re-attached monitor the rail was saved on pulls it back; a removed one
    // (or a resolution / Dock change) re-fits it on the remaining displays.
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed'] as const) {
      screen.on(ev as 'display-added', onDisplays);
      this.offs.push(() => screen.off(ev as 'display-added', onDisplays));
    }
  }

  private subscribeInbox(inboxStore: IInboxStore) {
    const generation = ++this.inboxGeneration;
    const changed = new Set<string>();
    let seeding = true;
    let superseded = false;
    const mark = (id: string) => {
      if (!seeding || superseded) return;
      // If a stalled read sees excessive churn, retain only live evidence.
      if (changed.size >= INBOX_SEED_READ_LIMIT && !changed.has(id)) {
        superseded = true;
        changed.clear();
      } else changed.add(id);
    };
    const track = (entry: InboxEntry) => { mark(entry.id); this.trackEntry(entry); };
    const drop = (ids: string[]) => { ids.forEach(mark); this.dropEntries(ids); };
    this.offs.push(
      inboxStore.onAppended(track), inboxStore.onUpdated(track),
      inboxStore.onRemoved((id) => drop([id])), inboxStore.onPruned(drop)
    );
    void inboxStore.read({ limit: INBOX_SEED_READ_LIMIT }).then(({ entries }) => {
      if (generation !== this.inboxGeneration || superseded) return;
      const live = [...this.questions.values()];
      this.questions.clear();
      // `read` is newest-first. Replay live entries last so seed eviction
      // cannot displace newer notifications or overwrite updated questions.
      for (const e of [...entries].reverse()) if (!changed.has(e.id)) this.trackEntry(e, false);
      for (const e of live) this.trackEntry(e, false);
      this.refresh();
    }).catch((err) => {
      if (generation === this.inboxGeneration) this.log('seedInbox', err);
    }).finally(() => { seeding = false; changed.clear(); });
  }

  stop() {
    this.inboxGeneration++;
    for (const off of this.offs.splice(0)) {
      try {
        off();
      } catch {
        // best-effort teardown
      }
    }
    this.clearTimers();
    for (const win of [this.rail, this.panel, this.tip]) {
      if (win && !win.isDestroyed()) win.destroy();
    }
    this.rail = null;
    this.panel = null;
    this.tip = null;
    this.tipView = null;
    this.hidden.clear();
    this.questions.clear();
    this.lastState.clear();
    this.completedAt.clear();
    this.threads = [];
    this.threadsGeneration++;
    this.threadsInFlight = null;
    this.threadsDirty = false;
    this.panelState = null;
    this.dragOffset = null;
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  /** "Minimize to Command Center": hide the app windows, float the rail. */
  enter(): boolean {
    if (!this.deps.isEnabled()) return false;
    const rail = this.ensureRail();
    this.active = true;
    this.reposition();
    this.pushSnapshot();
    void this.refreshThreads();
    for (const win of hideAppWindows(this.deps.mainWindows())) this.hidden.add(win);
    rail.showInactive();
    return true;
  }

  /**
   * A window minimized while the rail is up belongs behind it instead of in the Dock.
   */
  hideBehindRail(win: BrowserWindow) {
    if (!this.active) return;
    for (const w of hideAppWindows([win])) this.hidden.add(w);
  }

  /** Close the rail and restore its windows without changing the navigation target. */
  resume() {
    this.leave();
    const wins = [...this.hidden].filter((w) => !w.isDestroyed());
    this.hidden.clear();
    try {
      this.deps.restoreWindows(wins);
    } catch (err) {
      this.log('restoreWindows', err);
    }
  }

  /** Close the rail and bring the full shell forward. */
  exit() {
    this.resume();
    this.deps.showMainWindow();
  }

  /** Close the rail without touching the main window (flag turned off, quit). */
  leave() {
    this.active = false;
    this.endDrag();
    this.closePanel();
    this.hideTooltip();
    if (this.rail && !this.rail.isDestroyed()) this.rail.hide();
  }

  /** Config changed: turning the flag off while the rail is up restores the app. */
  onConfigChanged() {
    if (this.active && !this.deps.isEnabled()) this.exit();
    else this.refresh();
  }

  /** Debounced snapshot push (state changes arrive in bursts). */
  refresh() {
    if (!this.active || this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.pushSnapshot();
    }, PUSH_DEBOUNCE_MS);
  }

  // ----- snapshot ---------------------------------------------------------------

  buildSnapshot(): CompanionSnapshot {
    const now = this.now();
    const live = this.liveSessions();
    const liveById = new Map(live.map((s) => [s.id, s]));
    const agents: CompanionAgent[] = [];
    const counts = { blocked: 0, working: 0, idle: 0, recentlyCompleted: 0, runningSchedules: 0 };

    for (const s of live) {
      const state = this.deps.agentStatus.get(s.id);
      const doneAt = this.completedAt.get(s.id);
      const recentlyCompleted = doneAt !== undefined && now - doneAt < RECENT_DONE_MS && state !== 'blocked' && state !== 'working';
      if (state === 'blocked') counts.blocked++;
      else if (state === 'working') counts.working++;
      else counts.idle++;
      if (recentlyCompleted) counts.recentlyCompleted++;
      agents.push({
        sessionId: s.id,
        projectId: s.projectId,
        projectName: this.deps.projectName(s.projectId),
        projectColor: this.deps.projectColor(s.projectId),
        title: s.title,
        state,
        createdAt: s.createdAt,
        recentlyCompleted
      });
    }
    const threadsById = new Map<string, MenubarThreadAgent>();
    for (const t of this.threads) {
      const state = threadAgentState(t);
      threadsById.set(t.threadId, t);
      if (state === 'blocked') counts.blocked++;
      else if (state === 'working') counts.working++;
      else counts.idle++;
      agents.push({
        sessionId: `thread:${t.threadId}`,
        threadId: t.threadId,
        projectId: t.projectId,
        projectName: t.projectName || this.deps.projectName(t.projectId),
        projectColor: t.projectColor ?? this.deps.projectColor(t.projectId),
        title: t.title,
        state,
        failure: t.status === 'error' ? t.question || 'Thread failed' : undefined,
        createdAt: t.createdAt,
        recentlyCompleted: false
      });
    }
    agents.sort((a, b) => (AGENT_RANK[a.state] ?? 9) - (AGENT_RANK[b.state] ?? 9) || a.title.localeCompare(b.title));

    const requests: CompanionRequest[] = [];
    const askedSessions = new Set<string>();
    const askedThreads = new Set<string>();
    const cutoff = now - REQUEST_MAX_AGE_MS;
    const entries = [...this.questions.values()].filter((e) => e.ts >= cutoff).sort((a, b) => b.ts - a.ts);
    for (const e of entries) {
      const session = e.sessionId ? liveById.get(e.sessionId) : undefined;
      if (session) askedSessions.add(session.id);
      const thread = e.origin?.threadId ? threadsById.get(e.origin.threadId) : undefined;
      if (thread?.context || thread?.status === 'error') continue; // Prefer current runtime evidence over an old notification.
      if (thread) askedThreads.add(thread.threadId);
      let reason: CompanionRequest['reason'];
      if (e.executionId) reason = 'execution';
      else if (thread && !session) reason = 'thread';
      else if (!session) reason = 'ended';
      else if (!isRepliable(session)) reason = 'background';
      const questions = inboxQuestions(e);
      requests.push({
        id: `inbox:${e.id}`,
        kind: 'question',
        entryId: e.id,
        sessionId: e.sessionId,
        threadId: thread?.threadId,
        projectId: e.projectId,
        projectName: e.projectLabel || this.deps.projectName(e.projectId),
        projectColor: this.deps.projectColor(e.projectId),
        agentTitle: session?.title || e.origin?.title || 'Agent',
        // An AskUserQuestion-hook entry carries its text only on the question.
        prompt: (e.comments || e.subject || (questions.length === 1 ? questions[0].prompt : '') || '').trim(),
        questions,
        ts: e.ts,
        answerable: !reason,
        reason
      });
    }
    for (const a of agents) {
      if (a.state !== 'blocked' || askedSessions.has(a.sessionId)) continue;
      if (a.threadId) {
        if (askedThreads.has(a.threadId)) continue;
        const t = threadsById.get(a.threadId)!;
        // A thread's pending interaction is answered in its own composer.
        requests.push({
          id: `thread:${a.threadId}${t.context ? `:${t.context.interactionId}` : ''}`,
          kind: 'blocked',
          threadId: a.threadId,
          projectId: a.projectId,
          projectName: a.projectName,
          projectColor: a.projectColor,
          agentTitle: a.title,
          prompt: t.question || 'Waiting for your input',
          threadContext: t.context,
          ts: t.context?.createdAt ?? t.createdAt,
          answerable: false,
          reason: 'thread'
        });
        continue;
      }
      const s = liveById.get(a.sessionId)!;
      const verdict = this.deps.triage(a.sessionId);
      const repliable = isRepliable(s);
      requests.push({
        id: `agent:${a.sessionId}`,
        kind: 'blocked',
        sessionId: a.sessionId,
        projectId: a.projectId,
        projectName: a.projectName,
        projectColor: a.projectColor,
        agentTitle: a.title,
        prompt: verdict?.summary || 'Waiting for your input',
        ts: verdict ? now : s.createdAt,
        answerable: repliable,
        reason: repliable ? undefined : 'background'
      });
    }

    const schedules = this.buildSchedules();
    counts.runningSchedules = schedules.filter((t) => t.running).length;

    return {
      theme: this.deps.theme(),
      edge: this.deps.getPlacement()?.edge ?? 'right',
      requests,
      agents,
      schedules,
      counts,
      userInitials: this.initials
    };
  }

  private buildSchedules(): CompanionSchedule[] {
    const out: CompanionSchedule[] = [];
    for (const task of this.deps.scheduler.list()) {
      const alive = new Set(
        this.deps.ptys
          .list(task.projectId)
          .filter((s) => s.status === 'running' || s.status === 'starting')
          .map((s) => s.id)
      );
      const running = task.status.runs.some((r) => !r.finishedAt && (
        (r.launchKind ?? task.kind) === 'team'
          ? r.launchState === 'running' && !!r.executionId
          : !!r.sessionId && alive.has(r.sessionId)
      ));
      out.push({
        id: task.id,
        name: task.name,
        projectId: task.projectId,
        projectName: this.deps.projectName(task.projectId),
        enabled: task.enabled,
        running,
        nextRunAt: task.enabled ? task.status.nextRunAt ?? null : null,
        lastResult: task.status.lastRunResult,
        lastRunAt: task.status.lastRunAt
      });
    }
    const at = (t: CompanionSchedule) => (t.nextRunAt ? Date.parse(t.nextRunAt) : Infinity);
    out.sort((a, b) => Number(b.running) - Number(a.running) || at(a) - at(b) || a.name.localeCompare(b.name));
    return out.slice(0, SCHEDULES_MAX);
  }

  /** Pull the Modern-thread feed (single-flight; a change mid-read re-reads). */
  private async refreshThreads() {
    if (!this.deps.listThreads) return;
    if (this.threadsInFlight === this.threadsGeneration) {
      this.threadsDirty = true;
      return;
    }
    const generation = this.threadsGeneration;
    this.threadsInFlight = generation;
    this.threadsDirty = false;
    try {
      const threads = await this.deps.listThreads();
      if (generation !== this.threadsGeneration) return;
      this.threads = (Array.isArray(threads) ? threads : []).filter((t) => t?.kind === 'thread').slice(0, THREADS_MAX);
      this.refresh();
    } catch (err) {
      this.log('refreshThreads', err);
    } finally {
      if (this.threadsInFlight === generation) {
        this.threadsInFlight = null;
        if (this.threadsDirty && this.active) void this.refreshThreads();
      }
    }
  }

  private trackEntry(entry: InboxEntry, push = true) {
    if (inboxQuestions(entry).length === 0) {
      if (this.questions.delete(entry.id) && push) this.refresh();
      return;
    }
    this.questions.delete(entry.id);
    this.questions.set(entry.id, entry);
    while (this.questions.size > INBOX_CACHE_MAX) {
      const oldest = this.questions.keys().next().value as string;
      this.questions.delete(oldest);
    }
    if (push) this.refresh();
  }

  private dropEntries(ids: string[]) {
    let changed = false;
    for (const id of ids) changed = this.questions.delete(id) || changed;
    if (changed) this.refresh();
  }

  private liveSessions(): TerminalSession[] {
    return this.deps.ptys.listAll().filter((s) => s.status === 'running' || s.status === 'starting');
  }

  // ----- actions (all re-authorized from main state, Rule 1) ----------------------

  /** Answer a Needs You request by injecting the text into the agent's pty. */
  answer(requestId: unknown, text: unknown): CompanionAnswerResult {
    // Only a live rail answers (the menubar twin refuses when its flag is off).
    if (!this.active || !this.deps.isEnabled()) return { ok: false, reason: 'unknown' };
    if (typeof requestId !== 'string') return { ok: false, reason: 'unknown' };
    let sessionId: string | undefined;
    let multiline = false;
    if (requestId.startsWith('inbox:')) {
      const entry = this.questions.get(requestId.slice('inbox:'.length));
      if (!entry) return { ok: false, reason: 'unknown' };
      if (entry.executionId) return { ok: false, reason: 'execution' };
      sessionId = entry.sessionId;
      multiline = inboxQuestions(entry).length > 1;
    } else if (requestId.startsWith('agent:')) {
      sessionId = requestId.slice('agent:'.length);
      if (this.deps.agentStatus.get(sessionId) !== 'blocked') return { ok: false, reason: 'unknown' };
    } else {
      return { ok: false, reason: 'unknown' };
    }
    const session = sessionId ? this.deps.ptys.getSession(sessionId) : undefined;
    if (!session || (session.status !== 'running' && session.status !== 'starting')) {
      return { ok: false, reason: 'ended' };
    }
    if (!isRepliable(session)) return { ok: false, reason: 'background' };
    const clean = sanitizeAnswer(text, multiline);
    if (!clean) return { ok: false, reason: 'empty' };
    const ok = this.deps.ptys.reply(session.id, clean);
    if (ok) this.refresh();
    return ok ? { ok: true } : { ok: false, reason: 'ended' };
  }

  /** Every validated navigation back into Zana dismisses the companion. */
  open(target: CompanionOpenTarget | null | undefined) {
    if (!target || typeof target !== 'object') return;
    this.closePanel();
    const send = this.deps.sendToApp;
    switch (target.kind) {
      case 'main':
        this.exit();
        return;
      case 'home':
        this.exit();
        send('app:openHome');
        return;
      case 'agents':
        this.exit();
        send('app:openAgents');
        return;
      case 'scheduler': {
        const taskId = typeof target.taskId === 'string' && this.deps.scheduler.list().some((t) => t.id === target.taskId)
          ? target.taskId
          : undefined;
        this.exit();
        send('app:openScheduler', taskId);
        return;
      }
      case 'session': {
        const s = typeof target.sessionId === 'string' ? this.deps.ptys.getSession(target.sessionId) : undefined;
        if (!s) return;
        this.exit();
        send('app:focusSession', s.id, s.projectId);
        return;
      }
      case 'thread': {
        // Only a thread main's own feed reported (Rule 1).
        const t = typeof target.threadId === 'string' ? this.threads.find((x) => x.threadId === target.threadId) : undefined;
        if (!t || !this.deps.openThread) return;
        this.resume();
        this.deps.openThread(t.threadId, t.projectId);
        return;
      }
      case 'request': {
        const id = typeof target.requestId === 'string' ? target.requestId : '';
        if (id.startsWith('inbox:')) {
          const entry = this.questions.get(id.slice('inbox:'.length));
          if (!entry) return;
          this.exit();
          send('app:focusInboxEntry', entry.id, entry.projectId);
        } else if (id.startsWith('agent:')) {
          this.open({ kind: 'session', sessionId: id.slice('agent:'.length) });
        } else if (id.startsWith('thread:')) {
          // Match main-owned identity, including the current interaction. A
          // stale card must not open a newer question using the old request id.
          const t = this.threads.find(t => id === `thread:${t.threadId}${t.context ? `:${t.context.interactionId}` : ''}`);
          if (t) this.open({ kind: 'thread', threadId: t.threadId });
        }
        return;
      }
    }
  }

  async runSchedule(taskId: unknown): Promise<boolean> {
    if (typeof taskId !== 'string') return false;
    const previous = this.deps.scheduler.list().find((t) => t.id === taskId);
    if (!previous) return false;
    const knownRuns = new Set(previous.status?.runs.map((run) => run.id));
    const pendingRuns = new Set(previous.status?.runs.filter((run) => run.launchState === 'pending').map((run) => run.id));
    try {
      const task = await this.deps.scheduler.runNow(taskId);
      // runNow can resolve after persisting a launch failure, or recover an
      // existing reservation. Only acknowledge a confirmed launch from this call.
      return task.status.runs.some((run) =>
        (!knownRuns.has(run.id) || pendingRuns.has(run.id)) &&
        run.launchState === 'running' && !!(run.sessionId || run.executionId));
    } catch (err) {
      this.deps.logger?.('companion run schedule', err);
      return false;
    } finally {
      this.refresh();
    }
  }

  // ----- panel ------------------------------------------------------------------

  openPanel(kind: unknown, focusRequestId?: unknown) {
    if (!this.active || !PANEL_KINDS.includes(kind as CompanionPanelKind)) return;
    this.showPanel(kind as CompanionPanelKind, false, typeof focusRequestId === 'string' ? focusRequestId : undefined);
  }

  /** Hover and pin share one window and renderer, so promoting never replaces the card. */
  private showPanel(kind: CompanionPanelKind, preview: boolean, focusRequestId?: string) {
    if (this.blurCloseTimer) {
      clearTimeout(this.blurCloseTimer);
      this.blurCloseTimer = null;
    }
    this.hideTooltip();
    const panel = this.ensurePanel();
    const { rail, work, edge } = this.currentRail();
    const layout = panelLayout(rail, work, edge);
    panel.setBounds({ x: layout.x, y: layout.y, width: layout.width, height: layout.height }, false);
    this.panelState = {
      kind,
      preview,
      railSide: edge,
      anchorY: layout.anchorY,
      focusRequestId
    };
    this.pushSnapshot();
    this.sendTo(panel, IPC.companion.onPanel, this.panelState);
    if (this.rail) this.sendTo(this.rail, IPC.companion.onPanel, this.panelState);
    panel.setIgnoreMouseEvents(preview);
    panel.setFocusable(!preview);
    if (!panel.isVisible()) {
      if (preview) panel.showInactive();
      else panel.show();
    }
    if (!preview) panel.focus();
  }

  closePanel() {
    if (this.blurCloseTimer) {
      clearTimeout(this.blurCloseTimer);
      this.blurCloseTimer = null;
    }
    this.panelState = null;
    if (this.panel && !this.panel.isDestroyed() && this.panel.isVisible()) {
      this.panel.hide();
      this.sendTo(this.panel, IPC.companion.onPanelClosed);
    }
    if (this.rail) this.sendTo(this.rail, IPC.companion.onPanelClosed);
  }

  getPanelState(): CompanionPanelState | null {
    return this.panelState;
  }

  // ----- tooltip ------------------------------------------------------------------

  /** Rail hover: Agents uses its shared card; other icons float a label. */
  tooltip(raw: unknown) {
    const tip = sanitizeTooltip(raw);
    // A late hover-leave after a click must never dismiss the pinned panel.
    if (this.panelState && !this.panelState.preview) return;
    if (!tip || !this.active || this.dragTimer || !this.rail || this.rail.isDestroyed()) {
      this.hideTooltip();
      if (this.panelState?.preview) this.closePanel();
      return;
    }
    if (tip.panel === 'agents') {
      this.showPanel('agents', true);
      return;
    }
    if (this.panelState?.preview) this.closePanel();
    const win = this.ensureTip();
    const { rail, work, edge } = this.currentRail();
    win.setBounds(tooltipBounds(rail, work, edge, tip.y), false);
    this.tipView = {
      label: tip.label,
      detail: tip.detail,
      side: edge,
      theme: this.deps.theme()
    };
    this.sendTo(win, IPC.companion.onTooltip, this.tipView);
    if (!win.isVisible()) win.showInactive();
  }

  getTooltip(): CompanionTooltipView | null {
    return this.tipView;
  }

  private hideTooltip() {
    this.tipView = null;
    if (!this.tip || this.tip.isDestroyed() || !this.tip.isVisible()) return;
    this.sendTo(this.tip, IPC.companion.onTooltip, null);
    this.tip.hide();
  }

  // ----- drag + snap --------------------------------------------------------------

  dragStart() {
    if (!this.rail || this.rail.isDestroyed() || this.dragTimer) return;
    this.closePanel();
    this.hideTooltip();
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = this.rail.getPosition();
    this.dragOffset = { dx: cursor.x - wx, dy: cursor.y - wy };
    this.dragStartedAt = this.now();
    // Follow the cursor at ~60fps; a renderer-driven drag would fight the
    // window moving under the pointer.
    this.dragTimer = setInterval(() => {
      if (!this.rail || this.rail.isDestroyed() || !this.dragOffset) return;
      if (this.now() - this.dragStartedAt > DRAG_MAX_MS) {
        this.dragEnd();
        return;
      }
      const p = screen.getCursorScreenPoint();
      this.rail.setPosition(p.x - this.dragOffset.dx, p.y - this.dragOffset.dy, false);
    }, 16);
  }

  dragEnd() {
    if (!this.dragTimer) return;
    this.endDrag();
    if (!this.rail || this.rail.isDestroyed()) return;
    const b = this.rail.getBounds();
    const visible = { x: b.x + RAIL_PAD, y: b.y + RAIL_PAD, width: RAIL_WIDTH, height: RAIL_HEIGHT };
    const display = screen.getDisplayNearestPoint({ x: visible.x + visible.width / 2, y: visible.y + visible.height / 2 });
    const placement = snapPlacement(visible, display);
    try {
      this.deps.savePlacement(placement);
    } catch (err) {
      this.log('savePlacement', err);
    }
    this.reposition();
    this.pushSnapshot();
  }

  private endDrag() {
    if (this.dragTimer) clearInterval(this.dragTimer);
    this.dragTimer = null;
    this.dragOffset = null;
  }

  /** Whether an IPC sender is one of the companion's own windows. */
  ownsSender(sender: WebContents): boolean {
    return [this.rail, this.panel, this.tip].some(
      (w) => !!w && !w.isDestroyed() && w.webContents.id === sender.id
    );
  }

  /** Whether a window is one of the companion's own (menu routing skips them). */
  ownsWindow(win: BrowserWindow | null | undefined): boolean {
    return !!win && (win === this.rail || win === this.panel || win === this.tip);
  }

  // ----- windows ----------------------------------------------------------------

  private currentRail(): { rail: Rect; work: Rect; edge: CompanionEdge; display: Display } {
    const placement = this.deps.getPlacement();
    const displays = screen.getAllDisplays();
    const main = this.deps.mainWindows().find((w) => !w.isDestroyed()) ?? null;
    const fallback = main ? screen.getDisplayMatching(main.getBounds()) : null;
    const display = resolveDisplay(displays, placement, fallback, screen.getPrimaryDisplay());
    const work = display.workArea;
    return { rail: railRect(work, placement), work, edge: placement?.edge ?? 'right', display };
  }

  private reposition() {
    // Mid-drag the cursor owns the position; dragEnd() snaps + repositions.
    if (!this.rail || this.rail.isDestroyed() || this.dragTimer) return;
    const { rail, work, edge } = this.currentRail();
    this.rail.setBounds(railWindowBounds(rail), false);
    this.hideTooltip();
    // Re-fit an open panel in place: same kind, no focus change, so a
    // half-answered question survives a Dock / resolution change.
    if (this.panelState && this.panel && !this.panel.isDestroyed()) {
      const layout = panelLayout(rail, work, edge);
      this.panel.setBounds({ x: layout.x, y: layout.y, width: layout.width, height: layout.height }, false);
      this.panelState = { kind: this.panelState.kind, preview: this.panelState.preview, railSide: edge, anchorY: layout.anchorY };
      this.sendTo(this.panel, IPC.companion.onPanel, this.panelState);
    }
  }

  private pushSnapshot() {
    if (!this.active) return;
    let snapshot: CompanionSnapshot;
    try {
      snapshot = this.buildSnapshot();
    } catch (err) {
      this.log('buildSnapshot', err);
      return;
    }
    for (const win of [this.rail, this.panel]) {
      if (win) this.sendTo(win, IPC.companion.onSnapshot, snapshot);
    }
  }

  private sendTo(win: BrowserWindow, channel: string, ...args: unknown[]) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    try {
      win.webContents.send(channel, ...args);
    } catch (err) {
      this.log(`send ${channel}`, err);
    }
  }

  private ensureRail(): BrowserWindow {
    if (this.rail && !this.rail.isDestroyed()) return this.rail;
    const { rail } = this.currentRail();
    const win = this.createWindow(railWindowBounds(rail), 'rail');
    win.on('closed', () => {
      this.rail = null;
    });
    this.rail = win;
    return win;
  }

  private ensurePanel(): BrowserWindow {
    if (this.panel && !this.panel.isDestroyed()) return this.panel;
    const win = this.createWindow({ x: 0, y: 0, width: PANEL_WIDTH, height: PANEL_MAX_HEIGHT }, 'panel');
    // Click-away dismissal. Deferred a beat so a click that moved focus to the
    // rail (switching panels) can cancel it via openPanel().
    win.on('blur', () => {
      if (this.panelState?.preview) return;
      if (this.blurCloseTimer) clearTimeout(this.blurCloseTimer);
      this.blurCloseTimer = setTimeout(() => {
        this.blurCloseTimer = null;
        this.closePanel();
      }, 150);
    });
    win.on('closed', () => {
      this.panel = null;
    });
    this.panel = win;
    return win;
  }

  private ensureTip(): BrowserWindow {
    if (this.tip && !this.tip.isDestroyed()) return this.tip;
    const win = this.createWindow({ x: 0, y: 0, width: TOOLTIP_WIDTH, height: TOOLTIP_HEIGHT }, 'tooltip');
    // Pure decoration: clicks fall through to whatever is underneath.
    win.setIgnoreMouseEvents(true);
    win.on('closed', () => {
      this.tip = null;
    });
    this.tip = win;
    return win;
  }

  private createWindow(bounds: Rect, part: 'rail' | 'panel' | 'tooltip'): BrowserWindow {
    const win = new BrowserWindow({
      ...bounds,
      show: false,
      // NSPanel + non-activating: floats over full-screen apps on every Space
      // and a click never pulls the app (or its hidden windows) forward.
      type: process.platform === 'darwin' ? 'panel' : undefined,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      acceptFirstMouse: true,
      focusable: part !== 'tooltip',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        zoomFactor: DEFAULT_RENDERER_ZOOM_FACTOR
      }
    });
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    const search = `surface=companion&part=${part}`;
    const url = rendererUrl({ surface: 'companion', part });
    const loaded = url ? win.loadURL(url) : win.loadFile(join(__dirname, '../renderer/index.html'), { search });
    void loaded.catch((err) => this.log(`load ${part}`, err));
    return win;
  }

  private clearTimers() {
    for (const t of [this.pushTimer, this.blurCloseTimer]) if (t) clearTimeout(t);
    if (this.dragTimer) clearInterval(this.dragTimer);
    this.pushTimer = null;
    this.blurCloseTimer = null;
    this.dragTimer = null;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private log(context: string, err: unknown) {
    if (this.deps.logger) this.deps.logger(`companion.${context}`, err);
    else console.error(`[companion] ${context}:`, err); // eslint-disable-line no-console
  }
}
