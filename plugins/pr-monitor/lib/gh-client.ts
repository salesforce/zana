/**
 * Thin wrappers around the `gh` CLI for PR Monitor's main-process poller.
 *
 * Every call goes through the brokered exec capability (`ctx.exec`) so a disk
 * extension is permission-gated against the manifest's `execAllowlist: ['gh']`.
 * No raw `child_process` here — that would be blocked by the disk-extension
 * Node-builtin denylist anyway, and the broker is the sanctioned path.
 *
 * The functions degrade GRACEFULLY: a `gh` spawn failure, timeout, or non-zero
 * exit returns an empty/fallback value rather than throwing, so a poll cycle
 * can keep a PR in its last-known-good state instead of erroring the whole
 * batch. The poller is responsible for deciding whether an empty result is
 * meaningful (e.g. a CLOSED workflow PR legitimately has no checks).
 */

import type { PrMonitorContext, ExecResult } from './context.js';
import type { CheckRun, GhAccount, PrReviewer } from './types.js';
import { normalizeExcerpt } from './status.js';

const GH_TIMEOUT_MS = 30_000;

/**
 * Validate an `owner/repo` argument before it is interpolated into a `gh`
 * search query or passed as an argv token (AC-CORE-3.1). Each segment must
 * start with an alphanumeric / `.` / `_` (never `-`, so it can't be read as a
 * flag) and otherwise contain only `[A-Za-z0-9._-]`. Anything else — a leading
 * dash, a space, a shell metachar, a second slash — is rejected. Callers drop
 * or reject the value; they never pass an unvalidated repo through.
 */
export function isSafeRepoArg(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9._][A-Za-z0-9._-]*\/[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(v);
}

/** The brokered process-runner. A `{storage, log}`-only ctx (no `exec`) is rejected at module setup. */
type Broker = NonNullable<PrMonitorContext['exec']>;

/**
 * Run `gh <args>` via the broker and return its result, or null when the
 * broker rejected the call (spawn failure / timeout / output-cap kill). The
 * broker REJECTS for those cases rather than resolving with a code, so this
 * helper is what differentiates "ran and failed" (resolves with code !== 0)
 * from "couldn't run" (returns null).
 */
async function runGh(
  broker: Broker,
  args: string[],
  log: PrMonitorContext['log']
): Promise<ExecResult | null> {
  try {
    return await broker({ bin: 'gh', args, timeoutMs: GH_TIMEOUT_MS });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log(`gh ${args.join(' ')} failed to spawn: ${detail}`);
    return null;
  }
}

/**
 * Tolerant JSON parse: try the whole stdout, then the trailing `{…}`/`[…]`
 * block (gh may print a warning before its JSON on auth refresh). Returns
 * null on failure so callers fall back to their empty/safe defaults.
 */
function parseJson<T>(stdout: string): T | null {
  const s = stdout?.trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    const m = s.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
    if (m) {
      try {
        return JSON.parse(m[1]) as T;
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

/**
 * Fetch the CI check rollup for a PR via `gh pr checks <url> --json
 * name,state,bucket`. Returns an empty array on any failure (spawn, parse, or
 * empty payload) — note that `gh pr checks` legitimately exits non-zero when
 * any check is pending or failing, so the exit code is NOT a reliable success
 * signal; we judge success by whether we parsed any rows.
 *
 * `bucket` is gh's normalized grouping (pass/fail/pending/skipping/cancel),
 * preferred over the raw `state` for the rollup classifier. We pass both
 * through to the caller so the UI can show either.
 */
export async function fetchChecks(
  ctx: PrMonitorContext,
  url: string
): Promise<CheckRun[]> {
  if (!ctx.exec) return [];
  // `gh pr checks` infers the host from the PR URL and does NOT accept
  // `--hostname` (it errors "unknown flag"). Pass only the URL — passing the
  // flag made every fetch fail to parse, so the poller silently kept stale data.
  // AC-CORE-3.1: place all flags BEFORE `--`, positionals AFTER so a malicious
  // URL starting with `-` can't be interpreted as a flag.
  const result = await runGh(ctx.exec, ['pr', 'checks', '--json', 'name,state,bucket', '--', url], ctx.log);
  if (!result) return [];
  const parsed = parseJson<Array<{ name?: string; state?: string; bucket?: string }>>(result.stdout);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r): r is { name?: string; state?: string; bucket?: string } => !!r && typeof r === 'object')
    .map((r) => ({
      name: typeof r.name === 'string' ? r.name : 'unknown',
      state: typeof r.state === 'string' ? r.state : '',
      bucket: typeof r.bucket === 'string' ? r.bucket : undefined,
    }));
}

/**
 * The subset of `gh pr view`'s JSON that PR Monitor needs. `state` is the PR
 * state (OPEN/CLOSED/MERGED), `mergeStateStatus` is the protection-rollup
 * status (CLEAN/DIRTY/UNSTABLE/BLOCKED/…), `mergeable` is the simple flag
 * (MERGEABLE/CONFLICTING/UNKNOWN), `reviewDecision` is the review status
 * (APPROVED/REVIEW_REQUIRED/CHANGES_REQUESTED). All feed the status classifier.
 *
 * **Phase 1 additions:** `headRefName`, `author` (object {login, name}),
 * `isDraft`, `body`, `createdAt` (ISO string in raw JSON, parsed to epoch ms).
 * No avatar URL is derived — see the note in `fetchMergeState`.
 */
export interface MergeStateInfo {
  state: string;
  mergeStateStatus: string;
  mergeable: string;
  title: string;
  baseRefName: string;
  reviewDecision: string;
  headRefName: string;
  author: { login: string; name?: string } | null;
  isDraft: boolean;
  body: string;
  createdAt: number;
  updatedAt: number;
  /** Reviewers grouped by review state (R-LIST-016), derived from reviews + reviewRequests. */
  reviewers: PrReviewer[];
}

/**
 * Reduce `gh pr view`'s `reviews` + `reviewRequests` into one reviewer-per-login
 * list with a single {@link ReviewState} bucket (R-LIST-016 / AC-LIST-16.1).
 *
 * `reviews` is a chronological list of individual review submissions
 * (`{author:{login,name}, state}`); a reviewer may appear several times. We keep
 * each login's LATEST decisive review — CHANGES_REQUESTED or APPROVED — and
 * ignore COMMENTED / DISMISSED / PENDING (no triage signal). `reviewRequests` is
 * the set of reviewers with an outstanding ask; a login there that has not since
 * submitted a decisive review is 'review-requested'. An outstanding request
 * supersedes a stale prior approval (GitHub re-requested them), so requests win
 * over an APPROVED but not over a CHANGES_REQUESTED.
 */
export function reduceReviewers(
  reviews: Array<{ author?: { login?: string; name?: string }; state?: string }>,
  reviewRequests: Array<{ login?: string; name?: string }>
): PrReviewer[] {
  const byLogin = new Map<string, PrReviewer>();

  for (const r of reviews) {
    const login = r?.author?.login;
    if (typeof login !== 'string' || !login) continue;
    const state = String(r?.state ?? '').toUpperCase();
    let bucket: PrReviewer['state'] | null = null;
    if (state === 'APPROVED') bucket = 'approved';
    else if (state === 'CHANGES_REQUESTED') bucket = 'changes-requested';
    if (!bucket) continue; // COMMENTED / DISMISSED / PENDING carry no signal
    const entry: PrReviewer = { login, state: bucket };
    if (typeof r.author?.name === 'string' && r.author.name) entry.name = r.author.name;
    byLogin.set(login, entry); // later review overwrites earlier (chronological)
  }

  for (const req of reviewRequests) {
    const login = req?.login;
    if (typeof login !== 'string' || !login) continue;
    const prior = byLogin.get(login);
    // An outstanding request supersedes a stale approval, but not a
    // changes-requested (the author still owes them a fix).
    if (prior && prior.state === 'changes-requested') continue;
    const entry: PrReviewer = { login, state: 'review-requested' };
    if (typeof req.name === 'string' && req.name) entry.name = req.name;
    byLogin.set(login, entry);
  }

  return Array.from(byLogin.values());
}

/**
 * Fetch a PR's merge-relevant metadata via `gh pr view <url> --json
 * state,mergeStateStatus,mergeable,reviewDecision,title,baseRefName,headRefName,author,isDraft,body,createdAt`.
 * Returns an all-empty/null fallback record on any failure so the poller can
 * still call the classifier without null checks. `body` is trimmed + capped to
 * 280 chars here (Rule 5 — bound payload before persist). `author` is parsed
 * from the gh JSON object → {login, name?}. No avatar URL is derived — the
 * renderer draws initials (see note below). `createdAt` ISO → epoch ms.
 */
export async function fetchMergeState(
  ctx: PrMonitorContext,
  url: string
): Promise<MergeStateInfo> {
  const empty: MergeStateInfo = {
    state: '',
    mergeStateStatus: '',
    mergeable: '',
    title: '',
    baseRefName: '',
    reviewDecision: '',
    headRefName: '',
    author: null,
    isDraft: false,
    body: '',
    createdAt: 0,
    updatedAt: 0,
    reviewers: [],
  };
  if (!ctx.exec) return empty;
  // `gh pr view` infers the host from the PR URL and does NOT accept
  // `--hostname` (it errors "unknown flag"). Pass only the URL.
  // AC-CORE-3.1: place all flags BEFORE `--`, positionals AFTER so a malicious
  // URL starting with `-` can't be interpreted as a flag.
  const result = await runGh(
    ctx.exec,
    [
      'pr',
      'view',
      '--json',
      'state,mergeStateStatus,mergeable,reviewDecision,title,baseRefName,headRefName,author,isDraft,body,createdAt,updatedAt,reviews,reviewRequests',
      '--',
      url,
    ],
    ctx.log
  );
  if (!result || result.code !== 0) return empty;
  const parsed = parseJson<Partial<{
    state: string;
    mergeStateStatus: string;
    mergeable: string;
    reviewDecision: string;
    title: string;
    baseRefName: string;
    headRefName: string;
    author: { login?: string; name?: string };
    isDraft: boolean;
    body: string;
    createdAt: string;
    updatedAt: string;
    reviews: Array<{ author?: { login?: string; name?: string }; state?: string }>;
    reviewRequests: Array<{ login?: string; name?: string; slug?: string }>;
  }>>(result.stdout);
  if (!parsed || typeof parsed !== 'object') return empty;

  // Parse author object. We intentionally DO NOT derive an avatarUrl. Two reasons
  // (AC-LIST-16.2a), the first technical, not policy: (1) a renderer
  // <img src="https://<enterprise-host>/<login>.png"> CANNOT authenticate — the
  // enterprise avatar endpoint 302s to SSO and the Electron renderer holds no
  // session cookie for that host (verified curl 2026-07-17), so it yields a broken
  // image, not the PNG. The authenticated fetch path is main-side `gh`. (2) But the
  // broker's ExecResult.stdout is a utf-8 string, so the authenticated image bytes
  // can't round-trip through `gh api` to a data: URI without corruption — there is
  // no binary exec channel today. The renderer therefore renders initials
  // (AC-LIST-16.2a fallback). A data:-URI avatar can land once a host binary/base64
  // channel exists; until then, no avatarUrl is emitted.
  let author: { login: string; name?: string } | null = null;
  if (parsed.author && typeof parsed.author === 'object' && typeof parsed.author.login === 'string') {
    author = { login: parsed.author.login };
    if (typeof parsed.author.name === 'string') {
      author.name = parsed.author.name;
    }
  }

  // Normalize body into a plain-text excerpt (AC-LIST-17.2/17.3): strip markdown
  // boilerplate + cap to 280 chars main-side (Rule 5 — bound payload before persist).
  const body = normalizeExcerpt(typeof parsed.body === 'string' ? parsed.body : '');

  // Parse createdAt ISO → epoch ms
  let createdAt = 0;
  if (typeof parsed.createdAt === 'string') {
    const d = new Date(parsed.createdAt);
    if (!isNaN(d.getTime())) {
      createdAt = d.getTime();
    }
  }

  // Parse updatedAt ISO → epoch ms (drives the "PR Updated" sort — the real
  // GitHub last-change time, not our poll time).
  let updatedAt = 0;
  if (typeof parsed.updatedAt === 'string') {
    const d = new Date(parsed.updatedAt);
    if (!isNaN(d.getTime())) {
      updatedAt = d.getTime();
    }
  }

  // Reduce reviews + reviewRequests → grouped reviewers (R-LIST-016). A
  // reviewRequest to a TEAM has no `login` (only name/slug) and is dropped —
  // the row shows individual reviewers only.
  const reviewers = reduceReviewers(
    Array.isArray(parsed.reviews) ? parsed.reviews : [],
    Array.isArray(parsed.reviewRequests) ? parsed.reviewRequests : []
  );

  return {
    state: typeof parsed.state === 'string' ? parsed.state : '',
    mergeStateStatus: typeof parsed.mergeStateStatus === 'string' ? parsed.mergeStateStatus : '',
    mergeable: typeof parsed.mergeable === 'string' ? parsed.mergeable : '',
    title: typeof parsed.title === 'string' ? parsed.title : '',
    baseRefName: typeof parsed.baseRefName === 'string' ? parsed.baseRefName : '',
    reviewDecision: typeof parsed.reviewDecision === 'string' ? parsed.reviewDecision : '',
    headRefName: typeof parsed.headRefName === 'string' ? parsed.headRefName : '',
    author,
    isDraft: typeof parsed.isDraft === 'boolean' ? parsed.isDraft : false,
    body,
    createdAt,
    updatedAt,
    reviewers,
  };
}

/**
 * GET a `gh api` path on the given host. Used for autointegrate landing
 * detection — fetching the PR's issue comments and comparing the sync'd SHA
 * against a destination branch.
 *
 * `path` should be the API path without a leading slash (e.g.
 * `repos/owner/name/issues/123/comments?per_page=100`). Returns the parsed
 * JSON or null on any failure (spawn / non-zero exit / parse).
 */
export async function ghApi(
  ctx: PrMonitorContext,
  host: string,
  path: string
): Promise<unknown> {
  if (!ctx.exec) return null;
  // AC-CORE-3.1: place all flags BEFORE `--`, positionals AFTER so a malicious
  // path starting with `-` can't be interpreted as a flag.
  const result = await runGh(ctx.exec, ['api', '--hostname', host, '--', path], ctx.log);
  if (!result || result.code !== 0) return null;
  return parseJson<unknown>(result.stdout);
}

/**
 * Derive a GitHub REST API base URL from a host, matching how CodeNod stores an
 * Organization's `github_base_url`. Public github.com uses the api. subdomain;
 * GitHub Enterprise uses `https://<host>/api/v3`.
 */
export function apiBaseUrlForHost(host: string): string {
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

/**
 * Detect authenticated `gh` accounts by parsing `gh auth status`.
 *
 * `gh auth status` groups its output by host: a host appears flush-left on its
 * own line, followed by indented detail lines. We only need two facts per host —
 * the logged-in account login and whether it is the active account — both of
 * which `gh` prints in the indented block:
 *
 *   git.soma.salesforce.com
 *     ✓ Logged in to git.soma.salesforce.com account geoffrey-baker (keyring)
 *     - Active account: true
 *
 * `gh` has no `--json` for this command, so we parse the human output. It writes
 * status to stdout on success; older/edge builds use stderr, so we scan both.
 * Returns [] on any failure — discovery then falls back to no accounts (and the
 * Settings UI shows "no authenticated accounts" rather than crashing).
 */
/**
 * In-memory TTL cache for `gh auth status`. Every settings-tab open (Author,
 * Organizations, Repositories) resolves connection state via `connectionByHost`
 * → `getAuthHosts`, which spawns a `gh auth status` subprocess (~150–300ms).
 * Auth rarely changes mid-session, so a short-lived cache turns repeated opens
 * into a single spawn. Invalidated explicitly on Re-discover ({@link invalidateAuthHosts}).
 */
const AUTH_HOSTS_TTL_MS = 60_000;
let authHostsCache: { at: number; accounts: GhAccount[] } | null = null;

/** Drop the cached `gh auth status` result so the next read re-spawns gh. */
export function invalidateAuthHosts(): void {
  authHostsCache = null;
}

export async function getAuthHosts(ctx: PrMonitorContext): Promise<GhAccount[]> {
  if (!ctx.exec) return [];
  const cached = authHostsCache;
  if (cached && Date.now() - cached.at < AUTH_HOSTS_TTL_MS) return cached.accounts;
  const result = await runGh(ctx.exec, ['auth', 'status'], ctx.log);
  // `gh auth status` exits non-zero when NOT logged in anywhere; treat a null
  // (couldn't spawn) or a run with no parseable hosts as "no accounts". A null
  // spawn is transient — don't cache it, so a later open can recover.
  if (!result) return [];
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const accounts = parseAuthStatus(text);
  authHostsCache = { at: Date.now(), accounts };
  return accounts;
}

/**
 * Parse the text of `gh auth status` into {@link GhAccount}s. Exported for unit
 * testing against captured fixtures (the format is stable but human-oriented).
 */
export function parseAuthStatus(text: string): GhAccount[] {
  const accounts: GhAccount[] = [];
  const lines = text.split('\n');
  let currentHost = '';
  let login = '';
  let active = false;

  const flush = () => {
    if (currentHost && login) {
      accounts.push({
        host: currentHost,
        login,
        apiBaseUrl: apiBaseUrlForHost(currentHost),
        active,
      });
    }
    login = '';
    active = false;
  };

  for (const raw of lines) {
    // A host header is a non-indented, non-empty line that looks like a hostname.
    const isIndented = /^\s/.test(raw);
    const line = raw.trim();
    if (!line) continue;

    if (!isIndented && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(line)) {
      // New host block — commit the previous one first.
      flush();
      currentHost = line;
      continue;
    }

    // Indented detail lines for the current host.
    // "✓ Logged in to <host> account <login> (keyring)"
    const m = line.match(/Logged in to \S+ account (\S+)/i);
    if (m) login = m[1];
    if (/Active account:\s*true/i.test(line)) active = true;
  }
  flush();
  return accounts;
}

/**
 * The subset of REST `search/issues` result that PR Monitor needs for auto-discovery.
 * REST search returns `items[]` where each item has `html_url`, `title`, `number`,
 * `user.login`, `draft`, `repository_url`. No `statusCheckRollupState` (Phase 0 — needs
 * per-PR rollup via existing fetchChecks/fetchMergeState).
 */
export interface DiscoveredPr {
  url: string;
  title: string;
  number: number;
  repo: string;
  author: { login: string };
  isDraft: boolean;
}

/**
 * Search for PRs via REST `search/issues` (Phase 3 auto-discovery).
 * Built on `ghApi` (gh api --hostname <host> ...).
 *
 * Builds query per mode:
 * - 'authored' → 'is:pr is:open author:<login>'
 * - 'reviewRequested' → 'is:pr is:open review-requested:<login>'
 * - 'involved' → 'is:pr is:open involves:<login>' (author/assignee/mention/commenter)
 *
 * Appends ' repo:owner/repo' for each `watchedRepos` entry if non-empty.
 * Paginates with hard cap ≤500 items/query (5 pages × 100/page); logs truncation.
 * On 401/unauth, returns clear error (don't silently empty).
 *
 * Returns {ok, prs, error}. Caller de-dupes across modes/people/hosts.
 */
export async function searchPrs(
  ctx: PrMonitorContext,
  host: string,
  login: string,
  mode: 'authored' | 'reviewRequested' | 'involved',
  watchedRepos: string[]
): Promise<{ ok: boolean; prs?: DiscoveredPr[]; error?: string }> {
  if (!ctx.exec) {
    return { ok: false, error: 'exec capability unavailable' };
  }

  // Build query per mode
  let relation: string;
  if (mode === 'authored') {
    relation = `author:${login}`;
  } else if (mode === 'reviewRequested') {
    relation = `review-requested:${login}`;
  } else {
    relation = `involves:${login}`;
  }

  let q = `is:pr is:open ${relation}`;
  // Append repo scoping if watchedRepos non-empty. Each entry is validated as a
  // safe `owner/repo` (AC-CORE-3.1) before it goes into the query — a malformed
  // or injection-shaped entry (leading dash, space, extra qualifier) is dropped
  // and logged, never interpolated.
  if (watchedRepos.length > 0) {
    for (const repo of watchedRepos) {
      if (!isSafeRepoArg(repo)) {
        ctx.log(`searchPrs: dropping unsafe repo filter ${JSON.stringify(repo)}`);
        continue;
      }
      q += ` repo:${repo}`;
    }
  }

  const MAX_PAGES = 5;
  const PER_PAGE = 100;
  const collected: DiscoveredPr[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const path = `search/issues?q=${encodeURIComponent(q)}&per_page=${PER_PAGE}&page=${page}`;
    const data = await ghApi(ctx, host, path);

    // Parse REST search/issues result: {total_count, items:[...]}
    if (!data || typeof data !== 'object') {
      // Could be 401 (unauth), 403 (rate limit), or other failure
      // If first page and no data → surface error
      if (page === 1) {
        return { ok: false, error: `Search failed for ${host} (${relation}): no data returned (auth issue?)` };
      }
      // Later page failed → stop pagination, keep what we have
      break;
    }

    const payload = data as { total_count?: number; items?: unknown[] };
    if (!Array.isArray(payload.items)) {
      if (page === 1) {
        return { ok: false, error: `Search failed for ${host} (${relation}): malformed response` };
      }
      break;
    }

    if (payload.items.length === 0) {
      // No more results
      break;
    }

    for (const item of payload.items) {
      if (!item || typeof item !== 'object') continue;
      const i = item as {
        html_url?: string;
        title?: string;
        number?: number;
        user?: { login?: string };
        draft?: boolean;
        repository_url?: string;
      };
      if (typeof i.html_url !== 'string' || !i.html_url) continue;
      if (typeof i.title !== 'string') continue;
      if (typeof i.number !== 'number') continue;
      if (!i.user || typeof i.user.login !== 'string') continue;

      // Derive repo from repository_url (last 2 path segments)
      let repo = '';
      if (typeof i.repository_url === 'string') {
        const m = i.repository_url.match(/\/([^/]+\/[^/]+)$/);
        if (m) repo = m[1];
      }
      if (!repo) {
        // Fallback: try repoOf helper (may throw if URL unrecognized)
        try {
          repo = i.html_url.match(/\/([^/]+\/[^/]+)\/pull\/\d+/)?.[1] ?? '';
        } catch {
          /* ignore */
        }
      }

      collected.push({
        url: i.html_url,
        title: i.title,
        number: i.number,
        repo,
        author: { login: i.user.login },
        isDraft: typeof i.draft === 'boolean' ? i.draft : false,
      });
    }

    // Stop if fewer than PER_PAGE (last page)
    if (payload.items.length < PER_PAGE) {
      break;
    }
  }

  // Truncation log if we hit the cap
  if (collected.length >= MAX_PAGES * PER_PAGE) {
    ctx.log(
      `searchPrs(${host}, ${login}, ${mode}): truncated at ${collected.length} items (page cap ${MAX_PAGES})`
    );
  }

  return { ok: true, prs: collected };
}

// ---------------------------------------------------------------------------
// Stage-2 additions — organizations, repositories, author identity.
// All go through the same brokered `gh` path (ghApi / runGh); none add a new
// capability. Repo args are isSafeRepoArg-validated before interpolation.
// ---------------------------------------------------------------------------

/** A repository as surfaced by browse/suggested/search (R-REPO-009/007). */
export interface RemoteRepo {
  owner: string;
  repo: string;
  /** Full `owner/repo`. */
  fullName: string;
  host: string;
  /** ISO/epoch not needed here; browse only needs identity. */
  isPrivate?: boolean;
}

/**
 * List an organization's repositories, one page (R-REPO-009). Uses
 * `gh api --hostname <host> orgs/<org>/repos?per_page=100&page=<n>` and falls
 * back to `users/<org>/repos` when the login is a user, not an org. Returns the
 * page's repos plus whether another page likely exists (a full page).
 * `org` is validated as a bare login before interpolation.
 */
export async function listOrgRepos(
  ctx: PrMonitorContext,
  host: string,
  org: string,
  page: number
): Promise<{ ok: boolean; repos?: RemoteRepo[]; hasMore?: boolean; error?: string }> {
  if (!ctx.exec) return { ok: false, error: 'exec capability unavailable' };
  if (!/^[A-Za-z0-9._-]+$/.test(org) || org.startsWith('-')) {
    return { ok: false, error: `Invalid organization: ${JSON.stringify(org)}` };
  }
  const pg = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const PER_PAGE = 100;
  const tryPath = async (base: string) => {
    const data = await ghApi(ctx, host, `${base}/${org}/repos?per_page=${PER_PAGE}&page=${pg}&sort=full_name`);
    if (!Array.isArray(data)) return null;
    return data as Array<{ name?: string; owner?: { login?: string }; full_name?: string; private?: boolean }>;
  };
  let rows = await tryPath('orgs');
  if (rows === null) rows = await tryPath('users');
  if (rows === null) {
    return { ok: false, error: `Could not list repositories for ${org} on ${host}` };
  }
  const repos: RemoteRepo[] = [];
  for (const r of rows) {
    const owner = r.owner?.login ?? org;
    const name = typeof r.name === 'string' ? r.name : '';
    if (!name) continue;
    repos.push({
      owner,
      repo: name,
      fullName: typeof r.full_name === 'string' ? r.full_name : `${owner}/${name}`,
      host,
      isPrivate: r.private === true,
    });
  }
  return { ok: true, repos, hasMore: rows.length >= PER_PAGE };
}

/**
 * Server-side repository search on a host (R-REPO-009 hybrid search). Uses
 * `search/repositories?q=<query>`, optionally scoped to an org via `org:<org>`.
 * Query text is URL-encoded; the caller triggers this only when client-side
 * matches run thin.
 */
export async function searchRepos(
  ctx: PrMonitorContext,
  host: string,
  query: string,
  org?: string
): Promise<{ ok: boolean; repos?: RemoteRepo[]; error?: string }> {
  if (!ctx.exec) return { ok: false, error: 'exec capability unavailable' };
  const q = String(query ?? '').trim();
  if (!q) return { ok: true, repos: [] };
  let full = q;
  if (org && /^[A-Za-z0-9._-]+$/.test(org) && !org.startsWith('-')) {
    full = `${q} org:${org}`;
  }
  const data = await ghApi(ctx, host, `search/repositories?q=${encodeURIComponent(full)}&per_page=50`);
  if (!data || typeof data !== 'object') {
    return { ok: false, error: `Repository search failed on ${host}` };
  }
  const items = (data as { items?: unknown[] }).items;
  if (!Array.isArray(items)) return { ok: true, repos: [] };
  const repos: RemoteRepo[] = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const r = it as { name?: string; owner?: { login?: string }; full_name?: string; private?: boolean };
    const owner = r.owner?.login ?? '';
    const name = typeof r.name === 'string' ? r.name : '';
    if (!owner || !name) continue;
    repos.push({
      owner,
      repo: name,
      fullName: typeof r.full_name === 'string' ? r.full_name : `${owner}/${name}`,
      host,
      isPrivate: r.private === true,
    });
  }
  return { ok: true, repos };
}

/**
 * Search repositories across EVERY authenticated host at once (R-REPO-009).
 * The repo browser is search-first and NOT org-scoped: `orgs` in this extension
 * mirror `gh` accounts (users), so a per-org `orgs/<login>/repos` browse falls
 * back to personal repos. Instead we run `search/repositories?q=<query>` on each
 * distinct authenticated host (which searches every org the user can see on that
 * host) and merge, deduping by `host|fullName`. Empty query → no results (the
 * UI prompts the user to type).
 */
export async function searchReposAllHosts(
  ctx: PrMonitorContext,
  query: string
): Promise<{ ok: boolean; repos?: RemoteRepo[]; error?: string }> {
  if (!ctx.exec) return { ok: false, error: 'exec capability unavailable' };
  const q = String(query ?? '').trim();
  if (!q) return { ok: true, repos: [] };
  const accounts = await getAuthHosts(ctx);
  const hosts = Array.from(new Set(accounts.map((a) => a.host)));
  if (hosts.length === 0) return { ok: true, repos: [] };
  const perHost = await Promise.all(hosts.map((h) => searchRepos(ctx, h, q)));
  const seen = new Set<string>();
  const repos: RemoteRepo[] = [];
  for (const res of perHost) {
    if (!res.ok || !res.repos) continue;
    for (const r of res.repos) {
      const key = `${r.host}|${r.fullName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      repos.push(r);
    }
  }
  repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { ok: true, repos };
}

/**
 * Safety cap on `user/repos` pages one {@link listAllRepos} call walks (Rule 5 —
 * bounds each browse; 30 pages ≈ 3000 repos). One call normally walks to
 * EXHAUSTION (a short page) so every owner group shows on open; this cap is only
 * the guard for an unusually huge account, at which point "Load more" continues.
 */
export const REPOS_PAGES_PER_BATCH = 30;

/** How many pages one call fetches concurrently (bounds parallel `gh` spawns). */
export const REPOS_PAGE_WINDOW = 5;

/**
 * List EVERY repository the authenticated user can access on a host
 * (R-REPO-009 browse-all). Uses `user/repos?affiliation=owner,collaborator,
 * organization_member` — this returns personal repos, repos the user
 * collaborates on, AND repos in every org the user belongs to (the union that
 * matches CodeNod's "N repos" browser), which a per-org `orgs/<login>/repos`
 * call cannot reach when "orgs" are really `gh` user accounts.
 *
 * CodeNod paginates that endpoint until GitHub stops returning a `rel="next"`
 * link, THEN groups by owner — so every owner group shows on open. A single- or
 * few-page fetch truncates badly because `sort=full_name` clusters an owner's
 * repos together (e.g. `a360` alone is ~1316 repos = 14 full pages), so the
 * first N pages surface only ONE or TWO owner groups and later owners
 * (`a360core`, `core-2206`, `MarketingCloudSdk`, …) stay hidden behind "Load
 * more". To match, one call walks pages to EXHAUSTION (until a short page),
 * fetching {@link REPOS_PAGE_WINDOW} pages concurrently to stay fast, bounded by
 * a {@link REPOS_PAGES_PER_BATCH} safety cap. `hasMore` is true ONLY when that
 * cap is hit before exhaustion (an unusually large account), so "Load more"
 * continues from the next page; for typical accounts every group + its true
 * count appears on open and Load more never shows.
 *
 * `incompleteOwner` names the one owner whose group is cut by the safety cap:
 * because `sort=full_name` returns owners contiguously in ascending order, when
 * the cap is hit the alphabetically-LAST owner fetched is the frontier — its
 * repos continue past the cap. The browser marks that group with an "…" so the
 * count reads as partial (AC-REPO-9.7). Absent when the account is exhausted.
 */
export async function listAllRepos(
  ctx: PrMonitorContext,
  host: string,
  batch: number
): Promise<{ ok: boolean; repos?: RemoteRepo[]; hasMore?: boolean; incompleteOwner?: string; error?: string }> {
  if (!ctx.exec) return { ok: false, error: 'exec capability unavailable' };
  const b = Number.isFinite(batch) && batch > 0 ? Math.floor(batch) : 1;
  const PER_PAGE = 100;
  const firstPage = (b - 1) * REPOS_PAGES_PER_BATCH + 1;
  const lastPage = firstPage + REPOS_PAGES_PER_BATCH - 1;
  const repos: RemoteRepo[] = [];
  let anyOk = false;
  let hasMore = false;
  let exhausted = false;

  // Walk the cap in concurrent windows of REPOS_PAGE_WINDOW pages. Within a
  // window, results are consumed in page order so a short/failed page ends the
  // walk deterministically (later owners can't precede earlier ones).
  for (let winStart = firstPage; winStart <= lastPage && !exhausted; winStart += REPOS_PAGE_WINDOW) {
    const pages: number[] = [];
    for (let pg = winStart; pg < winStart + REPOS_PAGE_WINDOW && pg <= lastPage; pg++) pages.push(pg);
    const results = await Promise.all(
      pages.map((pg) =>
        ghApi(
          ctx,
          host,
          `user/repos?per_page=${PER_PAGE}&page=${pg}&sort=full_name&affiliation=owner,collaborator,organization_member`
        )
      )
    );
    for (let i = 0; i < results.length; i++) {
      const pg = pages[i];
      const data = results[i];
      if (!Array.isArray(data)) {
        // The very first page failing is a real error; a later page failing
        // just ends the walk with what we have.
        if (pg === firstPage) return { ok: false, error: `Could not list repositories on ${host}` };
        exhausted = true;
        break;
      }
      anyOk = true;
      const rows = data as Array<{ name?: string; owner?: { login?: string }; full_name?: string; private?: boolean }>;
      for (const r of rows) {
        const owner = r.owner?.login ?? '';
        const name = typeof r.name === 'string' ? r.name : '';
        if (!owner || !name) continue;
        repos.push({
          owner,
          repo: name,
          fullName: typeof r.full_name === 'string' ? r.full_name : `${owner}/${name}`,
          host,
          isPrivate: r.private === true,
        });
      }
      // A short page means the account is exhausted — nothing more to load.
      if (rows.length < PER_PAGE) {
        exhausted = true;
        break;
      }
    }
  }
  // Not exhausted → the safety cap cut the walk; more repos remain.
  if (!exhausted && anyOk) hasMore = true;
  // When the cap cut the walk, the alphabetically-last owner is the one whose
  // group spills past it (sort=full_name groups owners contiguously).
  const incompleteOwner = hasMore ? repos[repos.length - 1]?.owner : undefined;
  return { ok: anyOk, repos, hasMore, incompleteOwner };
}

/**
 * List every accessible repository across EVERY authenticated host, one BATCH
 * deep per host (R-REPO-009 browse-all). This is the browser's show-all-on-open
 * data source: it fans {@link listAllRepos} across the distinct hosts from
 * main's own `getAuthHosts` (never renderer free-text — Rule 2) and merges,
 * deduping by `host|fullName`. Each batch walks {@link REPOS_PAGES_PER_BATCH}
 * `user/repos` pages, so the first open covers the whole account for typical
 * sizes (one owner can span several pages under `sort=full_name`). `hasMore` is
 * true if ANY host reported another batch, so the browser can offer "Load more".
 * `incompleteOwners` unions each host's frontier owner (the group cut mid-stream)
 * so the browser can flag those groups with "…" (AC-REPO-9.5). Sorted by fullName.
 */
export async function listReposAllHosts(
  ctx: PrMonitorContext,
  batch: number
): Promise<{ ok: boolean; repos?: RemoteRepo[]; hasMore?: boolean; incompleteOwners?: string[]; error?: string }> {
  if (!ctx.exec) return { ok: false, error: 'exec capability unavailable' };
  const accounts = await getAuthHosts(ctx);
  const hosts = Array.from(new Set(accounts.map((a) => a.host)));
  if (hosts.length === 0) return { ok: true, repos: [], hasMore: false, incompleteOwners: [] };
  const perHost = await Promise.all(hosts.map((h) => listAllRepos(ctx, h, batch)));
  const seen = new Set<string>();
  const repos: RemoteRepo[] = [];
  let hasMore = false;
  const incomplete = new Set<string>();
  for (const res of perHost) {
    if (!res.ok || !res.repos) continue;
    if (res.hasMore) hasMore = true;
    if (res.incompleteOwner) incomplete.add(res.incompleteOwner);
    for (const r of res.repos) {
      const key = `${r.host}|${r.fullName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      repos.push(r);
    }
  }
  repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { ok: true, repos, hasMore, incompleteOwners: Array.from(incomplete) };
}

/** A repository the user has recently authored PRs in (R-REPO-007 Suggested). */
export interface SuggestedRepo {
  owner: string;
  repo: string;
  fullName: string;
  host: string;
  /** How many of the author's PRs touched this repo in the window. */
  prCount: number;
  /** Epoch ms of the most-recent PR update in the window. */
  lastActivity: number;
}

/**
 * Scan the authenticated user's PR activity over the last 90 days and group by
 * repository (R-REPO-007). Runs `search/issues?q=is:pr author:@me updated:>=<date>`
 * on the host, paginated to a hard cap, and rolls up per repo. The 90-day window
 * is FIXED. `sinceIso` is the ISO date 90 days ago, computed by the caller (main
 * has a real clock; kept as a param so the scan is testable).
 */
export async function suggestedRepos(
  ctx: PrMonitorContext,
  host: string,
  sinceIso: string
): Promise<{ ok: boolean; repos?: SuggestedRepo[]; error?: string }> {
  if (!ctx.exec) return { ok: false, error: 'exec capability unavailable' };
  const q = `is:pr author:@me updated:>=${sinceIso}`;
  const MAX_PAGES = 5;
  const PER_PAGE = 100;
  const byRepo = new Map<string, SuggestedRepo>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await ghApi(
      ctx,
      host,
      `search/issues?q=${encodeURIComponent(q)}&per_page=${PER_PAGE}&page=${page}&sort=updated`
    );
    if (!data || typeof data !== 'object') {
      if (page === 1) return { ok: false, error: `Activity scan failed on ${host}` };
      break;
    }
    const items = (data as { items?: unknown[] }).items;
    if (!Array.isArray(items) || items.length === 0) break;
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const i = it as { repository_url?: string; updated_at?: string };
      let full = '';
      if (typeof i.repository_url === 'string') {
        const m = i.repository_url.match(/\/([^/]+\/[^/]+)$/);
        if (m) full = m[1];
      }
      if (!full) continue;
      const [owner, repo] = full.split('/');
      if (!owner || !repo) continue;
      let ts = 0;
      if (typeof i.updated_at === 'string') {
        const d = new Date(i.updated_at);
        if (!isNaN(d.getTime())) ts = d.getTime();
      }
      const prev = byRepo.get(full);
      if (prev) {
        prev.prCount += 1;
        if (ts > prev.lastActivity) prev.lastActivity = ts;
      } else {
        byRepo.set(full, { owner, repo, fullName: full, host, prCount: 1, lastActivity: ts });
      }
    }
    if (items.length < PER_PAGE) break;
  }
  const repos = Array.from(byRepo.values()).sort(
    (a, b) => b.prCount - a.prCount || b.lastActivity - a.lastActivity
  );
  return { ok: true, repos };
}

/** Authenticated user's profile identity on a host (R-PPL-003). */
export interface AuthUser {
  login: string;
  name?: string;
  email?: string;
  /** github.com avatar URL — NOT fetched by the renderer (see avatar note). */
  avatarUrl?: string;
}

/**
 * Fetch the authenticated user's profile via `gh api --hostname <host> user`
 * (R-PPL-003 — Display Name + Email). Returns null on failure.
 */
export async function getAuthUser(ctx: PrMonitorContext, host: string): Promise<AuthUser | null> {
  const data = await ghApi(ctx, host, 'user');
  if (!data || typeof data !== 'object') return null;
  const u = data as { login?: string; name?: string; email?: string; avatar_url?: string };
  if (typeof u.login !== 'string' || !u.login) return null;
  const out: AuthUser = { login: u.login };
  if (typeof u.name === 'string' && u.name) out.name = u.name;
  if (typeof u.email === 'string' && u.email) out.email = u.email;
  if (typeof u.avatar_url === 'string' && u.avatar_url) out.avatarUrl = u.avatar_url;
  return out;
}

/**
 * The distinct outcomes of a repo-scoped `gh` probe (R-REPO-015/016 / AC-REPO-16.5).
 * The user's response differs per fault, so PR Monitor must tell them apart:
 *   - `ok`          — the repo is reachable and its auth is valid.
 *   - `remote-gone` — HTTP 404: deleted, made private, or renamed-and-not-redirected.
 *                     Persistent; needs a Remove/Keep decision (only after 2 passes).
 *   - `disconnect`  — host auth is invalid (HTTP 401, or 403/‘not logged in’ with an
 *                     auth signal). Fix is re-authenticate (R-REPO-013).
 *   - `outage`      — transient reachability problem: network/DNS/timeout, HTTP 5xx,
 *                     or rate-limit (403/429 with a rate-limit signal). Auto-clears
 *                     on the next successful poll (R-REPO-015). "Uncertain" (any
 *                     result not matching the above) is treated as an outage — never
 *                     a prompt.
 */
export type GhFault = 'ok' | 'remote-gone' | 'disconnect' | 'outage';

/**
 * Classify a repo-scoped `gh api` {@link ExecResult} into a {@link GhFault}
 * (AC-REPO-16.5). PURE — no I/O — so the mapping is unit-testable against captured
 * `gh` stderr. `gh` embeds the HTTP status in its error text (e.g. "HTTP 404: Not
 * Found (…)"), which we parse from stdout+stderr; auth vs rate-limit for a 403 is
 * disambiguated by keyword. A null result (couldn't spawn) or any unrecognized
 * error is UNCERTAIN → `outage` (retry), never `remote-gone` (which would wrongly
 * prompt a removal).
 */
export function classifyGhFault(result: ExecResult | null): GhFault {
  if (!result) return 'outage'; // couldn't spawn / timeout / output-cap kill → transient
  if (result.code === 0) return 'ok';
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const lower = text.toLowerCase();
  const statusMatch = text.match(/HTTP\s+(\d{3})/i);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const rateLimited = /rate limit|rate-limit|secondary rate|abuse detection|api rate/i.test(text);
  const authProblem =
    /not logged in|gh auth login|bad credentials|requires authentication|401|token/i.test(lower) ||
    /must authenticate|authentication|unauthorized/i.test(lower);

  if (status === 404) return 'remote-gone';
  if (status === 401) return 'disconnect';
  if (status === 429) return 'outage'; // rate limit → transient
  if (status === 403) return rateLimited ? 'outage' : 'disconnect'; // rate-limit vs forbidden-auth
  if (status >= 500 && status < 600) return 'outage'; // server error → transient
  // No HTTP status parsed: fall back to keyword signals.
  if (rateLimited) return 'outage';
  if (/not logged in|gh auth login/i.test(lower)) return 'disconnect';
  // network/DNS/timeout have no HTTP status → transient; and any remaining
  // "uncertain" result is treated as a transient outage, never remote-gone.
  return 'outage';
}

/**
 * Probe a single repo's reachability + auth via `gh api --hostname <host>
 * repos/<owner>/<repo>` and classify the result (R-REPO-015/016). Unlike
 * {@link ghApi} (which discards the failure detail), this keeps the raw
 * {@link ExecResult} so {@link classifyGhFault} can distinguish 404/401/403/5xx.
 * `owner/repo` is isSafeRepoArg-validated before interpolation; an invalid arg
 * is reported as `outage` (never a removal prompt). Returns `outage` when the
 * `exec` capability is unavailable.
 */
export async function probeRepoFault(
  ctx: PrMonitorContext,
  host: string,
  owner: string,
  repo: string
): Promise<GhFault> {
  if (!ctx.exec) return 'outage';
  const full = `${owner}/${repo}`;
  if (!isSafeRepoArg(full)) return 'outage';
  // AC-CORE-3.1: flags before `--`, positional path after.
  const result = await runGh(ctx.exec, ['api', '--hostname', host, '--', `repos/${owner}/${repo}`], ctx.log);
  return classifyGhFault(result);
}

/**
 * Test connectivity to a specific repo (R-REPO-010). Runs
 * `gh api --hostname <host> repos/<owner>/<repo>` and reports pass/fail. The
 * `owner/repo` is isSafeRepoArg-validated before interpolation. A failure names
 * the repo and directs the user to `gh auth login <host>`.
 */
export async function testRepoConnection(
  ctx: PrMonitorContext,
  host: string,
  owner: string,
  repo: string
): Promise<{ ok: boolean; error?: string }> {
  const full = `${owner}/${repo}`;
  if (!isSafeRepoArg(full)) {
    return { ok: false, error: `Invalid repository: ${full}` };
  }
  const data = await ghApi(ctx, host, `repos/${owner}/${repo}`);
  if (data && typeof data === 'object' && 'full_name' in data) {
    return { ok: true };
  }
  return {
    ok: false,
    error: `Couldn't reach ${full} on ${host}. Check access, or re-authenticate with: gh auth login ${host}`,
  };
}
