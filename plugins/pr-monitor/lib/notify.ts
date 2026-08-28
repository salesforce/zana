/**
 * Notification delivery decision — the R-NOTIF-002/003 + R-INBOX-002 AND-chain,
 * as ONE pure function so both the delivery loop (`PrMonitorBackground.tsx`) and
 * its tests share a single source of truth.
 *
 * Two independent delivery surfaces (in-app, inbox) share ONE mute scope:
 *
 *   shared mute scope (notification-worthy):
 *     the PR's repository not muted (per-repo `notifyInApp`, AC-REPO-11.4)
 *       AND the PR not individually muted (`muted`, R-LIST-018 / AC-LIST-18.5)
 *
 *   in-app delivery = worthy AND global in-app flag (R-NOTIF-002)
 *   inbox delivery  = worthy AND global Send-to-Inbox (R-NOTIF-003)
 *                            AND a Project association (R-INBOX-000 / AC-INBOX-2.3)
 *
 * The two surfaces are INDEPENDENT of each other (AC-NOTIF-3.5): the in-app flag
 * does NOT gate inbox, and Send-to-Inbox does NOT gate in-app. Mute scoping is
 * shared, not per-channel — muting a PR or repo silences BOTH (AC-NOTIF-3.6).
 *
 * This is delivery scoping only; whether a status change is interesting enough to
 * notify at all (direction of the transition) is a separate gate in the caller.
 */

import type { MonitoredPr, MonitoredRepo, PrMonitorSettings } from './types.js';

export interface NotifyDelivery {
  /** In-app notification surface (R-NOTIF-002). */
  inApp: boolean;
  /** Inbox surface (R-NOTIF-003 + R-INBOX-000). */
  inbox: boolean;
}

/**
 * Find the monitored-repo record for a PR's `owner/repo` (case-insensitive).
 * An absent record means the repo carries no per-repo mute — it does not
 * suppress (AC-REPO-11.4 is a narrowing flag, not a gate).
 */
function repoFor(
  pr: Pick<MonitoredPr, 'repo'>,
  repositories: MonitoredRepo[] | undefined
): MonitoredRepo | undefined {
  const key = (pr.repo ?? '').toLowerCase();
  if (!key) return undefined;
  return (repositories ?? []).find(
    (r) => `${r.owner}/${r.repo}`.toLowerCase() === key
  );
}

/**
 * Compute the delivery decision for a notification-worthy status change.
 *
 * `settings.notifyInApp` mirrors the legacy `notifyOnChange`; we fall back to it
 * (then to `false`) so an older stored settings blob still resolves the in-app
 * master switch.
 */
export function computeNotifyDelivery(
  pr: Pick<MonitoredPr, 'muted' | 'projectId' | 'repo'>,
  settings: Pick<
    PrMonitorSettings,
    'notifyInApp' | 'notifyOnChange' | 'sendToInbox' | 'repositories'
  >
): NotifyDelivery {
  const repo = repoFor(pr, settings.repositories);
  // Per-repo flag is a narrowing switch: absent record OR flag !== false → not
  // muting. Only an explicit `notifyInApp: false` mutes the repository.
  const repoNotMuted = repo ? repo.notifyInApp !== false : true;
  const notificationWorthy = repoNotMuted && !pr.muted;

  if (!notificationWorthy) return { inApp: false, inbox: false };

  const globalInApp = settings.notifyInApp ?? settings.notifyOnChange ?? false;
  const globalInbox = settings.sendToInbox ?? false;

  return {
    inApp: globalInApp,
    inbox: globalInbox && !!pr.projectId,
  };
}
