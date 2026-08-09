import { Tray, Menu, nativeImage, nativeTheme, type NativeImage } from 'electron';
import { buildAppGlyphTemplateImage, buildAppGlyphAttentionImage } from './tray-icon.js';
import type { PtyManager } from './pty.js';
import type { SchedulerManager } from './scheduler.js';
import type { AgentStatusTracker } from './agent-status.js';
import type { MenubarController } from './menubar.js';
import type { ScheduledTask } from '../shared/types.js';

/**
 * macOS menu-bar (status bar) presence for the scheduler.
 *
 * Lives entirely in the main process and reads from the same `SchedulerManager`
 * and `PtyManager` the window does, so the menu always reflects current state
 * without any renderer round-trip. The menu is rebuilt (debounced) whenever a
 * schedule changes, a pty starts/exits, or a 30s timer ticks (so relative
 * "next in 5m" labels stay fresh).
 *
 * It never owns app lifetime — the dock icon and main window stay exactly as
 * they were; the tray is an extra always-available control.
 */
export interface TrayDeps {
  scheduler: SchedulerManager;
  ptys: PtyManager;
  /** Agent-state tracker — for the blocked-first fleet badge (popover mode). */
  agentStatus: AgentStatusTracker;
  /** Project id → display name, for grouping/labels. */
  projectName: (projectId: string) => string;
  /** Bring the main window forward (create it if it was closed). */
  showWindow: () => void;
  /** Focus a specific live session in the window. */
  focusSession: (sessionId: string, projectId: string) => void;
  /**
   * Switch the window to the Scheduler view. With a task id, jump to that
   * schedule's scope and reveal it; without one, land on the overview.
   */
  openScheduler: (taskId?: string) => void;
  /**
   * The frameless-card popover (macOS). When present AND enabled, a tray click
   * toggles it instead of opening the native context menu, and the badge counts
   * the whole fleet (needs-you first) rather than only scheduled runs. Absent /
   * disabled ⇒ the native menu path below is used unchanged.
   */
  popover?: MenubarController | null;
  /** Live check: is the popover surface enabled (config flag + darwin)? */
  popoverEnabled: () => boolean;
  /** App icon path, resized down for the menu bar. May be null. */
  iconPath: string | null;
  logger?: (context: string, err: unknown) => void;
}

/** Max schedule rows before we collapse the tail into "…and N more". */
const MAX_ROWS = 20;

/** A schedule's still-alive session, tagged with whether its turn has ended. */
interface LiveRun {
  task: ScheduledTask;
  sessionId: string;
  /** Agent finished its turn but the pty is still open at the prompt. */
  finished: boolean;
}

export class TrayController {
  private tray: Tray | null = null;
  private deps: TrayDeps;
  private rebuildTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private offScheduler: (() => void) | null = null;
  private readonly onPty = () => this.scheduleRebuild();
  private readonly onTheme = () => {
    // A light/dark bar switch changes the non-template attention glyph's color,
    // so drop the cache and rebuild. (The plain template glyph auto-tints, so it
    // wouldn't need this — but the attention variant does.)
    this.iconCache.clear();
    this.scheduleRebuild();
  };
  /**
   * Rasterizing the glyph PNG is cheap but not free, and `rebuild()` runs on
   * every agent-status/pty edge plus a 30s tick — so cache the built images by
   * a `${attention}:${dark}` key. Cleared on theme change (color depends on it).
   */
  private readonly iconCache = new Map<string, NativeImage>();

  constructor(deps: TrayDeps) {
    this.deps = deps;
  }

  start() {
    if (this.tray) return;
    this.tray = new Tray(this.makeIcon(false));
    this.tray.setToolTip('Zana Command Center');
    if (this.deps.popover) this.deps.popover.attachTray(this.tray);
    // Click behavior depends on the surface: with the popover enabled, the icon
    // toggles the frameless card (a real menu-bar app gesture). Otherwise it
    // brings the main window forward and the schedule list lives in the native
    // context menu (set via setContextMenu below, which on macOS also opens on
    // a left click).
    this.tray.on('click', () => {
      if (this.usePopover()) this.deps.popover!.toggle();
      else this.deps.showWindow();
    });

    const onChanged = () => this.scheduleRebuild();
    this.deps.scheduler.on('changed', onChanged);
    this.offScheduler = () => this.deps.scheduler.off('changed', onChanged);
    // pty start/exit changes the running-count badge (and the popover fleet).
    this.deps.ptys.on('exit', this.onPty);
    this.deps.ptys.on('sessionUpdated', this.onPty);
    // Agent-state transitions move the needs-you/working tally, so they refresh
    // the badge + any open popover. Debounced through the same rebuild timer.
    this.deps.agentStatus.on('status', this.onPty);
    // The non-template attention glyph is drawn white-on-dark / black-on-light,
    // so a bar theme switch has to recolor it (Rule 3: subscribe once here).
    nativeTheme.on('updated', this.onTheme);

    // Keep relative "next in …" labels honest without a per-second timer.
    this.tickTimer = setInterval(() => this.rebuild(), 30_000);

    this.rebuild();
  }

  stop() {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.offScheduler?.();
    this.offScheduler = null;
    this.deps.ptys.off('exit', this.onPty);
    this.deps.ptys.off('sessionUpdated', this.onPty);
    this.deps.agentStatus.off('status', this.onPty);
    nativeTheme.off('updated', this.onTheme);
    this.iconCache.clear();
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  // ----- internals -----------------------------------------------------------

  private log(context: string, err: unknown) {
    if (this.deps.logger) this.deps.logger(context, err);
    else console.error(`[tray] ${context}:`, err); // eslint-disable-line no-console
  }

  /**
   * The menu-bar icon. `attention` swaps in the non-template glyph with a baked
   * red dot (agents need you); otherwise the plain OS-tinted template glyph.
   * Cached per `${attention}:${dark}` so the frequent rebuild path doesn't
   * re-rasterize; the cache is cleared on theme change.
   */
  private makeIcon(attention: boolean): NativeImage {
    const dark = nativeTheme.shouldUseDarkColors;
    const key = `${attention}:${dark}`;
    const cached = this.iconCache.get(key);
    if (cached) return cached;
    // The app's own marks (chevron + caret + Claude spark), redrawn monochrome
    // as a macOS template image — the OS tints it for light/dark menu bars.
    // This keeps the menu-bar presence on-brand while staying crisp at 18pt;
    // shrinking the colored 1024px app icon here would collapse into an
    // illegible dark blob and wouldn't tint. The attention variant is a
    // non-template image (it carries a literal red dot the OS mustn't recolor).
    try {
      const img = attention
        ? buildAppGlyphAttentionImage({ dark })
        : buildAppGlyphTemplateImage();
      this.iconCache.set(key, img);
      return img;
    } catch (err) {
      this.log('makeIcon glyph', err);
    }
    // Fall back to the resized colored app icon (non-template) if the glyph
    // can't be drawn, then to text-only.
    try {
      if (this.deps.iconPath) {
        const img = nativeImage.createFromPath(this.deps.iconPath);
        if (!img.isEmpty()) return img.resize({ width: 18, height: 18, quality: 'best' });
      }
    } catch (err) {
      this.log('makeIcon app-icon fallback', err);
    }
    // Empty image is valid — on macOS the title text alone still shows.
    return nativeImage.createEmpty();
  }

  /**
   * Tooltip that surfaces BOTH signals honestly: needs-you first (the red-dot
   * count), then working. Either can be zero.
   */
  private badgeTooltip(needsYou: number, working: number): string {
    const parts: string[] = [];
    if (needsYou > 0) parts.push(`${needsYou} need${needsYou > 1 ? '' : 's'} you`);
    if (working > 0) parts.push(`${working} working`);
    return parts.length ? parts.join(' · ') : 'Zana Command Center';
  }

  /**
   * Count agents in the `blocked` state across every LIVE session — the same
   * needs-you tally the popover's `badgeCount` computes, used to drive the red
   * dot in the native (no-popover) surface where there's no popover to ask.
   */
  private fleetBlockedCount(): number {
    let blocked = 0;
    for (const s of this.deps.ptys.listAll()) {
      if (s.status !== 'running' && s.status !== 'starting') continue;
      if (this.deps.agentStatus.get(s.id) === 'blocked') blocked++;
    }
    return blocked;
  }

  /** Is the frameless popover the active surface right now (present + enabled)? */
  private usePopover(): boolean {
    return !!this.deps.popover && this.deps.popoverEnabled();
  }

  /**
   * Re-derive the tray surface after the `menubarPopoverEnabled` flag flips at
   * runtime. `rebuild()` already branches on {@link usePopover}: in popover mode
   * it clears the native menu (so the click toggles the card); in native mode it
   * re-attaches the context menu. Calling it is enough to switch either way.
   */
  refreshSurface() {
    this.rebuild();
  }

  private scheduleRebuild() {
    if (this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuild();
    }, 150);
  }

  /**
   * Sessions still alive that this scheduler spawned, one per schedule, tagged
   * with whether the agent has finished its turn. `finished` (the run carries a
   * `finishedAt`) means the pty is still open at the prompt but the work is
   * done — surfaced as "done · open" rather than counted as running.
   */
  private runningScheduled(): LiveRun[] {
    const out: LiveRun[] = [];
    for (const task of this.deps.scheduler.list()) {
      const aliveIds = new Set(
        this.deps.ptys
          .list(task.projectId)
          .filter((s) => s.status === 'running' || s.status === 'starting')
          .map((s) => s.id)
      );
      const run = task.status.runs.find((r) => !!r.sessionId && aliveIds.has(r.sessionId));
      if (run?.sessionId) {
        out.push({ task, sessionId: run.sessionId, finished: !!run.finishedAt });
      }
    }
    return out;
  }

  private rebuild() {
    if (!this.tray || this.tray.isDestroyed()) return;
    // Popover surface: the badge counts the whole fleet (needs-you first) and
    // the card owns the list — there's no native menu to build. Keep an open
    // popover live by re-pushing its snapshot.
    if (this.usePopover()) {
      try {
        const { needsYou, working } = this.deps.popover!.badgeCount();
        // The number is the WORKING count (what the fleet is actively doing);
        // agents that need you show as a RED dot on the icon (setTitle can't
        // color text on macOS) with the count in the tooltip. Both signals are
        // visible at once: `[glyph•] 3`. monospacedDigit keeps the number from
        // jittering in width as it changes.
        if (process.platform === 'darwin') {
          this.tray.setTitle(working > 0 ? ` ${working}` : '', { fontType: 'monospacedDigit' });
        }
        this.tray.setImage(this.makeIcon(needsYou > 0));
        this.tray.setToolTip(this.badgeTooltip(needsYou, working));
        // A native context menu would hijack the left-click; make sure none is
        // set so the click handler's toggle wins.
        this.tray.setContextMenu(null);
        this.deps.popover!.refresh();
      } catch (err) {
        this.log('rebuild popover', err);
      }
      return;
    }
    try {
      const tasks = this.deps.scheduler.list();
      const alive = this.runningScheduled();
      const aliveByTask = new Map(alive.map((r) => [r.task.id, r]));
      // "Working" = agent's turn is in progress. A finished-but-open session
      // (agent done, pty still at the prompt) is alive but not working, so it
      // drops out of the running count/badge.
      const workingCount = alive.filter((r) => !r.finished).length;

      // Badge: number of scheduled sessions actively working, macOS-only
      // (setTitle is a no-op elsewhere). Empty string clears it.
      if (process.platform === 'darwin') {
        this.tray.setTitle(workingCount > 0 ? ` ${workingCount}` : '', {
          fontType: 'monospacedDigit'
        });
      }
      // Fleet-wide attention still drives the red dot even in native mode (the
      // native menu lists only schedules, but a blocked agent anywhere warrants
      // the signal). setImage is cross-platform, so the dot shows on win/linux
      // too even though the count text doesn't.
      const blocked = this.fleetBlockedCount();
      this.tray.setImage(this.makeIcon(blocked > 0));
      this.tray.setToolTip(
        blocked > 0
          ? this.badgeTooltip(blocked, workingCount)
          : workingCount > 0
          ? `${workingCount} scheduled session${workingCount > 1 ? 's' : ''} running`
          : 'Zana Command Center'
      );

      const items: Electron.MenuItemConstructorOptions[] = [];
      items.push({
        label:
          workingCount > 0
            ? `${workingCount} scheduled session${workingCount > 1 ? 's' : ''} running`
            : 'No scheduled sessions running',
        enabled: false
      });
      items.push({ type: 'separator' });

      if (tasks.length === 0) {
        items.push({ label: 'No schedules', enabled: false });
      } else {
        const sorted = this.sortTasks(tasks, aliveByTask);
        for (const task of sorted.slice(0, MAX_ROWS)) {
          const live = aliveByTask.get(task.id);
          items.push({
            label: this.taskLabel(task, live),
            // An item with a submenu can't also carry a top-level click handler
            // on macOS, so the former row-click ("open") moves into the submenu.
            submenu: this.taskSubmenu(task, live)
          });
        }
        if (sorted.length > MAX_ROWS) {
          items.push({ label: `…and ${sorted.length - MAX_ROWS} more`, enabled: false });
        }
      }

      items.push({ type: 'separator' });
      items.push({
        label: 'Open Scheduler',
        click: () => {
          this.deps.showWindow();
          this.deps.openScheduler();
        }
      });
      items.push({
        label: 'Show Command Center',
        click: () => this.deps.showWindow()
      });
      items.push({ type: 'separator' });
      items.push({ label: 'Quit', role: 'quit' });

      this.tray.setContextMenu(Menu.buildFromTemplate(items));
    } catch (err) {
      this.log('rebuild', err);
    }
  }

  /** Running first, then enabled by soonest next run, then paused. */
  private sortTasks(
    tasks: ScheduledTask[],
    aliveByTask: Map<string, LiveRun>
  ): ScheduledTask[] {
    const rank = (t: ScheduledTask): number => {
      const live = aliveByTask.get(t.id);
      if (live && !live.finished) return 0; // actively working
      if (live) return 1; // done · session open
      if (t.enabled) return 2;
      return 3;
    };
    return [...tasks].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      const na = a.status.nextRunAt ? Date.parse(a.status.nextRunAt) : Infinity;
      const nb = b.status.nextRunAt ? Date.parse(b.status.nextRunAt) : Infinity;
      if (na !== nb) return na - nb;
      return a.name.localeCompare(b.name);
    });
  }

  private taskLabel(task: ScheduledTask, live: LiveRun | undefined): string {
    const project = this.deps.projectName(task.projectId);
    const status = live
      ? live.finished
        ? 'done · session open'
        : 'running now'
      : !task.enabled
      ? 'paused'
      : task.status.nextRunAt
      ? `next ${formatNextRun(task.status.nextRunAt)}`
      : 'idle';
    // ● working · ◍ done-but-open · ○ paused · (blank) idle-enabled.
    const dot = live ? (live.finished ? '◍ ' : '● ') : task.enabled ? '' : '○ ';
    return `${dot}${task.name} · ${project} — ${status}`;
  }

  /** Per-schedule actions: open/focus, Run now, and Pause/Enable. */
  private taskSubmenu(
    task: ScheduledTask,
    live: LiveRun | undefined
  ): Electron.MenuItemConstructorOptions[] {
    const sub: Electron.MenuItemConstructorOptions[] = [];
    if (live) {
      sub.push({
        label: live.finished ? 'Open session (finished)' : 'Open running session',
        click: () => {
          this.deps.showWindow();
          this.deps.focusSession(live.sessionId, task.projectId);
        }
      });
    }
    sub.push({
      label: 'Show in Scheduler',
      click: () => {
        this.deps.showWindow();
        this.deps.openScheduler(task.id);
      }
    });
    sub.push({ type: 'separator' });
    sub.push({
      label: 'Run now',
      click: () => {
        try {
          this.deps.scheduler.runNow(task.id);
        } catch (err) {
          this.log(`runNow ${task.id}`, err);
        }
      }
    });
    sub.push({
      label: task.enabled ? 'Pause' : 'Enable',
      click: () => {
        try {
          this.deps.scheduler.setEnabled(task.id, !task.enabled);
        } catch (err) {
          this.log(`setEnabled ${task.id}`, err);
        }
      }
    });
    return sub;
  }
}

/** Compact relative time for a future ISO timestamp. Past → "due". */
function formatNextRun(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return 'idle';
  if (ms <= 0) return 'due';
  const s = Math.round(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `in ${h}h ${remM}m` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d`;
}
