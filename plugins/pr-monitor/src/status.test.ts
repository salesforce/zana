/**
 * Unit tests for PR Monitor's status-computation helpers.
 *
 * Tests the pure logic that rolls CI check results, merge state, and landing
 * probes into {@link PrRollupStatus} values. No I/O — every test supplies a
 * structured input and asserts the classifier's verdict.
 */
import { describe, it, expect } from 'vitest';
import {
  computeStatus,
  computeClosedStatus,
  parsePrUrl,
  destBranches,
  SYNC_RE,
  hasSfciJobComment,
  SFCI_JOB_COMMENT_PREFIX,
} from '../lib/status.js';
import type { CheckRun, PrRollupStatus } from '../lib/types.js';
import type { LandingProbe } from '../lib/status.js';

describe('hasSfciJobComment (AC-REPO-17.2)', () => {
  it('true when a tok-gimlet comment begins with the SFCI-job prefix', () => {
    const comments = [
      { author: { login: 'someone' }, body: 'unrelated' },
      { author: { login: 'tok-gimlet' }, body: `${SFCI_JOB_COMMENT_PREFIX} https://jenkins/job/123` },
    ];
    expect(hasSfciJobComment(comments)).toBe(true);
  });

  it('tolerates leading whitespace before the prefix', () => {
    const comments = [{ author: { login: 'tok-gimlet' }, body: `\n  ${SFCI_JOB_COMMENT_PREFIX} url` }];
    expect(hasSfciJobComment(comments)).toBe(true);
  });

  it('matches the REST user.login shape too', () => {
    const comments = [{ user: { login: 'TOK-GIMLET' }, body: `${SFCI_JOB_COMMENT_PREFIX} url` }];
    expect(hasSfciJobComment(comments)).toBe(true);
  });

  it('false when the prefix comment is authored by someone else', () => {
    const comments = [{ author: { login: 'impostor' }, body: `${SFCI_JOB_COMMENT_PREFIX} url` }];
    expect(hasSfciJobComment(comments)).toBe(false);
  });

  it('false when tok-gimlet posts an unrelated comment', () => {
    const comments = [{ author: { login: 'tok-gimlet' }, body: 'Build finished.' }];
    expect(hasSfciJobComment(comments)).toBe(false);
  });

  it('false when the prefix is not at the start of the body', () => {
    const comments = [{ author: { login: 'tok-gimlet' }, body: `FYI: ${SFCI_JOB_COMMENT_PREFIX} url` }];
    expect(hasSfciJobComment(comments)).toBe(false);
  });

  it('false on a non-array / malformed payload', () => {
    expect(hasSfciJobComment(null)).toBe(false);
    expect(hasSfciJobComment(undefined)).toBe(false);
    expect(hasSfciJobComment({})).toBe(false);
    expect(hasSfciJobComment([null, 42, 'x'])).toBe(false);
  });
});

describe('computeStatus', () => {
  it('returns "green" when the PR is merged', () => {
    const result = computeStatus({ state: 'MERGED', mergeStateStatus: 'CLEAN' }, 'MERGEABLE', []);
    expect(result).toBe('green');
  });

  it('returns "green" when all checks pass and merge state is CLEAN', () => {
    const checks: CheckRun[] = [
      { name: 'Build', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Tests', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Lint', state: 'SUCCESS', bucket: 'pass' },
    ];
    const result = computeStatus({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, 'MERGEABLE', checks);
    expect(result).toBe('green');
  });

  it('returns "yellow" when all checks pass but merge state is not CLEAN', () => {
    const checks: CheckRun[] = [
      { name: 'GUS Compliance', state: 'SUCCESS', bucket: 'pass' },
      { name: 'SCM Compliance', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Jenkins', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Build', state: 'SUCCESS', bucket: 'pass' },
      { name: 'CASAM Build', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Unit Tests', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Func Tests', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Static Analysis', state: 'SUCCESS', bucket: 'pass' },
    ];
    const result = computeStatus({ state: 'OPEN', mergeStateStatus: 'BLOCKED' }, 'MERGEABLE', checks);
    expect(result).toBe('yellow');
  });

  it('returns "review-required" when BLOCKED + all checks pass + reviewDecision REVIEW_REQUIRED', () => {
    // Regression: classify() must forward reviewDecision or this branch is dead
    // and every such PR misclassifies as "yellow" (Merge blocked). AC-LIST-12.5
    // rank-4 "Review required" is otherwise unreachable.
    const checks: CheckRun[] = [
      { name: 'Build', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Unit Tests', state: 'SUCCESS', bucket: 'pass' },
    ];
    const result = computeStatus(
      { state: 'OPEN', mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' },
      'MERGEABLE',
      checks
    );
    expect(result).toBe('review-required');
  });

  it('stays "yellow" when BLOCKED + passing but reviewDecision is not REVIEW_REQUIRED', () => {
    const checks: CheckRun[] = [{ name: 'Build', state: 'SUCCESS', bucket: 'pass' }];
    const result = computeStatus(
      { state: 'OPEN', mergeStateStatus: 'BLOCKED', reviewDecision: 'APPROVED' },
      'MERGEABLE',
      checks
    );
    expect(result).toBe('yellow');
  });

  it('returns "conflict" when mergeable is CONFLICTING', () => {
    const checks: CheckRun[] = [{ name: 'Build', state: 'PENDING', bucket: 'pending' }];
    const result = computeStatus({ state: 'OPEN', mergeStateStatus: 'UNSTABLE' }, 'CONFLICTING', checks);
    expect(result).toBe('conflict');
  });

  it('returns "conflict" when mergeStateStatus is DIRTY', () => {
    const checks: CheckRun[] = [{ name: 'Build', state: 'SUCCESS', bucket: 'pass' }];
    const result = computeStatus({ state: 'OPEN', mergeStateStatus: 'DIRTY' }, 'MERGEABLE', checks);
    expect(result).toBe('conflict');
  });

  it('returns "failed" when any check fails', () => {
    const checks: CheckRun[] = [
      { name: 'Build', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Tests', state: 'FAILURE', bucket: 'fail' },
      { name: 'Lint', state: 'SUCCESS', bucket: 'pass' },
    ];
    const result = computeStatus({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, 'MERGEABLE', checks);
    expect(result).toBe('failed');
  });

  it('returns "pending" when some checks are still running', () => {
    const checks: CheckRun[] = [
      { name: 'Build', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Tests', state: 'PENDING', bucket: 'pending' },
    ];
    const result = computeStatus({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, 'MERGEABLE', checks);
    expect(result).toBe('pending');
  });

  it('returns "pending" when no checks have reported yet', () => {
    const result = computeStatus({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, 'MERGEABLE', []);
    expect(result).toBe('pending');
  });

  it('handles neutral/skipped/cancelled statuses as done-ok', () => {
    const checks: CheckRun[] = [
      { name: 'Build', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Optional', state: 'SKIPPED', bucket: 'skipping' },
      { name: 'Cancelled', state: 'CANCELLED', bucket: 'cancel' },
    ];
    const result = computeStatus({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, 'MERGEABLE', checks);
    expect(result).toBe('green');
  });

  it('prioritizes conflict over failed', () => {
    const checks: CheckRun[] = [
      { name: 'Tests', state: 'FAILURE', bucket: 'fail' },
    ];
    const result = computeStatus({ state: 'OPEN', mergeStateStatus: 'DIRTY' }, 'MERGEABLE', checks);
    expect(result).toBe('conflict');
  });

  it('prioritizes failed over pending', () => {
    const checks: CheckRun[] = [
      { name: 'Build', state: 'PENDING', bucket: 'pending' },
      { name: 'Tests', state: 'FAILURE', bucket: 'fail' },
    ];
    const result = computeStatus({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, 'MERGEABLE', checks);
    expect(result).toBe('failed');
  });

  it('normalizes undefined/empty state strings to "pending"', () => {
    const checks: CheckRun[] = [
      { name: 'Build', state: '', bucket: undefined },
      { name: 'Tests', state: undefined as unknown as string },
    ];
    const result = computeStatus({ state: 'OPEN' }, undefined, checks);
    expect(result).toBe('pending');
  });

  it('treats IN_PROGRESS and QUEUED as running states', () => {
    const checks: CheckRun[] = [
      { name: 'Build', state: 'IN_PROGRESS', bucket: 'in_progress' },
      { name: 'Tests', state: 'QUEUED', bucket: 'queued' },
    ];
    const result = computeStatus({ state: 'OPEN', mergeStateStatus: 'CLEAN' }, 'MERGEABLE', checks);
    expect(result).toBe('pending');
  });
});

describe('computeClosedStatus', () => {
  it('returns "closed-merged" when state is MERGED', () => {
    const probe: LandingProbe = { landedSha: '' };
    const result = computeClosedStatus('MERGED', 'MERGED', probe);
    expect(result).toBe('closed-merged');
  });

  it('returns "closed-abandoned" when no landing probe exists', () => {
    const result = computeClosedStatus('CLOSED', 'CLOSED', null);
    expect(result).toBe('closed-abandoned');
  });

  it('returns "closed-abandoned" when probe exists but no landedSha', () => {
    const probe: LandingProbe = { landedSha: '' };
    const result = computeClosedStatus('CLOSED', 'CLOSED', probe);
    expect(result).toBe('closed-abandoned');
  });

  it('returns "integrating" when probe has sha but no finalBranch', () => {
    const probe: LandingProbe = { landedSha: 'abc1234', finalBranch: null };
    const result = computeClosedStatus('CLOSED', 'CLOSED', probe);
    expect(result).toBe('integrating');
  });

  it('returns "closed-merged" when sha is on final branch', () => {
    const probe: LandingProbe = {
      landedSha: 'abc1234',
      finalBranch: 'p4/main',
      finalBranchContainsSha: true,
    };
    const result = computeClosedStatus('CLOSED', 'CLOSED', probe);
    expect(result).toBe('closed-merged');
  });

  it('returns "integrating" when sha is on intermediate branch but not final', () => {
    const probe: LandingProbe = {
      landedSha: 'abc1234',
      finalBranch: 'p4/main',
      finalBranchContainsSha: false,
      intermediateBranch: 'm/main/mirror',
      intermediateBranchContainsSha: true,
    };
    const result = computeClosedStatus('CLOSED', 'CLOSED', probe);
    expect(result).toBe('integrating');
  });

  it('returns "integrating" when sha is not yet on any branch', () => {
    const probe: LandingProbe = {
      landedSha: 'abc1234',
      finalBranch: 'p4/main',
      finalBranchContainsSha: false,
      intermediateBranch: 'm/main/mirror',
      intermediateBranchContainsSha: false,
    };
    const result = computeClosedStatus('CLOSED', 'CLOSED', probe);
    expect(result).toBe('integrating');
  });
});

describe('SYNC_RE (Salesforce workflow detection)', () => {
  it('matches the standard sync comment format', () => {
    const comment = "This PR's accepted change 12345 is being sync'd from Perforce to Git, as commit [abc1234](https://example.com/commit/abc1234).";
    const match = SYNC_RE.exec(comment);
    expect(match).toBeTruthy();
    expect(match![1]).toBe('abc1234');
  });

  it('matches with straight apostrophe', () => {
    const comment = "sync'd from Perforce to Git, as commit [abc1234](...)";
    const match = SYNC_RE.exec(comment);
    expect(match).toBeTruthy();
    expect(match![1]).toBe('abc1234');
  });

  it('matches with curly apostrophe (U+2019)', () => {
    // Real curly apostrophe (’), not the straight ASCII one — GitHub's
    // Markdown renderer smart-quotes it in some contexts. Regression guard for
    // the SYNC_RE '['’]?' class (a straight-only '?' silently failed here).
    const comment = 'sync’d from Perforce to Git, as commit [abc1234](...)';
    expect(comment).toContain('’');
    const match = SYNC_RE.exec(comment);
    expect(match).toBeTruthy();
    expect(match![1]).toBe('abc1234');
  });

  it('matches without markdown link brackets', () => {
    const comment = "sync'd from Perforce to Git, as commit abc1234567890";
    const match = SYNC_RE.exec(comment);
    expect(match).toBeTruthy();
    expect(match![1]).toBe('abc1234567890');
  });

  it('captures 7-40 character hex SHAs', () => {
    const short = "sync'd from Perforce to Git, as commit [abc1234](...)";
    const long = "sync'd from Perforce to Git, as commit [abcdef1234567890abcdef1234567890abcdef12](...)";
    expect(SYNC_RE.exec(short)![1]).toBe('abc1234');
    expect(SYNC_RE.exec(long)![1]).toBe('abcdef1234567890abcdef1234567890abcdef12');
  });

  it('is case-insensitive', () => {
    const comment = "SYNC'D FROM PERFORCE TO GIT, AS COMMIT [ABC1234](...)";
    const match = SYNC_RE.exec(comment);
    expect(match).toBeTruthy();
    expect(match![1].toLowerCase()).toBe('abc1234');
  });

  it('does not match unrelated comments', () => {
    const comment = "This PR looks good to me, merging now.";
    const match = SYNC_RE.exec(comment);
    expect(match).toBeNull();
  });
});

describe('parsePrUrl', () => {
  it('parses a gitcore URL', () => {
    const url = 'https://gitcore.soma.salesforce.com/core-2206/core-262-public/pull/109504';
    const parsed = parsePrUrl(url);
    expect(parsed).toEqual({
      host: 'gitcore.soma.salesforce.com',
      owner: 'core-2206',
      repo: 'core-262-public',
      number: '109504',
    });
  });

  it('parses a github.com URL', () => {
    const url = 'https://github.com/owner/repo/pull/42';
    const parsed = parsePrUrl(url);
    expect(parsed).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      number: '42',
    });
  });

  it('parses http:// URLs', () => {
    const url = 'http://github.com/owner/repo/pull/99';
    const parsed = parsePrUrl(url);
    expect(parsed).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      number: '99',
    });
  });

  it('returns null for non-PR URLs', () => {
    expect(parsePrUrl('https://github.com/owner/repo')).toBeNull();
    expect(parsePrUrl('https://github.com/owner/repo/issues/42')).toBeNull();
    expect(parsePrUrl('not a url')).toBeNull();
    expect(parsePrUrl('')).toBeNull();
  });

  it('handles trailing slashes and fragments', () => {
    const url = 'https://github.com/owner/repo/pull/42/';
    const parsed = parsePrUrl(url);
    expect(parsed?.number).toBe('42');
  });
});

describe('destBranches', () => {
  it('returns final branch for p4/ base', () => {
    const result = destBranches('p4/main');
    expect(result).toEqual({ final: 'p4/main', intermediate: null });
  });

  it('returns final + intermediate for m/ base', () => {
    const result = destBranches('m/main/mirror');
    expect(result).toEqual({ final: 'p4/mirror', intermediate: 'm/main/mirror' });
  });

  it('handles m/ base with nested slashes', () => {
    const result = destBranches('m/foo/bar/baz');
    expect(result).toEqual({ final: 'p4/baz', intermediate: 'm/foo/bar/baz' });
  });

  it('returns nulls for non-workflow branches', () => {
    expect(destBranches('main')).toEqual({ final: null, intermediate: null });
    expect(destBranches('develop')).toEqual({ final: null, intermediate: null });
    expect(destBranches('feature/foo')).toEqual({ final: null, intermediate: null });
  });

  it('handles undefined and empty strings', () => {
    expect(destBranches(undefined)).toEqual({ final: null, intermediate: null });
    expect(destBranches('')).toEqual({ final: null, intermediate: null });
    expect(destBranches('   ')).toEqual({ final: null, intermediate: null });
  });

  it('strips trailing slashes', () => {
    const result = destBranches('m/main/mirror/');
    expect(result).toEqual({ final: 'p4/mirror', intermediate: 'm/main/mirror/' });
  });
});
