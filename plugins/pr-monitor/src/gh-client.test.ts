/**
 * Unit tests for PR Monitor's gh CLI wrappers.
 *
 * Tests the parsing, error-handling, and graceful degradation logic in
 * `gh-client.ts` — JSON extraction from partial/malformed output, handling
 * non-zero exit codes, and the empty-result contract that lets polling
 * continue when gh fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchChecks,
  fetchMergeState,
  ghApi,
  getAuthHosts,
  invalidateAuthHosts,
  parseAuthStatus,
  apiBaseUrlForHost,
  reduceReviewers,
  listAllRepos,
  listReposAllHosts,
  REPOS_PAGES_PER_BATCH,
  REPOS_PAGE_WINDOW,
  isSafeRepoArg,
} from '../lib/gh-client.js';
import type { PrMonitorContext, ExecResult } from '../lib/context.js';

/** Build a minimal PrMonitorContext stub with a mock exec broker. */
function makeCtx(execImpl: (args: { bin: string; args: string[] }) => Promise<ExecResult>): PrMonitorContext {
  return {
    moduleId: 'pr-monitor',
    exec: execImpl as PrMonitorContext['exec'],
    log: vi.fn(),
    storage: { get: vi.fn(), set: vi.fn() },
    cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  };
}

describe('fetchChecks', () => {
  it('parses valid JSON output', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: JSON.stringify([
        { name: 'Build', state: 'SUCCESS', bucket: 'pass' },
        { name: 'Tests', state: 'FAILURE', bucket: 'fail' },
      ]),
      stderr: '',
    }));
    const checks = await fetchChecks(ctx, 'https://github.com/owner/repo/pull/42');
    expect(checks).toEqual([
      { name: 'Build', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Tests', state: 'FAILURE', bucket: 'fail' },
    ]);
  });

  it('handles gh warnings before JSON (auth refresh)', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: `Notice: authentication token was refreshed\n[{"name":"Build","state":"SUCCESS","bucket":"pass"}]`,
      stderr: '',
    }));
    const checks = await fetchChecks(ctx, 'https://github.com/owner/repo/pull/42');
    expect(checks).toEqual([{ name: 'Build', state: 'SUCCESS', bucket: 'pass' }]);
  });

  it('returns empty array on malformed JSON', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: '{this is not valid json',
      stderr: '',
    }));
    const checks = await fetchChecks(ctx, 'https://github.com/owner/repo/pull/42');
    expect(checks).toEqual([]);
  });

  it('returns empty array when stdout is empty', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: '',
      stderr: '',
    }));
    const checks = await fetchChecks(ctx, 'https://github.com/owner/repo/pull/42');
    expect(checks).toEqual([]);
  });

  it('returns empty array on non-zero exit (expected for failing checks)', async () => {
    const ctx = makeCtx(async () => ({
      code: 1,
      stdout: JSON.stringify([{ name: 'Tests', state: 'FAILURE', bucket: 'fail' }]),
      stderr: 'some checks failed',
    }));
    // gh pr checks exits non-zero when checks fail — we still parse output.
    const checks = await fetchChecks(ctx, 'https://github.com/owner/repo/pull/42');
    expect(checks).toEqual([{ name: 'Tests', state: 'FAILURE', bucket: 'fail' }]);
  });

  it('returns empty array when exec throws (spawn failure)', async () => {
    const ctx = makeCtx(async () => {
      throw new Error('spawn ENOENT');
    });
    const checks = await fetchChecks(ctx, 'https://github.com/owner/repo/pull/42');
    expect(checks).toEqual([]);
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('spawn ENOENT'));
  });

  it('returns empty array when ctx.exec is undefined', async () => {
    const ctx: PrMonitorContext = {
      moduleId: 'pr-monitor',
      exec: undefined,
      log: vi.fn(),
      storage: { get: vi.fn(), set: vi.fn() },
      cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    };
    const checks = await fetchChecks(ctx, 'https://github.com/owner/repo/pull/42');
    expect(checks).toEqual([]);
  });

  it('filters out non-object entries in the array', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: JSON.stringify([
        { name: 'Build', state: 'SUCCESS', bucket: 'pass' },
        null,
        'invalid',
        { name: 'Tests', state: 'FAILURE', bucket: 'fail' },
      ]),
      stderr: '',
    }));
    const checks = await fetchChecks(ctx, 'https://github.com/owner/repo/pull/42');
    expect(checks).toEqual([
      { name: 'Build', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Tests', state: 'FAILURE', bucket: 'fail' },
    ]);
  });

  it('invokes `gh pr checks <url> --json …` WITHOUT --hostname', async () => {
    // Regression: `gh pr checks`/`gh pr view` infer the host from the PR URL and
    // reject `--hostname` ("unknown flag"). We used to pass it, so EVERY fetch
    // failed the flag parse, returned empty, and the poller kept stale data —
    // "refresh runs but never gets latest updates". The host comes from the URL.
    let capturedArgs: string[] = [];
    const ctx = makeCtx(async ({ args }) => {
      capturedArgs = args;
      return { code: 0, stdout: '[]', stderr: '' };
    });
    await fetchChecks(ctx, 'https://gitcore.soma.salesforce.com/org/repo/pull/42');
    // AC-CORE-3.1: argv reordered to place flags before `--`, positionals after
    expect(capturedArgs).toEqual([
      'pr',
      'checks',
      '--json',
      'name,state,bucket',
      '--',
      'https://gitcore.soma.salesforce.com/org/repo/pull/42',
    ]);
    expect(capturedArgs).not.toContain('--hostname');
  });

  it('places end-of-options -- separator before URL positional (AC-CORE-3.1)', async () => {
    // AC-CORE-3.1: insert `--` before positionals so a malicious URL starting with
    // `-` can't be interpreted as a flag. Flags MUST precede `--`, positionals follow.
    let capturedArgs: string[] = [];
    const ctx = makeCtx(async ({ args }) => {
      capturedArgs = args;
      return { code: 0, stdout: '[]', stderr: '' };
    });
    await fetchChecks(ctx, 'https://github.com/owner/repo/pull/42');
    // Expected order: ['pr','checks','--json','fields','--',url]
    const dashIndex = capturedArgs.indexOf('--');
    expect(dashIndex).toBeGreaterThan(-1); // `--` must be present
    const urlIndex = capturedArgs.indexOf('https://github.com/owner/repo/pull/42');
    expect(urlIndex).toBeGreaterThan(dashIndex); // URL after `--`
    // All flags must precede `--`
    const jsonIndex = capturedArgs.indexOf('--json');
    expect(jsonIndex).toBeGreaterThan(-1);
    expect(jsonIndex).toBeLessThan(dashIndex);
  });

  it('defaults missing name/state/bucket fields', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: JSON.stringify([
        { name: 'Build' },
        { state: 'SUCCESS' },
        { bucket: 'pass' },
        {},
      ]),
      stderr: '',
    }));
    const checks = await fetchChecks(ctx, 'https://github.com/owner/repo/pull/42');
    expect(checks).toEqual([
      { name: 'Build', state: '', bucket: undefined },
      { name: 'unknown', state: 'SUCCESS', bucket: undefined },
      { name: 'unknown', state: '', bucket: 'pass' },
      { name: 'unknown', state: '', bucket: undefined },
    ]);
  });
});

describe('fetchMergeState', () => {
  it('parses valid JSON output', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: JSON.stringify({
        state: 'OPEN',
        mergeStateStatus: 'CLEAN',
        mergeable: 'MERGEABLE',
        title: 'Fix bug',
        baseRefName: 'main',
        headRefName: 'feature-branch',
        author: { login: 'testuser', name: 'Test User' },
        isDraft: false,
        body: 'PR description',
        createdAt: '2024-01-15T12:00:00Z',
        updatedAt: '2024-02-20T09:30:00Z',
      }),
      stderr: '',
    }));
    const state = await fetchMergeState(ctx, 'https://github.com/owner/repo/pull/42');
    expect(state.state).toBe('OPEN');
    expect(state.mergeStateStatus).toBe('CLEAN');
    expect(state.mergeable).toBe('MERGEABLE');
    expect(state.title).toBe('Fix bug');
    expect(state.baseRefName).toBe('main');
    expect(state.reviewDecision).toBe('');
    expect(state.headRefName).toBe('feature-branch');
    expect(state.author).toEqual({ login: 'testuser', name: 'Test User' });
    expect(state.isDraft).toBe(false);
    expect(state.body).toBe('PR description');
    expect(state.createdAt).toBeGreaterThan(0); // parsed ISO → epoch ms
    expect(state.updatedAt).toBeGreaterThan(state.createdAt); // updatedAt parsed, later than createdAt
  });

  it('handles warnings before JSON', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: `Token refreshed\n{"state":"MERGED","mergeStateStatus":"MERGED","mergeable":"UNKNOWN","title":"Done","baseRefName":"main"}`,
      stderr: '',
    }));
    const state = await fetchMergeState(ctx, 'https://github.com/owner/repo/pull/42');
    expect(state.state).toBe('MERGED');
  });

  it('returns all-empty-strings on malformed JSON', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: 'not json',
      stderr: '',
    }));
    const state = await fetchMergeState(ctx, 'https://github.com/owner/repo/pull/42');
    expect(state).toEqual({
      state: '',
      mergeStateStatus: '',
      mergeable: '',
      title: '',
      baseRefName: '',
      reviewDecision: '',
      headRefName: '',
      author: null,
      isDraft: false,
      body: '',
      createdAt: 0,
      updatedAt: 0,
      reviewers: [],
    });
  });

  it('returns all-empty-strings on non-zero exit', async () => {
    const ctx = makeCtx(async () => ({
      code: 1,
      stdout: '',
      stderr: 'PR not found',
    }));
    const state = await fetchMergeState(ctx, 'https://github.com/owner/repo/pull/42');
    expect(state).toEqual({
      state: '',
      mergeStateStatus: '',
      mergeable: '',
      title: '',
      baseRefName: '',
      reviewDecision: '',
      headRefName: '',
      author: null,
      isDraft: false,
      body: '',
      createdAt: 0,
      updatedAt: 0,
      reviewers: [],
    });
  });

  it('returns all-empty-strings when exec throws', async () => {
    const ctx = makeCtx(async () => {
      throw new Error('timeout');
    });
    const state = await fetchMergeState(ctx, 'https://github.com/owner/repo/pull/42');
    expect(state).toEqual({
      state: '',
      mergeStateStatus: '',
      mergeable: '',
      title: '',
      baseRefName: '',
      reviewDecision: '',
      headRefName: '',
      author: null,
      isDraft: false,
      body: '',
      createdAt: 0,
      updatedAt: 0,
      reviewers: [],
    });
  });

  it('returns all-empty-strings when ctx.exec is undefined', async () => {
    const ctx: PrMonitorContext = {
      moduleId: 'pr-monitor',
      exec: undefined,
      log: vi.fn(),
      storage: { get: vi.fn(), set: vi.fn() },
      cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    };
    const state = await fetchMergeState(ctx, 'https://github.com/owner/repo/pull/42');
    expect(state).toEqual({
      state: '',
      mergeStateStatus: '',
      mergeable: '',
      title: '',
      baseRefName: '',
      reviewDecision: '',
      headRefName: '',
      author: null,
      isDraft: false,
      body: '',
      createdAt: 0,
      updatedAt: 0,
      reviewers: [],
    });
  });

  it('invokes `gh pr view <url> --json …` WITHOUT --hostname', async () => {
    // Same regression as fetchChecks: `gh pr view` rejects `--hostname`. The
    // host is inferred from the PR URL; passing the flag broke every fetch.
    let capturedArgs: string[] = [];
    const ctx = makeCtx(async ({ args }) => {
      capturedArgs = args;
      return { code: 0, stdout: '{}', stderr: '' };
    });
    await fetchMergeState(ctx, 'https://gitcore.soma.salesforce.com/org/repo/pull/42');
    // AC-CORE-3.1: argv reordered to place flags before `--`, positionals after
    expect(capturedArgs).toEqual([
      'pr',
      'view',
      '--json',
      'state,mergeStateStatus,mergeable,reviewDecision,title,baseRefName,headRefName,author,isDraft,body,createdAt,updatedAt,reviews,reviewRequests',
      '--',
      'https://gitcore.soma.salesforce.com/org/repo/pull/42',
    ]);
    expect(capturedArgs).not.toContain('--hostname');
  });

  it('places end-of-options -- separator before URL positional (AC-CORE-3.1)', async () => {
    // AC-CORE-3.1: insert `--` before positionals so a malicious URL starting with
    // `-` can't be interpreted as a flag. Flags MUST precede `--`, positionals follow.
    let capturedArgs: string[] = [];
    const ctx = makeCtx(async ({ args }) => {
      capturedArgs = args;
      return { code: 0, stdout: '{}', stderr: '' };
    });
    await fetchMergeState(ctx, 'https://github.com/owner/repo/pull/42');
    const dashIndex = capturedArgs.indexOf('--');
    expect(dashIndex).toBeGreaterThan(-1); // `--` must be present
    const urlIndex = capturedArgs.indexOf('https://github.com/owner/repo/pull/42');
    expect(urlIndex).toBeGreaterThan(dashIndex); // URL after `--`
    // All --json and its value must precede `--`
    const jsonIndex = capturedArgs.indexOf('--json');
    expect(jsonIndex).toBeGreaterThan(-1);
    expect(jsonIndex).toBeLessThan(dashIndex);
  });

  it('defaults missing fields to empty strings', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: JSON.stringify({ state: 'OPEN', title: 'Foo' }),
      stderr: '',
    }));
    const state = await fetchMergeState(ctx, 'https://github.com/owner/repo/pull/42');
    expect(state).toEqual({
      state: 'OPEN',
      mergeStateStatus: '',
      mergeable: '',
      title: 'Foo',
      baseRefName: '',
      reviewDecision: '',
      headRefName: '',
      author: null,
      isDraft: false,
      body: '',
      createdAt: 0,
      updatedAt: 0,
      reviewers: [],
    });
  });

  it('coerces non-string fields to empty strings', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: JSON.stringify({ state: 123, mergeStateStatus: null, mergeable: undefined, title: true }),
      stderr: '',
    }));
    const state = await fetchMergeState(ctx, 'https://github.com/owner/repo/pull/42');
    expect(state).toEqual({
      state: '',
      mergeStateStatus: '',
      mergeable: '',
      title: '',
      baseRefName: '',
      reviewDecision: '',
      headRefName: '',
      author: null,
      isDraft: false,
      body: '',
      createdAt: 0,
      updatedAt: 0,
      reviewers: [],
    });
  });
});

describe('reduceReviewers (R-LIST-016 / AC-LIST-16.1)', () => {
  it('maps APPROVED and CHANGES_REQUESTED to their buckets, ignores COMMENTED/DISMISSED/PENDING', () => {
    const out = reduceReviewers(
      [
        { author: { login: 'alice', name: 'Alice' }, state: 'APPROVED' },
        { author: { login: 'bob' }, state: 'CHANGES_REQUESTED' },
        { author: { login: 'carol' }, state: 'COMMENTED' },
        { author: { login: 'dave' }, state: 'DISMISSED' },
        { author: { login: 'erin' }, state: 'PENDING' },
      ],
      []
    );
    expect(out).toEqual([
      { login: 'alice', name: 'Alice', state: 'approved' },
      { login: 'bob', state: 'changes-requested' },
    ]);
  });

  it("keeps each login's LATEST decisive review (chronological overwrite)", () => {
    const out = reduceReviewers(
      [
        { author: { login: 'alice' }, state: 'CHANGES_REQUESTED' },
        { author: { login: 'alice' }, state: 'APPROVED' },
      ],
      []
    );
    expect(out).toEqual([{ login: 'alice', state: 'approved' }]);
  });

  it('adds review-requested reviewers with no prior decisive review', () => {
    const out = reduceReviewers([], [{ login: 'alice', name: 'Alice' }]);
    expect(out).toEqual([{ login: 'alice', name: 'Alice', state: 'review-requested' }]);
  });

  it('an outstanding request supersedes a stale APPROVED', () => {
    const out = reduceReviewers(
      [{ author: { login: 'alice' }, state: 'APPROVED' }],
      [{ login: 'alice' }]
    );
    expect(out).toEqual([{ login: 'alice', state: 'review-requested' }]);
  });

  it('a request does NOT override a CHANGES_REQUESTED (author still owes a fix)', () => {
    const out = reduceReviewers(
      [{ author: { login: 'alice' }, state: 'CHANGES_REQUESTED' }],
      [{ login: 'alice' }]
    );
    expect(out).toEqual([{ login: 'alice', state: 'changes-requested' }]);
  });

  it('drops reviews/requests with no login (e.g. team requests)', () => {
    const out = reduceReviewers(
      [{ author: {}, state: 'APPROVED' }, { state: 'CHANGES_REQUESTED' }],
      [{ name: 'Some Team' }]
    );
    expect(out).toEqual([]);
  });
});

describe('ghApi', () => {
  it('parses valid JSON output', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: JSON.stringify({ user: { login: 'alice' } }),
      stderr: '',
    }));
    const data = await ghApi(ctx, 'github.com', 'user');
    expect(data).toEqual({ user: { login: 'alice' } });
  });

  it('handles warnings before JSON', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: `Warning: rate limit\n[{"id":1}]`,
      stderr: '',
    }));
    const data = await ghApi(ctx, 'github.com', 'repos/owner/repo/issues');
    expect(data).toEqual([{ id: 1 }]);
  });

  it('returns null on malformed JSON', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: 'not json',
      stderr: '',
    }));
    const data = await ghApi(ctx, 'github.com', 'user');
    expect(data).toBeNull();
  });

  it('returns null on non-zero exit', async () => {
    const ctx = makeCtx(async () => ({
      code: 1,
      stdout: '',
      stderr: 'Not found',
    }));
    const data = await ghApi(ctx, 'github.com', 'repos/owner/nonexistent');
    expect(data).toBeNull();
  });

  it('returns null when exec throws', async () => {
    const ctx = makeCtx(async () => {
      throw new Error('spawn failed');
    });
    const data = await ghApi(ctx, 'github.com', 'user');
    expect(data).toBeNull();
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('spawn failed'));
  });

  it('returns null when ctx.exec is undefined', async () => {
    const ctx: PrMonitorContext = {
      moduleId: 'pr-monitor',
      exec: undefined,
      log: vi.fn(),
      storage: { get: vi.fn(), set: vi.fn() },
      cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    };
    const data = await ghApi(ctx, 'github.com', 'user');
    expect(data).toBeNull();
  });

  it('correctly constructs gh api arguments', async () => {
    let capturedArgs: string[] = [];
    const ctx = makeCtx(async ({ args }) => {
      capturedArgs = args;
      return { code: 0, stdout: '{}', stderr: '' };
    });
    await ghApi(ctx, 'gitcore.soma.salesforce.com', 'repos/org/repo/pulls/42/comments');
    // AC-CORE-3.1: argv reordered to place flags before `--`, positionals after
    expect(capturedArgs).toEqual(['api', '--hostname', 'gitcore.soma.salesforce.com', '--', 'repos/org/repo/pulls/42/comments']);
  });

  it('places end-of-options -- separator before path positional (AC-CORE-3.1)', async () => {
    // AC-CORE-3.1: insert `--` before positionals so a malicious path starting
    // with `-` can't be interpreted as a flag. Flags MUST precede `--`, positionals follow.
    let capturedArgs: string[] = [];
    const ctx = makeCtx(async ({ args }) => {
      capturedArgs = args;
      return { code: 0, stdout: '{}', stderr: '' };
    });
    await ghApi(ctx, 'github.com', 'user');
    const dashIndex = capturedArgs.indexOf('--');
    expect(dashIndex).toBeGreaterThan(-1); // `--` must be present
    const pathIndex = capturedArgs.indexOf('user');
    expect(pathIndex).toBeGreaterThan(dashIndex); // path after `--`
    // --hostname and its value must precede `--`
    const hostnameIndex = capturedArgs.indexOf('--hostname');
    expect(hostnameIndex).toBeGreaterThan(-1);
    expect(hostnameIndex).toBeLessThan(dashIndex);
  });
});

describe('apiBaseUrlForHost', () => {
  it('uses the api. subdomain for public github.com', () => {
    expect(apiBaseUrlForHost('github.com')).toBe('https://api.github.com');
  });

  it('uses /api/v3 for GitHub Enterprise hosts', () => {
    expect(apiBaseUrlForHost('gitcore.soma.salesforce.com')).toBe(
      'https://gitcore.soma.salesforce.com/api/v3'
    );
    expect(apiBaseUrlForHost('git.soma.salesforce.com')).toBe(
      'https://git.soma.salesforce.com/api/v3'
    );
  });
});

describe('parseAuthStatus', () => {
  // Real `gh auth status` output captured from a machine authed to two GHE hosts.
  const TWO_HOSTS = `git.soma.salesforce.com
  ✓ Logged in to git.soma.salesforce.com account geoffrey-baker (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'user', 'workflow'

gitcore.soma.salesforce.com
  ✓ Logged in to gitcore.soma.salesforce.com account geoffrey-baker (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'user', 'workflow'`;

  it('parses each authenticated host into an account', () => {
    const accounts = parseAuthStatus(TWO_HOSTS);
    expect(accounts).toEqual([
      {
        host: 'git.soma.salesforce.com',
        login: 'geoffrey-baker',
        apiBaseUrl: 'https://git.soma.salesforce.com/api/v3',
        active: true,
      },
      {
        host: 'gitcore.soma.salesforce.com',
        login: 'geoffrey-baker',
        apiBaseUrl: 'https://gitcore.soma.salesforce.com/api/v3',
        active: true,
      },
    ]);
  });

  it('parses public github.com with the api. base url', () => {
    const text = `github.com
  ✓ Logged in to github.com account octocat (oauth_token)
  - Active account: true`;
    expect(parseAuthStatus(text)).toEqual([
      {
        host: 'github.com',
        login: 'octocat',
        apiBaseUrl: 'https://api.github.com',
        active: true,
      },
    ]);
  });

  it('marks a non-active account active:false', () => {
    const text = `github.com
  ✓ Logged in to github.com account octocat (keyring)
  - Active account: false`;
    expect(parseAuthStatus(text)[0].active).toBe(false);
  });

  it('handles multiple accounts on one host (keeps the last login parsed)', () => {
    // gh can list two accounts under one host; we surface one account row per
    // host and keep the last-seen login. Active flips true if any is active.
    const text = `github.com
  ✓ Logged in to github.com account alice (keyring)
  - Active account: false
  ✓ Logged in to github.com account bob (keyring)
  - Active account: true`;
    const accounts = parseAuthStatus(text);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].login).toBe('bob');
    expect(accounts[0].active).toBe(true);
  });

  it('returns [] for empty or not-logged-in output', () => {
    expect(parseAuthStatus('')).toEqual([]);
    expect(parseAuthStatus('You are not logged into any GitHub hosts.')).toEqual([]);
  });
});

describe('getAuthHosts', () => {
  // getAuthHosts memoizes for 60s; each case installs its own gh stub, so clear
  // the cache first or a later case reads the previous case's accounts.
  beforeEach(() => {
    invalidateAuthHosts();
  });

  it('parses accounts from a successful gh auth status', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: `github.com
  ✓ Logged in to github.com account octocat (oauth_token)
  - Active account: true`,
      stderr: '',
    }));
    const accounts = await getAuthHosts(ctx);
    expect(accounts).toEqual([
      {
        host: 'github.com',
        login: 'octocat',
        apiBaseUrl: 'https://api.github.com',
        active: true,
      },
    ]);
  });

  it('reads status from stderr when gh writes there', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: '',
      stderr: `git.soma.salesforce.com
  ✓ Logged in to git.soma.salesforce.com account geoffrey-baker (keyring)
  - Active account: true`,
    }));
    const accounts = await getAuthHosts(ctx);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].host).toBe('git.soma.salesforce.com');
  });

  it('returns [] when gh could not spawn', async () => {
    const ctx = makeCtx(async () => {
      throw new Error('spawn failed');
    });
    expect(await getAuthHosts(ctx)).toEqual([]);
  });

  it('returns [] when ctx.exec is undefined', async () => {
    const ctx: PrMonitorContext = {
      moduleId: 'pr-monitor',
      exec: undefined,
      log: vi.fn(),
      storage: { get: vi.fn(), set: vi.fn() },
      cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    };
    expect(await getAuthHosts(ctx)).toEqual([]);
  });

  it('parses even when gh exits non-zero but printed host blocks', async () => {
    // gh exits non-zero if ANY configured host has an auth problem, yet still
    // prints the healthy hosts — we should still surface those.
    const ctx = makeCtx(async () => ({
      code: 1,
      stdout: `github.com
  ✓ Logged in to github.com account octocat (oauth_token)
  - Active account: true`,
      stderr: 'gitcore.soma.salesforce.com: authentication failed',
    }));
    const accounts = await getAuthHosts(ctx);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].login).toBe('octocat');
  });
});

// ── Browse-all repo pagination (R-REPO-009, CodeNod parity) ───────────────────
// CodeNod walks `user/repos` until GitHub stops returning a rel="next" link; a
// single-page fetch truncates because `sort=full_name` clusters an owner's repos
// (e.g. a360 alone spans 5 pages). listAllRepos walks REPOS_PAGES_PER_BATCH pages
// per call, so the first open covers the whole account for typical sizes.

/** Pull the `page=N` value out of a `gh api ... user/repos?...page=N...` argv. */
function pageOf(args: string[]): number {
  const path = args[args.indexOf('--') + 1] ?? '';
  const m = path.match(/[?&]page=(\d+)/);
  return m ? Number(m[1]) : 1;
}

/** Make a repo row as GitHub's `user/repos` returns it. */
function apiRepo(owner: string, name: string) {
  return { name, owner: { login: owner }, full_name: `${owner}/${name}`, private: false };
}

describe('listAllRepos — walk to exhaustion', () => {
  it('walks pages until a short page and concatenates repos', async () => {
    // 3 full pages then a short page → walk stops at the short page.
    const seen: number[] = [];
    const ctx = makeCtx(async ({ args }) => {
      const page = pageOf(args);
      seen.push(page);
      const rows =
        page <= 3
          ? Array.from({ length: 100 }, (_, i) => apiRepo('a360', `r${page}-${i}`))
          : [apiRepo('a360', 'tail')]; // short page 4
      return { code: 0, stdout: JSON.stringify(rows), stderr: '' };
    });
    const res = await listAllRepos(ctx, 'github.com', 1);
    expect(res.ok).toBe(true);
    expect(res.repos).toHaveLength(301);
    // Pages are fetched in concurrent windows; the walk stops once the short
    // page (4) is consumed. Window 1 covers pages 1..5, so 1..4 are seen.
    expect([...seen].sort((a, b) => a - b)).toContain(4);
    expect(Math.max(...seen)).toBeLessThanOrEqual(REPOS_PAGE_WINDOW);
    // Short page reached → account exhausted.
    expect(res.hasMore).toBe(false);
  });

  it('reports hasMore when the safety cap is hit before exhaustion', async () => {
    const seen: number[] = [];
    const ctx = makeCtx(async ({ args }) => {
      seen.push(pageOf(args));
      const rows = Array.from({ length: 100 }, (_, i) => apiRepo('a360', `r${i}`));
      return { code: 0, stdout: JSON.stringify(rows), stderr: '' };
    });
    const res = await listAllRepos(ctx, 'github.com', 1);
    expect(res.repos).toHaveLength(REPOS_PAGES_PER_BATCH * 100);
    expect(seen).toHaveLength(REPOS_PAGES_PER_BATCH);
    expect(res.hasMore).toBe(true);
    // AC-REPO-9.7: the last owner at the cap is the mid-stream frontier.
    expect(res.incompleteOwner).toBe('a360');
  });

  it('marks the alphabetically-last owner incomplete when the cap is hit', async () => {
    // sort=full_name returns owners contiguously; the frontier owner spills over.
    const ctx = makeCtx(async ({ args }) => {
      const page = pageOf(args);
      // Every page full → cap hit; last page ends on owner 'zed'.
      const owner = page < REPOS_PAGES_PER_BATCH ? 'acme' : 'zed';
      return {
        code: 0,
        stdout: JSON.stringify(Array.from({ length: 100 }, (_, i) => apiRepo(owner, `r${page}-${i}`))),
        stderr: '',
      };
    });
    const res = await listAllRepos(ctx, 'github.com', 1);
    expect(res.hasMore).toBe(true);
    expect(res.incompleteOwner).toBe('zed');
  });

  it('leaves incompleteOwner undefined when the account is exhausted', async () => {
    const ctx = makeCtx(async () => ({
      code: 0,
      stdout: JSON.stringify([apiRepo('a360', 'only')]), // short page → exhausted
      stderr: '',
    }));
    const res = await listAllRepos(ctx, 'github.com', 1);
    expect(res.hasMore).toBe(false);
    expect(res.incompleteOwner).toBeUndefined();
  });

  it('batch 2 continues from the page after the batch-1 cap', async () => {
    const seen: number[] = [];
    const ctx = makeCtx(async ({ args }) => {
      seen.push(pageOf(args));
      return { code: 0, stdout: JSON.stringify([apiRepo('a360', 'only')]), stderr: '' };
    });
    await listAllRepos(ctx, 'github.com', 2);
    // First page of batch 2 = REPOS_PAGES_PER_BATCH + 1; short page stops it there.
    expect(Math.min(...seen)).toBe(REPOS_PAGES_PER_BATCH + 1);
  });

  it('errors only when the very first page fails', async () => {
    const ctx = makeCtx(async () => ({ code: 1, stdout: '', stderr: 'HTTP 500' }));
    const res = await listAllRepos(ctx, 'github.com', 1);
    expect(res.ok).toBe(false);
  });

  it('keeps earlier pages when a later page fails', async () => {
    const ctx = makeCtx(async ({ args }) => {
      const page = pageOf(args);
      if (page === 1) {
        return {
          code: 0,
          stdout: JSON.stringify(Array.from({ length: 100 }, (_, i) => apiRepo('a360', `r${i}`))),
          stderr: '',
        };
      }
      return { code: 1, stdout: '', stderr: 'HTTP 500' }; // page 2 dies
    });
    const res = await listAllRepos(ctx, 'github.com', 1);
    expect(res.ok).toBe(true);
    expect(res.repos).toHaveLength(100);
    // A failed page ends the walk deterministically → treated as exhausted.
    expect(res.hasMore).toBe(false);
  });
});

describe('listReposAllHosts — fan across hosts', () => {
  beforeEach(() => invalidateAuthHosts());

  it('merges + dedupes repos from every authenticated host, sorted by fullName', async () => {
    const ctx = makeCtx(async ({ args }) => {
      if (args[0] === 'auth') {
        return {
          code: 0,
          stdout: `github.com
  ✓ Logged in to github.com account octocat (oauth_token)
  - Active account: true`,
          stderr: '',
        };
      }
      // single short page per host
      return {
        code: 0,
        stdout: JSON.stringify([apiRepo('zeta', 'z'), apiRepo('alpha', 'a')]),
        stderr: '',
      };
    });
    const res = await listReposAllHosts(ctx, 1);
    expect(res.ok).toBe(true);
    expect(res.repos?.map((r) => r.fullName)).toEqual(['alpha/a', 'zeta/z']);
  });

  it('unions each host frontier owner into incompleteOwners (AC-REPO-9.5)', async () => {
    const ctx = makeCtx(async ({ args }) => {
      if (args[0] === 'auth') {
        return {
          code: 0,
          stdout: `github.com
  ✓ Logged in to github.com account octocat (oauth_token)
  - Active account: true`,
          stderr: '',
        };
      }
      // Every page full → hasMore; frontier owner is the last row = 'a360'.
      return {
        code: 0,
        stdout: JSON.stringify(Array.from({ length: 100 }, (_, i) => apiRepo('a360', `r${i}`))),
        stderr: '',
      };
    });
    const res = await listReposAllHosts(ctx, 1);
    expect(res.hasMore).toBe(true);
    expect(res.incompleteOwners).toEqual(['a360']);
  });

  it('returns empty (not error) when no hosts are authenticated', async () => {
    const ctx = makeCtx(async () => ({ code: 1, stdout: '', stderr: 'not logged in' }));
    const res = await listReposAllHosts(ctx, 1);
    expect(res).toEqual({ ok: true, repos: [], hasMore: false, incompleteOwners: [] });
  });
});

describe('isSafeRepoArg', () => {
  it('accepts owner/repo tokens and rejects option injection', () => {
    expect(isSafeRepoArg('acme/widgets')).toBe(true);
    expect(isSafeRepoArg('A.B_c/d-e')).toBe(true);
    expect(isSafeRepoArg('--exploit/repo')).toBe(false);
    expect(isSafeRepoArg('-n/repo')).toBe(false);
    expect(isSafeRepoArg('owner/--flag')).toBe(false);
    expect(isSafeRepoArg('owner/repo;rm')).toBe(false);
    expect(isSafeRepoArg('owner/repo extra')).toBe(false);
    expect(isSafeRepoArg('owner')).toBe(false);
    expect(isSafeRepoArg('')).toBe(false);
    expect(isSafeRepoArg(null)).toBe(false);
  });
});
