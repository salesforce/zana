/**
 * Compact kanban card — BB tasks-style: muted key, two-line title, one meta
 * row. Status lives on the column. Checkboxes stay off the resting card.
 * Click (or Enter/Space) opens a detail dialog and marks the card seen.
 */

import { useState } from 'react';
import {
  AlertCircle,
  Clock,
  ExternalLink,
  GitPullRequestDraft,
  RefreshCw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { runPrAction } from './prAction.js';
import type { ModuleHost } from './host.js';
import {
  type MonitoredPr,
  extractWorkItem,
} from '../../lib/types.js';
import {
  formatRelative,
  formatTimeInStatus,
  initialsOf,
  summarizeChecks,
  tisLabel,
  DEFAULT_TIS_WARN_HOURS,
  DEFAULT_TIS_DANGER_HOURS,
} from './formatHelpers.js';
import { buildStallState, isBuildHappy } from '../../lib/pillState.js';
import { shortRepoName } from './pr-board.js';

interface Props {
  pr: MonitoredPr;
  host: ModuleHost;
  tisWarnHours?: number;
  tisDangerHours?: number;
  ignoredFailingChecks?: string[];
  selected: boolean;
  /** Any card on the board is selected — keep checkboxes available to extend the set. */
  selectionActive?: boolean;
  /** Explicit Select mode: click toggles selection instead of opening details. */
  selectMode?: boolean;
  onToggleSelect: (url: string) => void;
  onDismiss: (url: string) => void;
  onOpen: (url: string) => void;
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isUnread(pr: MonitoredPr): boolean {
  return pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt);
}

export function PrBoardCard({
  pr,
  host,
  tisWarnHours,
  tisDangerHours,
  ignoredFailingChecks,
  selected,
  selectionActive = false,
  selectMode = false,
  onToggleSelect,
  onDismiss,
  onOpen,
}: Props) {
  const [retrying, setRetrying] = useState(false);
  const unread = isUnread(pr);
  const closed = pr.status === 'closed-merged' || pr.status === 'closed-abandoned';
  const favorite = Boolean(pr.favorite);
  const hasSyncError = Boolean(pr.syncError);
  const workItem = pr.workItem ?? extractWorkItem(pr.title, pr.headRefName, pr.body);
  const title = workItem
    ? pr.title.replace(new RegExp(`(?:^|@)${workItem}[:\\s]*`, 'i'), '')
    : pr.title;
  const checks = pr.checks ?? [];
  const checkCounts = summarizeChecks(checks);
  const updated = pr.updatedAt || pr.lastChecked || pr.lastStatusChange;
  const buildHappy = pr.buildHappy ?? isBuildHappy(checks, { ignoredFailingChecks });
  const build = buildStallState({
    status: pr.status,
    buildHappy,
    reviewApproved: pr.reviewDecision === 'APPROVED',
    sfciGated: false,
    hasSfciJob: Boolean(pr.hasSfciJob),
    elapsedHours: pr.lastStatusChange ? Math.max(0, Date.now() - pr.lastStatusChange) / 3_600_000 : 0,
    warnHours: tisWarnHours ?? DEFAULT_TIS_WARN_HOURS,
    dangerHours: tisDangerHours ?? DEFAULT_TIS_DANGER_HOURS,
  });
  const stallCue =
    build === 'merge-stall'
      ? 'Merge stalled'
      : build === 'warn' || build === 'danger'
        ? tisLabel(build, 'build')
        : '';
  const stallClass = build === 'merge-stall' || build === 'danger' ? 'danger' : build === 'warn' ? 'warn' : '';
  const showCheckbox = selected || selectMode || selectionActive;

  const markSeen = async () => {
    if (!unread) return;
    await runPrAction(host, 'markPrAsSeen', { url: pr.url });
  };

  const toggleFavorite = async () => {
    await runPrAction(host, 'setPrFavorite', {
      url: pr.url,
      favorite: !favorite,
    });
  };

  const openPr = () => {
    if (isSafeExternalUrl(pr.url)) host.openExternal(pr.url);
    else host.toast('Refusing to open a non-http(s) URL', 'error');
  };

  const retrySync = async () => {
    setRetrying(true);
    try {
      await runPrAction(host, 'retryPr', { url: pr.url });
    } finally {
      setRetrying(false);
    }
  };

  const openDetails = () => {
    onOpen(pr.url);
    void markSeen();
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || selectMode) {
      onToggleSelect(pr.url);
      return;
    }
    openDetails();
  };

  return (
    <article
      className={[
        'prm-board-card',
        unread ? 'prm-board-card--unread' : '',
        closed ? 'prm-board-card--closed' : '',
        favorite ? 'prm-board-card--favorite' : '',
        selected ? 'prm-board-card--selected' : '',
        hasSyncError ? 'prm-board-card--stale' : '',
        showCheckbox ? 'prm-board-card--selectable' : '',
        selectMode ? 'prm-board-card--select-mode' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleCardClick}
      // The canvas captures pointers to pan empty space. Capturing a card's
      // pointer retargets its click to the canvas, so the details never open.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (selectMode || e.metaKey || e.ctrlKey) onToggleSelect(pr.url);
          else openDetails();
        }
      }}
      role="listitem"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`${pr.repo} #${pr.number}: ${pr.title}`}
    >
      <div className="prm-board-card-top">
        <input
          type="checkbox"
          className="prm-board-card-select"
          checked={selected}
          title={selected ? 'Deselect this PR' : 'Select this PR'}
          aria-label={selected ? 'Deselect this PR' : 'Select this PR'}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect(pr.url);
          }}
        />
        <span className="prm-board-card-id">
          <span className="prm-board-card-num">#{pr.number}</span>
          <span className="prm-board-card-repo" title={pr.repo}>{shortRepoName(pr.repo)}</span>
        </span>
        {workItem && <span className="prm-workitem-chip prm-board-card-wi">{workItem}</span>}
        <span className="prm-board-card-actions">
          <button
            type="button"
            className={`prm-tile-icon-btn prm-tip${favorite ? ' prm-tile-icon-btn--active' : ''}`}
            title={favorite ? 'Unfavorite' : 'Favorite'}
            data-tip={favorite ? 'Unfavorite' : 'Favorite'}
            aria-label={favorite ? 'Unfavorite' : 'Favorite'}
            aria-pressed={favorite}
            onClick={(e) => {
              e.stopPropagation();
              void toggleFavorite();
            }}
          >
            <Star size={12} {...(favorite ? { fill: 'currentColor' } : {})} />
          </button>
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
            <ExternalLink size={12} />
          </button>
          <button
            type="button"
            className="prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger"
            title="Dismiss"
            data-tip="Dismiss"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(pr.url);
            }}
          >
            <Trash2 size={12} />
          </button>
        </span>
      </div>

      <div className="prm-board-card-title">{title}</div>

      <div className="prm-board-card-meta">
        {pr.author && (
          <span className="prm-avatar prm-avatar--initials" title={pr.author.name || pr.author.login}>
            {initialsOf(pr.author)}
          </span>
        )}
        {stallCue ? (
          <span className={`prm-tis prm-tis--${stallClass} prm-board-card-stall`}>
            {formatTimeInStatus(pr.lastStatusChange)} {stallCue}
          </span>
        ) : (
          updated > 0 && <span className="prm-board-card-time">{formatRelative(updated)}</span>
        )}
        {checkCounts.fail > 0 && (
          <span className="prm-check-pip prm-check-pip--fail" aria-label={`${checkCounts.fail} checks failing`}>
            <X size={9} /> {checkCounts.fail}
          </span>
        )}
        {checkCounts.pending > 0 && (
          <span className="prm-check-pip prm-check-pip--pending" aria-label={`${checkCounts.pending} checks running`}>
            <Clock size={9} /> {checkCounts.pending}
          </span>
        )}
        {pr.isDraft && (
          <span className="prm-draft-pill prm-board-card-draft">
            <GitPullRequestDraft size={10} aria-hidden /> Draft
          </span>
        )}
        {hasSyncError && (
          <span className="prm-sync-error" title={`Couldn't sync this PR: ${pr.syncError}`}>
            <AlertCircle size={11} aria-hidden />
            <button
              type="button"
              className="prm-tile-icon-btn"
              title="Retry sync"
              aria-label="Retry syncing this PR"
              disabled={retrying}
              onClick={(e) => {
                e.stopPropagation();
                void retrySync();
              }}
            >
              <RefreshCw size={10} className={retrying ? 'prm-spin' : ''} />
            </button>
          </span>
        )}
      </div>
    </article>
  );
}
