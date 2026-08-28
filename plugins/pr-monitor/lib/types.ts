/**
 * Rollup status for a monitored pull request.
 *
 * Ordered roughly by severity (worst → best) for triage. `pending` covers PRs
 * whose checks have not yet reported. Terminal states (`closed-merged`,
 * `closed-abandoned`) indicate the PR has left the active review queue.
 */
export type PrRollupStatus =
  | 'pending'
  | 'failed'
  | 'conflict'
  | 'yellow'
  | 'review-required'
  | 'integrating'
  | 'green'
  | 'closed-merged'
  | 'closed-abandoned';

/**
 * A single CI check run reported against a PR's head commit.
 *
 * `state` is the raw value from the `gh` CLI (e.g. SUCCESS, FAILURE,
 * IN_PROGRESS). `bucket` is an optional normalized grouping used by the UI to
 * collapse related checks (e.g. "build", "tests", "lint").
 */
export interface CheckRun {
  name: string;
  state: string;
  bucket?: string;
}

/**
 * A pull request being actively tracked by PR Monitor.
 *
 * `mergeable` and `mergeStateStatus` come directly from `gh pr view` and feed
 * the rollup classifier. Timestamps are epoch milliseconds.
 * `projectId` is an optional manual project association for per-project filtering.
 *
 * **Phase 1 additions (tile redesign):** all OPTIONAL for backward compat.
 * `headRefName` = source branch. `author` = login/name (avatar bytes can't cross
 * the string-only exec channel — renderer draws initials).
 * `isDraft`, `body` (capped 280 chars), `createdAt` / `updatedAt` (epoch ms). `workItem` = extracted W-#######.
 * `source` governs Dismiss behavior ('manual' = delete, 'auto' = dismissed set).
 * Legacy records missing `source` are treated as 'manual'.
 * `discoveredVia` = provenance string for auto PRs.
 */
export interface MonitoredPr {
  url: string;
  repo: string;
  number: number;
  title: string;
  baseRefName: string;
  status: PrRollupStatus;
  mergeable: string;
  mergeStateStatus: string;
  checks: CheckRun[];
  addedAt: number;
  lastChecked: number;
  lastStatusChange: number;
  projectId?: string;
  /**
   * Last time user saw current status. `0` means user explicitly marked this PR
   * unread; omitted means never seen and falls back to `addedAt` for initial state.
   */
  lastSeenAt?: number;
  headRefName?: string;
  author?: PrAuthor;
  isDraft?: boolean;
  body?: string;
  createdAt?: number;
  /** When the PR last changed on GitHub (epoch ms, from `gh pr view` updatedAt). */
  updatedAt?: number;
  workItem?: string;
  source?: 'manual' | 'auto';
  discoveredVia?: string;
  /**
   * Per-PR mute (R-LIST-018). A muted PR generates no notifications regardless of
   * the global/per-repo switches, but stays in the list. Finest link of the
   * in-app AND-chain (AC-LIST-18.5).
   */
  muted?: boolean;
  /**
   * Per-PR favorite (R-LIST-026). A user-set find-faster marker, independent of
   * mute/seen/project: surfaces the row (star + light-yellow background) and drives
   * the "Favorites first" sort. Does NOT change polling/sync or protect the PR from
   * Sweep/dismiss. Absent = not favorite (no migration). One of the R-CORE-004
   * protected user-owned fields — carried across every poll.
   */
  favorite?: boolean;
  /**
   * Per-PR fetch-error indicator (R-LIST-023). Set when THIS PR's most recent sync
   * failed while GitHub was otherwise reachable — the row keeps its last-known
   * state marked stale (AC-LIST-23.2) and offers a retry. Cleared on the next
   * successful fetch. Distinct from the app-level disconnect warning (R-REPO-013).
   */
  syncError?: string;
  /** Epoch ms of the last SUCCESSFUL fetch — backs the "stale" presentation. */
  lastSyncOk?: number;
  /**
   * Reviewers grouped by review state (R-LIST-016). Derived main-side from
   * `gh pr view`'s `reviews` + `reviewRequests`. Optional for back-compat; a
   * record without it renders no reviewer group.
   */
  reviewers?: PrReviewer[];
  /**
   * When the PR's REVIEW clock started (epoch ms) — the moment it became Open,
   * reset on a Draft → Open transition (R-LIST-025 / AC-LIST-25.2). Backs the
   * review pill's days-scale elapsed time, independently of `lastStatusChange`
   * (which backs the build clock). Absent on a Draft (review has not begun) and
   * on legacy records (the review pill falls back to `lastStatusChange`).
   */
  reviewClockStartedAt?: number;
  /**
   * The PR's overall review decision (APPROVED / REVIEW_REQUIRED /
   * CHANGES_REQUESTED / '' ) from `gh pr view` (AC-LIST-25.5). Backs the review
   * pill's done-state and the merge-stall gate (build-happy AND review-approved,
   * AC-LIST-14.7). Absent on legacy records.
   */
  reviewDecision?: string;
  /**
   * Cached main-side verdict: is the build "happy" (all non-review checks
   * done+passing, ignored-check failures excluded)? (AC-LIST-13.7). Advisory
   * cache; the renderer recomputes live from `checks` + the repo's ignore list.
   */
  buildHappy?: boolean;
  /**
   * Cached main-side verdict: does this PR have the `tok-gimlet` SFCI-job comment
   * (AC-REPO-17.2)? Fetched in the poller (the renderer has no comments access).
   * Only meaningful on an `sfciGated` repo; absent means "unknown / not fetched".
   */
  hasSfciJob?: boolean;
}

/**
 * A reviewer's current review state on a PR (R-LIST-016). Grouped into exactly
 * three buckets the row displays: **approved**, **review-requested** (asked, not
 * yet answered), and **changes-requested**. Other GitHub review states
 * (COMMENTED / DISMISSED / PENDING) are not surfaced — they carry no triage
 * signal for "is review holding this PR up".
 */
export type ReviewState = 'approved' | 'review-requested' | 'changes-requested';

/**
 * One reviewer on a PR (R-LIST-016). `login` is the GitHub handle; `name` the
 * display name when known. No `avatarUrl`: like {@link PrAuthor}, avatar bytes
 * can only come through the brokered `gh` CLI as a `data:` URI (AC-LIST-16.2a),
 * and no binary exec channel exists today — the renderer draws initials.
 */
export interface PrReviewer {
  login: string;
  name?: string;
  state: ReviewState;
}

/**
 * Status transition emitted when a poll detects a change.
 *
 * Consumers use this to drive notifications and to decide whether to
 * auto-remove a terminal PR or keep it collapsed.
 */
export interface PrStatusDelta {
  url: string;
  oldStatus: PrRollupStatus;
  newStatus: PrRollupStatus;
  pr: MonitoredPr;
}

/**
 * Time-in-status threshold preset (R-SYS-008). A named standard range that maps
 * elapsed time-in-status to normal/warning/danger. Assigned per-repository
 * (R-REPO-014); the default is Standard. Governs the R-LIST-013 pill escalation
 * color and the R-LIST-014 stalled threshold only — not the elapsed value shown.
 */
export type TisPresetId = 'fast' | 'standard' | 'long-running';

export interface TisPreset {
  id: TisPresetId;
  label: string;
  warnHours: number;
  dangerHours: number;
}

/**
 * Build-phase (hours-scale) time-in-status presets (R-SYS-008): Fast 1h/2h,
 * Standard (default) 4h/6h, Long-running 12h/24h. Govern the BUILD pill
 * (R-LIST-013) — CI + the merge/precheckin step that follows review.
 */
export const TIS_PRESETS: Record<TisPresetId, TisPreset> = {
  fast: { id: 'fast', label: 'Fast', warnHours: 1, dangerHours: 2 },
  standard: { id: 'standard', label: 'Standard', warnHours: 4, dangerHours: 6 },
  'long-running': { id: 'long-running', label: 'Long-running', warnHours: 12, dangerHours: 24 },
};

export const DEFAULT_TIS_PRESET: TisPresetId = 'standard';

/**
 * Review-phase (days-scale) time-in-status preset (R-SYS-009). Same preset ids as
 * the build family but the thresholds are in DAYS: a PR waiting on review escalates
 * on a slower clock than a stuck build. Governs the REVIEW pill (R-LIST-025), shown
 * for Open (non-Draft) PRs only.
 */
export interface ReviewTisPreset {
  id: TisPresetId;
  label: string;
  warnDays: number;
  dangerDays: number;
}

/** Fast 1d/2d, Standard (default) 3d/5d, Long-running 7d/14d (R-SYS-009). */
export const REVIEW_TIS_PRESETS: Record<TisPresetId, ReviewTisPreset> = {
  fast: { id: 'fast', label: 'Fast', warnDays: 1, dangerDays: 2 },
  standard: { id: 'standard', label: 'Standard', warnDays: 3, dangerDays: 5 },
  'long-running': { id: 'long-running', label: 'Long-running', warnDays: 7, dangerDays: 14 },
};

export const DEFAULT_REVIEW_TIS_PRESET: TisPresetId = 'standard';

/**
 * The build-phase preset id in effect for a repo, tolerating the pre-two-pill
 * legacy shape: a persisted `MonitoredRepo` may carry only `tisPreset` (the old
 * single preset) instead of `buildTisPreset`. Reads new → legacy → default so a
 * migration on write is not required for the value to resolve correctly.
 */
function repoBuildPresetId(rec: MonitoredRepo | undefined): TisPresetId {
  const id = rec?.buildTisPreset ?? rec?.tisPreset;
  return id && id in TIS_PRESETS ? id : DEFAULT_TIS_PRESET;
}

function findRepo(repoFullName: string, repositories: MonitoredRepo[] | undefined): MonitoredRepo | undefined {
  const key = (repoFullName ?? '').toLowerCase();
  return key
    ? (repositories ?? []).find((r) => `${r.owner}/${r.repo}`.toLowerCase() === key)
    : undefined;
}

/**
 * Resolve the effective BUILD-phase thresholds (warn/danger HOURS) for a PR
 * (R-REPO-014 / AC-REPO-14.2/14.3, AC-LIST-13.3). The PR's repository build
 * preset OVERRIDES the global thresholds: a repo assigned `long-running`
 * escalates its build pill on a longer bar than the global default. A PR whose
 * repo isn't found falls back to the passed globals (themselves defaulting to the
 * Standard preset). `repoFullName` is the PR's `owner/repo`; matching is
 * case-insensitive. Legacy `tisPreset`-only repos resolve via the build preset.
 */
export function resolveBuildThresholds(
  repoFullName: string,
  repositories: MonitoredRepo[] | undefined,
  globalWarnHours: number,
  globalDangerHours: number
): { warnHours: number; dangerHours: number } {
  const rec = findRepo(repoFullName, repositories);
  if (rec) {
    const preset = TIS_PRESETS[repoBuildPresetId(rec)];
    return { warnHours: preset.warnHours, dangerHours: preset.dangerHours };
  }
  return { warnHours: globalWarnHours, dangerHours: globalDangerHours };
}

/**
 * Resolve the effective REVIEW-phase thresholds (warn/danger DAYS) for a PR
 * (R-REPO-014 / AC-SYS-9.2, AC-LIST-25.3). Mirrors {@link resolveBuildThresholds}
 * on the days-scale review family. A repo with no explicit `reviewTisPreset`
 * resolves to the default (Standard 3d/5d); an unknown repo falls back to the
 * passed globals.
 */
export function resolveReviewThresholds(
  repoFullName: string,
  repositories: MonitoredRepo[] | undefined,
  globalWarnDays: number,
  globalDangerDays: number
): { warnDays: number; dangerDays: number } {
  const rec = findRepo(repoFullName, repositories);
  if (rec) {
    const id = rec.reviewTisPreset && rec.reviewTisPreset in REVIEW_TIS_PRESETS ? rec.reviewTisPreset : DEFAULT_REVIEW_TIS_PRESET;
    const preset = REVIEW_TIS_PRESETS[id];
    return { warnDays: preset.warnDays, dangerDays: preset.dangerDays };
  }
  return { warnDays: globalWarnDays, dangerDays: globalDangerDays };
}

/**
 * Back-compat shim: the pre-two-pill call site name. Delegates to
 * {@link resolveBuildThresholds}. New code should call the build/review resolvers
 * directly. Retained so any un-migrated import keeps compiling.
 */
export function resolveTisThresholds(
  repoFullName: string,
  repositories: MonitoredRepo[] | undefined,
  globalWarnHours: number,
  globalDangerHours: number
): { warnHours: number; dangerHours: number } {
  return resolveBuildThresholds(repoFullName, repositories, globalWarnHours, globalDangerHours);
}

/**
 * Live connection state for an org/repo (R-ORG-005). Derived each sync/poll pass
 * from `gh` auth state — NOT persisted. `checking` is the transient in-flight
 * state; a settled pass lands on `connected` or `disconnected` (AC-ORG-5.4).
 */
export type ConnectionState = 'connected' | 'disconnected' | 'checking';

/**
 * Persisted sync-health bookkeeping (R-REPO-015/016). NOT the display shape — this
 * is the durable state the poller mutates across passes so a fault can be debounced
 * (remote-gone needs TWO consecutive failing passes, AC-REPO-16.5) and a kept-gone
 * repo can be excluded from future polls (AC-REPO-16.3). Keyed by lowercase
 * `owner/repo`.
 *   - `gone404[name]` — count of CONSECUTIVE remote-gone passes for a repo; reset to
 *     0 on any non-404 outcome. A repo reaches the Remove/Keep prompt at count ≥ 2.
 *   - `kept[]`        — repos the user chose to KEEP after a remote-gone prompt; they
 *     stay listed (PRs marked stale) but are excluded from the sync pass until the
 *     user removes them or they become reachable again (which clears the entry).
 */
export interface SyncHealthState {
  gone404: Record<string, number>;
  kept: string[];
}

export const EMPTY_SYNC_HEALTH_STATE: SyncHealthState = { gone404: {}, kept: [] };

/**
 * The DISPLAY shape of current sync-health (R-REPO-013), derived each poll from
 * {@link SyncHealthState} + the per-host probe outcomes. Drives the single
 * consolidated PR-list clue (AC-REPO-13.5) and the Remove/Keep prompt (R-REPO-016).
 * All lists are host/org-scoped, never global (AC-REPO-13.6).
 *   - `disconnectedHosts` — hosts whose `gh` auth is invalid (re-auth). Precedence
 *     wins over outage when both apply to a host (AC-REPO-15.5).
 *   - `outageHosts`       — hosts in a transient outage (wait/retry, auto-clears).
 *   - `remoteGone`        — repos confirmed gone (≥2 passes) awaiting a Remove/Keep
 *     decision. Each is `owner/repo`.
 *   - `keptGone`          — repos the user chose to keep; folded into the same clue
 *     (AC-REPO-16.4), not polled.
 */
export interface SyncHealth {
  disconnectedHosts: string[];
  outageHosts: string[];
  remoteGone: string[];
  keptGone: string[];
}

export const EMPTY_SYNC_HEALTH: SyncHealth = {
  disconnectedHosts: [],
  outageHosts: [],
  remoteGone: [],
  keptGone: [],
};

/**
 * A GitHub organization the user monitors (R-ORG-003). Seeded once-ever from the
 * authenticated `gh` accounts (R-ORG-002 anti-loop: discovery runs once, gated by
 * {@link PrMonitorSettings.orgDiscovered}, NOT "when the list is empty"). The user
 * can Delete an org (removes it + its repos + their PRs from PR Monitor, leaves gh
 * creds untouched) and only Re-discover repopulates. `apiBaseUrl` is derived from
 * the host. Connection state is live, not stored here.
 */
export interface MonitoredOrg {
  host: string;
  login: string;
  apiBaseUrl: string;
}

/**
 * A repository connected to PR Monitor (R-REPO-*). `owner`/`repo` compose the
 * `owner/repo` full name. `active` (R-REPO-012): only connected AND active repos
 * are synced; toggling active off is user-initiated and REMOVES that repo's PRs.
 * `notifyInApp` is the per-repo in-app notifications flag (AC-REPO-11.4), ANDed
 * with the global switch. `createdAt` = epoch ms added to PR Monitor. Connection
 * state is live (derived per sync), not stored here.
 *
 * **Two time-in-status presets (R-REPO-014):** `buildTisPreset` (R-SYS-008, hours)
 * governs the build pill; `reviewTisPreset` (R-SYS-009, days) governs the review
 * pill. Both default Standard. `tisPreset` is the LEGACY single-preset field kept
 * OPTIONAL for back-compat — a persisted pre-two-pill repo carries only `tisPreset`
 * and the resolvers (`resolveBuildThresholds`) read it as the build preset, so no
 * migration-on-write is required. New repos seed `buildTisPreset`/`reviewTisPreset`.
 *
 * **SFCI + ignored checks (R-REPO-017/018):** `sfciGated` (default false) marks a
 * repo whose build/merge runs through an SFCI Jenkins job — build/merge stall then
 * requires the `tok-gimlet` SFCI-job comment (AC-REPO-17.3/17.4). `ignoredFailingChecks`
 * (default empty) is a list of check-name substrings whose failures are counted as
 * passing for build/merge computation only (the rollup badge is unaffected,
 * AC-REPO-18.2); the "Ignore Snyk" toggle maps to `['Snyk']`.
 */
export interface MonitoredRepo {
  owner: string;
  repo: string;
  host: string;
  orgLogin: string;
  active: boolean;
  /** LEGACY single preset (pre-two-pill). Optional; read as the build preset when `buildTisPreset` is absent. */
  tisPreset?: TisPresetId;
  /** Build-phase (hours) preset (R-SYS-008), default Standard. */
  buildTisPreset?: TisPresetId;
  /** Review-phase (days) preset (R-SYS-009), default Standard. */
  reviewTisPreset?: TisPresetId;
  /** SFCI-gated repo (R-REPO-017), default false. */
  sfciGated?: boolean;
  /** Check-name substrings to ignore for build/merge status (R-REPO-018), default empty. */
  ignoredFailingChecks?: string[];
  createdAt: number;
  notifyInApp: boolean;
}

/**
 * PR author information. No avatar URL: the brokered `gh` exec channel returns a
 * utf-8 string only, so image bytes can't round-trip, and a renderer-issued
 * `<img src=https://…>` would be direct network egress the renderer isn't allowed
 * (AC-LIST-16.2a). The renderer draws initials from `name`/`login`.
 */
export interface PrAuthor {
  login: string;
  name?: string;
}

/**
 * The monitored author's persisted identity (R-PPL-003/004). Written ONCE by the
 * first author-discovery pass and re-synced SOLELY through the Organizations
 * Re-discover action (AC-PPL-2.2/5.3) — never live-read from `gh` on every
 * Author-area open. `identities` is the per-org login list; `connection` is NOT
 * stored (it is live-derived per open, R-ORG-005). Connection is layered onto the
 * stored identities at read time so the display is fresh without a discovery pass.
 */
export interface StoredAuthorIdentity {
  host: string;
  login: string;
}

export interface StoredAuthor {
  login: string;
  name?: string;
  email?: string;
  identities: StoredAuthorIdentity[];
}

/**
 * User-tunable PR Monitor preferences.
 *
 * `pollIntervalMinutes` is clamped to [15, 120]. `badgeMode` controls whether the
 * sidebar badge shows the total PR count (`total`, the default) or the count of
 * PRs with unseen status changes (`unread`).
 *
 * **Terminal PRs never auto-drop (AC-CORE-1.2/1.4):** closed/merged PRs stay in
 * the list; only an explicit Dismiss / bulk / Sweep action removes them. There is
 * no `terminalBehavior` toggle. **Display is always both surfaces
 * (AC-NAV-2.3/3.5):** the global sidebar and each project's PRs tab always render;
 * there is no `displayMode` toggle.
 *
 * **Auto-discovery (R-CORE-001, single-author):** discovery is AUTHORED-ONLY and
 * driven by the authenticated `gh` user (`author:@me`) — `discoverPrs` searches
 * each authenticated host with THAT host's own login. `watchedRepos` optionally
 * NARROWS discovery to specific `owner/repo`s (empty = search across the whole
 * account, no repo filter).
 *
 * DEPRECATED / vestigial — no longer read by discovery logic (kept only for
 * settings-shape backward-compat; do NOT reintroduce into `discoverPrs`):
 * `watchedPeople` (a roster of other people to follow — OQ-CORE-1/2 OUT of scope),
 * `relevanceModes.reviewRequested`/`involved` (out of scope), and `autoDiscover`
 * (discovery now runs whenever auto-sync runs; the master toggle is
 * `autoSyncEnabled`). `tisWarnHours`/`tisDangerHours` drive the time-in-status pill
 * coloring — hours since the PR entered its current rollup status
 * (`lastStatusChange`, NOT raw age). Default preset is 4h warn / 6h danger
 * (AC-LIST-13.3). `gusLocatorBaseUrl` optional for W-######## linking.
 *
 * **Accounts (host targeting):** discovery runs against authenticated `gh` accounts
 * (see {@link GhAccount}), auto-detected from `gh auth status` — the user never types
 * a hostname. `discoverHosts` persists which detected account hosts are ENABLED for
 * discovery; `undefined` means "all detected accounts" (the default). Toggling an
 * account off in Settings writes the remaining enabled hosts here.
 */
export interface PrMonitorSettings {
  pollIntervalMinutes: number;
  notifyOnChange: boolean;
  badgeMode: 'total' | 'unread';
  watchedRepos: string[];
  watchedPeople: string[];
  relevanceModes: {
    authored: boolean;
    reviewRequested: boolean;
    involved: boolean;
  };
  autoDiscover: boolean;
  /**
   * Enabled account hosts for discovery. `undefined` = all detected accounts
   * (default). A concrete array is the set of hosts the user left toggled on in
   * the Accounts section. Populated from {@link GhAccount} hosts, never typed.
   */
  discoverHosts?: string[];
  /** Global BUILD-phase (hours) thresholds — the fallback when a repo has no build preset (AC-LIST-13.3). */
  tisWarnHours?: number;
  tisDangerHours?: number;
  /** Global REVIEW-phase (days) thresholds — the fallback when a repo has no review preset (AC-LIST-25.3). */
  reviewWarnDays?: number;
  reviewDangerDays?: number;
  gusLocatorBaseUrl?: string;

  // --- Stage-2 Settings IA (grouped left-nav) ---
  /**
   * Persisted active left-nav row of the Settings shell (R-SET-003 / AC-3.7).
   * Defaults to 'organizations' when unset.
   */
  settingsActiveNav?: SettingsNavId;
  /**
   * Monitored organizations (R-ORG-*). Seeded once from `gh` accounts, gated by
   * {@link orgDiscovered}. User Delete/Re-discover mutate this.
   */
  organizations?: MonitoredOrg[];
  /** Connected repositories (R-REPO-*). */
  repositories?: MonitoredRepo[];
  /**
   * Anti-loop once-ever discovery flags (R-ORG-002 / R-PPL-002). `true` once the
   * first auto-discovery pass has run, so a delete→reappear→delete loop can't
   * happen; only an explicit Re-discover repopulates.
   */
  orgDiscovered?: boolean;
  authorDiscovered?: boolean;
  /**
   * The persisted monitored author (R-PPL-003/004). Written once by the first
   * author-discovery pass (gated by {@link authorDiscovered}) and re-synced only
   * via the Organizations Re-discover action — NOT re-fetched from `gh` on every
   * Author-area open (AC-PPL-2.2/5.3). Connection state is layered on live at read.
   */
  author?: StoredAuthor;
  /**
   * Global in-app notifications master switch (R-NOTIF-001). ANDed with each
   * repo's {@link MonitoredRepo.notifyInApp} and the per-PR mute (R-LIST-018).
   * Mirrors the legacy {@link notifyOnChange} for back-compat.
   */
  notifyInApp?: boolean;
  /**
   * Send-to-Inbox toggle (R-NOTIF-003). Additive over the shared MUTE scoping;
   * also requires a Project association (AC-INBOX-2.3). Independent of the in-app
   * flag.
   */
  sendToInbox?: boolean;
  /**
   * Auto-Sync master toggle (R-SYS-002). When off, the background poller does not
   * run on the interval; the Sync Interval stays editable and governs the next
   * run once re-enabled. Default true.
   */
  autoSyncEnabled?: boolean;
}

/**
 * Settings left-nav row ids (R-SET-002/003). Order + grouping:
 *   GITHUB → organizations, repositories, author
 *   CONFIGURATION → notifications
 *   SYSTEM → system
 */
export type SettingsNavId =
  | 'organizations'
  | 'repositories'
  | 'author'
  | 'notifications'
  | 'system';

export const DEFAULT_SETTINGS_NAV: SettingsNavId = 'organizations';

/**
 * An authenticated `gh` account, auto-detected by parsing `gh auth status`.
 * Each authenticated host becomes one account. `apiBaseUrl` is derived from the
 * host (public github.com → `https://api.github.com`; GHE → `https://<host>/api/v3`),
 * matching how CodeNod stores an Organization's `github_base_url`. `active` mirrors
 * `gh`'s own "Active account" flag for that host. This is discovered state, NOT
 * persisted settings — {@link PrMonitorSettings.discoverHosts} records which hosts
 * the user has ENABLED for discovery.
 */
export interface GhAccount {
  host: string;
  login: string;
  apiBaseUrl: string;
  active: boolean;
}

export const DEFAULT_PR_MONITOR_SETTINGS: PrMonitorSettings = {
  pollIntervalMinutes: 15,
  notifyOnChange: true,
  badgeMode: 'total',
  watchedRepos: [],
  watchedPeople: [],
  relevanceModes: {
    authored: true,
    reviewRequested: true,
    involved: true,
  },
  autoDiscover: false,
  discoverHosts: undefined,
  tisWarnHours: 4,
  tisDangerHours: 6,
  reviewWarnDays: 3,
  reviewDangerDays: 5,
  gusLocatorBaseUrl: undefined,
  settingsActiveNav: DEFAULT_SETTINGS_NAV,
  organizations: [],
  repositories: [],
  orgDiscovered: false,
  authorDiscovered: false,
  notifyInApp: true,
  sendToInbox: false,
  autoSyncEnabled: true,
};

/**
 * Cache key under which the background poller stashes the monitored-PR count,
 * read synchronously by the sidebar nav badge factory in `renderer-entry`.
 */
export const MONITORED_COUNT_CACHE_KEY = 'monitoredCount';

/**
 * Cache key under which the background poller writes the most recent
 * {@link MonitoredPr} list, so the panel can paint instantly on mount.
 */
export const MONITORED_PRS_CACHE_KEY = 'monitoredPrs';

/**
 * Storage key for user-tunable preferences ({@link PrMonitorSettings}).
 * Single source of truth — the SetupGate, SettingsView, and Background poller
 * all reach for the same key so a write in one place is visible everywhere.
 */
export const SETTINGS_STORAGE_KEY = 'settings';

/**
 * Cache keys under which the background poller PREFETCHES the three Settings
 * collections (organizations, connected repositories, author identity) at app
 * start, so the respective Settings areas paint instantly from cache instead of
 * waiting on a `gh`-backed `host.call` when the user first opens them
 * (R-SET-005 background prefetch). Each value is the resolved capability payload
 * (`{ ok, orgs|repos|author }`); an area reads it synchronously for first paint,
 * then still fires its own `load()` to refresh. `null`/absent → the area falls
 * back to its normal loading spinner, so a cold cache is never a broken state.
 */
export const PREFETCH_ORGS_CACHE_KEY = 'prefetch:orgs';
export const PREFETCH_REPOS_CACHE_KEY = 'prefetch:repos';
export const PREFETCH_AUTHOR_CACHE_KEY = 'prefetch:author';

// Match both public GitHub and GitHub Enterprise (e.g., gitcore.soma.salesforce.com)
const GITHUB_PR_URL_RE = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;

/**
 * Extract the "org/repo" slug from a GitHub PR URL.
 * Throws if the URL is not a recognizable PR URL.
 */
export function repoOf(url: string): string {
  const m = GITHUB_PR_URL_RE.exec(url);
  if (!m) {
    throw new Error(`Not a GitHub PR URL: ${url}`);
  }
  return m[2]; // org/repo is now in capture group 2
}

/**
 * Extract the numeric PR number from a GitHub PR URL.
 * Throws if the URL is not a recognizable PR URL.
 */
export function prNumber(url: string): number {
  const m = GITHUB_PR_URL_RE.exec(url);
  if (!m) {
    throw new Error(`Not a GitHub PR URL: ${url}`);
  }
  return Number(m[3]); // PR number is now in capture group 3
}

/**
 * Extract the git host (e.g. `github.com`, `git.soma.salesforce.com`) from a
 * GitHub PR URL. Backs the host/remote filter (R-LIST-027) — every
 * {@link MonitoredPr} carries its host implicitly in `url`, not as a stored
 * field, so filtering by host derives it on read. Throws if the URL is not a
 * recognizable PR URL, mirroring {@link repoOf}/{@link prNumber}.
 */
export function hostOf(url: string): string {
  const m = GITHUB_PR_URL_RE.exec(url);
  if (!m) {
    throw new Error(`Not a GitHub PR URL: ${url}`);
  }
  return m[1];
}

const STATUS_PRIORITY: Record<PrRollupStatus, number> = {
  failed: 7,
  conflict: 6,
  yellow: 5,
  'review-required': 4,
  pending: 3,
  integrating: 2,
  green: 1,
  'closed-abandoned': 0,
  'closed-merged': 0,
};

/**
 * Ordinal priority of a status — higher means "worse / more attention-grabbing".
 * Used to roll up a list of PRs to a single chip color.
 */
export function statusPriority(status: PrRollupStatus): number {
  return STATUS_PRIORITY[status];
}

/**
 * Return the highest-priority status across a list of PRs (the rollup chip's status).
 * Returns `'green'` when the list is empty so callers don't have to special-case it.
 */
export function worstStatus(prs: MonitoredPr[]): PrRollupStatus {
  if (prs.length === 0) {
    return 'green';
  }
  let worst: PrRollupStatus = prs[0].status;
  for (let i = 1; i < prs.length; i++) {
    if (statusPriority(prs[i].status) > statusPriority(worst)) {
      worst = prs[i].status;
    }
  }
  return worst;
}

/**
 * **Canonical triage-severity rank (AC-LIST-12.5).** The nine statuses have ONE
 * fixed total order, most-needs-attention first (rank 1 = most severe). Used
 * everywhere a severity ranking is required — the **Status** sort (AC-LIST-9.1)
 * and the "worsens the status" inbox test (AC-INBOX-2.2). Distinct from
 * {@link STATUS_PRIORITY}, which is the older board rollup-chip ordering and is
 * NOT this order — do not conflate them.
 *
 *   1 Merge conflict · 2 Failing · 3 Merge blocked · 4 Review required ·
 *   5 Pending · 6 Merging · 7 All checks passing · 8 Merged · 9 Closed
 */
const TRIAGE_SEVERITY_RANK: Record<PrRollupStatus, number> = {
  conflict: 1,
  failed: 2,
  yellow: 3,
  'review-required': 4,
  pending: 5,
  integrating: 6,
  green: 7,
  'closed-merged': 8,
  'closed-abandoned': 9,
};

/**
 * Canonical triage-severity rank of a status (AC-LIST-12.5), rank 1 = most
 * severe. Drives the Status sort (AC-LIST-9.1).
 */
export function triageSeverityRank(status: PrRollupStatus): number {
  return TRIAGE_SEVERITY_RANK[status];
}

/**
 * Canonical GUS work-item shape: `W-` followed by exactly 8 digits, on word
 * boundaries so it doesn't match inside a larger token (`fooW-12345678` →
 * no match). Case-insensitive on the `W`. (AC-LIST-11.3a.)
 */
const WORK_ITEM_RE = /\bW-\d{8}\b/i;

/**
 * Extract the GUS work-item ID (`W-########`) for a PR, scanning sources in a
 * fixed precedence: title → head branch → body. Returns the FIRST match found
 * (AC-LIST-11.3a), uppercased, or undefined when none of the sources contain
 * one. Branch/body are optional so legacy single-arg callers still compile.
 */
export function extractWorkItem(
  title: string,
  branch?: string,
  body?: string
): string | undefined {
  for (const source of [title, branch, body]) {
    if (typeof source !== 'string' || !source) continue;
    const m = WORK_ITEM_RE.exec(source);
    if (m) return m[0].toUpperCase();
  }
  return undefined;
}

/**
 * Validate a work-item id against a locator base URL and build the deep link
 * (AC-LIST-11.3b/c). Returns the link string ONLY when BOTH hold:
 *   - `locatorBase` parses as an `http(s)` URL, and
 *   - `id` is exactly `W-` + 8 digits (`^W-\d{8}$`),
 * otherwise null so the caller renders plain text (no unsafe href). The id is
 * URL-encoded before being appended.
 */
export function buildWorkItemLink(
  id: string | undefined,
  locatorBase: string | undefined
): string | null {
  if (!id || !locatorBase) return null;
  if (!/^W-\d{8}$/i.test(id)) return null;
  let base: URL;
  try {
    base = new URL(locatorBase);
  } catch {
    return null;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;
  const trimmed = locatorBase.replace(/\/+$/, '');
  return `${trimmed}/${encodeURIComponent(id.toUpperCase())}`;
}
