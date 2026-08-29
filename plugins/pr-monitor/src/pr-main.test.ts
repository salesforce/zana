/**
 * Unit tests for pr-main.ts — the main-process PR monitor core.
 *
 * **Risk #1 regression:** refreshOne rebuilds the MonitoredPr object each poll;
 * any field not explicitly copied is WIPED. This suite guards against field-drop
 * regressions (projectId once wiped, Phase 1 adds many new fields).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrMonitorContext } from '../lib/context.js';
import type { MonitoredPr } from '../lib/types.js';
import prMonitorMainModule, { addPrByUrl } from '../lib/pr-main.js';

// Mock fetchMergeState + fetchChecks to return controlled data
vi.mock('../lib/gh-client.js', () => ({
  fetchMergeState: vi.fn(async (_ctx, _url) => ({
    state: 'OPEN',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    title: 'Test PR',
    baseRefName: 'main',
    reviewDecision: 'APPROVED',
    headRefName: 'feature-branch',
    author: { login: 'testuser', name: 'Test User', avatarUrl: 'https://github.com/testuser.png' },
    isDraft: false,
    body: 'PR body text',
    createdAt: 1700000000000,
  })),
  fetchChecks: vi.fn(async () => [
    { name: 'CI', state: 'SUCCESS', bucket: 'pass' },
  ]),
  ghApi: vi.fn(async () => null),
  // The R-REPO-012 sync-pass gate consults gh auth via connectionByHost; supply a
  // connected github.com account so untracked seeds still refresh in these tests.
  getAuthHosts: vi.fn(async () => [
    { host: 'github.com', login: 'testuser', apiBaseUrl: 'https://api.github.com', active: true },
  ]),
  getAuthUser: vi.fn(async () => ({ login: 'testuser', name: 'Test User' })),
  // pollAll runs author-driven discovery (R-CORE-001); these tests seed their own
  // PRs and want discovery to be a no-op, so searchPrs returns nothing.
  searchPrs: vi.fn(async () => ({ ok: true, prs: [] })),
  // Real-ish guard: owner/repo shape only (mirrors gh-client.isSafeRepoArg).
  isSafeRepoArg: (v: unknown): v is string => typeof v === 'string' && /^[\w.-]+\/[\w.-]+$/.test(v),
}));

// Mock status.js classifier
vi.mock('../lib/status.js', () => ({
  computeStatus: vi.fn(() => 'green'),
  computeClosedStatus: vi.fn(() => 'closed-merged'),
  destBranches: vi.fn(() => ({ final: null, intermediate: null })),
  parsePrUrl: vi.fn(() => ({ host: 'github.com', owner: 'test', repo: 'repo', number: 42 })),
  hasSfciJobComment: vi.fn(() => false),
  SYNC_RE: /SYNC: ([0-9a-f]+)/,
}));

describe('pr-main refreshOne regression (Risk #1)', () => {
  let ctx: PrMonitorContext;
  let storage: Map<string, unknown>;

  beforeEach(() => {
    storage = new Map();
    ctx = {
      log: vi.fn(),
      exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
      storage: {
        get: vi.fn((key: string) => storage.get(key)),
        set: vi.fn((key: string, val: unknown) => storage.set(key, val)),
      },
    };
  });

  it('preserves ALL Phase 1 fields + projectId + lastSeenAt + source + discoveredVia on poll', async () => {
    const module = prMonitorMainModule.setup(ctx);
    const url = 'https://github.com/test/repo/pull/42';
    const now = Date.now();

    // Seed storage with a PR that has ALL fields populated (Phase 1 + existing)
    const seed: MonitoredPr = {
      url,
      repo: 'test/repo',
      number: 42,
      title: '@W-12345678: Seed PR',
      baseRefName: 'main',
      status: 'green',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checks: [{ name: 'Old CI', state: 'SUCCESS', bucket: 'pass' }],
      addedAt: now - 10000,
      lastChecked: now - 5000,
      lastStatusChange: now - 2000,
      projectId: 'proj-123',
      lastSeenAt: now - 1000,
      // Phase 1 fields
      headRefName: 'feature-old',
      author: { login: 'olduser', name: 'Old User', avatarUrl: 'https://github.com/olduser.png' },
      isDraft: true,
      body: 'Old body',
      createdAt: now - 100000,
      workItem: 'W-12345678',
      source: 'auto',
      discoveredVia: 'author:olduser',
    };
    storage.set('prs', { [url]: seed });

    // Poll (which calls refreshOne internally)
    const result = await module.pollAll();
    expect(result.ok).toBe(true);
    expect(result.prs).toHaveLength(1);

    const refreshed = result.prs![0];
    // Core fields
    expect(refreshed.url).toBe(url);
    expect(refreshed.repo).toBe('test/repo');
    expect(refreshed.number).toBe(42);
    expect(refreshed.addedAt).toBe(seed.addedAt);
    // Preserved existing optional fields
    expect(refreshed.projectId).toBe('proj-123');
    expect(refreshed.lastSeenAt).toBe(seed.lastSeenAt);
    // Preserved Phase 1 fields (should carry forward from seed; gh mock returns different values but refreshOne prefers fresh OR prev)
    expect(refreshed.headRefName).toBeDefined(); // either fresh or prev
    expect(refreshed.author).toBeDefined();
    expect(refreshed.isDraft).toBeDefined();
    expect(refreshed.body).toBeDefined();
    expect(refreshed.createdAt).toBeDefined();
    // workItem re-derives from FRESH title (mock returns "Test PR" with no W-#)
    expect(refreshed.workItem).toBeUndefined();
    expect(refreshed.source).toBe('auto');
    expect(refreshed.discoveredVia).toBe('author:olduser');
  });

  it('initializes new fields in addPrByUrl for manually-added PRs', async () => {
    prMonitorMainModule.setup(ctx);
    const url = 'https://github.com/test/repo/pull/99';

    // addPrByUrl is the shared fetch/persist path behind pullPr (AC-LIST-3.4).
    const result = await addPrByUrl(ctx, url);
    expect(result.ok).toBe(true);
    expect(result.prs).toHaveLength(1);

    const pr = result.prs![0];
    // Phase 1 fields should be populated from fetchMergeState
    expect(pr.headRefName).toBe('feature-branch');
    expect(pr.author).toEqual({ login: 'testuser', name: 'Test User', avatarUrl: 'https://github.com/testuser.png' });
    expect(pr.isDraft).toBe(false);
    expect(pr.body).toBe('PR body text');
    expect(pr.createdAt).toBe(1700000000000);
    expect(pr.workItem).toBeUndefined(); // "Test PR" has no W-#######
    expect(pr.source).toBe('manual'); // addPr sets 'manual'
    expect(pr.discoveredVia).toBeUndefined();
  });

  it('extractWorkItem derives workItem in addPrByUrl', async () => {
    const { fetchMergeState } = await import('../lib/gh-client.js');
    vi.mocked(fetchMergeState).mockResolvedValueOnce({
      state: 'OPEN',
      mergeStateStatus: 'CLEAN',
      mergeable: 'MERGEABLE',
      title: '@W-99999999: Has work item',
      baseRefName: 'main',
      reviewDecision: 'APPROVED',
      headRefName: 'fix-branch',
      author: { login: 'dev', name: 'Developer' },
      isDraft: false,
      body: '',
      createdAt: Date.now(),
    });

    prMonitorMainModule.setup(ctx);
    const url = 'https://github.com/test/repo/pull/88';
    const result = await addPrByUrl(ctx, url);
    expect(result.ok).toBe(true);
    const pr = result.prs![0];
    expect(pr.workItem).toBe('W-99999999');
  });

  it('preserves status + merge fields when fetchMergeState fails (Bug A — false-BLOCKED)', async () => {
    // Bug A: transient gh fail → fetchMergeState returns all-empty → classify with
    // empty mergeStateStatus → 'yellow' → false "Merge blocked" on green PR.
    // Fix: when merge.state empty, skip reclassify and preserve prev.
    const { fetchMergeState } = await import('../lib/gh-client.js');
    const module = prMonitorMainModule.setup(ctx);
    const url = 'https://github.com/test/repo/pull/77';
    const now = Date.now();

    const seed: MonitoredPr = {
      url,
      repo: 'test/repo',
      number: 77,
      title: 'Stable PR',
      baseRefName: 'main',
      status: 'green',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checks: [{ name: 'CI', state: 'SUCCESS', bucket: 'pass' }],
      addedAt: now - 5000,
      lastChecked: now - 1000,
      lastStatusChange: now - 2000,
    };
    storage.set('prs', { [url]: seed });

    // Mock fetchMergeState to return empty (gh fail)
    vi.mocked(fetchMergeState).mockResolvedValueOnce({
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
    });

    const result = await module.pollAll();
    expect(result.ok).toBe(true);
    expect(result.prs).toHaveLength(1);

    const refreshed = result.prs![0];
    // Status + merge fields preserved
    expect(refreshed.status).toBe('green'); // NOT 'yellow'
    expect(refreshed.mergeStateStatus).toBe('CLEAN'); // NOT ''
    expect(refreshed.mergeable).toBe('MERGEABLE');
    expect(refreshed.title).toBe('Stable PR');
    expect(refreshed.baseRefName).toBe('main');
    // No false delta
    expect(result.deltas).toEqual([]);
  });

  it('carries forward Phase 1 fields when gh mock returns empty (strengthen #1)', async () => {
    // Test #1 was too weak — gh mock returned fresh values, so merge.x||prev.x
    // picked fresh and prev-fallback path never exercised. Mock EMPTY fields to
    // force true carry-forward.
    const { fetchMergeState } = await import('../lib/gh-client.js');
    const module = prMonitorMainModule.setup(ctx);
    const url = 'https://github.com/test/repo/pull/66';
    const now = Date.now();

    const seed: MonitoredPr = {
      url,
      repo: 'test/repo',
      number: 66,
      title: 'Carry test',
      baseRefName: 'main',
      status: 'green',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checks: [{ name: 'Build', state: 'SUCCESS', bucket: 'pass' }],
      addedAt: now - 8000,
      lastChecked: now - 3000,
      lastStatusChange: now - 4000,
      headRefName: 'old-branch',
      author: { login: 'prevuser', name: 'Previous User', avatarUrl: 'https://github.com/prevuser.png' },
      isDraft: true,
      body: 'Previous body text',
      createdAt: now - 50000,
    };
    storage.set('prs', { [url]: seed });

    // Mock fetchMergeState to return EMPTY state (triggers mergeFailed guard)
    // so Phase 1 fields fallback to prev instead of fresh empty values.
    vi.mocked(fetchMergeState).mockResolvedValueOnce({
      state: '',              // empty → mergeFailed=true
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
    });

    const result = await module.pollAll();
    expect(result.ok).toBe(true);
    const refreshed = result.prs![0];

    // True carry-forward from prev (not fresh mock values)
    expect(refreshed.headRefName).toBe('old-branch');
    expect(refreshed.author).toEqual({ login: 'prevuser', name: 'Previous User', avatarUrl: 'https://github.com/prevuser.png' });
    expect(refreshed.isDraft).toBe(true); // prev, not false
    expect(refreshed.body).toBe('Previous body text');
    expect(refreshed.createdAt).toBe(seed.createdAt);
  });
});

describe('pr-main refreshOne two-pill overlay wiring (§6.7 / R-LIST-013/025)', () => {
  let ctx: PrMonitorContext;
  let storage: Map<string, unknown>;

  beforeEach(() => {
    storage = new Map();
    ctx = {
      log: vi.fn(),
      exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
      storage: {
        get: vi.fn((key: string) => storage.get(key)),
        set: vi.fn((key: string, val: unknown) => storage.set(key, val)),
      },
    } as unknown as PrMonitorContext;
  });

  function seedOpenPr(over: Partial<MonitoredPr> = {}): { url: string; seed: MonitoredPr; now: number } {
    const now = Date.now();
    const url = 'https://github.com/test/repo/pull/42';
    const seed: MonitoredPr = {
      url,
      repo: 'test/repo',
      number: 42,
      title: 'Test PR',
      baseRefName: 'main',
      status: 'green',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checks: [{ name: 'CI', state: 'SUCCESS', bucket: 'pass' }],
      addedAt: now - 10000,
      lastChecked: now - 5000,
      lastStatusChange: now - 2000,
      isDraft: false,
      createdAt: now - 100000,
      ...over,
    };
    storage.set('prs', { [url]: seed });
    return { url, seed, now };
  }

  it('caches buildHappy + reviewDecision each poll (AC-LIST-13.7)', async () => {
    const module = prMonitorMainModule.setup(ctx);
    seedOpenPr({ reviewDecision: undefined, buildHappy: undefined });

    const result = await module.pollAll();
    const refreshed = result.prs![0];
    // Mock checks = one passing → build happy; mock merge reviewDecision = APPROVED.
    expect(refreshed.buildHappy).toBe(true);
    expect(refreshed.reviewDecision).toBe('APPROVED');
  });

  it('an ignored (Snyk) failing check still reads build-happy (AC-LIST-13.7)', async () => {
    const { fetchChecks } = await import('../lib/gh-client.js');
    vi.mocked(fetchChecks).mockResolvedValueOnce([
      { name: 'CI', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Snyk Open Source', state: 'FAILURE', bucket: 'fail' },
    ]);
    storage.set('settings', {
      repositories: [{ host: 'github.com', owner: 'test', repo: 'repo', active: true, ignoredFailingChecks: ['Snyk'] }],
    });
    const module = prMonitorMainModule.setup(ctx);
    seedOpenPr();

    const result = await module.pollAll();
    expect(result.prs![0].buildHappy).toBe(true);
  });

  it('does NOT fetch SFCI comments for a non-gated repo (hasSfciJob=false)', async () => {
    const { ghApi } = await import('../lib/gh-client.js');
    vi.mocked(ghApi).mockClear();
    const module = prMonitorMainModule.setup(ctx);
    seedOpenPr();

    const result = await module.pollAll();
    expect(result.prs![0].hasSfciJob).toBe(false);
    expect(vi.mocked(ghApi)).not.toHaveBeenCalled();
  });

  it('fetches + caches hasSfciJob for a gated, open repo (AC-LIST-14.5)', async () => {
    const { ghApi } = await import('../lib/gh-client.js');
    const { hasSfciJobComment } = await import('../lib/status.js');
    vi.mocked(ghApi).mockClear();
    vi.mocked(ghApi).mockResolvedValueOnce([{ author: { login: 'tok-gimlet' }, body: 'An SFCI job…' }]);
    vi.mocked(hasSfciJobComment).mockReturnValueOnce(true);
    storage.set('settings', {
      repositories: [{ host: 'github.com', owner: 'test', repo: 'repo', active: true, sfciGated: true }],
    });
    const module = prMonitorMainModule.setup(ctx);
    seedOpenPr();

    const result = await module.pollAll();
    expect(vi.mocked(ghApi)).toHaveBeenCalledWith(
      ctx,
      'github.com',
      expect.stringContaining('/issues/42/comments')
    );
    expect(result.prs![0].hasSfciJob).toBe(true);
  });

  it('preserves last-known hasSfciJob when the comment fetch throws', async () => {
    const { ghApi } = await import('../lib/gh-client.js');
    vi.mocked(ghApi).mockRejectedValueOnce(new Error('rate limited'));
    storage.set('settings', {
      repositories: [{ host: 'github.com', owner: 'test', repo: 'repo', active: true, sfciGated: true }],
    });
    const module = prMonitorMainModule.setup(ctx);
    seedOpenPr({ hasSfciJob: true });

    const result = await module.pollAll();
    expect(result.prs![0].hasSfciJob).toBe(true); // carried forward, not reset
  });

  it('§3.8: seeds reviewClockStartedAt from createdAt on first sight of an already-open PR', async () => {
    const module = prMonitorMainModule.setup(ctx);
    seedOpenPr({ reviewClockStartedAt: undefined, isDraft: false });

    const result = await module.pollAll();
    // Seeded from the (fresh) PR open time — mock fetchMergeState.createdAt.
    expect(result.prs![0].reviewClockStartedAt).toBe(1700000000000);
  });

  it('§3.8: resets reviewClockStartedAt to now on a Draft→Open transition', async () => {
    const module = prMonitorMainModule.setup(ctx);
    const before = Date.now();
    // prev.isDraft true, fresh merge isDraft false (mock default) → transition.
    seedOpenPr({ isDraft: true, reviewClockStartedAt: undefined });

    const result = await module.pollAll();
    const clock = result.prs![0].reviewClockStartedAt!;
    expect(clock).toBeGreaterThanOrEqual(before);
  });

  it('§3.8: a still-open PR carries its review clock forward', async () => {
    const module = prMonitorMainModule.setup(ctx);
    const priorClock = Date.now() - 3 * 24 * 3600 * 1000;
    seedOpenPr({ isDraft: false, reviewClockStartedAt: priorClock });

    const result = await module.pollAll();
    expect(result.prs![0].reviewClockStartedAt).toBe(priorClock);
  });

  it('§3.8: a Draft PR has no review clock', async () => {
    const { fetchMergeState } = await import('../lib/gh-client.js');
    vi.mocked(fetchMergeState).mockResolvedValueOnce({
      state: 'OPEN',
      mergeStateStatus: 'CLEAN',
      mergeable: 'MERGEABLE',
      title: 'Draft PR',
      baseRefName: 'main',
      reviewDecision: '',
      headRefName: 'wip',
      author: { login: 'dev', name: 'Dev' },
      isDraft: true,
      body: '',
      createdAt: Date.now() - 10000,
    });
    const module = prMonitorMainModule.setup(ctx);
    seedOpenPr({ isDraft: true, reviewClockStartedAt: 123456 });

    const result = await module.pollAll();
    expect(result.prs![0].reviewClockStartedAt).toBeUndefined();
  });
});

describe('updateRepository refreshes status-affecting edits immediately (no wait for next sync)', () => {
  let ctx: PrMonitorContext;
  let storage: Map<string, unknown>;

  beforeEach(() => {
    storage = new Map();
    ctx = {
      log: vi.fn(),
      exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
      storage: {
        get: vi.fn((key: string) => storage.get(key)),
        set: vi.fn((key: string, val: unknown) => storage.set(key, val)),
      },
    } as unknown as PrMonitorContext;
  });

  function seedRepoAndPr(repoOver: Record<string, unknown> = {}, prOver: Partial<MonitoredPr> = {}) {
    const now = Date.now();
    const url = 'https://github.com/test/repo/pull/42';
    storage.set('settings', {
      repositories: [{ host: 'github.com', owner: 'test', repo: 'repo', active: true, ...repoOver }],
    });
    const seed: MonitoredPr = {
      url,
      repo: 'test/repo',
      number: 42,
      title: 'Test PR',
      baseRefName: 'main',
      status: 'green',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checks: [{ name: 'CI', state: 'SUCCESS', bucket: 'pass' }],
      addedAt: now - 10000,
      lastChecked: now - 5000,
      lastStatusChange: now - 2000,
      isDraft: false,
      createdAt: now - 100000,
      ...prOver,
    };
    storage.set('prs', { [url]: seed });
    return { url };
  }

  const key = { host: 'github.com', owner: 'test', repo: 'repo' };

  it('toggling Ignore-Snyk re-runs the poll for that repo and returns refreshed prs', async () => {
    const { fetchChecks } = await import('../lib/gh-client.js');
    // The live poll now sees a failing Snyk check that the new ignore list forgives.
    vi.mocked(fetchChecks).mockResolvedValue([
      { name: 'CI', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Snyk Open Source', state: 'FAILURE', bucket: 'fail' },
    ]);
    const module = prMonitorMainModule.setup(ctx);
    seedRepoAndPr();

    const res = await module.updateRepository({ key, ignoredFailingChecks: ['Snyk'] });
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.prs)).toBe(true);
    // buildHappy recomputed with the new ignore list → the forgiven Snyk fail is happy.
    expect(res.prs![0].buildHappy).toBe(true);
  });

  it('enabling SFCI-gated fetches the SFCI-job comment on Save and caches hasSfciJob', async () => {
    const { ghApi } = await import('../lib/gh-client.js');
    const { hasSfciJobComment } = await import('../lib/status.js');
    vi.mocked(ghApi).mockClear();
    vi.mocked(ghApi).mockResolvedValueOnce([{ author: { login: 'tok-gimlet' }, body: 'An SFCI job…' }]);
    vi.mocked(hasSfciJobComment).mockReturnValueOnce(true);
    const module = prMonitorMainModule.setup(ctx);
    seedRepoAndPr({}, { hasSfciJob: false });

    const res = await module.updateRepository({ key, sfciGated: true });
    expect(res.ok).toBe(true);
    expect(vi.mocked(ghApi)).toHaveBeenCalledWith(ctx, 'github.com', expect.stringContaining('/issues/42/comments'));
    expect(res.prs![0].hasSfciJob).toBe(true);
  });

  it('a preset-only edit persists WITHOUT re-running the poll (presets resolve renderer-side)', async () => {
    const { fetchMergeState, fetchChecks, ghApi } = await import('../lib/gh-client.js');
    vi.mocked(fetchMergeState).mockClear();
    vi.mocked(fetchChecks).mockClear();
    vi.mocked(ghApi).mockClear();
    const module = prMonitorMainModule.setup(ctx);
    seedRepoAndPr();

    const res = await module.updateRepository({ key, buildTisPreset: 'long-running' });
    expect(res.ok).toBe(true);
    // No refresh → no prs returned, no gh round-trips fired.
    expect(res.prs).toBeUndefined();
    expect(vi.mocked(fetchMergeState)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchChecks)).not.toHaveBeenCalled();
    expect(vi.mocked(ghApi)).not.toHaveBeenCalled();
    // Preset still persisted.
    const settings = storage.get('settings') as { repositories: Array<{ buildTisPreset?: string }> };
    expect(settings.repositories[0].buildTisPreset).toBe('long-running');
  });

  it('deactivating a repo removes its PRs and does NOT return a refreshed list', async () => {
    const module = prMonitorMainModule.setup(ctx);
    seedRepoAndPr();

    const res = await module.updateRepository({ key, active: false });
    expect(res.ok).toBe(true);
    expect(res.prs).toBeUndefined();
    // PR store emptied for the repo.
    const prs = storage.get('prs') as Record<string, unknown>;
    expect(Object.keys(prs).length).toBe(0);
  });
});

describe('pullPr add-guards (AC-LIST-3.5 no-op, AC-LIST-3.6 error-adds-nothing)', () => {
  let ctx: PrMonitorContext;
  let storage: Map<string, unknown>;

  beforeEach(() => {
    storage = new Map();
    ctx = {
      log: vi.fn(),
      exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
      storage: {
        get: vi.fn((key: string) => storage.get(key)),
        set: vi.fn((key: string, val: unknown) => storage.set(key, val)),
      },
    } as unknown as PrMonitorContext;
    // Seed a connected + active repo so pullPr can resolve a fetch target.
    storage.set('settings', {
      repositories: [
        { host: 'github.com', owner: 'test', repo: 'repo', orgLogin: 'test', active: true },
      ],
      organizations: [{ host: 'github.com', login: 'test', apiBaseUrl: 'https://api.github.com' }],
    });
  });

  it('AC-LIST-3.5: pulling an already-monitored PR is a no-op (error, list unchanged)', async () => {
    const module = prMonitorMainModule.setup(ctx);
    const url = 'https://github.com/test/repo/pull/42';

    // First pull adds it.
    const first = await module.pullPr({ host: 'github.com', fullName: 'test/repo', number: 42 });
    expect(first.ok).toBe(true);
    expect(first.prs).toHaveLength(1);
    const snapshot = JSON.stringify(storage.get('prs'));

    // Second pull of the same PR: rejected, and the store is untouched.
    const second = await module.pullPr({ host: 'github.com', fullName: 'test/repo', number: 42 });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('Already monitoring');
    expect(JSON.stringify(storage.get('prs')), 'store unchanged — true no-op').toBe(snapshot);
    expect(Object.keys(storage.get('prs') as Record<string, unknown>)).toEqual([url]);
  });

  it('AC-LIST-3.6: an invalid PR number surfaces an error and adds nothing', async () => {
    const module = prMonitorMainModule.setup(ctx);
    const res = await module.pullPr({ host: 'github.com', fullName: 'test/repo', number: 0 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Enter a valid PR number.');
    expect(storage.get('prs'), 'nothing persisted on invalid input').toBeUndefined();
  });

  it('AC-LIST-3.6: an unconnected/unknown repo surfaces an error and adds nothing', async () => {
    const module = prMonitorMainModule.setup(ctx);
    const res = await module.pullPr({ host: 'github.com', fullName: 'stranger/repo', number: 7 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not connected and active');
    expect(storage.get('prs')).toBeUndefined();
  });
});
