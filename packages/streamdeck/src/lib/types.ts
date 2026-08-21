/**
 * Read-only type subsets this package needs, mirroring shapes from core's
 * `packages/domain` and the control-plane dep interface in
 * `src/main/control-plane.ts`. Declared here (rather than imported) to keep the
 * package self-contained — same discipline as `@zcc/cli`'s `lib/types.ts`.
 */

/**
 * Live agent state, fused server-side onto each `agent.list` row. MIRROR of
 * core's `AgentState` (`packages/domain`). Add a value in core and this must
 * follow.
 */
export type AgentState = 'working' | 'blocked' | 'done' | 'idle' | 'unknown';

/**
 * One row from the `agent.list` control-plane op: the inter-agent registry
 * (identity) fused with live `state`. `handle` is authoritative but only present
 * once the agent called `register_agent`; `displayName` is the drifting tab
 * title. Address an agent by `handle ?? displayName`.
 */
export interface AgentListItem {
  sessionId: string;
  projectId: string;
  handle?: string;
  displayName?: string;
  role?: string;
  capabilities?: string[];
  cwd: string;
  /** Fused server-side from `getAgentStatus(sessionId)`. */
  state: AgentState;
  /**
   * True when this session was spawned by the scheduler (a background job, not a
   * tab the user opened) — mirrors core's `TerminalSession.scheduled`. Present
   * only once the app projects it onto `agent.list`; until then `isScheduled()`
   * falls back to the "Scheduled: …" title the scheduler stamps.
   */
  scheduled?: boolean;
}

/**
 * Is this a scheduler-spawned background agent? Prefers the authoritative
 * `scheduled` flag; falls back to the `"Scheduled: <task>"` title the scheduler
 * bakes in (mirrored into `displayName`), so the deck can hide these out of the
 * agents grid even before the control-plane projection carries the flag.
 */
export function isScheduled(a: AgentListItem): boolean {
  return a.scheduled === true || (a.displayName?.startsWith('Scheduled: ') ?? false);
}

/**
 * Best human label for an agent. Deliberately prefers `displayName` (the live
 * tab title) over `handle`, so the deck caption reads the SAME string the app's
 * Kanban card shows (`session.title`) — the two surfaces name an agent alike.
 * `handle` is the fallback for a registered-but-untitled agent, `sessionId`
 * the last resort. (Contrast: core's `agentLabel()` prefers the addressable
 * handle; the deck is a glance surface, so recognisability beats addressability.)
 */
export function agentLabel(a: AgentListItem): string {
  return a.displayName ?? a.handle ?? a.sessionId;
}

/**
 * The status buckets the physical deck renders. The agent-tile colour language
 * (per the operator's spec) is: `busy` = yellow (working), `idle` = neutral/no
 * colour (present but quiet), `attention` = red (needs a human). `running`
 * (green) is kept for NON-agent chrome — success flashes, enabled schedules, the
 * loading page — so those stay green rather than reading as "an agent working".
 * `error` (rust) and `done` (teal) round out the stale / finished edge states.
 */
export type DeckStatus = 'idle' | 'busy' | 'running' | 'attention' | 'error' | 'done';

/**
 * Map a live `AgentState` to a deck agent-tile colour bucket:
 *  - `working` → `busy` (YELLOW): actively doing work.
 *  - `blocked` → `attention` (RED): waiting on a human — the "needs you" glance.
 *  - `idle`    → `idle` (NEUTRAL / no colour): present but quiet.
 *  - `done`    → `done` (teal): finished its run, distinct from idle.
 *  - `unknown` → `error` (rust): stale/unreachable, visibly distinct from idle.
 */
export function stateToDeckStatus(state: AgentState): DeckStatus {
  switch (state) {
    case 'working':
      return 'busy';
    case 'blocked':
      return 'attention';
    case 'unknown':
      return 'error';
    case 'done':
      return 'done';
    case 'idle':
    default:
      return 'idle';
  }
}

/**
 * One row from the `project.list` control-plane op. Read-only subset of core's
 * `Project` (`packages/domain`) — only the fields the deck renders/acts on.
 * `tag` is the URL-safe slug; `name` is the display label.
 */
export interface ProjectItem {
  id: string;
  name: string;
  path: string;
  tag?: string;
}

/** Best human label for a project tile. */
export function projectLabel(p: ProjectItem): string {
  return p.tag ?? p.name ?? p.id;
}

/**
 * Curated, visually-distinct project-identity palette. Deliberately excludes
 * pure red — red is reserved for the "needs you" alert border, so a project dot
 * never reads as an alert. Indexed by a cheap hash of the project id.
 */
const PROJECT_PALETTE: [number, number, number][] = [
  [66, 165, 245], // blue
  [102, 187, 106], // green
  [255, 167, 38], // orange
  [171, 71, 188], // purple
  [38, 198, 218], // cyan
  [255, 238, 88], // yellow
  [141, 110, 99], // brown
  [236, 64, 122], // pink
  [126, 87, 194], // deep purple
  [156, 204, 101], // lime
  [255, 112, 67], // deep orange
  [41, 182, 246] // light blue
];

/**
 * Stable identity colour for a project, derived from its id so the same project
 * always dots the same colour on every agent tile — no project list fetch
 * needed. A finite curated palette (not free-form HSL) keeps the colours far
 * enough apart to tell projects apart at a glance on the deck.
 */
export function projectColor(projectId: string): [number, number, number] {
  let h = 0;
  for (let i = 0; i < projectId.length; i += 1) h = (h * 31 + projectId.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
}

/**
 * One row from the `sched.list` control-plane op. Read-only subset of core's
 * `ScheduledTask`. `enabled` drives the tile colour (green when on); `schedule`
 * carries the human cadence for the label. `status` carries the next planned
 * fire (`nextRunAt`) and the last spawned session id — the app already sends the
 * whole `ScheduledTask`, so these ride along for free; the deck uses them for
 * the "next run in …" readout and to colour a running schedule yellow.
 */
export interface ScheduleItem {
  id: string;
  name: string;
  enabled: boolean;
  projectId: string;
  schedule?: { every?: string; cron?: string; tz?: string };
  status?: {
    /** ISO-8601 timestamp of the next planned fire. */
    nextRunAt?: string;
    /** Session id of the most recent spawned run (may still be live). */
    lastRunSessionId?: string;
  };
}

/** Best human label for a schedule tile. */
export function scheduleLabel(s: ScheduleItem): string {
  return s.name ?? s.id;
}

/**
 * Is this schedule's most recent run still a live session? True when its
 * `status.lastRunSessionId` matches a currently-listed agent — the scheduler
 * spawns a real terminal per fire, so an in-flight run shows up in `agent.list`.
 * Used to colour a mid-run schedule yellow ("busy"), matching the agent tiles.
 */
export function isScheduleRunning(s: ScheduleItem, liveSessionIds: ReadonlySet<string>): boolean {
  const sid = s.status?.lastRunSessionId;
  return !!sid && liveSessionIds.has(sid);
}

/**
 * Compact "time until next fire" for a schedule tile, from `status.nextRunAt`.
 *  - `now` in ms (injected so this is pure/testable).
 *  - <1 min → "<1m"; else the largest one or two units ("5m", "2h", "1d 3h").
 *  - past-due / missing / unparseable → "due" / "—" so the tile never shows junk.
 */
export function nextRunEta(s: ScheduleItem, now: number): string {
  const iso = s.status?.nextRunAt;
  if (!iso) return '—';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '—';
  const ms = at - now;
  if (ms <= 0) return 'due';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    const remM = mins % 60;
    return remM ? `${hrs}h ${remM}m` : `${hrs}h`;
  }
  const days = Math.floor(hrs / 24);
  const remH = hrs % 24;
  return remH ? `${days}d ${remH}h` : `${days}d`;
}

/**
 * The `status` control-plane op's shape — a cheap fleet overview. `agents`
 * carries each live agent's fused `state`, from which the deck derives the
 * working/blocked counts for the status page.
 */
export interface StatusSummary {
  projects: number;
  agents: { sessionId: string; handle?: string; state: AgentState }[];
  enabledSchedules: { id: string; name: string }[];
}

/**
 * A launch-profile id the deck can spawn via `term.create`. The app is the
 * authority on which ids are valid (it gates on enabled × installed harnesses
 * and returns the concrete set from `harness.list`), so the deck treats this as
 * an opaque string rather than re-encoding core's `VALID_PROFILES` union — a
 * physical button just forwards whatever id the app offered. `claude` /
 * `claude-yolo` are the guaranteed baseline used when `harness.list` is
 * unavailable (an app too old to know the op).
 */
export type SpawnProfile = string;

/**
 * One spawnable harness profile as returned by the app's `harness.list` op —
 * every profile of every enabled × installed harness family. `id` is the
 * concrete `term.create` profile, `family` groups the buttons, `label` is the
 * short caption, and `yolo` marks the permission-bypass variant so the deck can
 * style it distinctly. The deck never invents these; it renders what the app sends.
 */
export interface SpawnProfileInfo {
  id: SpawnProfile;
  family: string;
  label: string;
  yolo: boolean;
}

/** The baseline offered when `harness.list` is unavailable or empty. */
export const FALLBACK_SPAWN_PROFILES: readonly SpawnProfileInfo[] = [
  { id: 'claude', family: 'claude', label: 'Claude', yolo: false },
  { id: 'claude-yolo', family: 'claude', label: 'Claude Yolo', yolo: true }
];

export function isSpawnProfileInfo(v: unknown): v is SpawnProfileInfo {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.family === 'string' &&
    typeof v.label === 'string' &&
    typeof v.yolo === 'boolean'
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function isProjectItem(v: unknown): v is ProjectItem {
  return isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string';
}

export function isScheduleItem(v: unknown): v is ScheduleItem {
  return isRecord(v) && typeof v.id === 'string' && typeof v.enabled === 'boolean';
}

export function isStatusSummary(v: unknown): v is StatusSummary {
  return isRecord(v) && typeof v.projects === 'number' && Array.isArray(v.agents);
}
