import { describe, expect, it } from 'vitest';
import { computeNavBadge, isPrUnread } from '../lib/badge.js';
import type { MonitoredPr } from '../lib/types.js';

function makePr(over: Partial<MonitoredPr> = {}): MonitoredPr {
  return {
    url: 'https://github.com/owner/repo/pull/42',
    repo: 'owner/repo',
    number: 42,
    title: 'Test PR',
    baseRefName: 'main',
    status: 'green',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checks: [],
    addedAt: 1000,
    lastChecked: 2000,
    lastStatusChange: 1500,
    ...over
  };
}

describe('computeNavBadge', () => {
  it('counts unread PRs in unread mode and hides a zero', () => {
    const prs = [
      makePr({ lastStatusChange: 2000, lastSeenAt: 1500 }),
      makePr({ lastStatusChange: 1200, lastSeenAt: 1500 }),
      makePr({ lastSeenAt: 0, lastStatusChange: 1000 })
    ];
    expect(computeNavBadge({ settings: { badgeMode: 'unread' }, prs })).toBe(2);
    expect(computeNavBadge({ settings: { badgeMode: 'unread' }, prs: [makePr({ lastSeenAt: 3000, lastStatusChange: 1500 })] })).toBe(
      null
    );
  });

  it('counts total PRs in total mode and defaults to total', () => {
    const prs = [makePr(), makePr()];
    expect(computeNavBadge({ settings: { badgeMode: 'total' }, prs })).toBe(2);
    expect(computeNavBadge({ settings: null, prs: [] })).toBe(null);
    expect(computeNavBadge({ prs: [makePr()], totalCount: 4 })).toBe(4);
  });

  it('treats lastSeenAt 0 as unread', () => {
    expect(isPrUnread(makePr({ lastSeenAt: 0 }))).toBe(true);
    expect(isPrUnread(makePr({ lastSeenAt: 4000, lastStatusChange: 1500 }))).toBe(false);
  });
});
