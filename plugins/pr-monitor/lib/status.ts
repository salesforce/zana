/**
 * Pure status-computation helpers for PR Monitor's polling engine.
 *
 * Ported from the Python `monitor_prs.py` reference. No I/O, no ctx — every
 * function here takes structured inputs (checks + merge state, or a closed-PR
 * landing probe result) and returns a {@link PrRollupStatus}. Side-effectful
 * gh CLI calls live in `gh-client.ts`; this file is the classifier the poller
 * runs over their results.
 *
 * The Salesforce p4-branch (autointegrate) workflow needs a richer closed-PR
 * verdict than "closed = abandoned": some PRs are CLOSED but the change has
 * been accepted and is sync'ing onto a `p4/` branch. {@link computeClosedStatus}
 * mirrors the Python decision tree using a {@link LandingProbe} result that
 * the main module wires up by calling `gh api` via its `ghApi` helper.
 */

import type { CheckRun, PrRollupStatus } from './types.js';

const DONE_OK = new Set(['pass', 'success', 'neutral', 'skipped', 'skipping', 'cancelled', 'cancel']);
const FAIL = new Set(['fail', 'failure']);
const RUNNING = new Set(['pending', 'in_progress', 'queued']);

// Fast compliance/gatekeeper checks that complete before build/test suite spawns.
// If ONLY these are visible + BLOCKED, more checks likely coming.
const EARLY_CHECKS = /^(gus|scm|codeowners|credential|lock.the.line|prizm|continuous-integration\/jenkins)/i;

/**
 * Regex that recognizes the Salesforce autointegrate landing comment:
 * "This PR's accepted change NNN is being sync'd from Perforce to Git, as
 * commit [<sha>](...)." — the comment that signals a closed-but-not-abandoned
 * workflow PR is on its way to a `p4/` branch.
 *
 * Capture group 1 is the SHA (7-40 hex chars). Case-insensitive; both the
 * straight (U+0027) and curly (U+2019) apostrophe are tolerated (and the
 * apostrophe is optional) via the `['’]?` class — GitHub's Markdown
 * renderer "smart-quotes" the apostrophe in some comment contexts.
 */
export const SYNC_RE = /sync['’]?d from Perforce to Git, as commit \[?([0-9a-f]{7,40})/i;

function normalize(s: string | undefined): string {
  return (s ?? '').toLowerCase().trim() || 'pending';
}

/**
 * The exact prefix of the SFCI-job issue comment (AC-REPO-17.2). tok-gimlet posts
 * this once its Jenkins build job has been created for a PR; its presence is what
 * lets a gated repo's build/merge pill stall (AC-REPO-17.3/17.4).
 */
export const SFCI_JOB_COMMENT_PREFIX = 'An SFCI job has been created for your Pull Request at:';
const SFCI_JOB_AUTHOR = 'tok-gimlet';

/**
 * Scan a `gh api …/issues/{n}/comments` payload for the tok-gimlet SFCI-job
 * comment (AC-REPO-17.2): any comment authored by `tok-gimlet` whose body BEGINS
 * with {@link SFCI_JOB_COMMENT_PREFIX} (leading whitespace tolerated). Pure over
 * the raw JSON array; a non-array / malformed payload yields false. Author match
 * is case-insensitive on `author.login` (the GraphQL shape) or `user.login` (the
 * REST issue-comments shape) so either fetch path works.
 */
export function hasSfciJobComment(comments: unknown): boolean {
  if (!Array.isArray(comments)) return false;
  for (const c of comments) {
    if (!c || typeof c !== 'object') continue;
    const rec = c as { body?: unknown; author?: { login?: unknown }; user?: { login?: unknown } };
    const login = (rec.author?.login ?? rec.user?.login);
    if (typeof login !== 'string' || login.toLowerCase() !== SFCI_JOB_AUTHOR) continue;
    const body = rec.body;
    if (typeof body !== 'string') continue;
    if (body.trimStart().startsWith(SFCI_JOB_COMMENT_PREFIX)) return true;
  }
  return false;
}

/** Max length of a normalized PR-body excerpt (AC-LIST-17.3). */
const EXCERPT_MAX = 280;

/**
 * Normalize a raw PR body into a plain-text excerpt (AC-LIST-17.2/17.3).
 *
 * Six ordered, deterministic transforms — order matters (e.g. fenced code is
 * removed before inline markers so a `>` inside a code block isn't mistaken for
 * a quote marker):
 *   1. strip HTML comments   `<!-- … -->`
 *   2. strip fenced code     ```` ```…``` ````
 *   3. strip images          `![alt](url)`     (drop entirely)
 *   4. links → text          `[text](url)` → `text`
 *   5. strip leading markdown markers: heading (`#`), quote (`>`), and
 *      emphasis/code punctuation (`*` `_` `` ` ``)
 *   6. strip leading blank lines
 * then collapse the result and slice to {@link EXCERPT_MAX} chars. Pure — no I/O.
 */
export function normalizeExcerpt(raw: string | undefined): string {
  let s = raw ?? '';
  // 1. HTML comments
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // 2. fenced code blocks (``` or ~~~), including the fence lines
  s = s.replace(/(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(\n[ \t]*\2[^\n]*)/g, '$1');
  // 3. images — drop entirely (before links: images are a superset syntax)
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // 4. links → their visible text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 5. strip leading heading / quote / emphasis markers, line by line
  s = s
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|>\s?|[*_`]+)/, ''))
    .join('\n');
  // 6. drop leading blank lines
  s = s.replace(/^\s*\n+/, '');
  // collapse trailing whitespace and cap
  s = s.trimEnd();
  if (s.length > EXCERPT_MAX) s = s.slice(0, EXCERPT_MAX);
  return s;
}

/**
 * Roll a list of CI check results plus the PR's merge state into one of the
 * non-closed {@link PrRollupStatus} values. A CLOSED PR (state === 'CLOSED'
 * with mergeStateStatus !== 'MERGED') routes through {@link computeClosedStatus}
 * elsewhere and is not handled here — this returns 'pending' for that case so
 * the poller can call the closed-state classifier instead.
 *
 * - 'green'            : merged, or all checks done and merge state CLEAN.
 * - 'review-required'  : all checks done and passing, but review approval needed.
 * - 'yellow'           : all checks done and passing, but merge blocked for other reasons.
 * - 'conflict'         : mergeable is CONFLICTING or mergeStateStatus is DIRTY.
 * - 'failed'           : at least one check has reported a failure.
 * - 'pending'          : checks are still running, or no checks have reported yet.
 */
export function computeStatus(
  mergeState: { state?: string; mergeStateStatus?: string; reviewDecision?: string },
  mergeable: string | undefined,
  checks: CheckRun[]
): PrRollupStatus {
  const statuses = checks.map((c) => normalize(c.bucket || c.state));
  const total = statuses.length;
  const anyFail = statuses.some((s) => FAIL.has(s));
  const done = statuses.filter((s) => !RUNNING.has(s)).length;
  const allDone = total > 0 && done === total;

  const prState = (mergeState.state ?? '').toUpperCase();
  const mergeStatus = (mergeState.mergeStateStatus ?? '').toUpperCase();
  const mergeableUp = (mergeable ?? '').toUpperCase();
  const reviewDecision = (mergeState.reviewDecision ?? '').toUpperCase();

  if (prState === 'MERGED') return 'green';

  // Merge conflicts need explicit action — surface them even while CI is still
  // running so they don't masquerade as "still working".
  if (mergeableUp === 'CONFLICTING' || mergeStatus === 'DIRTY') {
    return 'conflict';
  }

  if (anyFail) return 'failed';

  if (!allDone) return 'pending';

  // All checks done and passing.
  if (mergeStatus === 'CLEAN') return 'green';

  // BLOCKED with only early compliance checks visible is suspicious — GitHub
  // often reports BLOCKED before spawning the build/test suite. If all visible
  // done checks are fast gatekeepers (GUS, SCM, CODEOWNERS, credential scan, etc),
  // treat as pending — more checks likely coming.
  if (mergeStatus === 'BLOCKED') {
    const doneChecks = checks.filter((c) => !RUNNING.has(normalize(c.bucket || c.state)));
    const allEarly = doneChecks.length > 0 && doneChecks.every((c) => EARLY_CHECKS.test(c.name));
    if (allEarly) return 'pending';
  }

  // Checks done but merge blocked — distinguish review-required from other blocks.
  if (reviewDecision === 'REVIEW_REQUIRED') return 'review-required';

  return 'yellow';
}

/**
 * Evidence the poller has gathered about a CLOSED PR's autointegrate landing,
 * passed to {@link computeClosedStatus} so the classifier stays pure.
 *
 * - `landedSha`: the most recent commit SHA pulled from the PR's autointegrate
 *   sync comment, or empty if no such comment exists.
 * - `finalBranchContainsSha`: result of comparing `landedSha` against the
 *   destination `p4/...` branch — true if the commit has reached it.
 * - `intermediateBranchContainsSha`: same comparison against the mirror
 *   (`m/...`) branch when applicable; undefined when there is no mirror hop.
 * - `finalBranch` / `intermediateBranch`: the branch names the probe consulted;
 *   used by the poller for log/UI summaries (the classifier itself ignores
 *   them).
 */
export interface LandingProbe {
  landedSha: string;
  finalBranch?: string | null;
  intermediateBranch?: string | null;
  finalBranchContainsSha?: boolean | null;
  intermediateBranchContainsSha?: boolean | null;
}

/**
 * Classify a CLOSED PR (`mergeStateStatus !== 'MERGED'`) using an
 * autointegrate landing probe. Returns one of:
 *
 * - 'closed-merged'    : the sync'd commit is on its destination p4/ branch
 *                        (workflow landing succeeded — terminal, treat as merged).
 * - 'integrating'      : a sync comment exists but the commit is not yet on
 *                        its terminal branch (may be on the mirror); keep watching.
 * - 'closed-abandoned' : the PR closed without any detectable landing
 *                        (developer closed it, superseded, etc.); terminal.
 *
 * The terminal-state vocabulary differs from the Python source (which used
 * 'green' / 'closed') because the SDK's {@link PrRollupStatus} pulls the two
 * apart for the UI's collapsed-group behavior.
 */
export function computeClosedStatus(
  state: string,
  mergeStateStatus: string,
  probe: LandingProbe | null
): PrRollupStatus {
  if ((state ?? '').toUpperCase() === 'MERGED') return 'closed-merged';
  if (!probe || !probe.landedSha) return 'closed-abandoned';
  if (!probe.finalBranch) return 'integrating';
  if (probe.finalBranchContainsSha === true) return 'closed-merged';
  if (probe.intermediateBranch && probe.intermediateBranchContainsSha === true) {
    return 'integrating';
  }
  return 'integrating';
}

/**
 * Parsed parts of a PR URL, used by the autointegrate probe path. Returns null
 * for an unrecognized shape so callers can short-circuit to 'closed-abandoned'
 * rather than throwing.
 *
 * e.g. https://gitcore.soma.salesforce.com/core-2206/core-262-public/pull/109504
 *   -> { host: 'gitcore.soma.salesforce.com', owner: 'core-2206',
 *        repo: 'core-262-public', number: '109504' }
 */
export function parsePrUrl(url: string): { host: string; owner: string; repo: string; number: string } | null {
  const m = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec((url ?? '').trim());
  if (!m) return null;
  return { host: m[1], owner: m[2], repo: m[3], number: m[4] };
}

/**
 * Landing branches for a workflow PR's base, as { final, intermediate }.
 *
 * - base `p4/...`         -> { final: base,             intermediate: null }
 * - base `m/.../<suffix>` -> { final: 'p4/<suffix>',    intermediate: base }
 * - anything else         -> { final: null,             intermediate: null }
 *
 * The mirror branch is an intermediate milestone: commits show up there first
 * then sync onward to the `p4/` branch. The classifier uses this distinction
 * to keep a half-landed PR in 'integrating' rather than declaring it landed.
 */
export function destBranches(base: string | undefined): {
  final: string | null;
  intermediate: string | null;
} {
  const b = (base ?? '').trim();
  if (b.startsWith('p4/')) return { final: b, intermediate: null };
  if (b.startsWith('m/')) {
    const suffix = b.replace(/\/+$/, '').split('/').pop() ?? '';
    return { final: `p4/${suffix}`, intermediate: b };
  }
  return { final: null, intermediate: null };
}
