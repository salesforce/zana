import { BrowserWindow, screen, type Tray } from 'electron';
import { join } from 'node:path';
import { IPC } from '../shared/ipc.js';
import type { PtyManager } from './pty.js';
import type { SchedulerManager } from './scheduler.js';
import type { AgentStatusTracker } from './agent-status.js';
import type {
  AgentState,
  IdleTriageResult,
  MenubarAgent,
  MenubarSnapshot,
  TerminalSession
} from '../shared/types.js';

/**
 * The frameless-card menu-bar popover (macOS) — the styled alternative to the
 * native `Tray` context menu (`tray.ts`). This owns the popover BrowserWindow,
 * anchors it under the tray icon, hides it on blur, and builds/pushes the live
 * fleet snapshot the popover renderer draws.
 *
 * It's created lazily (first open) but its data subscriptions are wired by the
 * caller once at app init (Rule 3) and torn down on `stop()`. The popover is a
 * thin, read-only view: every snapshot is built HERE in main from the pty +
 * agent-state + scheduler singletons the window already reads, and every action
 * the popover triggers routes back through a main-authorized handler (Rule 1).
 *
 * macOS-only surface — the caller gates it behind `menubarPopoverEnabled` and
 * the darwin platform check; other platforms keep the native menu.
 */
export interface MenubarDeps {
  ptys: PtyManager;
  scheduler: SchedulerManager;
  agentStatus: AgentStatusTracker;
  /** Project id → display name. */
  projectName: (projectId: string) => string;
  /** Project id → accent color (for the row chip tint), or undefined. */
  projectColor: (projectId: string) => string | undefined;
  /** Whether a session is currently starred (favorite = pinned in the popover). */
  isFavorite: (sessionId: string) => boolean;
  /**
   * The cached idle-triage verdict for a session, or null. Closes over main's
   * `lastTriageBySession` map — a synchronous in-memory lookup, no fs/LLM cost
   * on the hot buildSnapshot path (Rule 5). Absent add-on / uncached ⇒ null.
   */
  triage: (sessionId: string) => IdleTriageResult | null;
  /** Active app theme, so the popover matches without its own config read. */
  theme: () => 'dark' | 'light';
  /** Preload script path (same CJS preload the main window uses). */
  preloadPath: string;
  logger?: (context: string, err: unknown) => void;
}

/** Popover card size. Height is a soft cap; the card scrolls its rows region. */
const POPOVER_WIDTH = 380;
const POPOVER_HEIGHT = 520;
/** Gap between the menu bar and the top of the card. */
const ANCHOR_GAP = 6;

/**
 * Which agent states the popover surfaces, in display-priority order — the same
 * attention-first ordering the sidebar `AgentTray` uses, plus `done` for a
 * finished-but-open session (a scheduled run parked at the prompt). `idle`/
 * `unknown` are excluded: they don't want attention and would just be noise.
 */
const SURFACED: readonly AgentState[] = ['blocked', 'working', 'done'];
const STATE_RANK: Record<string, number> = { blocked: 0, working: 1, done: 2 };

export class MenubarController {
  private deps: MenubarDeps;
  private win: BrowserWindow | null = null;
  private tray: Tray | null = null;

  constructor(deps: MenubarDeps) {
    this.deps = deps;
  }

  /** Bind the tray so the controller can anchor the popover under its icon. */
  attachTray(tray: Tray) {
    this.tray = tray;
  }

  /** Toggle the popover open/closed (left-click on the tray icon). */
  toggle() {
    if (this.win && this.win.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  show() {
    const win = this.ensureWindow();
    this.position(win);
    // Push a fresh snapshot before the card paints so it never flashes empty.
    this.pushSnapshot();
    win.show();
    win.focus();
  }

  hide() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.win.hide();
    }
  }

  isVisible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  /** Rebuild + push a snapshot if the popover is open. Cheap; safe to spam. */
  refresh() {
    if (this.isVisible()) this.pushSnapshot();
  }

  stop() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }
    this.win = null;
  }

  // ----- snapshot -------------------------------------------------------------

  /**
   * Build the fleet snapshot synchronously from the live singletons. It never
   * touches the filesystem — it's safe to call on every state change.
   */
  buildSnapshot(): MenubarSnapshot {
    const agents: MenubarAgent[] = [];
    let needsYou = 0;
    let working = 0;

    for (const session of this.allLiveSessions()) {
      const state = this.deps.agentStatus.get(session.id);
      if (!SURFACED.includes(state)) continue;
      if (state === 'blocked') needsYou++;
      else if (state === 'working') working++;
      // Enrich blocked rows with "what is it waiting for" from the cached triage
      // verdict — a straight in-memory read (Rule 5). Only for blocked agents;
      // working/done never carry a question.
      const verdict = state === 'blocked' ? this.deps.triage(session.id) : null;
      agents.push({
        sessionId: session.id,
        projectId: session.projectId,
        projectName: this.deps.projectName(session.projectId),
        projectColor: this.deps.projectColor(session.projectId),
        title: session.title,
        state,
        favorite: this.deps.isFavorite(session.id),
        createdAt: session.createdAt,
        question: verdict?.summary || undefined,
        resolution: verdict?.resolution,
        repliable: isRepliable(session)
      });
    }

    // Attention-first, then by title so ordering is stable across pushes.
    agents.sort((a, b) => {
      const r = (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9);
      if (r !== 0) return r;
      return a.title.localeCompare(b.title);
    });

    return {
      agents,
      needsYou,
      working,
      scheduleCount: this.deps.scheduler.list().length,
      nextRunAt: this.soonestNextRun(),
      theme: this.deps.theme()
    };
  }

  /** Blocked-first fleet tally for the tray-icon badge (needs-you drives it). */
  badgeCount(): { needsYou: number; working: number } {
    let needsYou = 0;
    let working = 0;
    for (const session of this.allLiveSessions()) {
      const state = this.deps.agentStatus.get(session.id);
      if (state === 'blocked') needsYou++;
      else if (state === 'working') working++;
    }
    return { needsYou, working };
  }

  private pushSnapshot() {
    if (!this.win || this.win.isDestroyed() || this.win.webContents.isDestroyed()) return;
    try {
      this.win.webContents.send(IPC.menubar.onSnapshot, this.buildSnapshot());
    } catch (err) {
      this.log('pushSnapshot', err);
    }
  }

  /** Every live session across all projects (running or starting). */
  private allLiveSessions(): TerminalSession[] {
    return this.deps.ptys
      .listAll()
      .filter((s) => s.status === 'running' || s.status === 'starting');
  }

  private soonestNextRun(): string | null {
    let soonest = Infinity;
    for (const task of this.deps.scheduler.list()) {
      if (!task.enabled) continue;
      const at = task.status.nextRunAt ? Date.parse(task.status.nextRunAt) : NaN;
      if (Number.isFinite(at) && at < soonest) soonest = at;
    }
    return Number.isFinite(soonest) ? new Date(soonest).toISOString() : null;
  }

  // ----- window ---------------------------------------------------------------

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: POPOVER_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      // Vibrancy gives the native menu-bar-popover translucency; the card keeps
      // a solid --bg-panel fallback for when the compositor ignores it.
      vibrancy: 'popover',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    // Float above full-screen apps so the popover is reachable from anywhere.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // A menu-bar popover dismisses when you click away — hide (don't close, so
    // we reuse the window) on blur.
    win.on('blur', () => {
      if (!win.isDestroyed()) win.hide();
    });
    win.on('closed', () => {
      this.win = null;
    });

    const query = 'surface=popover';
    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${query}`);
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), { search: query });
    }

    this.win = win;
    return win;
  }

  /** Center the card under the tray icon, clamped to the display work area. */
  private position(win: BrowserWindow) {
    const bounds = this.tray?.getBounds();
    const size = win.getBounds();
    if (!bounds) return;
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const work = display.workArea;
    let x = Math.round(bounds.x + bounds.width / 2 - size.width / 2);
    const y = Math.round(bounds.y + bounds.height + ANCHOR_GAP);
    // Clamp horizontally so a right-edge tray icon doesn't push the card off.
    x = clamp(x, work.x + 8, work.x + work.width - size.width - 8);
    win.setPosition(x, y, false);
  }

  private log(context: string, err: unknown) {
    if (this.deps.logger) this.deps.logger(context, err);
    else console.error(`[menubar] ${context}:`, err); // eslint-disable-line no-console
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Whether a session may take a "light" reply from the menu bar. Background work
 * — scheduled runs and headless (hidden) sessions — is excluded: the user
 * replying from a glance surface can't see that terminal, so injecting input
 * into a detached job would be surprising. This is the renderer-facing hint;
 * the `menubar:reply` handler re-checks the same gate authoritatively (Rule 1).
 */
export function isRepliable(session: TerminalSession): boolean {
  return !session.scheduled && !session.headless;
}
