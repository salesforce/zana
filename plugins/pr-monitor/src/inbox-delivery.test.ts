import { describe, expect, it } from 'vitest';
import { inboxCommentForDelta, inboxDeliveriesForDeltas, isInterestingDelta } from '../lib/inbox-delivery.js';
import { DEFAULT_PR_MONITOR_SETTINGS, type MonitoredPr, type PrStatusDelta } from '../lib/types.js';

function pr(over: Partial<MonitoredPr> = {}): MonitoredPr {
  return {
    url: 'https://github.com/acme/app/pull/1',
    repo: 'acme/app',
    number: 1,
    title: 'Fix [bug]',
    status: 'green',
    addedAt: 1,
    lastChecked: 1,
    lastStatusChange: 1,
    projectId: 'p1',
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checks: [],
    ...over
  };
}

function delta(over: Partial<PrStatusDelta> = {}): PrStatusDelta {
  const item = pr(over.pr);
  return { url: item.url, oldStatus: 'yellow', newStatus: 'green', pr: item, ...over };
}

describe('inbox-delivery', () => {
  it('treats green/failed/conflict transitions as interesting', () => {
    expect(isInterestingDelta(delta({ newStatus: 'green' }))).toBe(true);
    expect(isInterestingDelta(delta({ oldStatus: 'failed', newStatus: 'pending' }))).toBe(false);
    expect(isInterestingDelta(delta({ oldStatus: 'green', newStatus: 'failed' }))).toBe(true);
  });

  it('escapes markdown in the inbox body and skips unassigned PRs', () => {
    const body = inboxCommentForDelta(delta());
    expect(body).toContain('acme/app#1');
    expect(body).toContain('Fix \\[bug\\]');
    expect(body).toContain('https://github.com/acme/app/pull/1');
    expect(inboxCommentForDelta(delta({ pr: pr({ url: 'not a url' }) }))).toContain('Fix \\[bug\\]');
    expect(inboxCommentForDelta(delta({ pr: pr({ url: 'javascript:alert(1)' }) }))).not.toContain('](');
    const deliveries = inboxDeliveriesForDeltas(
      [delta(), delta({ pr: pr({ projectId: undefined }) })],
      { ...DEFAULT_PR_MONITOR_SETTINGS, sendToInbox: true }
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.projectId).toBe('p1');
  });

  it('honors notify delivery mute', () => {
    const muted = pr({ muted: true });
    expect(
      inboxDeliveriesForDeltas([delta({ pr: muted })], { ...DEFAULT_PR_MONITOR_SETTINGS, sendToInbox: true })
    ).toEqual([]);
  });
});
