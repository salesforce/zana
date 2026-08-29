import {
  DEFAULT_PR_MONITOR_SETTINGS,
  type MonitoredPr,
  type PrMonitorSettings
} from './types.js';

export function isPrUnread(pr: MonitoredPr): boolean {
  return pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt);
}

/** Same count the disk-extension nav badge used: total vs unread. */
export function computeNavBadge(args: {
  settings?: Pick<PrMonitorSettings, 'badgeMode'> | null;
  prs: MonitoredPr[];
  totalCount?: number;
}): number | null {
  const badgeMode = args.settings?.badgeMode ?? DEFAULT_PR_MONITOR_SETTINGS.badgeMode;
  if (badgeMode === 'unread') {
    const unseenCount = args.prs.filter(isPrUnread).length;
    return unseenCount > 0 ? unseenCount : null;
  }
  const totalCount = args.totalCount ?? args.prs.length;
  return totalCount > 0 ? totalCount : null;
}
