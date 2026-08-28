/**
 * PR Monitor — main process side.
 *
 * Tracks a small list of GitHub PRs, polls their CI + merge state via the
 * brokered `gh` CLI, and computes a rollup status for each on every poll.
 * Persists the watch list and last-known status to `ctx.storage` (the
 * host-side per-extension KV) so a restart picks up where the last poll left
 * off and the renderer always has a snapshot to display while a fresh poll is
 * in flight.
 *
 * Capabilities exposed to the renderer via `ModuleHost.call` (see the returned
 * object below for the full set): PR lifecycle (pullPr, removePr, listPrs,
 * pollAll, syncRepos, dismissPr(s), setPrsSeen, …), repo/org management
 * (listRepos, addRepository, listOrgs, …), and getAuthor. Settings are read and
 * written by the renderer directly through `host.storage` (SETTINGS key), not a
 * capability.
 *
 * Storage keys (per-extension, namespaced by host):
 *   - `prs`: `Record<string, MonitoredPr>` keyed by canonical PR URL.
 *   - `settings`: `PrMonitorSettings` (merged into defaults on read).
 *
 * The Salesforce p4-branch autointegrate workflow needs a richer closed-PR
 * verdict than "closed = abandoned": some PRs close while the change syncs
 * onward to a `p4/` branch. The closed-state path probes the PR's issue
 * comments + the destination branch via `gh api` to decide
 * 'closed-merged' / 'integrating' / 'closed-abandoned'. See {@link probeLanding}.
 */

import type { PrMonitorContext } from './context.js';
import {
  DEFAULT_PR_MONITOR_SETTINGS,
  DEFAULT_TIS_PRESET,
  DEFAULT_REVIEW_TIS_PRESET,
  EMPTY_SYNC_HEALTH,
  EMPTY_SYNC_HEALTH_STATE,
  extractWorkItem,
  prNumber,
  repoOf,
  type CheckRun,
  type ConnectionState,
  type MonitoredOrg,
  type MonitoredPr,
  type MonitoredRepo,
  type PrMonitorSettings,
  type PrRollupStatus,
  type PrStatusDelta,
  type StoredAuthor,
  type SyncHealth,
  type SyncHealthState,
  type TisPresetId,
  TIS_PRESETS,
} from './types.js';
import {
  fetchChecks,
  fetchMergeState,
  getAuthHosts,
  getAuthUser,
  ghApi,
  invalidateAuthHosts,
  isSafeRepoArg,
  listOrgRepos,
  listReposAllHosts,
  probeRepoFault,
  searchPrs,
  searchRepos,
  searchReposAllHosts,
  suggestedRepos,
  testRepoConnection,
  type AuthUser,
  type MergeStateInfo,
  type RemoteRepo,
  type SuggestedRepo,
} from './gh-client.js';
import { isKeptGone, reduceSyncHealth, type RepoProbe } from './sync-health.js';
import {
  computeClosedStatus,
  computeStatus,
  destBranches,
  hasSfciJobComment,
  parsePrUrl,
  SYNC_RE,
  type LandingProbe,
} from './status.js';
import { isBuildHappy } from './pillState.js';

/** Storage key for the watch list. */
const PRS_KEY = 'prs';
/** Storage key for user settings. */
const SETTINGS_KEY = 'settings';
/** Storage key for dismissed auto-discovered PRs (url → dismissedAt). */
const DISMISSED_KEY = 'dismissedUrls';
/** Storage key for the persisted sync-health bookkeeping (R-REPO-015/016). */
const SYNC_HEALTH_KEY = 'syncHealth';

/**
 * Max repos probed for sync-health per poll (Rule 5 — bound the round-trips). A
 * probe is one `gh api repos/<o>/<r>` call; capping keeps a large repo list from
 * turning one poll into hundreds of `gh` spawns. Repos beyond the cap keep their
 * prior health state untouched (not cleared) and are probed on a later pass.
 */
const SYNC_HEALTH_PROBE_CAP = 40;

/**
 * How many PR `gh` round-trips run concurrently within one poll (Rule 5 — bound
 * the parallel `gh` spawns). `pollAll` is a single brokered capability call with
 * a hard ~30s dispatch deadline in the host; each PR needs several SERIAL `gh`
 * subprocess calls (discovery: fetchMergeState + fetchChecks + classify; refresh:
 * refreshOne's own round-trips), so doing every PR serially blows the deadline
 * once discovery is live and the authored set is more than a handful — especially
 * over VPN to a GHE host. A small concurrent window keeps wall-clock well under
 * the deadline without fan-out'ing hundreds of `gh` spawns at once.
 */
const PR_FETCH_CONCURRENCY = 6;

/**
 * Max NEW PRs fetched-and-added in one discovery pass (Rule 5 — bound the work an
 * unbounded authored-set can create). A first run against a busy account could
 * surface many open authored PRs; capping the per-pass adds keeps one poll inside
 * the dispatch deadline. Remaining new PRs are picked up on the next pass (they
 * are still open, so the next `searchPrs` re-surfaces them). Already-tracked PRs
 * are refreshed separately and are not subject to this cap.
 */
const DISCOVER_ADD_CAP = 40;

/**
 * Max URLs honored in one bulk user-field mutation (favorite/unfavorite over a
 * selection). Defensive bound (Rule 5) — the list is renderer-supplied, so a
 * runaway selection can't turn one call into an unbounded read-modify-write.
 * Beyond the cap the extra URLs are ignored (the operation still succeeds for
 * the first `BULK_URL_CAP`); the realistic on-screen selection is far smaller.
 */
const BULK_URL_CAP = 500;

/**
 * Object keys that must never be written into the `prs` map by URL — a
 * renderer-supplied URL of `__proto__` / `constructor` / `prototype` would walk
 * the prototype chain (an `in` / truthy check treats them as present). Every
 * per-URL mutation gates on `hasOwnProperty` AND rejects these explicitly so a
 * crafted URL can't pollute the prototype.
 */
const FORBIDDEN_URL_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** True when `url` is a real own key of `prs` and not a prototype-chain trap. */
function isMutablePrKey(prs: Record<string, MonitoredPr>, url: string): boolean {
  return !FORBIDDEN_URL_KEYS.has(url) && Object.prototype.hasOwnProperty.call(prs, url);
}

/**
 * Run `worker` over `items` with at most `limit` in flight at once. Preserves no
 * ordering guarantee to the caller beyond "all settle before resolve"; a worker
 * that throws is surfaced to the caller (workers here swallow their own errors).
 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Min/max for `pollIntervalMinutes`. The Settings UI offers a fixed dropdown
 * (15 / 30 / 60 / 120; OQ-SYS-5). A stored or tampered value is clamped into
 * [15, 120] here so the poll loop never runs tighter than every 15 minutes.
 */
const POLL_MIN = 15;
const POLL_MAX = 120;

/** `ctx.storage.get` may be sync (built-in) or async (broker). Normalize. */
async function readStorage<T>(ctx: PrMonitorContext, key: string): Promise<T | undefined> {
  // Awaiting a non-promise simply yields the value; this normalizes both forms
  // without a runtime probe that would NPE on `undefined`.
  return await ctx.storage.get<T>(key);
}

async function readPrs(ctx: PrMonitorContext): Promise<Record<string, MonitoredPr>> {
  const stored = await readStorage<Record<string, MonitoredPr>>(ctx, PRS_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

/**
 * In-process mutex serializing every read-modify-write of the `prs` KV
 * (R-CORE-004, AC-CORE-4.1/4.2). `ctx.storage` offers no transaction, and a poll
 * spends seconds in `gh` round-trips between its read and its write — so a user
 * action (assignProject / markSeen / setMuted / dismiss) landing in that window
 * would be lost when the poll writes its stale snapshot back. Every writer now
 * runs its read-modify-write inside this lock; the requirement mandates the
 * *outcome* (neither change lost) and leaves the mechanism to implementation.
 *
 * The chain is intentionally failure-tolerant: a rejecting critical section must
 * not wedge the queue, so the tail always resolves regardless of `fn`'s outcome.
 */
let prsWriteChain: Promise<unknown> = Promise.resolve();
function withPrsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = prsWriteChain.then(fn, fn);
  prsWriteChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * User-owned PR fields (R-CORE-004): set by explicit user action, never derived
 * from a `gh` poll. When a poll persists freshly-fetched records it must NOT
 * revert these to the values captured before its round-trips — it overlays the
 * current (possibly newer) values read back inside {@link withPrsLock}.
 */
function overlayUserFields(fresh: MonitoredPr, current: MonitoredPr): MonitoredPr {
  return {
    ...fresh,
    projectId: current.projectId,
    lastSeenAt: current.lastSeenAt,
    muted: current.muted,
    favorite: current.favorite,
  };
}

async function readSettings(ctx: PrMonitorContext): Promise<PrMonitorSettings> {
  const stored = await readStorage<Partial<PrMonitorSettings>>(ctx, SETTINGS_KEY);
  return mergeSettings(stored);
}

async function readDismissed(ctx: PrMonitorContext): Promise<Record<string, number>> {
  const stored = await readStorage<Record<string, number>>(ctx, DISMISSED_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

async function readSyncHealthState(ctx: PrMonitorContext): Promise<SyncHealthState> {
  const stored = await readStorage<Partial<SyncHealthState>>(ctx, SYNC_HEALTH_KEY);
  if (!stored || typeof stored !== 'object') return { ...EMPTY_SYNC_HEALTH_STATE };
  return {
    gone404: stored.gone404 && typeof stored.gone404 === 'object' ? stored.gone404 : {},
    kept: Array.isArray(stored.kept) ? stored.kept.filter((n): n is string => typeof n === 'string') : [],
  };
}

/**
 * Run the R-REPO-015/016 sync-health probe pass. Probes each tracked, active,
 * CONNECTED repo (bounded by {@link SYNC_HEALTH_PROBE_CAP}), classifies each
 * `gh` outcome, folds the results through the pure {@link reduceSyncHealth}
 * reducer (with the auth-disconnected hosts), persists the next state, and
 * returns the derived {@link SyncHealth} display shape. Never throws — a probe
 * failure degrades to `outage` (retry), never a spurious removal prompt.
 *
 * Kept-gone repos are deliberately NOT probed here (they're excluded from the
 * sync pass, AC-REPO-16.3) EXCEPT we still probe them to detect recovery so
 * AC-REPO-15.4 can auto-clear them — so a kept repo IS probed, just not synced.
 */
async function runSyncHealthPass(ctx: PrMonitorContext): Promise<SyncHealth> {
  const settings = await readSettings(ctx);
  const repos = settings.repositories ?? [];
  // No tracked repos → no sync-health to compute (discovery is people-based and
  // ungated). Skip the auth read + probes entirely.
  if (repos.length === 0) return { ...EMPTY_SYNC_HEALTH };
  const conn = await connectionByHost(ctx);

  // Auth-disconnected hosts (from gh auth), scoped to hosts the user tracks.
  const authDisconnectedHosts = Array.from(
    new Set(
      repos
        .filter((r) => (conn[r.host] ?? 'disconnected') !== 'connected')
        .map((r) => r.host)
    )
  );

  const prev = await readSyncHealthState(ctx);
  // Probe active repos on connected hosts (a disconnected host can't be probed
  // meaningfully — its fault is already a disconnect) plus kept-gone repos (to
  // detect recovery). Bound the count.
  const toProbe = repos
    .filter((r) => r.active)
    .filter((r) => (conn[r.host] ?? 'disconnected') === 'connected')
    .slice(0, SYNC_HEALTH_PROBE_CAP);

  // Bounded concurrent probes (Rule 5): serial `gh api` probes over many repos
  // add to the pollAll wall-clock that must stay under the host dispatch deadline.
  const probes: RepoProbe[] = await mapConcurrent(toProbe, PR_FETCH_CONCURRENCY, async (r) => {
    const fault = await probeRepoFault(ctx, r.host, r.owner, r.repo);
    return { name: `${r.owner}/${r.repo}`.toLowerCase(), host: r.host, fault };
  });

  const { state, health } = reduceSyncHealth(prev, probes, authDisconnectedHosts);
  await ctx.storage.set(SYNC_HEALTH_KEY, state);
  return health;
}

function mergeSettings(patch: Partial<PrMonitorSettings> | undefined): PrMonitorSettings {
  const merged: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, ...(patch ?? {}) };
  // Clamp pollIntervalMinutes — the shared-types contract says [1, 30].
  if (!Number.isFinite(merged.pollIntervalMinutes)) {
    merged.pollIntervalMinutes = DEFAULT_PR_MONITOR_SETTINGS.pollIntervalMinutes;
  }
  merged.pollIntervalMinutes = Math.max(POLL_MIN, Math.min(POLL_MAX, Math.round(merged.pollIntervalMinutes)));
  return merged;
}

/**
 * Walk the issue-comments payload for the latest autointegrate sync SHA. The
 * API returns comments oldest-first, so we scan forward and keep the LAST
 * match — that mirrors the Python reference (a later sync supersedes an
 * earlier one).
 */
function findLandedSha(comments: unknown): string {
  if (!Array.isArray(comments)) return '';
  let sha = '';
  for (const c of comments) {
    if (!c || typeof c !== 'object') continue;
    const body = (c as { body?: unknown }).body;
    if (typeof body !== 'string') continue;
    const m = SYNC_RE.exec(body);
    if (m) sha = m[1];
  }
  return sha;
}

/**
 * Probe the autointegrate landing for a CLOSED PR: pull its comments to find
 * the sync'd SHA, then ask the GitHub compare API whether that SHA is
 * reachable from the destination branch (and the mirror, when applicable).
 *
 * Returns null when the URL can't be parsed (unrecognized host shape). All
 * downstream "couldn't tell" cases are encoded by leaving the corresponding
 * `*ContainsSha` field as undefined / null — the classifier treats those as
 * "not yet landed".
 */
async function probeLanding(ctx: PrMonitorContext, url: string, baseRefName: string): Promise<LandingProbe | null> {
  const parsed = parsePrUrl(url);
  if (!parsed) return null;
  const { host, owner, repo, number } = parsed;

  const comments = await ghApi(ctx, host, `repos/${owner}/${repo}/issues/${number}/comments?per_page=100`);
  const sha = findLandedSha(comments);

  const { final, intermediate } = destBranches(baseRefName);
  const probe: LandingProbe = {
    landedSha: sha,
    finalBranch: final,
    intermediateBranch: intermediate,
    finalBranchContainsSha: null,
    intermediateBranchContainsSha: null,
  };

  if (!sha) return probe;

  if (final) {
    probe.finalBranchContainsSha = await commitContained(ctx, host, owner, repo, sha, final);
  }
  if (intermediate && probe.finalBranchContainsSha !== true) {
    probe.intermediateBranchContainsSha = await commitContained(ctx, host, owner, repo, sha, intermediate);
  }
  return probe;
}

/**
 * Ask GitHub whether `sha` is reachable from `branch` via
 * `repos/<owner>/<repo>/compare/<sha>...<branch>`. `behind_by === 0` means the
 * branch contains the commit. Returns null when the comparison couldn't be
 * made (branch or sha unknown / API failure), which the classifier treats as
 * "not yet landed".
 */
async function commitContained(
  ctx: PrMonitorContext,
  host: string,
  owner: string,
  repo: string,
  sha: string,
  branch: string
): Promise<boolean | null> {
  const data = await ghApi(ctx, host, `repos/${owner}/${repo}/compare/${sha}...${encodeURIComponent(branch)}`);
  if (!data || typeof data !== 'object' || !('behind_by' in data)) return null;
  const v = (data as { behind_by: unknown }).behind_by;
  return typeof v === 'number' ? v === 0 : null;
}

/**
 * Compute one PR's fresh rollup status from its newly-fetched merge state and
 * checks. For a CLOSED PR (state CLOSED but not MERGED) this performs the
 * autointegrate landing probe; everything else routes through the pure
 * {@link computeStatus} classifier.
 */
async function classify(ctx: PrMonitorContext, url: string, merge: MergeStateInfo, checks: CheckRun[]): Promise<PrRollupStatus> {
  const prState = (merge.state ?? '').toUpperCase();
  // A MERGED PR is terminal (github.com merge button) — 'closed-merged', no
  // landing probe needed. A CLOSED-but-not-merged PR runs the autointegrate
  // landing probe. Everything else routes through the pure classifier. Without
  // the MERGED branch a merged PR falls through to computeStatus → 'green',
  // mislabeling it and re-polling it forever (AC-CORE-1.3 terminal-skip miss).
  if (prState === 'MERGED') {
    return computeClosedStatus(merge.state, merge.mergeStateStatus, null);
  }
  if (prState === 'CLOSED') {
    const probe = await probeLanding(ctx, url, merge.baseRefName);
    return computeClosedStatus(merge.state, merge.mergeStateStatus, probe);
  }
  return computeStatus(
    { state: merge.state, mergeStateStatus: merge.mergeStateStatus, reviewDecision: merge.reviewDecision },
    merge.mergeable,
    checks
  );
}

/**
 * Fetch fresh state for one tracked PR and return the updated record. Preserves
 * the last-known `checks` array on a transient fetch failure for an open PR,
 * and intentionally treats an empty checks payload as expected on a
 * CLOSED/MERGED workflow PR (gh stops returning checks once the PR is closed).
 *
 * **CRITICAL (Risk #1, refreshOne footgun):** this rebuilds the MonitoredPr
 * object each poll. EVERY field — including Phase 1 additions + source/discoveredVia
 * + projectId + lastSeenAt — MUST be explicitly carried forward or it gets WIPED.
 */
async function refreshOne(ctx: PrMonitorContext, prev: MonitoredPr): Promise<MonitoredPr> {
  const merge = await fetchMergeState(ctx, prev.url);
  let checks = await fetchChecks(ctx, prev.url);

  const prState = (merge.state ?? '').toUpperCase();
  const terminal = prState === 'CLOSED' || prState === 'MERGED';

  // Open PR + empty checks => likely a transient gh failure. Keep last-known
  // checks so the UI's ✅/❌/⏳ counts don't blank to zero.
  if (checks.length === 0 && !terminal) {
    checks = prev.checks;
  }
  // Closed PR + empty checks => expected; preserve last-known counts.
  if (checks.length === 0 && terminal) {
    checks = prev.checks;
  }

  // FIX (Bug A — false-BLOCKED): fetchMergeState degraded to all-empty on gh fail
  // (rate-limit/parse error/non-zero exit → empty shape). Reclassifying with empty
  // mergeStateStatus yields 'yellow' → false "Merge blocked" on a green PR. When
  // merge fetch failed (state empty), skip reclassify and preserve last-known state.
  const mergeFailed = !merge.state;

  let newStatus = prev.status;
  if (!mergeFailed) {
    newStatus = await classify(ctx, prev.url, merge, checks);
  }

  const now = Date.now();
  const lastStatusChange = newStatus !== prev.status ? now : prev.lastStatusChange;
  const title = mergeFailed ? prev.title : (merge.title || prev.title);
  const baseRefName = mergeFailed ? prev.baseRefName : (merge.baseRefName || prev.baseRefName);
  const mergeable = mergeFailed ? prev.mergeable : (merge.mergeable || prev.mergeable);
  const mergeStateStatus = mergeFailed ? prev.mergeStateStatus : (merge.mergeStateStatus || prev.mergeStateStatus);

  // Phase 1 additions (tile redesign) — prefer fresh merge data, fallback to prev.
  // When merge fetch failed, preserve prev (same as core merge fields above).
  const headRefName = mergeFailed ? prev.headRefName : (merge.headRefName || prev.headRefName);
  const author = mergeFailed ? prev.author : (merge.author || prev.author);
  const isDraft = mergeFailed ? prev.isDraft : (merge.isDraft ?? prev.isDraft);
  const body = mergeFailed ? prev.body : (merge.body || prev.body);
  const createdAt = mergeFailed ? prev.createdAt : (merge.createdAt || prev.createdAt);
  const updatedAt = mergeFailed ? prev.updatedAt : (merge.updatedAt || prev.updatedAt);
  // Reviewers refresh with the merge fetch; preserve last-known on a failed fetch.
  const reviewers = mergeFailed ? prev.reviewers : merge.reviewers;
  // workItem re-derives each refresh (handles title edits), scanning
  // title → branch → body for the first W-######## (AC-LIST-11.3a).
  const workItem = extractWorkItem(title, headRefName, body);

  // --- Two-pill overlay fields (advisory; never affect the rollup badge) ---
  // Resolve this PR's repo config for the ignore-list + SFCI gate. main reads its
  // own store (Rule 1) — the renderer never supplies these.
  const settings = await readSettings(ctx);
  const repoRec = (settings.repositories ?? []).find(
    (r) => `${r.owner}/${r.repo}`.toLowerCase() === (prev.repo ?? '').toLowerCase()
  );
  const ignoredFailingChecks = repoRec?.ignoredFailingChecks ?? [];
  const sfciGated = repoRec?.sfciGated === true;

  // Build-happy verdict, ignoring the repo's ignore-list failures (AC-LIST-13.7).
  const buildHappy = isBuildHappy(checks, { ignoredFailingChecks });

  // Review decision backs the review pill's done-state + the merge-stall gate.
  const reviewDecision = mergeFailed ? prev.reviewDecision : (merge.reviewDecision || prev.reviewDecision);

  // SFCI-job comment (AC-REPO-17.2): only fetch for a gated, non-terminal, live PR
  // — the comment gates the build/merge stall (AC-LIST-14.5). A non-gated repo, a
  // terminal PR, or a failed merge fetch carries the last-known verdict (or false).
  let hasSfciJob = prev.hasSfciJob ?? false;
  if (sfciGated && !terminal && !mergeFailed) {
    const parsed = parsePrUrl(prev.url);
    if (parsed) {
      try {
        const comments = await ghApi(
          ctx,
          parsed.host,
          `repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/comments?per_page=100`
        );
        hasSfciJob = hasSfciJobComment(comments);
      } catch (err) {
        ctx.log(`SFCI comment fetch failed for ${prev.url}: ${err instanceof Error ? err.message : String(err)}`);
        // Keep last-known verdict on a transient failure.
      }
    }
  }

  // Review clock origin (R-LIST-025 / §3.8). Draft → no review clock. Draft→Open
  // transition (or first sight already-Open) resets/seeds it; an already-open PR
  // carries its clock forward. On a failed merge fetch, preserve prev.
  let reviewClockStartedAt = prev.reviewClockStartedAt;
  if (!mergeFailed) {
    if (isDraft) {
      reviewClockStartedAt = undefined; // review has not begun on a Draft
    } else if (prev.isDraft === true) {
      reviewClockStartedAt = now; // observed Draft → Open transition
    } else if (prev.reviewClockStartedAt) {
      reviewClockStartedAt = prev.reviewClockStartedAt; // still open, clock runs
    } else {
      // First sight already Open (never-drafted → open since creation): seed from
      // the PR's open time so a long-open PR reads its true review age, not "0d".
      reviewClockStartedAt = createdAt || now;
    }
  }

  return {
    url: prev.url,
    repo: prev.repo,
    number: prev.number,
    title,
    baseRefName,
    status: newStatus,
    mergeable,
    mergeStateStatus,
    checks,
    addedAt: prev.addedAt,
    lastChecked: now,
    lastStatusChange,
    lastSeenAt: prev.lastSeenAt,
    // Carry the manual project assignment forward — refreshOne rebuilds the PR
    // object from the gh poll, so anything not explicitly copied here is lost on
    // the next poll. Dropping projectId silently wiped a user's assignment within
    // one poll interval (looked like "selecting a project doesn't stick").
    projectId: prev.projectId,
    // Phase 1 fields — MUST be copied or wiped (Risk #1)
    headRefName,
    author,
    isDraft,
    body,
    createdAt,
    updatedAt,
    workItem,
    reviewers,
    // source + discoveredVia carry forward (auto PRs need these; manual PRs have source='manual' or undefined→'manual')
    source: prev.source,
    discoveredVia: prev.discoveredVia,
    // Per-PR mute carries forward untouched (R-LIST-018).
    muted: prev.muted,
    // Per-PR favorite carries forward untouched (R-LIST-026) — a user-owned field
    // (R-CORE-004); drop it here and a poll would wipe the mark.
    favorite: prev.favorite,
    // Per-PR fetch-error (R-LIST-023): a failed merge fetch marks THIS PR's row
    // as not-syncable and keeps its last-known state stale; a success clears it
    // and stamps lastSyncOk. (App-level disconnect is a separate signal — R-REPO-013.)
    syncError: mergeFailed ? 'Could not sync this PR from GitHub.' : undefined,
    lastSyncOk: mergeFailed ? prev.lastSyncOk : now,
    // Two-pill overlay fields — advisory, cached each poll (Risk #1: copy or wipe).
    reviewClockStartedAt,
    reviewDecision,
    buildHappy,
    hasSfciJob,
  };
}

/**
 * Auto-discover the authenticated user's OWN authored PRs (R-CORE-001 /
 * AC-CORE-1.1). PR Monitor is a single-author personal monitor: the monitored
 * set is populated from open PRs where the author is the authenticated `gh` user
 * (`author:@me`), scoped to the user's authenticated hosts. Scope explicitly
 * EXCLUDES watching other people, review-requested, or @mentioned/involved PRs
 * (OQ-CORE-1/2) — so discovery searches ONLY the `authored` relation, using each
 * authenticated host's OWN login as the author (that host's `@me`).
 *
 * For each authenticated (and enabled) host: searchPrs(authored, <host login>),
 * union+dedupe by URL. For each discovered URL: if already in `prs` → skip; if in
 * dismissed set → skip; else add as source:'auto' + discoveredVia, fetch full
 * state via addPr internals, persist. Auto PRs that stop matching → KEEP (no
 * prune-on-unmatch). Terminal PRs are never auto-dropped — only an explicit
 * Dismiss removes them (AC-CORE-1.2/1.4).
 */
async function discoverPrs(ctx: PrMonitorContext): Promise<void> {
  const settings = await readSettings(ctx);

  // Resolve discovery hosts + the author login for each from the authenticated
  // `gh` accounts. The user never types a hostname or a person to watch — the
  // author IS the authenticated user, per host (`author:@me`). `discoverHosts`
  // (when set) is the subset of detected account hosts left ENABLED in Settings;
  // `undefined` means all detected accounts. If gh reports no accounts, there is
  // nothing to search.
  const accounts = await getAuthHosts(ctx);
  if (accounts.length === 0) {
    ctx.log('discoverPrs: no authenticated gh accounts — skipping discovery');
    return;
  }
  const enabled = settings.discoverHosts;
  const searchAccounts =
    enabled === undefined ? accounts : accounts.filter((a) => enabled.includes(a.host));
  if (searchAccounts.length === 0) {
    ctx.log('discoverPrs: no enabled accounts — skipping discovery');
    return;
  }
  const dismissed = await readDismissed(ctx);
  const existing = await readPrs(ctx);

  // Union all discovered URLs
  type DiscoveredEntry = { url: string; title: string; number: number; repo: string; author: { login: string }; isDraft: boolean; discoveredVia: string };
  const discovered = new Map<string, DiscoveredEntry>();

  for (const account of searchAccounts) {
    const { host, login } = account;
    // Authored-only (R-CORE-001): search this host for the authenticated user's
    // own open PRs. No review-requested / involved relations (out of scope).
    const result = await searchPrs(ctx, host, login, 'authored', settings.watchedRepos);
    if (!result.ok) {
      ctx.log(`discoverPrs: searchPrs(${host}, ${login}, authored) failed: ${result.error}`);
      continue;
    }
    for (const pr of result.prs ?? []) {
      const via = `authored:${login}@${host}`;
      if (!discovered.has(pr.url)) {
        discovered.set(pr.url, { ...pr, discoveredVia: via });
      }
    }
  }

  // Filter to genuinely-new, gate-allowed URLs BEFORE the slow fetches: skip
  // dismissed, skip already-tracked, apply the R-REPO-012 sync-pass gate (a
  // discovered PR in an Inactive/Disconnected tracked repo is excluded).
  const now = Date.now();
  const gate = await repoSyncGate(ctx);
  const candidates: Array<{ url: string; pr: DiscoveredEntry }> = [];
  for (const [url, pr] of discovered) {
    if (url in dismissed) continue;
    if (url in existing) continue;
    const repoName = pr.repo || repoOf(url);
    if (!gate(repoName)) continue;
    candidates.push({ url, pr });
  }

  // Bound the per-pass work (Rule 5): cap how many NEW PRs one pass fetches. The
  // rest are still open and re-surface on the next poll.
  if (candidates.length > DISCOVER_ADD_CAP) {
    ctx.log(`discoverPrs: ${candidates.length} new candidates, capping to ${DISCOVER_ADD_CAP} this pass`);
    candidates.length = DISCOVER_ADD_CAP;
  }

  // Fetch full state (slow gh round-trips) OUTSIDE the write lock, with a bounded
  // concurrent window so a large authored set can't push pollAll past the host's
  // ~30s dispatch deadline. Each worker swallows its own error (last-known-good).
  const toAdd: Record<string, MonitoredPr> = {};
  await mapConcurrent(candidates, PR_FETCH_CONCURRENCY, async ({ url, pr }) => {
    try {
      const merge = await fetchMergeState(ctx, url);
      const checks = await fetchChecks(ctx, url);
      const status = await classify(ctx, url, merge, checks);
      const title = merge.title || pr.title;
      const workItem = extractWorkItem(title, merge.headRefName, merge.body);

      toAdd[url] = {
        url,
        repo: pr.repo || repoOf(url),
        number: pr.number || prNumber(url),
        title,
        baseRefName: merge.baseRefName || '',
        status,
        mergeable: merge.mergeable || '',
        mergeStateStatus: merge.mergeStateStatus || '',
        checks,
        addedAt: now,
        lastChecked: now,
        lastStatusChange: now,
        headRefName: merge.headRefName,
        author: merge.author ?? (pr.author ? { login: pr.author.login } : undefined),
        isDraft: merge.isDraft ?? pr.isDraft,
        body: merge.body,
        createdAt: merge.createdAt,
        updatedAt: merge.updatedAt,
        workItem,
        reviewers: merge.reviewers,
        source: 'auto',
        discoveredVia: pr.discoveredVia,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      ctx.log(`discoverPrs: failed to add ${url}: ${detail}`);
    }
  });

  if (Object.keys(toAdd).length === 0) return;

  // Persist under the lock (R-CORE-004): re-read the current map so a URL the
  // user manually added or dismissed during the fetch window is respected — only
  // genuinely-new URLs are inserted, and a mid-poll dismissal is not resurrected.
  await withPrsLock(async () => {
    const current = await readPrs(ctx);
    const dismissedNow = await readDismissed(ctx);
    let added = 0;
    for (const [url, newPr] of Object.entries(toAdd)) {
      if (url in current) continue;
      if (url in dismissedNow) continue;
      current[url] = newPr;
      added++;
    }
    if (added > 0) {
      await ctx.storage.set(PRS_KEY, current);
      ctx.log(`discoverPrs: added ${added} auto PRs`);
    }
  });
}

/**
 * Prune dismissed set (Phase 3 retention — Rule 5). Cap to newest ~500 and/or
 * drop entries whose PR is CLOSED/MERGED (can't be rediscovered as open).
 * Run during pollAll after refresh.
 */
async function pruneDismissed(ctx: PrMonitorContext): Promise<void> {
  const dismissed = await readDismissed(ctx);
  const entries = Object.entries(dismissed).sort((a, b) => b[1] - a[1]); // newest first

  const CAP = 500;
  const pruned: Record<string, number> = {};
  for (const [url, dismissedAt] of entries.slice(0, CAP)) {
    pruned[url] = dismissedAt;
  }

  if (Object.keys(pruned).length !== Object.keys(dismissed).length) {
    await ctx.storage.set(DISMISSED_KEY, pruned);
    ctx.log(`pruneDismissed: capped to ${Object.keys(pruned).length} (was ${Object.keys(dismissed).length})`);
  }
}

/**
 * Short display host (AC-ORG-3.1): strip a trailing `.salesforce.com`
 * (`gitcore.soma.salesforce.com` → `gitcore.soma`); every other host — including
 * `github.com` — is shown as-is. Exported-ish (module-local) so the renderer can
 * mirror it; kept here as the canonical rule.
 */
function shortHost(host: string): string {
  return host.endsWith('.salesforce.com') ? host.slice(0, -'.salesforce.com'.length) : host;
}

/**
 * Once-ever seed of {@link PrMonitorSettings.organizations} from the authenticated
 * `gh` accounts (R-ORG-002 anti-loop). Runs only when `orgDiscovered` is false OR
 * `force` (an explicit Re-discover). Sets `orgDiscovered=true` so a delete does not
 * trigger a re-seed. Returns the resulting settings (persisted).
 */
async function discoverOrgs(ctx: PrMonitorContext, force: boolean): Promise<PrMonitorSettings> {
  const settings = await readSettings(ctx);
  if (settings.orgDiscovered && !force) return settings;
  const accounts = await getAuthHosts(ctx);
  const orgs: MonitoredOrg[] = accounts.map((a) => ({
    host: a.host,
    login: a.login,
    apiBaseUrl: a.apiBaseUrl,
  }));
  let merged: MonitoredOrg[];
  if (force) {
    // Re-discover: union existing (user may have added some) with detected,
    // dedup by host+login. Detected wins on apiBaseUrl.
    const byKey = new Map<string, MonitoredOrg>();
    for (const o of settings.organizations ?? []) byKey.set(`${o.host}|${o.login}`, o);
    for (const o of orgs) byKey.set(`${o.host}|${o.login}`, o);
    merged = Array.from(byKey.values());
  } else {
    merged = orgs;
  }
  const next = mergeSettings({ ...settings, organizations: merged, orgDiscovered: true });
  await ctx.storage.set(SETTINGS_KEY, next);
  return next;
}

/**
 * Discover and PERSIST the monitored author's identity from live `gh` (R-PPL-003/004).
 * This is the ONLY path that live-reads `gh` for the author: the first author-area
 * open (gated by `authorDiscovered`) and the explicit Organizations Re-discover
 * (`force`). Later opens read the stored `settings.author` as-is (AC-PPL-2.2/5.3) —
 * they must NOT call this. Returns the stored author (or undefined when no accounts).
 */
async function discoverAuthor(
  ctx: PrMonitorContext,
  force: boolean
): Promise<StoredAuthor | undefined> {
  const settings = await readSettings(ctx);
  if (settings.authorDiscovered && !force && settings.author) return settings.author;

  const accounts = await getAuthHosts(ctx);
  if (accounts.length === 0) {
    // No accounts: mark discovered so a later open shows the stored (empty) state
    // as-is instead of re-probing gh on every open. A Re-discover re-runs this.
    if (!settings.authorDiscovered) {
      await ctx.storage.set(SETTINGS_KEY, mergeSettings({ ...settings, authorDiscovered: true }));
    }
    return settings.author;
  }
  const primary = accounts.find((a) => a.active) ?? accounts[0];
  const profile: AuthUser = (await getAuthUser(ctx, primary.host)) ?? { login: primary.login };
  const author: StoredAuthor = {
    login: profile.login,
    name: profile.name,
    email: profile.email,
    identities: accounts.map((a) => ({ host: a.host, login: a.login })),
  };
  await ctx.storage.set(SETTINGS_KEY, mergeSettings({ ...settings, author, authorDiscovered: true }));
  return author;
}

/**
 * Derive live connection state per host (R-ORG-005 / AC-ORG-5.4). A host is
 * `connected` when it appears in the authenticated `gh` accounts, else
 * `disconnected`. Transient `checking` is a renderer-only in-flight state — the
 * settled main-side result is always connected/disconnected.
 */
async function connectionByHost(ctx: PrMonitorContext): Promise<Record<string, ConnectionState>> {
  const accounts = await getAuthHosts(ctx);
  const connected = new Set(accounts.map((a) => a.host));
  const settings = await readSettings(ctx);
  const out: Record<string, ConnectionState> = {};
  for (const o of settings.organizations ?? []) {
    out[o.host] = connected.has(o.host) ? 'connected' : 'disconnected';
  }
  for (const r of settings.repositories ?? []) {
    if (!(r.host in out)) out[r.host] = connected.has(r.host) ? 'connected' : 'disconnected';
  }
  return out;
}

/**
 * Confine a renderer-supplied `host` before it reaches a `gh api --hostname`
 * call (Rule 2 / extension Rule 2 — the renderer is untrusted). A host string
 * only becomes a fetch target when it BOTH (a) matches a host the user actually
 * configured (an org record or a monitored repo) AND (b) currently
 * authenticates in `gh`. This mirrors `pullPr`'s connected+active re-validation
 * (pr-main.ts:838-849) so the browse/search/test paths can't be steered at an
 * arbitrary GHE host (SSRF via the trusted `gh` cap). Returns `null` when the
 * host is allowed, or an error message when it must be rejected.
 */
async function rejectUnknownHost(ctx: PrMonitorContext, host: string): Promise<string | null> {
  const settings = await readSettings(ctx);
  const configured = new Set<string>();
  for (const o of settings.organizations ?? []) configured.add(o.host);
  for (const r of settings.repositories ?? []) configured.add(r.host);
  if (!configured.has(host)) return 'That host is not configured.';
  const conn = await connectionByHost(ctx);
  if ((conn[host] ?? 'disconnected') !== 'connected') {
    return 'That host is not connected.';
  }
  return null;
}

/**
 * The sync-pass gate (R-REPO-012). A repository the user has connected in the
 * `repositories` set is WORKED in a sync pass only when it is BOTH active AND its
 * host currently authenticates in `gh` (connected). Returns a predicate over a
 * PR's `owner/repo` full name:
 *   - repo NOT in the `repositories` list → NOT gated (discovery is people-based,
 *     so a watched person's PR can legitimately live in any repo); allowed.
 *   - repo in the list but Inactive → excluded (AC-REPO-12.3).
 *   - repo in the list but on a Disconnected host → excluded (AC-REPO-12.2).
 *   - repo in the list, active, connected → allowed (AC-REPO-12.1/12.4).
 * Excluded repos surface no new PRs and fire no notifications while excluded —
 * their last-known PRs stay in the list (last-known-good), just not re-synced.
 */
async function repoSyncGate(
  ctx: PrMonitorContext
): Promise<(repoFullName: string) => boolean> {
  const settings = await readSettings(ctx);
  const conn = await connectionByHost(ctx);
  const health = await readSyncHealthState(ctx);
  const byName = new Map<string, MonitoredRepo>();
  for (const r of settings.repositories ?? []) {
    byName.set(`${r.owner}/${r.repo}`.toLowerCase(), r);
  }
  return (repoFullName: string): boolean => {
    const rec = byName.get(String(repoFullName ?? '').toLowerCase());
    if (!rec) return true; // untracked repo → not gated
    if (!rec.active) return false;
    // R-REPO-016: a repo the user chose to KEEP after it went remote-gone is
    // excluded from the sync pass — there's nothing reachable to poll — until
    // they remove it or it recovers (which clears the kept flag on the next pass).
    if (isKeptGone(health, repoFullName)) return false;
    return (conn[rec.host] ?? 'disconnected') === 'connected';
  };
}

/** Normalize a user-entered repository ref (owner/repo, full URL, or SSH) to
 *  `{owner, repo}` (AC-REPO-8.4), or null when unparseable. */
function parseRepoRef(input: string): { owner: string; repo: string } | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  // Full https URL
  const url = s.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (url) return sanitizeOwnerRepo(url[1], url[2]);
  // SSH clone: git@host:owner/repo.git
  const ssh = s.match(/^[^@]+@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return sanitizeOwnerRepo(ssh[1], ssh[2]);
  // Bare owner/repo
  const bare = s.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (bare) return sanitizeOwnerRepo(bare[1], bare[2]);
  return null;
}

function sanitizeOwnerRepo(owner: string, repo: string): { owner: string; repo: string } | null {
  const full = `${owner}/${repo}`;
  return isSafeRepoArg(full) ? { owner, repo } : null;
}

/** Add a repo to settings (R-REPO-008). Returns {ok, error, settings}. */
async function addRepo(
  ctx: PrMonitorContext,
  owner: string,
  repo: string,
  host: string,
  orgLogin: string
): Promise<{ ok: boolean; error?: string; settings?: PrMonitorSettings }> {
  const settings = await readSettings(ctx);
  const repos = settings.repositories ?? [];
  const dup = repos.some(
    (r) => r.host === host && r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase()
  );
  if (dup) return { ok: false, error: 'This repository is already connected.' };
  const entry: MonitoredRepo = {
    owner,
    repo,
    host,
    orgLogin,
    active: true,
    buildTisPreset: DEFAULT_TIS_PRESET,
    reviewTisPreset: DEFAULT_REVIEW_TIS_PRESET,
    sfciGated: false,
    ignoredFailingChecks: [],
    createdAt: Date.now(),
    notifyInApp: true,
  };
  const next = mergeSettings({ ...settings, repositories: [...repos, entry] });
  await ctx.storage.set(SETTINGS_KEY, next);
  return { ok: true, settings: next };
}

/** Remove all monitored PRs belonging to a given `owner/repo` (case-insensitive). */
async function removePrsForRepo(ctx: PrMonitorContext, fullName: string): Promise<void> {
  await withPrsLock(async () => {
    const prs = await readPrs(ctx);
    const needle = fullName.toLowerCase();
    let changed = false;
    for (const url of Object.keys(prs)) {
      if (prs[url].repo.toLowerCase() === needle) {
        delete prs[url];
        changed = true;
      }
    }
    if (changed) await ctx.storage.set(PRS_KEY, prs);
  });
}

/**
 * Validate a PR URL, fetch its initial state via gh, persist it, and return the
 * full PR list wrapped in a response envelope. Shared fetch/persist path for the
 * `pullPr(repo+number)` capability (R-LIST-003) and the internal auto-discovery
 * add — a pulled PR is a manual add with a URL built from a connected repo, so it
 * lands here with `source: 'manual'` (AC-LIST-3.4). Module-scope (not a method) so
 * callers don't depend on `this` inside the capabilities literal.
 */
export async function addPrByUrl(
  ctx: PrMonitorContext,
  url: string
): Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }> {
  try {
    if (typeof url !== 'string' || !url.trim()) {
      return { ok: false, error: 'Missing PR URL' };
    }
    const cleanUrl = url.trim();
    const repo = repoOf(cleanUrl);
    const number = prNumber(cleanUrl);

    // Dup pre-check is advisory; the authoritative check happens under the lock.
    const existing = await readPrs(ctx);
    if (existing[cleanUrl]) {
      return { ok: false, error: `Already monitoring: ${cleanUrl}` };
    }

    // Slow gh fetches run before taking the lock; the insert re-checks the
    // current map under the lock so a concurrent add/poll can't be lost (R-CORE-004).
    const merge = await fetchMergeState(ctx, cleanUrl);
    const checks = await fetchChecks(ctx, cleanUrl);
    const status = await classify(ctx, cleanUrl, merge, checks);
    const now = Date.now();
    const title = merge.title || '';
    const workItem = extractWorkItem(title, merge.headRefName, merge.body);

    const pr: MonitoredPr = {
      url: cleanUrl,
      repo,
      number,
      title,
      baseRefName: merge.baseRefName || '',
      status,
      mergeable: merge.mergeable || '',
      mergeStateStatus: merge.mergeStateStatus || '',
      checks,
      addedAt: now,
      lastChecked: now,
      lastStatusChange: now,
      // Phase 1 additions (tile redesign)
      headRefName: merge.headRefName,
      author: merge.author ?? undefined,
      isDraft: merge.isDraft,
      body: merge.body,
      createdAt: merge.createdAt,
      updatedAt: merge.updatedAt,
      workItem,
      reviewers: merge.reviewers,
      source: 'manual', // manually-added PRs always 'manual'; auto PRs come via Phase 3 discoverPrs
    };
    return await withPrsLock(async () => {
      const current = await readPrs(ctx);
      if (current[cleanUrl]) {
        return { ok: false, error: `Already monitoring: ${cleanUrl}` };
      }
      current[cleanUrl] = pr;
      await ctx.storage.set(PRS_KEY, current);
      const prs = Object.values(current).sort((a, b) => a.addedAt - b.addedAt);
      return { ok: true, prs };
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}

const prMonitorMainModule = {
  id: 'pr-monitor',
  setup(ctx: PrMonitorContext) {
    if (!ctx.exec) {
      throw new Error('pr-monitor: brokered exec capability is unavailable; cannot run the gh CLI.');
    }

    return {
      /**
       * Pull a specific PR by repository + number (R-LIST-003). Builds the PR URL
       * from the connected repo's host + owner/repo + number, then delegates to the
       * same fetch/persist path as {@link addPrByUrl} (source stays 'manual', AC-LIST-3.4).
       * The repo MUST be one of the connected + active repositories (AC-LIST-3.3) —
       * the renderer's dropdown lists exactly those, and main re-validates here since
       * the renderer is untrusted.
       */
      async pullPr(params: {
        host: string;
        fullName: string;
        number: number | string;
      }): Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }> {
        try {
          const host = String(params?.host ?? '').trim();
          const fullName = String(params?.fullName ?? '').trim();
          const num = Math.floor(Number(params?.number));
          if (!host || !fullName) return { ok: false, error: 'Please select a repository.' };
          if (!Number.isFinite(num) || num <= 0) {
            return { ok: false, error: 'Enter a valid PR number.' };
          }
          if (!isSafeRepoArg(fullName)) {
            return { ok: false, error: `Invalid repository: ${fullName}` };
          }
          // Re-validate against the connected + active repo set (AC-LIST-3.3):
          // the renderer is untrusted, so a supplied host/fullName only becomes a
          // fetch target after matching a repository the user actually connected.
          const settings = await readSettings(ctx);
          const match = (settings.repositories ?? []).find(
            (r) => r.active && r.host === host && `${r.owner}/${r.repo}`.toLowerCase() === fullName.toLowerCase()
          );
          if (!match) {
            return { ok: false, error: 'That repository is not connected and active.' };
          }
          // Active alone is not enough — the host must currently authenticate in
          // `gh` (AC-LIST-3.3 "connected + active"), else the fetch would fail.
          const conn = await connectionByHost(ctx);
          if ((conn[match.host] ?? 'disconnected') !== 'connected') {
            return { ok: false, error: 'That repository is not connected and active.' };
          }
          // Build the canonical PR URL for the host. GHE and github.com share the
          // `https://<host>/<owner>/<repo>/pull/<n>` shape.
          const url = `https://${host}/${match.owner}/${match.repo}/pull/${num}`;
          return await addPrByUrl(ctx, url);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Remove a PR from the watch list and return the updated list.
       */
      async removePr(url: string): Promise<{ ok: boolean; prs?: MonitoredPr[] }> {
        const cleanUrl = (url ?? '').trim();
        if (!cleanUrl) return { ok: true, prs: [] };
        return await withPrsLock(async () => {
          const existing = await readPrs(ctx);
          if (!(cleanUrl in existing)) {
            const prs = Object.values(existing).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs };
          }
          delete existing[cleanUrl];
          await ctx.storage.set(PRS_KEY, existing);
          const prs = Object.values(existing).sort((a, b) => a.addedAt - b.addedAt);
          return { ok: true, prs };
        });
      },

      /** Return the full tracked list (stable order by addedAt asc). */
      async listPrs(): Promise<MonitoredPr[]> {
        const prs = await readPrs(ctx);
        return Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
      },

      /**
       * Refresh every tracked PR and persist the result. Returns the full PR list
       * plus deltas for status changes, wrapped in a response envelope.
       *
       * **Unified sync (§5.5):** (1) discoverPrs() — author-driven, adds the
       * authenticated user's own open authored PRs (R-CORE-001 / AC-CORE-1.1);
       * (2) refreshOne for every tracked PR (existing, keep status-change detection exactly);
       * (3) prune terminal/dismissed per settings + caps. One pollIntervalMinutes drives both.
      */
      async pollAll(): Promise<{ ok: boolean; prs?: MonitoredPr[]; deltas?: PrStatusDelta[]; health?: SyncHealth; error?: string }> {
        try {
          // (0) Sync-health probe pass (R-REPO-013/015/016) — classify each tracked
          // repo's reachability so the PR list can show ONE consolidated clue. Runs
          // BEFORE the refresh loop so the kept-gone gate reflects this pass, and
          // never throws (degrades to last-known health).
          let health: SyncHealth = { ...EMPTY_SYNC_HEALTH };
          try {
            health = await runSyncHealthPass(ctx);
          } catch (err) {
            ctx.log(`sync-health pass failed: ${err instanceof Error ? err.message : String(err)}`);
          }

          // (1) Auto-discover new PRs if enabled
          await discoverPrs(ctx);

          // (2) Refresh every tracked PR. A PR already in a terminal state
          // (closed-merged / closed-abandoned) is skipped — its verdict won't
          // change and re-polling it wastes a gh round-trip (AC-CORE-1.3). It
          // stays in the list until the user explicitly dismisses it
          // (AC-CORE-1.2/1.4 — terminal PRs never auto-drop).
          //
          // The slow gh fetches run OUTSIDE the write lock (R-CORE-004): holding
          // the mutex across seconds of round-trips would serialize user actions
          // behind the whole poll. We snapshot, fetch fresh records lock-free,
          // then take the lock only to merge + persist against the CURRENT map.
          const snapshot = await readPrs(ctx);
          const deltas: PrStatusDelta[] = [];
          const fetched: Record<string, MonitoredPr> = {};
          // R-REPO-012 sync-pass gate: a PR in a tracked repo that is Inactive or
          // Disconnected is skipped — no re-fetch, no delta, no notification —
          // while it stays in that state. Its last-known row survives untouched.
          const gate = await repoSyncGate(ctx);
          // Refresh the non-terminal, gate-allowed PRs in a bounded concurrent
          // window (Rule 5): each refreshOne is several serial `gh` round-trips,
          // so a serial loop over many tracked PRs (plus the discovery pass above)
          // overflows the host's ~30s dispatch deadline — especially over VPN.
          const toRefresh = Object.keys(snapshot).filter((url) => {
            const prev = snapshot[url];
            if (prev.status === 'closed-merged' || prev.status === 'closed-abandoned') return false;
            return gate(prev.repo);
          });
          await mapConcurrent(toRefresh, PR_FETCH_CONCURRENCY, async (url) => {
            try {
              fetched[url] = await refreshOne(ctx, snapshot[url]);
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err);
              ctx.log(`refresh failed for ${url}: ${detail}`);
              // Leave prev in place — last-known-good wins over a partial failure.
            }
          });

          // (3) Merge + persist under the lock. Re-read the current map so a user
          // action that landed during the fetches is not clobbered; overlay the
          // user-owned fields from the fresh read, and skip URLs the user removed
          // mid-poll (don't resurrect a dismissed PR).
          const prsList = await withPrsLock(async () => {
            const current = await readPrs(ctx);
            for (const [url, next] of Object.entries(fetched)) {
              const live = current[url];
              if (!live) continue; // removed/dismissed during the poll — do not resurrect
              const merged = overlayUserFields(next, live);
              current[url] = merged;
              if (merged.status !== (snapshot[url]?.status ?? merged.status)) {
                deltas.push({ url, oldStatus: snapshot[url].status, newStatus: merged.status, pr: merged });
              }
            }
            await ctx.storage.set(PRS_KEY, current);
            return Object.values(current).sort((a, b) => a.addedAt - b.addedAt);
          });

          // (4) Prune dismissed set (Phase 3 retention)
          await pruneDismissed(ctx);

          return { ok: true, prs: prsList, deltas, health };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          return { ok: false, error };
        }
      },

      /**
       * On-demand sync of a specific repository selection (AC-LIST-2.5 — the
       * Sync & Filter picker's narrowed "Sync" action). Re-checks exactly the
       * monitored PRs whose `repo` (owner/repo) is in `repos`, skipping terminal
       * PRs like {@link pollAll}. Unlike pollAll it does NOT run account-wide
       * discovery — a repo-scoped sync re-checks what's already tracked in those
       * repos, it isn't a discovery pass. An empty/absent `repos` is a no-op that
       * returns the current list unchanged.
       */
      async syncRepos(params: { repos: string[] }): Promise<{ ok: boolean; prs?: MonitoredPr[]; deltas?: PrStatusDelta[]; error?: string }> {
        try {
          const wanted = new Set(
            (Array.isArray(params?.repos) ? params.repos : [])
              .map((r) => String(r ?? '').trim().toLowerCase())
              .filter(Boolean)
          );
          // Fetch fresh records lock-free (slow gh round-trips), then merge +
          // persist under the lock so a concurrent user action isn't lost
          // (R-CORE-004). Mirrors pollAll's snapshot→fetch→merge shape.
          const snapshot = await readPrs(ctx);
          const deltas: PrStatusDelta[] = [];
          const fetched: Record<string, MonitoredPr> = {};
          if (wanted.size > 0) {
            for (const url of Object.keys(snapshot)) {
              const prev = snapshot[url];
              if (!wanted.has(prev.repo.toLowerCase())) continue;
              if (prev.status === 'closed-merged' || prev.status === 'closed-abandoned') continue;
              try {
                fetched[url] = await refreshOne(ctx, prev);
              } catch (err) {
                ctx.log(`sync failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }
          const prsList = await withPrsLock(async () => {
            const current = await readPrs(ctx);
            for (const [url, next] of Object.entries(fetched)) {
              const live = current[url];
              if (!live) continue; // removed/dismissed mid-sync — do not resurrect
              const merged = overlayUserFields(next, live);
              current[url] = merged;
              if (merged.status !== snapshot[url].status) {
                deltas.push({ url, oldStatus: snapshot[url].status, newStatus: merged.status, pr: merged });
              }
            }
            if (Object.keys(fetched).length > 0) await ctx.storage.set(PRS_KEY, current);
            return Object.values(current).sort((a, b) => a.addedAt - b.addedAt);
          });
          return { ok: true, prs: prsList, deltas };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Assign a PR to a project (or clear the assignment with null).
       */
      async assignProject(url: string, projectId: string | null): Promise<{ ok: boolean; prs?: MonitoredPr[] }> {
        const cleanUrl = (url ?? '').trim();
        if (!cleanUrl) return { ok: false };
        return await withPrsLock(async () => {
          const prs = await readPrs(ctx);
          if (!(cleanUrl in prs)) return { ok: false };
          prs[cleanUrl].projectId = projectId ?? undefined;
          await ctx.storage.set(PRS_KEY, prs);
          const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
          return { ok: true, prs: prsList };
        });
      },

      /**
       * Mark a PR as seen by updating its lastSeenAt timestamp to now.
       */
      async markPrAsSeen(params: { url: string }): Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }> {
        try {
          const cleanUrl = (params?.url ?? '').trim();
          if (!cleanUrl) {
            return { ok: false, error: 'Missing PR URL' };
          }
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            if (!(cleanUrl in prs)) {
              return { ok: false, error: `PR not found: ${cleanUrl}` };
            }
            prs[cleanUrl].lastSeenAt = Date.now();
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          return { ok: false, error };
        }
      },

      /**
       * Mark a PR as unseen with an explicit sentinel. Clearing the timestamp would
       * fall back to addedAt, leaving a never-changed PR read when both timestamps
       * match.
       */
      async markPrAsUnseen(params: { url: string }): Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }> {
        try {
          const cleanUrl = (params?.url ?? '').trim();
          if (!cleanUrl) {
            return { ok: false, error: 'Missing PR URL' };
          }
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            if (!(cleanUrl in prs)) {
              return { ok: false, error: `PR not found: ${cleanUrl}` };
            }
            prs[cleanUrl].lastSeenAt = 0;
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          return { ok: false, error };
        }
      },

      /**
       * Bulk mark-seen / mark-unseen (R-LIST-010, AC-LIST-10.3). Sets or clears
       * lastSeenAt for every URL in the batch in one storage write. Unknown URLs
       * are skipped. `seen: true` → mark read (lastSeenAt = now); `false` →
       * explicitly unread (lastSeenAt = 0).
       */
      async setPrsSeen(params: { urls: string[]; seen: boolean }): Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }> {
        try {
          const urls = Array.isArray(params?.urls) ? params.urls : [];
          const seen = !!params?.seen;
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            const now = Date.now();
            for (const raw of urls) {
              const url = String(raw ?? '').trim();
              if (url && prs[url]) prs[url].lastSeenAt = seen ? now : 0;
            }
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Bulk dismiss (R-LIST-004 Sweep / R-LIST-006 bulk bar). Removes every URL in
       * the batch from the list; an auto-discovered PR is additionally added to the
       * dismissed set so re-discovery skips it, a manual PR is simply removed
       * (AC-LIST-4.4). One storage write for the list + one for the dismissed set.
       */
      async dismissPrs(params: { urls: string[] }): Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }> {
        try {
          const urls = Array.isArray(params?.urls) ? params.urls : [];
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            const dismissed = await readDismissed(ctx);
            const now = Date.now();
            let dismissedChanged = false;
            for (const raw of urls) {
              const url = String(raw ?? '').trim();
              const pr = url ? prs[url] : undefined;
              if (!pr) continue;
              const isAuto = pr.source === 'auto';
              delete prs[url];
              if (isAuto) {
                dismissed[url] = now;
                dismissedChanged = true;
              }
            }
            await ctx.storage.set(PRS_KEY, prs);
            if (dismissedChanged) await ctx.storage.set(DISMISSED_KEY, dismissed);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Dismiss a PR (Phase 3). If source==='auto' → remove from prs AND add to
       * dismissedUrls (so rediscovery skips). If source==='manual' or missing → just
       * removePr (delete, NOT added to dismissed). Returns updated PR list.
       */
      async dismissPr(params: { url: string }): Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }> {
        try {
          const cleanUrl = (params?.url ?? '').trim();
          if (!cleanUrl) {
            return { ok: false, error: 'Missing PR URL' };
          }
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            const pr = prs[cleanUrl];
            if (!pr) {
              return { ok: false, error: `PR not found: ${cleanUrl}` };
            }

            const isAuto = pr.source === 'auto';
            delete prs[cleanUrl];
            await ctx.storage.set(PRS_KEY, prs);

            if (isAuto) {
              // Add to dismissed set so re-discovery skips
              const dismissed = await readDismissed(ctx);
              dismissed[cleanUrl] = Date.now();
              await ctx.storage.set(DISMISSED_KEY, dismissed);
            }

            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          return { ok: false, error };
        }
      },

      /**
       * Toggle a PR's per-PR mute (R-LIST-018). A muted PR stays in the list but
       * generates no notifications regardless of global/per-repo switches. The URL
       * must be an OWN key of the prs map — a prototype-chain trap (`__proto__` etc.)
       * is rejected, so a crafted URL can't pollute the prototype.
       */
      async setPrMuted(params: { url: string; muted: boolean }): Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }> {
        try {
          const cleanUrl = (params?.url ?? '').trim();
          if (!cleanUrl) return { ok: false, error: 'Missing PR URL' };
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            if (!isMutablePrKey(prs, cleanUrl)) return { ok: false, error: `PR not found: ${cleanUrl}` };
            prs[cleanUrl].muted = !!params.muted;
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Toggle a PR's per-PR favorite (R-LIST-026). A find-faster marker: surfaces
       * the row (star + tint) and drives the "Favorites first" sort. Independent of
       * mute/seen/project and does NOT change polling/sync. The URL must be an OWN
       * key of the prs map — a prototype-chain trap (`__proto__` etc.) is rejected,
       * so a crafted URL can't pollute the prototype.
       */
      async setPrFavorite(params: { url: string; favorite: boolean }): Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }> {
        try {
          const cleanUrl = (params?.url ?? '').trim();
          if (!cleanUrl) return { ok: false, error: 'Missing PR URL' };
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            if (!isMutablePrKey(prs, cleanUrl)) return { ok: false, error: `PR not found: ${cleanUrl}` };
            prs[cleanUrl].favorite = !!params.favorite;
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Bulk favorite / unfavorite (R-LIST-026, DR-2). Sets or clears `favorite`
       * for every URL in the batch in ONE storage write. Unknown URLs and
       * prototype-chain traps are skipped; the batch is capped at BULK_URL_CAP
       * (Rule 5) so a runaway renderer selection can't unbound the write.
       */
      async setPrsFavorite(params: { urls: string[]; favorite: boolean }): Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }> {
        try {
          const urls = Array.isArray(params?.urls) ? params.urls.slice(0, BULK_URL_CAP) : [];
          const favorite = !!params?.favorite;
          return await withPrsLock(async () => {
            const prs = await readPrs(ctx);
            for (const raw of urls) {
              const url = String(raw ?? '').trim();
              if (url && isMutablePrKey(prs, url)) prs[url].favorite = favorite;
            }
            await ctx.storage.set(PRS_KEY, prs);
            const prsList = Object.values(prs).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Re-fetch a single PR on demand (R-LIST-023 retry). Clears its syncError on
       * success. Bypasses the terminal-skip in pollAll — the user asked for THIS PR.
       */
      async retryPr(params: { url: string }): Promise<{ ok: boolean; prs?: MonitoredPr[]; error?: string }> {
        try {
          const cleanUrl = (params?.url ?? '').trim();
          if (!cleanUrl) return { ok: false, error: 'Missing PR URL' };
          const snapshot = await readPrs(ctx);
          const prev = snapshot[cleanUrl];
          if (!prev) return { ok: false, error: `PR not found: ${cleanUrl}` };
          // Slow fetch outside the lock; merge under it so a user field or removal
          // that lands during the fetch isn't reverted/resurrected (R-CORE-004).
          const next = await refreshOne(ctx, prev);
          return await withPrsLock(async () => {
            const current = await readPrs(ctx);
            const live = current[cleanUrl];
            if (!live) return { ok: false, error: `PR not found: ${cleanUrl}` };
            current[cleanUrl] = overlayUserFields(next, live);
            await ctx.storage.set(PRS_KEY, current);
            const prsList = Object.values(current).sort((a, b) => a.addedAt - b.addedAt);
            return { ok: true, prs: prsList };
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      // --- Organizations (R-ORG-*) ---

      /**
       * List monitored orgs with derived short-host + live connection state
       * (R-ORG-003/005). Seeds once-ever from `gh` accounts on first call
       * (R-ORG-002 anti-loop, gated by orgDiscovered).
       */
      async listOrgs(): Promise<{
        ok: boolean;
        orgs?: Array<MonitoredOrg & { shortHost: string; connection: ConnectionState }>;
        error?: string;
      }> {
        try {
          const settings = await discoverOrgs(ctx, false);
          const conn = await connectionByHost(ctx);
          const orgs = (settings.organizations ?? []).map((o) => ({
            ...o,
            shortHost: shortHost(o.host),
            connection: conn[o.host] ?? 'disconnected',
          }));
          return { ok: true, orgs };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /** Re-discover orgs from gh accounts (R-ORG-004). Explicit user action. */
      async rediscoverOrgs(): Promise<{ ok: boolean; error?: string }> {
        try {
          // Explicit refresh — bust the gh auth-status cache so discovery and
          // connection state reflect live `gh` accounts, not a stale snapshot.
          invalidateAuthHosts();
          await discoverOrgs(ctx, true);
          // Re-discover is the SOLE sanctioned author re-sync path (AC-PPL-5.3):
          // refresh the persisted author identities from live gh here, so ordinary
          // Author-area opens can stay read-only against the stored record.
          await discoverAuthor(ctx, true);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Delete an org (R-ORG-006): removes the org, its repos, and those repos'
       * PRs from PR Monitor. Leaves gh creds untouched. Identified by host+login.
       */
      async deleteOrg(params: { host: string; login: string }): Promise<{ ok: boolean; error?: string }> {
        try {
          const host = String(params?.host ?? '').trim();
          const login = String(params?.login ?? '').trim();
          if (!host || !login) return { ok: false, error: 'Missing org identity' };
          const settings = await readSettings(ctx);
          const orgs = (settings.organizations ?? []).filter((o) => !(o.host === host && o.login === login));
          // Remove repos on this host+org and their PRs.
          const keptRepos: MonitoredRepo[] = [];
          for (const r of settings.repositories ?? []) {
            if (r.host === host && r.orgLogin === login) {
              await removePrsForRepo(ctx, `${r.owner}/${r.repo}`);
            } else {
              keptRepos.push(r);
            }
          }
          const next = mergeSettings({ ...settings, organizations: orgs, repositories: keptRepos });
          await ctx.storage.set(SETTINGS_KEY, next);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      // --- Repositories (R-REPO-*) ---

      /** List connected repos with short-host + connection state (R-REPO-001). */
      async listRepos(): Promise<{
        ok: boolean;
        repos?: Array<MonitoredRepo & { shortHost: string; connection: ConnectionState }>;
        error?: string;
      }> {
        try {
          const settings = await readSettings(ctx);
          const conn = await connectionByHost(ctx);
          // Connection is derived SOLELY from gh auth (R-ORG-005) and is
          // independent of the `active` flag (AC-REPO-5.3): a repo can be
          // inactive yet connected, or active yet disconnected. Conflating them
          // (forcing 'disconnected' when inactive) made "inactive yet connected"
          // unrepresentable. The sync-pass gate (R-REPO-012) ANDs active with
          // connection separately; the badge shows each state as-is.
          const repos = (settings.repositories ?? []).map((r) => ({
            ...r,
            shortHost: shortHost(r.host),
            connection: conn[r.host] ?? 'disconnected',
          }));
          return { ok: true, repos };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Add a repository manually (R-REPO-008). `ref` accepts owner/repo, a full
       * URL, or an SSH clone URL; `host` + `orgLogin` come from the org dropdown.
       */
      async addRepository(params: {
        ref: string;
        host: string;
        orgLogin: string;
      }): Promise<{ ok: boolean; error?: string; settings?: PrMonitorSettings }> {
        try {
          const host = String(params?.host ?? '').trim();
          const orgLogin = String(params?.orgLogin ?? '').trim();
          if (!host || !orgLogin) return { ok: false, error: 'Please select an organization.' };
          const parsed = parseRepoRef(params?.ref ?? '');
          if (!parsed) {
            const raw = String(params?.ref ?? '').trim();
            if (raw && !raw.includes('/')) {
              return { ok: false, error: 'Please include the owner — e.g., your-org/repo-name.' };
            }
            return { ok: false, error: 'Invalid repository. Enter owner/repo or a full GitHub URL.' };
          }
          return await addRepo(ctx, parsed.owner, parsed.repo, host, orgLogin);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Add a batch of already-identified repos (from Suggested/Browse selection).
       * Each is `{owner, repo, host, orgLogin}`; duplicates are silently skipped.
       */
      async addRepositories(params: {
        repos: Array<{ owner: string; repo: string; host: string; orgLogin: string }>;
      }): Promise<{ ok: boolean; added?: number; settings?: PrMonitorSettings; error?: string }> {
        try {
          const list = Array.isArray(params?.repos) ? params.repos : [];
          let added = 0;
          let settings: PrMonitorSettings | undefined;
          for (const r of list) {
            const parsed = sanitizeOwnerRepo(r.owner, r.repo);
            if (!parsed || !r.host || !r.orgLogin) continue;
            const res = await addRepo(ctx, parsed.owner, parsed.repo, r.host, r.orgLogin);
            if (res.ok) {
              added++;
              settings = res.settings;
            }
          }
          if (!settings) settings = await readSettings(ctx);
          return { ok: true, added, settings };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Update a repo's settings (R-REPO-011): repository ref, org, active flag,
       * TIS preset, and per-repo in-app notifications. Toggling active OFF removes
       * that repo's PRs (user-initiated — R-REPO-011 note). Identified by the
       * ORIGINAL host+owner+repo (`key`), so the ref itself can change.
       */
      async updateRepository(params: {
        key: { host: string; owner: string; repo: string };
        ref?: string;
        orgLogin?: string;
        active?: boolean;
        tisPreset?: TisPresetId;
        buildTisPreset?: TisPresetId;
        reviewTisPreset?: TisPresetId;
        sfciGated?: boolean;
        ignoredFailingChecks?: string[];
        notifyInApp?: boolean;
      }): Promise<{ ok: boolean; error?: string; settings?: PrMonitorSettings; prs?: MonitoredPr[] }> {
        try {
          const k = params?.key;
          if (!k?.host || !k?.owner || !k?.repo) return { ok: false, error: 'Missing repository key' };
          const settings = await readSettings(ctx);
          const repos = [...(settings.repositories ?? [])];
          const idx = repos.findIndex(
            (r) => r.host === k.host && r.owner === k.owner && r.repo === k.repo
          );
          if (idx < 0) return { ok: false, error: 'Repository not found' };
          const cur = repos[idx];
          const next: MonitoredRepo = { ...cur };

          if (typeof params.ref === 'string' && params.ref.trim()) {
            const parsed = parseRepoRef(params.ref);
            if (!parsed) return { ok: false, error: 'Invalid repository. Enter owner/repo or a full GitHub URL.' };
            next.owner = parsed.owner;
            next.repo = parsed.repo;
          }
          if (typeof params.orgLogin === 'string' && params.orgLogin.trim()) {
            next.orgLogin = params.orgLogin.trim();
          }
          // Two independent presets (R-REPO-014). `buildTisPreset` is the current
          // field; `tisPreset` is accepted as the legacy alias and routed to build.
          const buildPreset = params.buildTisPreset ?? params.tisPreset;
          if (typeof buildPreset === 'string' && buildPreset in TIS_PRESETS) {
            next.buildTisPreset = buildPreset;
            // Drop the legacy single field so it can't shadow the build preset.
            next.tisPreset = undefined;
          }
          if (typeof params.reviewTisPreset === 'string' && params.reviewTisPreset in TIS_PRESETS) {
            next.reviewTisPreset = params.reviewTisPreset;
          }
          if (typeof params.sfciGated === 'boolean') next.sfciGated = params.sfciGated;
          if (Array.isArray(params.ignoredFailingChecks)) {
            // Normalize to a de-duped list of non-empty strings (R-REPO-018).
            next.ignoredFailingChecks = Array.from(
              new Set(params.ignoredFailingChecks.filter((s): s is string => typeof s === 'string' && s.trim().length > 0))
            );
          }
          if (typeof params.notifyInApp === 'boolean') next.notifyInApp = params.notifyInApp;

          const wasActive = cur.active;
          if (typeof params.active === 'boolean') next.active = params.active;

          repos[idx] = next;
          const merged = mergeSettings({ ...settings, repositories: repos });
          await ctx.storage.set(SETTINGS_KEY, merged);

          // Active → inactive is user-initiated: remove that repo's PRs.
          if (wasActive && next.active === false) {
            await removePrsForRepo(ctx, `${cur.owner}/${cur.repo}`);
            return { ok: true, settings: merged };
          }

          // Settings that feed the poll-cached pill fields (`buildHappy`,
          // `hasSfciJob`) — `sfciGated` and `ignoredFailingChecks` — take effect
          // main-side only on a refresh. Re-run refreshOne for this repo's live
          // PRs now so the two-pill status updates on Save without waiting for the
          // next background sync. Preset changes are resolved renderer-side from
          // `settings`, so they need no refresh; we refresh only when a cached
          // field's input changed and the repo is (still) active.
          const gatedChanged = next.sfciGated !== cur.sfciGated;
          const ignoredChanged =
            JSON.stringify(next.ignoredFailingChecks ?? []) !== JSON.stringify(cur.ignoredFailingChecks ?? []);
          if (next.active !== false && (gatedChanged || ignoredChanged)) {
            const repoKey = `${next.owner}/${next.repo}`.toLowerCase();
            const snapshot = await readPrs(ctx);
            const fetched: Record<string, MonitoredPr> = {};
            for (const url of Object.keys(snapshot)) {
              const prev = snapshot[url];
              if (prev.repo.toLowerCase() !== repoKey) continue;
              if (prev.status === 'closed-merged' || prev.status === 'closed-abandoned') continue;
              try {
                fetched[url] = await refreshOne(ctx, prev);
              } catch (err) {
                ctx.log(`updateRepository refresh failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
            if (Object.keys(fetched).length > 0) {
              const prsList = await withPrsLock(async () => {
                const current = await readPrs(ctx);
                for (const [url, fresh] of Object.entries(fetched)) {
                  const live = current[url];
                  if (!live) continue; // removed/dismissed mid-refresh — do not resurrect
                  current[url] = overlayUserFields(fresh, live);
                }
                await ctx.storage.set(PRS_KEY, current);
                return Object.values(current).sort((a, b) => a.addedAt - b.addedAt);
              });
              return { ok: true, settings: merged, prs: prsList };
            }
          }
          return { ok: true, settings: merged };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /** Delete a repository (R-REPO-011) and its monitored PRs. */
      async deleteRepository(params: {
        host: string;
        owner: string;
        repo: string;
      }): Promise<{ ok: boolean; settings?: PrMonitorSettings; error?: string }> {
        try {
          const { host, owner, repo } = params ?? {};
          if (!host || !owner || !repo) return { ok: false, error: 'Missing repository key' };
          const settings = await readSettings(ctx);
          const repos = (settings.repositories ?? []).filter(
            (r) => !(r.host === host && r.owner === owner && r.repo === repo)
          );
          const next = mergeSettings({ ...settings, repositories: repos });
          await ctx.storage.set(SETTINGS_KEY, next);
          await removePrsForRepo(ctx, `${owner}/${repo}`);
          return { ok: true, settings: next };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Cheap read of current sync-health (R-REPO-013) without a fresh probe
       * pass. Re-derives the PERSISTENT facts from the stored bookkeeping + live
       * `gh` auth: disconnected hosts (from auth), confirmed remote-gone (≥2
       * passes, not kept), and kept-gone. The TRANSIENT `outageHosts` is only
       * known from an actual probe pass, so it's surfaced through {@link pollAll}'s
       * return, not here — this read leaves it empty. Lets the renderer paint the
       * clue on mount before the first poll completes.
       */
      async getSyncHealth(): Promise<{ ok: boolean; health?: SyncHealth; error?: string }> {
        try {
          const state = await readSyncHealthState(ctx);
          const conn = await connectionByHost(ctx);
          const settings = await readSettings(ctx);
          const trackedHosts = new Set((settings.repositories ?? []).map((r) => r.host));
          const disconnectedHosts = Array.from(trackedHosts)
            .filter((h) => (conn[h] ?? 'disconnected') !== 'connected')
            .sort();
          const kept = new Set((state.kept ?? []).map((n) => n.toLowerCase()));
          const remoteGone = Object.entries(state.gone404 ?? {})
            .filter(([name, count]) => count >= 2 && !kept.has(name))
            .map(([name]) => name)
            .sort();
          const health: SyncHealth = {
            disconnectedHosts,
            outageHosts: [],
            remoteGone,
            keptGone: Array.from(kept).sort(),
          };
          return { ok: true, health };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /**
       * Resolve a remote-gone repo's Remove/Keep prompt (R-REPO-016). `action`:
       *   - `remove` — delete the repo + its tracked PRs (same as R-REPO-006), and
       *     clear its health bookkeeping.
       *   - `keep`   — retain the repo + last-known PRs (marked stale) but exclude it
       *     from the sync pass; recorded in the kept set so `repoSyncGate` skips it
       *     until removal or recovery (AC-REPO-16.3).
       * `repo` is the `owner/repo` full name (renderer-supplied → validated here,
       * Rule 1/2 — it must be an isSafeRepoArg AND a currently-tracked repo).
       */
      async resolveRemoteGone(params: {
        repo: string;
        action: 'remove' | 'keep';
      }): Promise<{ ok: boolean; settings?: PrMonitorSettings; error?: string }> {
        try {
          const repo = String(params?.repo ?? '').trim();
          const action = params?.action;
          if (!isSafeRepoArg(repo)) return { ok: false, error: `Invalid repository: ${repo}` };
          if (action !== 'remove' && action !== 'keep') return { ok: false, error: 'Invalid action' };
          const settings = await readSettings(ctx);
          const key = repo.toLowerCase();
          const rec = (settings.repositories ?? []).find(
            (r) => `${r.owner}/${r.repo}`.toLowerCase() === key
          );
          if (!rec) return { ok: false, error: `Not a tracked repository: ${repo}` };

          const state = await readSyncHealthState(ctx);
          if (action === 'remove') {
            const repos = (settings.repositories ?? []).filter(
              (r) => `${r.owner}/${r.repo}`.toLowerCase() !== key
            );
            const next = mergeSettings({ ...settings, repositories: repos });
            await ctx.storage.set(SETTINGS_KEY, next);
            await removePrsForRepo(ctx, `${rec.owner}/${rec.repo}`);
            // Clear its bookkeeping so a re-add starts fresh.
            const gone404 = { ...state.gone404 };
            delete gone404[key];
            await ctx.storage.set(SYNC_HEALTH_KEY, {
              gone404,
              kept: (state.kept ?? []).filter((n) => n.toLowerCase() !== key),
            });
            return { ok: true, settings: next };
          }
          // keep: record in the kept set (idempotent), leave repo + PRs in place.
          const keptSet = new Set((state.kept ?? []).map((n) => n.toLowerCase()));
          keptSet.add(key);
          await ctx.storage.set(SYNC_HEALTH_KEY, {
            gone404: state.gone404 ?? {},
            kept: Array.from(keptSet).sort(),
          });
          return { ok: true, settings };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      /** Test a repo's connection (R-REPO-010). */
      async testRepository(params: {
        host: string;
        owner: string;
        repo: string;
      }): Promise<{ ok: boolean; error?: string }> {
        const { host, owner, repo } = params ?? {};
        if (!host || !owner || !repo) return { ok: false, error: 'Missing repository key' };
        const bad = await rejectUnknownHost(ctx, host);
        if (bad) return { ok: false, error: bad };
        return testRepoConnection(ctx, host, owner, repo);
      },

      /**
       * Browse an org's repos, one page (R-REPO-009). `org` here is the org login;
       * host from the org record.
       */
      async browseRepos(params: {
        host: string;
        org: string;
        page?: number;
      }): Promise<{ ok: boolean; repos?: RemoteRepo[]; hasMore?: boolean; error?: string }> {
        const { host, org } = params ?? {};
        if (!host || !org) return { ok: false, error: 'Missing host/org' };
        const bad = await rejectUnknownHost(ctx, host);
        if (bad) return { ok: false, error: bad };
        return listOrgRepos(ctx, host, org, params.page ?? 1);
      },

      /** Server-side repo search on a host (R-REPO-009 hybrid). */
      async searchRepositories(params: {
        host: string;
        query: string;
        org?: string;
      }): Promise<{ ok: boolean; repos?: RemoteRepo[]; error?: string }> {
        const { host, query, org } = params ?? {};
        if (!host) return { ok: false, error: 'Missing host' };
        const bad = await rejectUnknownHost(ctx, host);
        if (bad) return { ok: false, error: bad };
        return searchRepos(ctx, host, query ?? '', org);
      },

      /**
       * Search repositories across EVERY authenticated host (R-REPO-009). This is
       * the browser's search-first entry point: no org dropdown — "orgs" here are
       * `gh` user accounts, so a per-org browse degrades to personal repos. Each
       * host is searched via `search/repositories` (covers all orgs the user can
       * see there) and the results merge, deduped by host+fullName. Hosts come
       * from main's own `getAuthHosts` (never renderer free-text — Rule 2).
       */
      async searchAllRepositories(params: {
        query: string;
      }): Promise<{ ok: boolean; repos?: RemoteRepo[]; error?: string }> {
        return searchReposAllHosts(ctx, params?.query ?? '');
      },

      /**
       * List EVERY accessible repository across all authenticated hosts, one page
       * deep (R-REPO-009 browse-all). This is the browser's show-all-on-open data
       * source (CodeNod parity): the renderer opens the dialog and gets the full
       * owner-grouped list without typing. Each repo is tagged `alreadyAdded` so
       * the browser can render a "Connected" pill instead of a checkbox for repos
       * already monitored. `page` drives "Load more". Hosts come from main's own
       * `getAuthHosts` (never renderer free-text — Rule 2).
       */
      async listAllRepositories(params?: { page?: number }): Promise<{
        ok: boolean;
        repos?: Array<RemoteRepo & { alreadyAdded: boolean }>;
        hasMore?: boolean;
        incompleteOwners?: string[];
        error?: string;
      }> {
        const res = await listReposAllHosts(ctx, params?.page ?? 1);
        if (!res.ok || !res.repos) return { ok: res.ok, error: res.error, repos: [], hasMore: false };
        const settings = await readSettings(ctx);
        const connected = new Set(
          (settings.repositories ?? []).map(
            (r) => `${r.host}|${r.owner.toLowerCase()}/${r.repo.toLowerCase()}`
          )
        );
        const repos = res.repos.map((r) => ({
          ...r,
          alreadyAdded: connected.has(`${r.host}|${r.fullName.toLowerCase()}`),
        }));
        return { ok: true, repos, hasMore: res.hasMore, incompleteOwners: res.incompleteOwners };
      },

      /**
       * Suggested repositories (R-REPO-007): scan the author's 90-day PR activity
       * across every monitored org's host, tag which are already connected. The
       * 90-day window is FIXED and computed here (main has a real clock).
       */
      async suggestRepositories(): Promise<{
        ok: boolean;
        repos?: Array<SuggestedRepo & { alreadyAdded: boolean; orgLogin: string }>;
        error?: string;
      }> {
        try {
          const settings = await discoverOrgs(ctx, false);
          const orgs = settings.organizations ?? [];
          if (orgs.length === 0) return { ok: true, repos: [] };
          const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const connected = new Set(
            (settings.repositories ?? []).map((r) => `${r.host}|${r.owner.toLowerCase()}/${r.repo.toLowerCase()}`)
          );
          // Scan once per distinct host (author:@me is host-scoped, not org-scoped).
          const hosts = Array.from(new Set(orgs.map((o) => o.host)));
          const all: Array<SuggestedRepo & { alreadyAdded: boolean; orgLogin: string }> = [];
          for (const host of hosts) {
            const res = await suggestedRepos(ctx, host, since);
            if (!res.ok || !res.repos) continue;
            for (const r of res.repos) {
              // Attribute to a monitored org on the same host whose login matches
              // the repo owner, else the first org on that host.
              const org =
                orgs.find((o) => o.host === host && o.login.toLowerCase() === r.owner.toLowerCase()) ??
                orgs.find((o) => o.host === host);
              all.push({
                ...r,
                orgLogin: org?.login ?? r.owner,
                alreadyAdded: connected.has(`${host}|${r.owner.toLowerCase()}/${r.repo.toLowerCase()}`),
              });
            }
          }
          return { ok: true, repos: all };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },

      // --- Author (R-PPL-*) ---

      /**
       * The monitored author's identity across orgs (R-PPL-003/004). Returns the
       * authenticated user's profile (display name + email from the first org's
       * host) plus a per-org GitHub-identity list. Seeds authorDiscovered once.
       */
      async getAuthor(): Promise<{
        ok: boolean;
        author?: {
          login: string;
          name?: string;
          email?: string;
          identities: Array<{ host: string; shortHost: string; login: string; connection: ConnectionState }>;
        };
        error?: string;
      }> {
        try {
          // Read the PERSISTED author, seeding it ONCE on the first open (gated by
          // authorDiscovered inside discoverAuthor). Later opens read the stored
          // identity as-is — no live gh re-sync per open (AC-PPL-2.2/5.3). The only
          // re-sync path is Organizations Re-discover (rediscoverOrgs → force).
          const author = await discoverAuthor(ctx, false);
          if (!author) return { ok: true, author: undefined };
          // Connection is NOT stored — layer it on live at read (R-ORG-005), so the
          // per-org pill is fresh without a discovery pass.
          const conn = await connectionByHost(ctx);
          const identities = author.identities.map((i) => ({
            host: i.host,
            shortHost: shortHost(i.host),
            login: i.login,
            connection: (conn[i.host] ?? 'disconnected') as ConnectionState,
          }));
          return {
            ok: true,
            author: {
              login: author.login,
              name: author.name,
              email: author.email,
              identities,
            },
          };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    };
  },
  teardown() {
    // No long-lived resources to clean up yet (polling happens renderer-side).
    // Future: if main grows timers/watchers, release them here.
  },
};

export function setupPrMonitor(ctx: PrMonitorContext) {
  return prMonitorMainModule.setup(ctx);
}

export default prMonitorMainModule;
