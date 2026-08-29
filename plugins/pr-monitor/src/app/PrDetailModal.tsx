/**
 * PR detail dialog — the compact board card's missing page. Opened by clicking
 * a kanban card (select-mode / ⌘-click still select). Shows the fields the
 * resting card hides: description, branches, reviewers, checks, clocks, and
 * the same row actions as the list tile.
 */

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BellOff,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Link2,
  Mail,
  MailOpen,
  RefreshCw,
  Star,
  Trash2,
  X,
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
  formatRelative,
  formatTimeInStatus,
  initialsOf,
  statusPill,
  tisLabel,
  DEFAULT_TIS_WARN_HOURS,
  DEFAULT_TIS_DANGER_HOURS,
  DEFAULT_REVIEW_TIS_WARN_DAYS,
  DEFAULT_REVIEW_TIS_DANGER_DAYS,
} from './formatHelpers.js';
import { buildStallState, reviewState, isBuildHappy } from '../../lib/pillState.js';
import { copyText } from './clipboard.js';
import { PrProjectControl } from './PrProjectControl.js';
import { PrChecksCollapse } from './PrChecksCollapse.js';
import { portal } from './portal.js';

const REVIEWER_GROUPS: Array<{ state: ReviewState; label: string; className: string }> = [
  { state: 'changes-requested', label: 'Changes requested', className: 'prm-reviewers--changes' },
  { state: 'review-requested', label: 'Review requested', className: 'prm-reviewers--requested' },
  { state: 'approved', label: 'Approved', className: 'prm-reviewers--approved' },
];

function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function mergeHint(pr: MonitoredPr): string | null {
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') return 'Has merge conflicts';
  if (pr.mergeStateStatus === 'BLOCKED') return 'Merge blocked';
  if (pr.mergeStateStatus === 'BEHIND') return 'Branch is behind the base';
  if (pr.mergeStateStatus === 'UNSTABLE') return 'Merge state unstable';
  return null;
}

interface Props {
  pr: MonitoredPr;
  host: ModuleHost;
  projects: ProjectInfo[];
  tisWarnHours?: number;
  tisDangerHours?: number;
  reviewWarnDays?: number;
  reviewDangerDays?: number;
  sfciGated?: boolean;
  ignoredFailingChecks?: string[];
  workItemLocatorBase?: string;
  onClose: () => void;
  onDismiss: (url: string) => void;
  onProjectAssign: (url: string, projectId: string | null) => void;
}

export function PrDetailModal({
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
  onClose,
  onDismiss,
  onProjectAssign,
}: Props) {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const unread = pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt);
  const closed = pr.status === 'closed-merged' || pr.status === 'closed-abandoned';
  const muted = Boolean(pr.muted);
  const favorite = Boolean(pr.favorite);
  const hasSyncError = Boolean(pr.syncError);
  const workItem = pr.workItem ?? extractWorkItem(pr.title, pr.headRefName, pr.body);
  const workItemLink = buildWorkItemLink(workItem, workItemLocatorBase);
  const title = workItem
    ? pr.title.replace(new RegExp(`(?:^|@)${workItem}[:\\s]*`, 'i'), '')
    : pr.title;
  const pill = statusPill(pr.status);
  const checks = pr.checks ?? [];
  const reviewers = pr.reviewers ?? [];
  const reviewersByState: Record<ReviewState, PrReviewer[]> = {
    'changes-requested': reviewers.filter((r) => r.state === 'changes-requested'),
    'review-requested': reviewers.filter((r) => r.state === 'review-requested'),
    approved: reviewers.filter((r) => r.state === 'approved'),
  };
  const hint = mergeHint(pr);

  const reviewApproved = pr.reviewDecision === 'APPROVED';
  const buildHappy = pr.buildHappy ?? isBuildHappy(checks, { ignoredFailingChecks });
  const build = buildStallState({
    status: pr.status,
    buildHappy,
    reviewApproved,
    sfciGated,
    hasSfciJob: Boolean(pr.hasSfciJob),
    elapsedHours: pr.lastStatusChange ? Math.max(0, Date.now() - pr.lastStatusChange) / 3_600_000 : 0,
    warnHours: tisWarnHours ?? DEFAULT_TIS_WARN_HOURS,
    dangerHours: tisDangerHours ?? DEFAULT_TIS_DANGER_HOURS,
  });
  const buildStr = formatTimeInStatus(pr.lastStatusChange);
  const buildColor: 'ok' | 'warn' | 'danger' =
    build === 'merge-stall' || build === 'danger' ? 'danger' : build === 'warn' ? 'warn' : 'ok';
  const buildPillLabel =
    build === 'done' ? 'Build ✓' : build === 'merge-stall' ? 'Merge stalled' : tisLabel(buildColor, 'build');
  const buildStateClass: string = build === 'done' ? 'done' : buildColor;

  const showReviewPill = !pr.isDraft && !closed;
  const review = reviewState({
    reviewApproved,
    merged: pr.status === 'closed-merged',
    elapsedDays: pr.reviewClockStartedAt ? Math.max(0, Date.now() - pr.reviewClockStartedAt) / 86_400_000 : 0,
    warnDays: reviewWarnDays ?? DEFAULT_REVIEW_TIS_WARN_DAYS,
    dangerDays: reviewDangerDays ?? DEFAULT_REVIEW_TIS_DANGER_DAYS,
  });
  const reviewStr = formatTimeInStatus(pr.reviewClockStartedAt);
  const reviewColor: 'ok' | 'warn' | 'danger' =
    review === 'danger' ? 'danger' : review === 'warn' ? 'warn' : 'ok';
  const reviewPillLabel = review === 'done' ? 'Review ✓' : tisLabel(reviewColor, 'review');
  const reviewStateClass: string = review === 'done' ? 'done' : reviewColor;

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

  const openPr = () => {
    if (isSafeExternalUrl(pr.url)) host.openExternal(pr.url);
    else host.toast('Refusing to open a non-http(s) URL', 'error');
  };

  const copyToClipboard = async (text: string, label: string) => {
    if (await copyText(text)) host.toast(`${label} copied`, 'info');
    else host.toast(`Failed to copy ${label}`, 'error');
  };

  const toggleSeen = async () => {
    const handler = unread ? 'markPrAsSeen' : 'markPrAsUnseen';
    applyResult(await host.call<{ ok: boolean; prs?: MonitoredPr[] }>(handler, { url: pr.url }));
  };

  const toggleMute = async () => {
    applyResult(
      await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('setPrMuted', { url: pr.url, muted: !muted })
    );
  };

  const toggleFavorite = async () => {
    applyResult(
      await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('setPrFavorite', {
        url: pr.url,
        favorite: !favorite,
      })
    );
  };

  const retrySync = async () => {
    setRetrying(true);
    try {
      applyResult(await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('retryPr', { url: pr.url }));
    } finally {
      setRetrying(false);
    }
  };

  const dialog = (
    <div className="modal-backdrop" onClick={onClose} data-testid="prm-detail-backdrop">
      <div
        className="modal prm-modal prm-modal--detail"
        role="dialog"
        aria-modal
        aria-labelledby="prm-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="prm-modal-header">
          <h3 id="prm-detail-title">
            <StateIcon size={14} aria-hidden />
            <span className="prm-detail-id">
              #{pr.number}
              <span className="prm-detail-repo">{pr.repo}</span>
            </span>
          </h3>
          <button type="button" className="prm-row-icon-btn" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </header>

        <div className="prm-modal-body prm-detail-body">
          <div className="prm-detail-heading">
            {workItem &&
              (workItemLink ? (
                <button
                  type="button"
                  className="prm-workitem-chip prm-workitem-chip--link"
                  title={`Open ${workItem}`}
                  onClick={() => {
                    if (isSafeExternalUrl(workItemLink)) host.openExternal(workItemLink);
                  }}
                >
                  {workItem}
                </button>
              ) : (
                <span className="prm-workitem-chip">{workItem}</span>
              ))}
            <h4 className="prm-detail-pr-title">{title}</h4>
          </div>

          <div className="prm-detail-status-row">
            <span className={`prm-status-pill ${pill.className}`}>{pill.label}</span>
            {pr.isDraft && (
              <span className="prm-draft-pill">
                <GitPullRequestDraft size={10} aria-hidden /> Draft
              </span>
            )}
            {muted && (
              <span className="prm-mute-indicator" title="Muted — notifications silenced">
                <BellOff size={11} aria-hidden /> Muted
              </span>
            )}
            {buildStr && (
              <span className={`prm-tis prm-tis--${buildStateClass}`}>
                {buildStr}
                {buildPillLabel && <span className="prm-tis-cue"> {buildPillLabel}</span>}
              </span>
            )}
            {showReviewPill && (reviewStr || reviewPillLabel) && (
              <span className={`prm-tis prm-tis--review prm-tis--${reviewStateClass}`}>
                {reviewStr}
                {reviewPillLabel && <span className="prm-tis-cue"> {reviewPillLabel}</span>}
              </span>
            )}
          </div>

          {hint && <div className="prm-detail-hint">{hint}</div>}

          <dl className="prm-detail-facts">
            {pr.author && (
              <div className="prm-detail-fact">
                <dt>Author</dt>
                <dd>
                  <span className="prm-avatar prm-avatar--initials">{initialsOf(pr.author)}</span>
                  {pr.author.name || pr.author.login}
                </dd>
              </div>
            )}
            {pr.createdAt ? (
              <div className="prm-detail-fact">
                <dt>Opened</dt>
                <dd>{formatRelative(pr.createdAt)}</dd>
              </div>
            ) : null}
            {(pr.updatedAt || pr.lastChecked) ? (
              <div className="prm-detail-fact">
                <dt>Updated</dt>
                <dd>{formatRelative(pr.updatedAt || pr.lastChecked)}</dd>
              </div>
            ) : null}
            {pr.lastChecked ? (
              <div className="prm-detail-fact">
                <dt>Last synced</dt>
                <dd>{formatRelative(pr.lastChecked)}</dd>
              </div>
            ) : null}
          </dl>

          {(pr.headRefName || pr.baseRefName) && (
            <div className="prm-detail-section">
              <div className="prm-detail-label">Branches</div>
              <div className="prm-detail-branch">
                <GitBranch size={12} aria-hidden />
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
                    onClick={() => void copyToClipboard(pr.headRefName!, 'Branch name')}
                  >
                    <Link2 size={10} />
                  </button>
                )}
              </div>
            </div>
          )}

          {pr.body && (
            <div className="prm-detail-section">
              <div className="prm-detail-label">Description</div>
              <div className="prm-detail-desc">{pr.body}</div>
            </div>
          )}

          {reviewers.length > 0 && (
            <div className="prm-detail-section">
              <div className="prm-detail-label">Reviewers</div>
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
            </div>
          )}

          <div className="prm-detail-section">
            <div className="prm-detail-label">Checks</div>
            <PrChecksCollapse checks={checks} />
          </div>

          {hasSyncError && (
            <div className="prm-detail-sync-error">
              <AlertCircle size={12} aria-hidden />
              <span>Couldn't sync this PR: {pr.syncError}</span>
              <button
                type="button"
                className="prm-btn prm-btn--sm"
                disabled={retrying}
                aria-label="Retry syncing this PR"
                onClick={() => void retrySync()}
              >
                <RefreshCw size={11} className={retrying ? 'prm-spin' : ''} /> Retry
              </button>
            </div>
          )}

          <div className="prm-detail-section">
            <PrProjectControl
              projectId={pr.projectId}
              projects={projects}
              onAssign={(projectId) => onProjectAssign(pr.url, projectId)}
            />
          </div>
        </div>

        <footer className="prm-modal-footer prm-detail-footer">
          <button
            type="button"
            className="prm-btn prm-btn--primary"
            onClick={openPr}
            title="Open on GitHub"
          >
            <ExternalLink size={13} />
            <span>Open on GitHub</span>
          </button>
          <button
            type="button"
            className="prm-btn"
            aria-label="Copy link"
            onClick={() => void copyToClipboard(pr.url, 'PR link')}
          >
            <Link2 size={13} />
            <span>Copy link</span>
          </button>
          <span className="prm-detail-footer-spacer" />
          <button
            type="button"
            className={`prm-tile-icon-btn prm-tip${favorite ? ' prm-tile-icon-btn--active' : ''}`}
            title={favorite ? 'Unfavorite' : 'Favorite'}
            data-tip={favorite ? 'Unfavorite' : 'Favorite'}
            aria-label={favorite ? 'Unfavorite' : 'Favorite'}
            aria-pressed={favorite}
            onClick={() => void toggleFavorite()}
          >
            <Star size={13} {...(favorite ? { fill: 'currentColor' } : {})} />
          </button>
          <button
            type="button"
            className="prm-tile-icon-btn prm-tip"
            title={muted ? 'Unmute' : 'Mute'}
            data-tip={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={() => void toggleMute()}
          >
            {muted ? <BellOff size={13} /> : <Bell size={13} />}
          </button>
          <button
            type="button"
            className="prm-tile-icon-btn prm-tip"
            title={unread ? 'Mark this PR as read' : 'Mark this PR as unread'}
            data-tip={unread ? 'Mark read' : 'Mark unread'}
            aria-label={unread ? 'Mark read' : 'Mark unread'}
            onClick={() => void toggleSeen()}
          >
            {unread ? <MailOpen size={13} /> : <Mail size={13} />}
          </button>
          <button
            type="button"
            className="prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger"
            title="Dismiss"
            data-tip="Dismiss"
            aria-label="Dismiss"
            onClick={() => onDismiss(pr.url)}
          >
            <Trash2 size={13} />
          </button>
        </footer>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? portal(dialog, document.body) : dialog;
}
