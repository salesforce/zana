/**
 * Wires the pieces into a running deck app. The root is a landing page holding a
 * single ZCC hub tile; pressing it opens a capability menu that fans out to the
 * live views (agents / projects / schedules / status). This is the "1 ZCC icon →
 * all the tools" model.
 *
 * Two data disciplines coexist:
 *  - The AGENTS view is live-polled (its status changes second-to-second), so a
 *    poll loop rebuilds it in place while it's on screen.
 *  - PROJECTS / SCHEDULES / STATUS change slowly, so they're fetched once on
 *    open (and on an explicit Refresh) rather than polled. The open handler
 *    returns instantly and pushes the built page when the fetch resolves — the
 *    HID press callback never blocks on I/O.
 *
 * `createDeckApp` takes an already-open `DeckDevice`, so tests drive it with a
 * `FakeDeck` and the bin wires the real Elgato one.
 */

import { DeckController, XL } from './deck/device.js';
import { Navigator, Page } from './deck/page.js';
import { buildMainPage } from './pages/main-page.js';
import { buildZccMenuPage } from './pages/zcc-menu-page.js';
import { buildAgentsPage } from './pages/agents-page.js';
import { buildAgentActionsPage } from './pages/agent-actions-page.js';
import { buildProjectsPage } from './pages/projects-page.js';
import { buildProjectActionsPage } from './pages/project-actions-page.js';
import { buildSchedulesPage, type ScheduleView } from './pages/schedules-page.js';
import { buildScheduleActionsPage } from './pages/schedule-actions-page.js';
import { buildStatusPage } from './pages/status-page.js';
import { buildLoadingPage } from './pages/loading-page.js';
import { ActionQueue, type DispatchResult } from './lib/actions.js';
import { AgentPoller } from './lib/poller.js';
import { ZccSource } from './lib/zcc-source.js';
import type { DeckDevice } from './deck/device.js';
import { isScheduled, FALLBACK_SPAWN_PROFILES } from './lib/types.js';
import type { AgentListItem, ProjectItem, ScheduleItem, SpawnProfileInfo } from './lib/types.js';

export interface DeckAppOpts {
  dataDir?: string;
  pollIntervalMs?: number;
  onResult?: (r: DispatchResult) => void;
}

export interface DeckApp {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createDeckApp(device: DeckDevice, opts: DeckAppOpts = {}): DeckApp {
  const source = new ZccSource({ dataDir: opts.dataDir });

  // The physical deck's grid — drives every page builder so layouts fold to the
  // connected model (8×4 XL, 5×3 original, …) instead of assuming XL.
  const geom = device.geometry ?? XL;

  // Root is the landing page; every view/overlay is pushed on top of it.
  const navigator = new Navigator(new Page('main'));
  const controller = new DeckController(device, navigator);

  // Each resolved intent flashes the tile that fired it (check-on-green /
  // cross-on-rust) before any caller-supplied onResult runs.
  const queue = new ActionQueue(source, (r) => {
    controller.flashResult(r.ok);
    opts.onResult?.(r);
  });

  // Last agent snapshot — kept so the hub/menu can badge the "needs you" count
  // (and cross-reference live schedule runs) without their own poll.
  let latestAgents: AgentListItem[] = [];
  // Exclude scheduler-spawned jobs: they're hidden from the grid (summarised by
  // the clock tile), so they must not inflate the "needs you" badge — the badge
  // counts only interactive agents.
  const blockedCount = () =>
    latestAgents.filter((a) => a.state === 'blocked' && !isScheduled(a)).length;
  // Which overflow page of the agents grid is showing (reset each time it opens).
  let agentsPageIndex = 0;

  const render = () => void controller.renderAll();
  const back = () => {
    navigator.pop();
    render();
  };

  // ── Agents (live-polled) ────────────────────────────────────────────────
  const openAgent = (agent: AgentListItem) => {
    navigator.push(buildAgentActionsPage(agent, { queue, back, geom }));
    render();
  };
  const buildAgents = (agents: AgentListItem[]): Page =>
    buildAgentsPage(agents, {
      openAgent,
      refresh: () => rebuildAgents(latestAgents),
      back,
      geom,
      pageIndex: agentsPageIndex,
      onMore: () => {
        agentsPageIndex += 1;
        navigator.replaceCurrent(buildAgents(latestAgents));
        render();
      },
      // Clock tile → jump to the schedules view (scheduled agents are hidden
      // from the grid and summarised by that tile's working-count badge).
      openSchedules: () => void showSchedules(false)
    });
  // A fresh snapshot: keep it, then re-render whichever agent-derived page is
  // visible — the agents grid itself, or the hub/menu whose "needs you" badge
  // is sourced from it. Never yanks a pushed overlay out from under the user.
  const rebuildAgents = (agents: AgentListItem[]) => {
    latestAgents = agents;
    const name = navigator.current.name;
    if (name === 'agents') {
      navigator.replaceCurrent(buildAgents(agents));
      render();
    } else if (name === 'main') {
      navigator.replaceCurrent(buildMainPage({ openMenu, blockedCount: blockedCount() }));
      render();
    } else if (name === 'zcc_menu') {
      navigator.replaceCurrent(buildMenu());
      render();
    }
  };
  const openAgents = () => {
    // Show the last snapshot immediately, then kick an out-of-band poll so the
    // grid is fresh without waiting up to intervalMs for the next tick.
    agentsPageIndex = 0;
    navigator.push(buildAgents(latestAgents));
    render();
    void poller.pollNow();
  };

  // Fetch-on-open views push a "Loading…" interstitial the instant they open
  // (so the keys never sit dead on the previous page during the round-trip),
  // then replace it in place with the real grid. `inFlight` guards a slow fetch
  // from being started twice by an impatient double-press.
  const inFlight = new Set<string>();
  const withLoading = async (
    view: string,
    caption: string,
    replace: boolean,
    build: () => Promise<Page>
  ) => {
    if (inFlight.has(view)) return;
    inFlight.add(view);
    // On open, push the placeholder; on refresh the view is already current, so
    // swap the placeholder in place. Either way one page ends up on top.
    if (replace) navigator.replaceCurrent(buildLoadingPage(caption, geom));
    else navigator.push(buildLoadingPage(caption, geom));
    render();
    try {
      const page = await build();
      navigator.replaceCurrent(page);
      render();
    } finally {
      inFlight.delete(view);
    }
  };

  // ── Projects (fetch-on-open) ────────────────────────────────────────────
  // Spawnable harness profiles (from `harness.list`) — the buttons the project
  // overlay offers. Refreshed alongside the projects list (they change only when
  // the user toggles a harness in Settings), and seeded with the guaranteed
  // claude/claude-yolo baseline so the very first overlay is never button-less.
  let spawnProfiles: SpawnProfileInfo[] = [...FALLBACK_SPAWN_PROFILES];
  const openProject = (project: ProjectItem) => {
    navigator.push(buildProjectActionsPage(project, { queue, back, geom, profiles: spawnProfiles }));
    render();
  };
  const showProjects = (replace: boolean) =>
    withLoading('projects', 'Projects', replace, async () => {
      // Fetch both in parallel; the profile list gates the overlay's spawn
      // buttons, so refresh it whenever the projects grid is (re)built.
      const [projects, profiles] = await Promise.all([
        source.listProjects(),
        source.listSpawnProfiles()
      ]);
      spawnProfiles = profiles;
      return buildProjectsPage(projects, { openProject, refresh: () => void showProjects(true), back, geom });
    });
  const openProjects = () => void showProjects(false);

  // ── Schedules (fetch-on-open) ───────────────────────────────────────────
  const openSchedule = (schedule: ScheduleItem) => {
    navigator.push(buildScheduleActionsPage(schedule, { queue, back, geom }));
    render();
  };
  // Body readout mode for the schedules grid — clock glyph vs "next run in …".
  // Persisted here (not in the page) so a Refresh/toggle rebuild keeps the mode.
  let scheduleView: ScheduleView = 'icon';
  const showSchedules = (replace: boolean) =>
    withLoading('schedules', 'Schedules', replace, async () => {
      const schedules = await source.listSchedules();
      // Cross-reference the last-fetched agents so a schedule whose spawned run
      // is still live colours yellow. `latestAgents` is kept fresh by the poller
      // while the agents/menu pages are up; on a cold open it's the last snapshot.
      const liveSessionIds = new Set(latestAgents.map((a) => a.sessionId));
      return buildSchedulesPage(schedules, {
        openSchedule,
        refresh: () => void showSchedules(true),
        back,
        geom,
        view: scheduleView,
        toggleView: () => {
          scheduleView = scheduleView === 'icon' ? 'eta' : 'icon';
          void showSchedules(true);
        },
        liveSessionIds
      });
    });
  const openSchedules = () => void showSchedules(false);

  // ── Status (fetch-on-open) ──────────────────────────────────────────────
  const showStatus = (replace: boolean) =>
    withLoading('status', 'Status', replace, async () => {
      const summary = await source.getStatus();
      return buildStatusPage(summary, { refresh: () => void showStatus(true), back, geom });
    });
  const openStatus = () => void showStatus(false);

  // ── Menu + landing ──────────────────────────────────────────────────────
  const buildMenu = (): Page =>
    buildZccMenuPage({
      openAgents,
      openProjects,
      openSchedules,
      openStatus,
      back,
      geom,
      blockedCount: blockedCount()
    });
  const openMenu = () => {
    navigator.push(buildMenu());
    render();
  };
  navigator.replaceRoot(buildMainPage({ openMenu, blockedCount: blockedCount() }));

  // The poll loop feeds the agents grid, and also keeps the hub/menu "needs you"
  // badge live while they're on screen — so ticks on those three pages, not just
  // the agents grid. Pushed overlays and the slow fetch-on-open views don't poll.
  const poller = new AgentPoller(source, rebuildAgents, {
    intervalMs: opts.pollIntervalMs ?? 1_500,
    shouldPoll: () => ['agents', 'main', 'zcc_menu'].includes(navigator.current.name)
  });

  return {
    async start() {
      await controller.renderAll();
      poller.start();
    },
    async stop() {
      poller.stop();
      await controller.close();
    }
  };
}
