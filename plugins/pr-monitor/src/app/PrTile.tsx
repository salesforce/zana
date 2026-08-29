/**
 * Rich vertical tile for a monitored PR (Phase 2 tile redesign, extended for
 * list-requirements R-LIST-011…023 + the coherent row redesign).
 *
 * Layout:
 *  - Line 1: selection checkbox · state icon · title (leading @W-####### colored) ·
 *    status WORD-PILL · "Updated" pill (if unseen) · time-in-status pill (colored + cue) ·
 *    check pips · mute indicator · fetch-error indicator+retry · ROW ACTIONS (mark
 *    read/unread · mute/unmute · dismiss, responsive-overflowing into ⋯)
 *  - Line 2: W-chip · repo · #num + open-external + copy · author initials · Draft pill
 *  - Line 3: head → base branch + copy
 *  - Reviewers: grouped approved / review-requested / changes-requested (avatar→initials)
 *  - Desc: ≤2 line body clamp
 *  - Bottom line: the project-association control itself (icon + name; always present)
 *  - Per-check disclosure: expand to list every check run (R-LIST-022)
 *
 * Unseen → left accent bar + bold whole-row text (hasUnseenChanges =
 * lastSeenAt===0 || lastStatusChange > (lastSeenAt ?? addedAt)). Opening a tile
 * marks it seen.
 *
 * The status pill, the time-in-status pill and the check-count pips double as the
 * per-check disclosure toggle when the PR has checks (there is no standalone
 * "Checks" button). Time-in-status pill counts from lastStatusChange (not raw
 * age), colored ok/warn/danger with a non-color word cue (Slow/Stalled) for
 * colorblind users (AC-LIST-13.2).
 * Avatar: initials only — the renderer never issues an image request (AC-LIST-16.2a).
 */

import { useState } from 'react';
import {
  ExternalLink,
  Link2,
  GitBranch,
  GitPullRequest,
  GitMerge,
  GitPullRequestDraft,
  GitPullRequestClosed,
  BellOff,
  Bell,
  Star,
  Mail,
  MailOpen,
  Trash2,
  AlertCircle,
  RefreshCw,
  Check,
  X,
  Clock,
} from 'lucide-react';
import type { ModuleHost, ProjectInfo } from './host.js';
import {
  type MonitoredPr,
  type PrReviewer,
  type ReviewState,
  extractWorkItem,
  buildWorkItemLink,
  MONITORED_PRS_CACHE_KEY,
  MONITORED_COUNT_CACHE_KEY,
} from '../../lib/types.js';
import {
  statusPill,
  formatTimeInStatus,
  tisLabel,
  summarizeChecks,
  initialsOf,
  DEFAULT_TIS_WARN_HOURS,
  DEFAULT_TIS_DANGER_HOURS,
  DEFAULT_REVIEW_TIS_WARN_DAYS,
  DEFAULT_REVIEW_TIS_DANGER_DAYS,
  type RowActionId,
} from './formatHelpers.js';
import { buildStallState, reviewState, isBuildHappy, type BuildPillState } from '../../lib/pillState.js';
import { copyText } from './clipboard.js';
import { PrProjectControl } from './PrProjectControl.js';
import { PrChecksCollapse } from './PrChecksCollapse.js';

interface Props {
  pr: MonitoredPr;
  host: ModuleHost;
  projects: ProjectInfo[];
  /** BUILD-pill escalation thresholds (hours). Default preset is 4h / 6h. */
  tisWarnHours?: number;
  tisDangerHours?: number;
  /** REVIEW-pill escalation thresholds (days). Default preset is 3d / 5d. */
  reviewWarnDays?: number;
  reviewDangerDays?: number;
  /** Repo's SFCI-gated flag — gates build/merge-stall on the tok-gimlet comment. */
  sfciGated?: boolean;
  /** Repo's ignored-failing-check substrings (e.g. ['Snyk']) for build-happy. */
  ignoredFailingChecks?: string[];
  /** Locator base for building a W-######## deep link (AC-LIST-11.3b). */
  workItemLocatorBase?: string;
  /** Whether this row is selected (R-LIST-006). */
  selected: boolean;
  onToggleSelect: (url: string) => void;
  onDismiss: (url: string) => void;
  onProjectAssign: (url: string, projectId: string | null) => void;
}

/** Only http(s) URLs are ever opened externally (AC-LIST-11.5a). */
function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Reviewer group order + labels for the reviewers strip (AC-LIST-16.1). */
const REVIEWER_GROUPS: Array<{ state: ReviewState; label: string; className: string }> = [
  { state: 'changes-requested', label: 'Changes requested', className: 'prm-reviewers--changes' },
  { state: 'review-requested', label: 'Review requested', className: 'prm-reviewers--requested' },
  { state: 'approved', label: 'Approved', className: 'prm-reviewers--approved' },
];

/** Fixed row-action order. Overflow collapses from the tail, so `dismiss`
 *  (destructive) is the first to move into ⋯ as the row narrows and the common
 *  `mark read/unread` stays inline longest. */
const ROW_ACTIONS: RowActionId[] = ['seen', 'favorite', 'mute', 'dismiss'];

export function PrTile({
  pr,
  host,
  projects,
  tisWarnHours,
  tisDangerHours,
  reviewWarnDays,
  reviewDangerDays,
  sfciGated = false,
  ignoredFailingChecks,
  workItemLocatorBase,
  selected,
  onToggleSelect,
  onDismiss,
  onProjectAssign,
}: Props) {
  const [checksOpen, setChecksOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const hasUnseenChanges = pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt);
  const workItem = pr.workItem ?? extractWorkItem(pr.title, pr.headRefName, pr.body);
  const workItemLink = buildWorkItemLink(workItem, workItemLocatorBase);
  const pill = statusPill(pr.status);
  const closed = pr.status === 'closed-merged' || pr.status === 'closed-abandoned';
  const muted = Boolean(pr.muted);
  const favorite = Boolean(pr.favorite);
  const hasSyncError = Boolean(pr.syncError);

  const checks = pr.checks ?? [];
  const checkCounts = summarizeChecks(checks);

  // ── Two time-in-status pills (R-LIST-013 build / R-LIST-025 review) ──────────
  // Both are an advisory OVERLAY on top of the rollup status (plan §4). The build
  // pill ALWAYS renders; the review pill only when the PR is Open (never Draft),
  // and never on a terminal PR. A finished gate shows a passive "✓" done-state so
  // the layout stays stable (§3). buildHappy prefers the poll-cached verdict but
  // recomputes from checks + ignore-list as a fallback (renderer stays pure).
  const reviewApproved = pr.reviewDecision === 'APPROVED';
  const buildHappy = pr.buildHappy ?? isBuildHappy(checks, { ignoredFailingChecks });
  const build: BuildPillState = buildStallState({
    status: pr.status,
    buildHappy,
    reviewApproved,
    sfciGated,
    hasSfciJob: Boolean(pr.hasSfciJob),
    elapsedHours: pr.lastStatusChange ? Math.max(0, Date.now() - pr.lastStatusChange) / 3_600_000 : 0,
    warnHours: tisWarnHours ?? DEFAULT_TIS_WARN_HOURS,
    dangerHours: tisDangerHours ?? DEFAULT_TIS_DANGER_HOURS,
  });
  // Build pill display: clock counts from lastStatusChange (build clock origin).
  const buildStr = formatTimeInStatus(pr.lastStatusChange);
  // Color: done → neutral (handled by --done class), merge-stall/danger → danger,
  // else the hours-band color. Label names the gate; merge-stall specializes.
  const buildColor: 'ok' | 'warn' | 'danger' =
    build === 'merge-stall' || build === 'danger'
      ? 'danger'
      : build === 'warn'
      ? 'warn'
      : 'ok'; // ok / done / blocked all read a calm clock
  const buildPillLabel =
    build === 'done'
      ? 'Build ✓'
      : build === 'merge-stall'
      ? 'Merge stalled'
      : tisLabel(buildColor, 'build');
  // The rendered modifier class: done state is its own passive treatment.
  const buildStateClass: string = build === 'done' ? 'done' : buildColor;

  // Review pill: Open-only, days scale. done = approved & unmerged (Review ✓).
  const showReviewPill = !pr.isDraft && !closed;
  const merged = pr.status === 'closed-merged';
  const review = reviewState({
    reviewApproved,
    merged,
    elapsedDays: pr.reviewClockStartedAt ? Math.max(0, Date.now() - pr.reviewClockStartedAt) / 86_400_000 : 0,
    warnDays: reviewWarnDays ?? DEFAULT_REVIEW_TIS_WARN_DAYS,
    dangerDays: reviewDangerDays ?? DEFAULT_REVIEW_TIS_DANGER_DAYS,
  });
  const reviewStr = formatTimeInStatus(pr.reviewClockStartedAt);
  const reviewColor: 'ok' | 'warn' | 'danger' =
    review === 'danger' ? 'danger' : review === 'warn' ? 'warn' : 'ok';
  const reviewPillLabel = review === 'done' ? 'Review ✓' : tisLabel(reviewColor, 'review');
  const reviewStateClass: string = review === 'done' ? 'done' : reviewColor;

  const reviewers = pr.reviewers ?? [];
  const reviewersByState: Record<ReviewState, PrReviewer[]> = {
    'changes-requested': reviewers.filter((r) => r.state === 'changes-requested'),
    'review-requested': reviewers.filter((r) => r.state === 'review-requested'),
    approved: reviewers.filter((r) => r.state === 'approved'),
  };
  const hasReviewers = reviewers.length > 0;

  const openPr = () => {
    if (isSafeExternalUrl(pr.url)) {
      host.openExternal(pr.url);
    } else {
      host.toast('Refusing to open a non-http(s) URL', 'error');
    }
  };

  // State icon: draft / closed / merged / open
  const StateIcon = pr.isDraft
    ? GitPullRequestDraft
    : pr.status === 'closed-merged'
    ? GitMerge
    : pr.status === 'closed-abandoned'
    ? GitPullRequestClosed
    : GitPullRequest;

  const applyResult = (result: { ok: boolean; prs?: MonitoredPr[] } | undefined) => {
    if (result?.ok && result.prs) {
      host.cache.set(MONITORED_PRS_CACHE_KEY, result.prs);
      host.cache.set(MONITORED_COUNT_CACHE_KEY, result.prs.length);
      host.cache.refreshBadge();
    }
  };

  // Mark seen on tile click
  const handleTileClick = async () => {
    if (hasUnseenChanges) {
      const result = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('markPrAsSeen', { url: pr.url });
      applyResult(result);
    }
  };

  // Toggle seen↔unseen without needing an event (used by row action + menu).
  const toggleSeen = async () => {
    const handler = hasUnseenChanges ? 'markPrAsSeen' : 'markPrAsUnseen';
    const result = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>(handler, { url: pr.url });
    applyResult(result);
  };

  const toggleMute = async () => {
    const result = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('setPrMuted', {
      url: pr.url,
      muted: !muted,
    });
    applyResult(result);
  };

  const toggleFavorite = async () => {
    const result = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('setPrFavorite', {
      url: pr.url,
      favorite: !favorite,
    });
    applyResult(result);
  };

  const retrySync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      const result = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('retryPr', { url: pr.url });
      applyResult(result);
    } finally {
      setRetrying(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    if (await copyText(text)) {
      host.toast(`${label} copied`, 'info');
    } else {
      host.toast(`Failed to copy ${label}`, 'error');
    }
  };

  // ── Per-check disclosure toggle, carried by the status/time/count elements ──
  const canToggleChecks = checks.length > 0;
  // The toggle surface's tooltip must explain WHAT the surface means (not just
  // "show/hide checks", which is opaque), then note the click action. Mixed
  // case even when the surface text is CSS-uppercased (item 3). `verb` is the
  // trailing action clause shared by all three surfaces.
  const checksVerb = canToggleChecks ? ` — click to ${checksOpen ? 'hide' : 'show'} checks` : '';
  const toggleChecks = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setChecksOpen((v) => !v);
  };
  const onChecksKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleChecks(e);
    }
  };
  // Interactive attrs applied to each toggle surface only when there are checks;
  // otherwise the element stays inert (cursor default, no toggle). Each surface
  // passes its OWN explanatory tip.
  const checksToggleAttrs = (tip: string) =>
    canToggleChecks
      ? {
          role: 'button' as const,
          tabIndex: 0,
          'aria-expanded': checksOpen,
          title: tip,
          'data-tip': tip,
          onClick: toggleChecks,
          onKeyDown: onChecksKey,
        }
      : {};
  const checksToggleClass = canToggleChecks ? ' prm-tip prm-checks-trigger' : '';
  // Explanatory tips per surface (item 2): the status word, the time-in-status,
  // and the pass/fail counts each say what they mean before the click clause.
  const statusTip = `${pill.label} — overall PR status${checksVerb}`;
  const checksSummary = `${checkCounts.pass} passing, ${checkCounts.fail} failing, ${checkCounts.pending} running`;
  // Build-pill tooltip: name the gate + its state, then the checks summary in
  // hover (§6.4), then the click clause. done reads a plain "Build passing".
  const buildStateWord =
    build === 'done'
      ? 'Build passing'
      : build === 'merge-stall'
      ? 'Merge stalled'
      : build === 'blocked'
      ? 'Build waiting (SFCI job not yet created)'
      : buildPillLabel || 'Build running';
  const buildTip = `${buildStateWord} · ${buildStr} in build phase · ${checksSummary}${checksVerb}`;
  // Review-pill tooltip: name the review gate + its clock (no checks summary —
  // review is not about CI checks).
  const reviewStateWord = review === 'done' ? 'Review approved' : reviewPillLabel || 'Awaiting review';
  const reviewTip = `${reviewStateWord} · ${reviewStr} in review${checksVerb}`;
  const pipsTip = `${checksSummary}${checksVerb}`;

  // ── Row actions (item 10) ───────────────────────────────────────────────────
  const rowActionMeta: Record<
    RowActionId,
    { Icon: typeof Mail; label: string; title: string; danger?: boolean; active?: boolean }
  > = {
    seen: {
      Icon: hasUnseenChanges ? MailOpen : Mail,
      label: hasUnseenChanges ? 'Mark read' : 'Mark unread',
      title: hasUnseenChanges ? 'Mark this PR as read (seen)' : 'Mark this PR as unread',
    },
    favorite: {
      // The star is a stateful toggle: filled (via the --active class) when the PR
      // is a favorite, hollow otherwise. Label/title state the ACTION the click
      // takes, matching the mute action's convention.
      Icon: Star,
      label: favorite ? 'Unfavorite' : 'Favorite',
      title: favorite
        ? 'Unfavorite — remove this PR from favorites'
        : 'Favorite — mark this PR to find it faster',
      active: favorite,
    },
    mute: {
      // Icon mirrors the CURRENT state (matching the .prm-mute-indicator badge,
      // where BellOff = muted): a muted PR shows the silenced bell, an active one
      // shows the ringing bell. The label/title state the ACTION the click takes.
      Icon: muted ? BellOff : Bell,
      label: muted ? 'Unmute' : 'Mute',
      title: muted ? 'Unmute — resume notifications for this PR' : 'Mute — silence notifications for this PR',
    },
    dismiss: {
      Icon: Trash2,
      label: 'Dismiss',
      title: 'Dismiss — remove this PR from the monitored list',
      danger: true,
    },
  };
  const runRowAction = (id: RowActionId) => {
    if (id === 'seen') void toggleSeen();
    else if (id === 'favorite') void toggleFavorite();
    else if (id === 'mute') void toggleMute();
    else onDismiss(pr.url);
  };

  return (
    <div
      className={`prm-tile ${hasUnseenChanges ? 'prm-tile--unread' : ''} ${closed ? 'prm-tile--closed' : ''} ${hasSyncError ? 'prm-tile--stale' : ''} ${favorite ? 'prm-tile--favorite' : ''} ${selected ? 'prm-tile--selected' : ''}`}
      onClick={handleTileClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void handleTileClick();
        }
      }}
    >
      {/* Line 1: select · state icon · title · status pill · Updated pill · TIS · checks · mute · error · row actions · ⋯ */}
      <div className="prm-tile-line1">
        <input
          type="checkbox"
          className="prm-tile-select"
          checked={selected}
          title={selected ? 'Deselect this PR' : 'Select this PR'}
          aria-label={selected ? 'Deselect this PR' : 'Select this PR'}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect(pr.url);
          }}
        />
        <StateIcon size={14} className="prm-tile-state-icon" aria-hidden />
        <span className="prm-tile-title">
          {workItem && <span className="prm-tile-workitem-inline">@{workItem}: </span>}
          {pr.title.replace(new RegExp(`(?:^|@)${workItem}[:\\s]*`, 'i'), '')}
        </span>
        <span
          className={`prm-status-pill ${pill.className} prm-tip${checksToggleClass}`}
          title={statusTip}
          data-tip={statusTip}
          {...checksToggleAttrs(statusTip)}
        >
          {pill.label}
        </span>
        {/* Build pill (R-LIST-013) — ALWAYS renders. Label names the gate:
            "Build slow"/"Build stalled"/"Build ✓"/"Merge stalled". Doubles as the
            per-check disclosure toggle when the PR has checks (§6.4). */}
        {canToggleChecks ? (
          <span
            className={`prm-tis prm-tis--${buildStateClass} prm-tip prm-checks-trigger`}
            role="button"
            tabIndex={0}
            aria-expanded={checksOpen}
            title={buildTip}
            data-tip={buildTip}
            aria-label={`${buildStateWord}, ${buildStr} in build phase`}
            onClick={toggleChecks}
            onKeyDown={onChecksKey}
          >
            {buildStr}
            {buildPillLabel && <span className="prm-tis-cue"> {buildPillLabel}</span>}
          </span>
        ) : (
          <span
            className={`prm-tis prm-tis--${buildStateClass} prm-tip`}
            title={buildTip}
            data-tip={buildTip}
            aria-label={`${buildStateWord}, ${buildStr} in build phase`}
          >
            {buildStr}
            {buildPillLabel && <span className="prm-tis-cue"> {buildPillLabel}</span>}
          </span>
        )}

        {/* Review pill (R-LIST-025) — Open PRs only (never Draft/terminal). Days
            scale. done = approved & unmerged → passive "Review ✓". Doubles as the
            per-check disclosure toggle when the PR has checks (§6.4), same as the
            build pill. */}
        {showReviewPill &&
          (reviewStr || reviewPillLabel) &&
          (canToggleChecks ? (
            <span
              className={`prm-tis prm-tis--review prm-tis--${reviewStateClass} prm-tip prm-checks-trigger`}
              role="button"
              tabIndex={0}
              aria-expanded={checksOpen}
              title={reviewTip}
              data-tip={reviewTip}
              aria-label={`${reviewStateWord}, ${reviewStr} in review`}
              onClick={toggleChecks}
              onKeyDown={onChecksKey}
            >
              {reviewStr}
              {reviewPillLabel && <span className="prm-tis-cue"> {reviewPillLabel}</span>}
            </span>
          ) : (
            <span
              className={`prm-tis prm-tis--review prm-tis--${reviewStateClass} prm-tip`}
              title={reviewTip}
              data-tip={reviewTip}
              aria-label={`${reviewStateWord}, ${reviewStr} in review`}
            >
              {reviewStr}
              {reviewPillLabel && <span className="prm-tis-cue"> {reviewPillLabel}</span>}
            </span>
          ))}

        {/* Check-status summary pips (R-LIST-021) — zero-count buckets omitted;
            no checks → no summary, no reserved space (AC-LIST-21.4). The pips
            double as the per-check disclosure toggle (item 6). */}
        {checks.length > 0 && (
          <span
            className="prm-check-pips prm-tip prm-checks-trigger"
            aria-label={`Checks: ${checkCounts.pass} passed, ${checkCounts.fail} failed, ${checkCounts.pending} running`}
            {...checksToggleAttrs(pipsTip)}
          >
            {checkCounts.pass > 0 && (
              <span className="prm-check-pip prm-check-pip--pass">
                <Check size={9} /> {checkCounts.pass}
              </span>
            )}
            {checkCounts.fail > 0 && (
              <span className="prm-check-pip prm-check-pip--fail">
                <X size={9} /> {checkCounts.fail}
              </span>
            )}
            {checkCounts.pending > 0 && (
              <span className="prm-check-pip prm-check-pip--pending">
                <Clock size={9} /> {checkCounts.pending}
              </span>
            )}
          </span>
        )}

        {/* Mute indicator (AC-LIST-18.3) */}
        {muted && (
          <span className="prm-mute-indicator" title="Muted — notifications silenced for this PR" aria-label="Muted">
            <BellOff size={11} />
          </span>
        )}

        {/* Per-PR fetch-error indicator + retry (R-LIST-023) */}
        {hasSyncError && (
          <span className="prm-sync-error" title={`Couldn't sync this PR: ${pr.syncError}. Showing last-known (stale) status.`}>
            <AlertCircle size={11} className="prm-sync-error-icon" aria-hidden />
            <span className="prm-sync-error-text">stale</span>
            <button
              type="button"
              className="prm-tile-icon-btn prm-tip"
              title="Retry — re-fetch just this PR"
              data-tip="Retry sync"
              aria-label="Retry syncing this PR"
              disabled={retrying}
              onClick={(e) => void retrySync(e)}
            >
              <RefreshCw size={10} className={retrying ? 'prm-spin' : ''} />
            </button>
          </span>
        )}

        {/* Row action set: inline icon buttons (mark read/unread · mute · dismiss).
            All actions render inline — no responsive ⋯ overflow (the redesign's
            row never narrows enough to need it). */}
        <span className="prm-tile-actions">
          {ROW_ACTIONS.map((id) => {
            const meta = rowActionMeta[id];
            const Icon = meta.Icon;
            return (
              <button
                key={id}
                type="button"
                className={`prm-tile-icon-btn prm-tip${meta.danger ? ' prm-tile-icon-btn--danger' : ''}${meta.active ? ' prm-tile-icon-btn--active' : ''}`}
                title={meta.title}
                data-tip={meta.label}
                aria-label={meta.label}
                aria-pressed={meta.active}
                onClick={(e) => {
                  e.stopPropagation();
                  runRowAction(id);
                }}
              >
                <Icon size={13} {...(meta.active ? { fill: 'currentColor' } : {})} />
              </button>
            );
          })}
        </span>
      </div>

      {/* Line 2: W-chip · repo · #num + open-external + copy · author avatar/initials · Draft pill */}
      <div className="prm-tile-line2">
        {workItem &&
          (workItemLink ? (
            <button
              type="button"
              className="prm-workitem-chip prm-workitem-chip--link"
              title={`Open ${workItem}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isSafeExternalUrl(workItemLink)) host.openExternal(workItemLink);
              }}
            >
              {workItem}
            </button>
          ) : (
            <span className="prm-workitem-chip">{workItem}</span>
          ))}
        <span className="prm-tile-repo">{pr.repo}</span>
        <span className="prm-tile-number">
          #{pr.number}
          <button
            type="button"
            className="prm-tile-icon-btn prm-tip"
            title="Open on GitHub"
            data-tip="Open on GitHub"
            aria-label="Open on GitHub"
            onClick={(e) => {
              e.stopPropagation();
              openPr();
            }}
          >
            <ExternalLink size={10} />
          </button>
          <button
            type="button"
            className="prm-tile-icon-btn prm-tip"
            title="Copy link"
            data-tip="Copy link"
            aria-label="Copy link"
            onClick={(e) => {
              e.stopPropagation();
              void copyToClipboard(pr.url, 'PR link');
            }}
          >
            <Link2 size={10} />
          </button>
        </span>
        {pr.author && (
          <span className="prm-author">
            {/* Initials only — the renderer never issues its own image request
                (AC-LIST-16.2a: no renderer network egress). A data:-URI avatar
                via the gh broker can land once a binary exec channel exists. */}
            <span className="prm-avatar prm-avatar--initials">{initialsOf(pr.author)}</span>
            <span className="prm-author-name">{pr.author.name || pr.author.login}</span>
          </span>
        )}
        {pr.isDraft && <span className="prm-draft-pill">Draft</span>}
      </div>

      {/* Line 3: head → base branch + copy */}
      {(pr.headRefName || pr.baseRefName) && (
        <div className="prm-tile-line3">
          <GitBranch size={10} className="prm-branch-icon" aria-hidden />
          <span className="prm-branch">
            {pr.headRefName || '?'} → {pr.baseRefName || '?'}
          </span>
          {pr.headRefName && (
            <button
              type="button"
              className="prm-tile-icon-btn prm-tip"
              title="Copy branch"
              data-tip="Copy branch"
              aria-label="Copy branch name"
              onClick={(e) => {
                e.stopPropagation();
                void copyToClipboard(pr.headRefName!, 'Branch name');
              }}
            >
              <Link2 size={10} />
            </button>
          )}
        </div>
      )}

      {/* Reviewers grouped by state (R-LIST-016) */}
      {hasReviewers && (
        <div className="prm-reviewers">
          {REVIEWER_GROUPS.map(({ state, label, className }) => {
            const group = reviewersByState[state];
            if (group.length === 0) return null;
            return (
              <span key={state} className={`prm-reviewers-group ${className}`} title={label}>
                <span className="prm-reviewers-label">{label}</span>
                {group.map((r) => (
                  <span
                    key={r.login}
                    className="prm-avatar prm-avatar--initials prm-reviewer-avatar"
                    title={r.name || r.login}
                    aria-label={`${label}: ${r.name || r.login}`}
                  >
                    {initialsOf(r)}
                  </span>
                ))}
              </span>
            );
          })}
        </div>
      )}

      {/* Desc: ≤2 line body clamp */}
      {pr.body && <div className="prm-desc">{pr.body}</div>}

      {/* Bottom line: the project-association control (icon + name), always
          present — associated (green folder + name) or "Not associated with a
          project" (red folder). Replaces both the old top-right control and the
          old gray project line (item 5). */}
      <PrProjectControl
        projectId={pr.projectId}
        projects={projects}
        onAssign={(projectId) => onProjectAssign(pr.url, projectId)}
      />

      {/* Per-check disclosure body (R-LIST-022) */}
      {checksOpen && checks.length > 0 && (
        <div className="prm-tile-checks" onClick={(e) => e.stopPropagation()}>
          <PrChecksCollapse checks={checks} />
        </div>
      )}
    </div>
  );
}
