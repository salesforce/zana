/**
 * Unit tests for PR Monitor's shared type helpers.
 *
 * Tests the helper functions that extract data from PR URLs, compute status
 * priorities, and roll up worst-case status across a list of PRs.
 */
import { describe, it, expect } from 'vitest';
import {
  repoOf,
  prNumber,
  hostOf,
  statusPriority,
  worstStatus,
  extractWorkItem,
  triageSeverityRank,
  resolveBuildThresholds,
  resolveReviewThresholds,
  resolveTisThresholds,
  TIS_PRESETS,
  REVIEW_TIS_PRESETS,
  DEFAULT_TIS_PRESET,
  DEFAULT_REVIEW_TIS_PRESET,
} from '../lib/types.js';
import type { MonitoredPr, MonitoredRepo, PrRollupStatus } from '../lib/types.js';

describe('repoOf', () => {
  it('extracts org/repo from a standard GitHub URL', () => {
    expect(repoOf('https://github.com/owner/repo/pull/42')).toBe('owner/repo');
  });

  it('extracts org/repo with trailing path segments', () => {
    expect(repoOf('https://github.com/owner/repo/pull/42/files')).toBe('owner/repo');
    expect(repoOf('https://github.com/owner/repo/pull/42/commits')).toBe('owner/repo');
  });

  it('handles http:// URLs', () => {
    expect(repoOf('http://github.com/owner/repo/pull/99')).toBe('owner/repo');
  });

  it('handles URL fragments and query strings', () => {
    expect(repoOf('https://github.com/owner/repo/pull/42#discussion_r123')).toBe('owner/repo');
    expect(repoOf('https://github.com/owner/repo/pull/42?foo=bar')).toBe('owner/repo');
  });

  it('is case-insensitive for the domain', () => {
    expect(repoOf('https://GITHUB.COM/owner/repo/pull/42')).toBe('owner/repo');
  });

  it('throws on non-PR URLs', () => {
    expect(() => repoOf('https://github.com/owner/repo')).toThrow('Not a GitHub PR URL');
    expect(() => repoOf('https://github.com/owner/repo/issues/42')).toThrow('Not a GitHub PR URL');
    expect(() => repoOf('not a url')).toThrow('Not a GitHub PR URL');
  });

  it('throws on empty or undefined input', () => {
    expect(() => repoOf('')).toThrow('Not a GitHub PR URL');
    expect(() => repoOf('   ')).toThrow('Not a GitHub PR URL');
  });

  it('handles repos with dashes and underscores', () => {
    expect(repoOf('https://github.com/my-org/my_repo/pull/123')).toBe('my-org/my_repo');
  });
});

describe('prNumber', () => {
  it('extracts PR number from a standard GitHub URL', () => {
    expect(prNumber('https://github.com/owner/repo/pull/42')).toBe(42);
  });

  it('extracts PR number with trailing path segments', () => {
    expect(prNumber('https://github.com/owner/repo/pull/99/files')).toBe(99);
    expect(prNumber('https://github.com/owner/repo/pull/12345/commits')).toBe(12345);
  });

  it('handles http:// URLs', () => {
    expect(prNumber('http://github.com/owner/repo/pull/999')).toBe(999);
  });

  it('handles URL fragments and query strings', () => {
    expect(prNumber('https://github.com/owner/repo/pull/42#discussion_r123')).toBe(42);
    expect(prNumber('https://github.com/owner/repo/pull/42?foo=bar')).toBe(42);
  });

  it('is case-insensitive for the domain', () => {
    expect(prNumber('https://GITHUB.COM/owner/repo/pull/42')).toBe(42);
  });

  it('throws on non-PR URLs', () => {
    expect(() => prNumber('https://github.com/owner/repo')).toThrow('Not a GitHub PR URL');
    expect(() => prNumber('https://github.com/owner/repo/issues/42')).toThrow('Not a GitHub PR URL');
    expect(() => prNumber('not a url')).toThrow('Not a GitHub PR URL');
  });

  it('throws on empty or undefined input', () => {
    expect(() => prNumber('')).toThrow('Not a GitHub PR URL');
    expect(() => prNumber('   ')).toThrow('Not a GitHub PR URL');
  });
});

describe('hostOf', () => {
  it('extracts the host from a standard GitHub URL', () => {
    expect(hostOf('https://github.com/owner/repo/pull/42')).toBe('github.com');
  });

  it('extracts a GitHub Enterprise host', () => {
    expect(hostOf('https://git.soma.salesforce.com/owner/repo/pull/42')).toBe('git.soma.salesforce.com');
  });

  it('handles trailing path segments, fragments, and query strings', () => {
    expect(hostOf('https://github.com/owner/repo/pull/42/files')).toBe('github.com');
    expect(hostOf('https://github.com/owner/repo/pull/42#discussion_r123')).toBe('github.com');
    expect(hostOf('https://github.com/owner/repo/pull/42?foo=bar')).toBe('github.com');
  });

  it('throws on non-PR URLs', () => {
    expect(() => hostOf('https://github.com/owner/repo')).toThrow('Not a GitHub PR URL');
    expect(() => hostOf('not a url')).toThrow('Not a GitHub PR URL');
  });
});

describe('statusPriority', () => {
  it('assigns correct ordinal values (higher = worse)', () => {
    expect(statusPriority('failed')).toBeGreaterThan(statusPriority('conflict'));
    expect(statusPriority('conflict')).toBeGreaterThan(statusPriority('yellow'));
    expect(statusPriority('yellow')).toBeGreaterThan(statusPriority('review-required'));
    expect(statusPriority('review-required')).toBeGreaterThan(statusPriority('pending'));
    expect(statusPriority('pending')).toBeGreaterThan(statusPriority('integrating'));
    expect(statusPriority('integrating')).toBeGreaterThan(statusPriority('green'));
    expect(statusPriority('green')).toBeGreaterThan(statusPriority('closed-abandoned'));
    // closed-abandoned and closed-merged both priority 0 (terminal, equal)
    expect(statusPriority('closed-abandoned')).toBe(statusPriority('closed-merged'));
  });

  it('matches the reference priority map', () => {
    expect(statusPriority('failed')).toBe(7);
    expect(statusPriority('conflict')).toBe(6);
    expect(statusPriority('yellow')).toBe(5);
    expect(statusPriority('review-required')).toBe(4);
    expect(statusPriority('pending')).toBe(3);
    expect(statusPriority('integrating')).toBe(2);
    expect(statusPriority('green')).toBe(1);
    expect(statusPriority('closed-abandoned')).toBe(0);
    expect(statusPriority('closed-merged')).toBe(0);
  });

  it('returns a number for every status value', () => {
    const statuses: PrRollupStatus[] = [
      'pending',
      'failed',
      'conflict',
      'yellow',
      'review-required',
      'integrating',
      'green',
      'closed-merged',
      'closed-abandoned',
    ];
    for (const status of statuses) {
      expect(typeof statusPriority(status)).toBe('number');
    }
  });
});

describe('triageSeverityRank (AC-LIST-12.5)', () => {
  it('ranks the nine statuses in canonical triage-severity order (1 = most severe)', () => {
    expect(triageSeverityRank('conflict')).toBe(1);
    expect(triageSeverityRank('failed')).toBe(2);
    expect(triageSeverityRank('yellow')).toBe(3);
    expect(triageSeverityRank('review-required')).toBe(4);
    expect(triageSeverityRank('pending')).toBe(5);
    expect(triageSeverityRank('integrating')).toBe(6);
    expect(triageSeverityRank('green')).toBe(7);
    expect(triageSeverityRank('closed-merged')).toBe(8);
    expect(triageSeverityRank('closed-abandoned')).toBe(9);
  });

  it('is strictly monotonic across the canonical order (unique ranks)', () => {
    const order: PrRollupStatus[] = [
      'conflict',
      'failed',
      'yellow',
      'review-required',
      'pending',
      'integrating',
      'green',
      'closed-merged',
      'closed-abandoned',
    ];
    const ranks = order.map(triageSeverityRank);
    // Each strictly greater than the one before → total order, no ties.
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
    expect(new Set(ranks).size).toBe(9);
  });
});

describe('worstStatus', () => {
  function makePr(url: string, status: PrRollupStatus): MonitoredPr {
    return {
      url,
      repo: 'owner/repo',
      number: 42,
      title: 'PR',
      baseRefName: 'main',
      status,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checks: [],
      addedAt: Date.now(),
      lastChecked: Date.now(),
      lastStatusChange: Date.now(),
      lastSeenAt: undefined,
    };
  }

  it('returns "green" for an empty list', () => {
    expect(worstStatus([])).toBe('green');
  });

  it('returns the single PR status when list has one item', () => {
    expect(worstStatus([makePr('url1', 'failed')])).toBe('failed');
    expect(worstStatus([makePr('url1', 'green')])).toBe('green');
  });

  it('returns the highest-priority status across multiple PRs', () => {
    const prs = [
      makePr('url1', 'green'),
      makePr('url2', 'yellow'),
      makePr('url3', 'conflict'),
      makePr('url4', 'failed'),
    ];
    expect(worstStatus(prs)).toBe('failed');
  });

  it('handles all-green PRs', () => {
    const prs = [
      makePr('url1', 'green'),
      makePr('url2', 'green'),
      makePr('url3', 'green'),
    ];
    expect(worstStatus(prs)).toBe('green');
  });

  it('handles all-pending PRs', () => {
    const prs = [
      makePr('url1', 'pending'),
      makePr('url2', 'pending'),
    ];
    expect(worstStatus(prs)).toBe('pending');
  });

  it('prefers active failures over terminal states', () => {
    const prs = [
      makePr('url1', 'closed-merged'),
      makePr('url2', 'closed-abandoned'),
      makePr('url3', 'failed'),
    ];
    expect(worstStatus(prs)).toBe('failed');
  });

  it('prefers integrating over closed states', () => {
    const prs = [
      makePr('url1', 'closed-merged'),
      makePr('url2', 'integrating'),
    ];
    expect(worstStatus(prs)).toBe('integrating');
  });

  it('handles a mix of terminal and active states', () => {
    const prs = [
      makePr('url1', 'closed-merged'),
      makePr('url2', 'green'),
      makePr('url3', 'yellow'),
      makePr('url4', 'conflict'),
    ];
    expect(worstStatus(prs)).toBe('conflict');
  });

  it('handles many PRs efficiently', () => {
    const prs = Array.from({ length: 100 }, (_, i) =>
      makePr(`url${i}`, i === 99 ? 'failed' : 'green')
    );
    expect(worstStatus(prs)).toBe('failed');
  });
});

describe('two-pill presets (R-SYS-008 build hours / R-SYS-009 review days)', () => {
  it('build family is hours-scale: Fast 1/2, Standard 4/6, Long-running 12/24', () => {
    expect(TIS_PRESETS.fast).toMatchObject({ warnHours: 1, dangerHours: 2 });
    expect(TIS_PRESETS.standard).toMatchObject({ warnHours: 4, dangerHours: 6 });
    expect(TIS_PRESETS['long-running']).toMatchObject({ warnHours: 12, dangerHours: 24 });
    expect(DEFAULT_TIS_PRESET).toBe('standard');
  });

  it('review family is days-scale: Fast 1/2, Standard 3/5, Long-running 7/14', () => {
    expect(REVIEW_TIS_PRESETS.fast).toMatchObject({ warnDays: 1, dangerDays: 2 });
    expect(REVIEW_TIS_PRESETS.standard).toMatchObject({ warnDays: 3, dangerDays: 5 });
    expect(REVIEW_TIS_PRESETS['long-running']).toMatchObject({ warnDays: 7, dangerDays: 14 });
    expect(DEFAULT_REVIEW_TIS_PRESET).toBe('standard');
  });
});

describe('resolveBuildThresholds (build preset overrides globals; legacy tisPreset → build)', () => {
  function repo(over: Partial<MonitoredRepo>): MonitoredRepo {
    return {
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
      active: true,
      createdAt: 1,
      ...over,
    } as MonitoredRepo;
  }

  it('unknown repo falls back to the passed globals', () => {
    expect(resolveBuildThresholds('nobody/here', [], 4, 6)).toEqual({ warnHours: 4, dangerHours: 6 });
  });

  it("a repo's buildTisPreset overrides the globals (long-running → 12/24)", () => {
    const repos = [repo({ buildTisPreset: 'long-running' })];
    expect(resolveBuildThresholds('acme/widgets', repos, 4, 6)).toEqual({ warnHours: 12, dangerHours: 24 });
  });

  it('legacy tisPreset-only repo resolves via the build preset (fast → 1/2)', () => {
    const repos = [repo({ tisPreset: 'fast' })];
    expect(resolveBuildThresholds('acme/widgets', repos, 4, 6)).toEqual({ warnHours: 1, dangerHours: 2 });
  });

  it('buildTisPreset wins over a stale legacy tisPreset', () => {
    const repos = [repo({ tisPreset: 'fast', buildTisPreset: 'long-running' })];
    expect(resolveBuildThresholds('acme/widgets', repos, 4, 6)).toEqual({ warnHours: 12, dangerHours: 24 });
  });

  it('match is case-insensitive on owner/repo', () => {
    const repos = [repo({ buildTisPreset: 'fast' })];
    expect(resolveBuildThresholds('ACME/Widgets', repos, 4, 6)).toEqual({ warnHours: 1, dangerHours: 2 });
  });

  it('resolveTisThresholds shim delegates to the build resolver', () => {
    const repos = [repo({ buildTisPreset: 'long-running' })];
    expect(resolveTisThresholds('acme/widgets', repos, 4, 6)).toEqual(
      resolveBuildThresholds('acme/widgets', repos, 4, 6)
    );
  });
});

describe('resolveReviewThresholds (days-scale, independent of the build preset)', () => {
  function repo(over: Partial<MonitoredRepo>): MonitoredRepo {
    return {
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
      active: true,
      createdAt: 1,
      ...over,
    } as MonitoredRepo;
  }

  it('unknown repo falls back to the passed global DAYS', () => {
    expect(resolveReviewThresholds('nobody/here', [], 3, 5)).toEqual({ warnDays: 3, dangerDays: 5 });
  });

  it('a repo with no reviewTisPreset resolves to the default Standard (3/5)', () => {
    const repos = [repo({ buildTisPreset: 'fast' })]; // build preset must NOT leak into review
    expect(resolveReviewThresholds('acme/widgets', repos, 99, 99)).toEqual({ warnDays: 3, dangerDays: 5 });
  });

  it("a repo's reviewTisPreset overrides (long-running → 7/14 days)", () => {
    const repos = [repo({ reviewTisPreset: 'long-running' })];
    expect(resolveReviewThresholds('acme/widgets', repos, 3, 5)).toEqual({ warnDays: 7, dangerDays: 14 });
  });
});

describe('extractWorkItem', () => {
  it('extracts leading @W-####### from title', () => {
    expect(extractWorkItem('@W-23444006: Reconcile web-SDK module config')).toBe('W-23444006');
  });

  it('extracts bare W-####### at start of title', () => {
    expect(extractWorkItem('W-12345678 Add feature')).toBe('W-12345678');
  });

  it('normalizes to uppercase', () => {
    expect(extractWorkItem('@w-99999999: Fix bug')).toBe('W-99999999');
    expect(extractWorkItem('w-88888888 Update docs')).toBe('W-88888888');
  });

  it('matches W-####### mid-title when preceded by space', () => {
    expect(extractWorkItem('Fix for @W-11111111 issue')).toBe('W-11111111');
  });

  it('returns undefined when no W-####### present', () => {
    expect(extractWorkItem('Reconcile web-SDK module config')).toBeUndefined();
    expect(extractWorkItem('Add feature')).toBeUndefined();
  });

  it('returns undefined for empty or whitespace-only titles', () => {
    expect(extractWorkItem('')).toBeUndefined();
    expect(extractWorkItem('   ')).toBeUndefined();
  });

  it('returns undefined for malformed W- patterns', () => {
    expect(extractWorkItem('W- no number')).toBeUndefined();
    expect(extractWorkItem('W-abc not digits')).toBeUndefined();
  });

  it('extracts the FIRST W-####### when multiple present', () => {
    expect(extractWorkItem('@W-11111111 and W-22222222')).toBe('W-11111111');
  });

  it('ignores W-####### embedded in a word (no preceding space or @)', () => {
    // Regex is (?:^|@)(W-\d+) — requires start-of-string or @ before W-
    // So "fooW-12345678" should NOT match (no space before W- at word-boundary).
    // But the current regex DOES match mid-word if preceded by space.
    // Actually the regex /(?:^|@)(W-\d+)/i means: start-of-string OR @, then W-digits.
    // It does NOT have a word-boundary anchor, so "fooW-12345678" would NOT match
    // because the 'W' isn't at start or after @. Let's confirm expected behavior:
    expect(extractWorkItem('fooW-12345678')).toBeUndefined();
  });

  it('handles titles with only @W-####### (no description)', () => {
    expect(extractWorkItem('@W-99999999')).toBe('W-99999999');
    expect(extractWorkItem('W-88888888')).toBe('W-88888888');
  });
});
