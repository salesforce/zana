/**
 * Unit tests for auto-discovery — discoverPrs, dismissPr, poll integration.
 *
 * PR Monitor is a single-author personal monitor (R-CORE-001 / AC-CORE-1.1):
 * the monitored set is populated from open PRs the AUTHENTICATED `gh` user
 * authored (`author:@me`), across the user's authenticated hosts. Watching other
 * people, review-requested, or @mentioned/involved PRs is explicitly OUT of scope
 * (OQ-CORE-1/2). These tests assert that contract, not the old watch-list model.
 *
 * Tests:
 * - Discovers the authenticated user's authored PRs, per authenticated host, deduped by URL
 * - Authored-ONLY: never searches review-requested / involved relations (scope guard)
 * - Multi-host discovery (each host searched with its own login = that host's @me)
 * - `discoverHosts` enable-subset is honored
 * - Skips PRs already tracked / in the dismissed set (Risk #2)
 * - Source + discoveredVia carry forward through poll
 * - Unauth-host error path
 * - No authenticated accounts → nothing discovered
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrMonitorContext } from '../lib/context.js';
import type { MonitoredPr, PrMonitorSettings } from '../lib/types.js';
import { DEFAULT_PR_MONITOR_SETTINGS } from '../lib/types.js';
import prMonitorMainModule from '../lib/pr-main.js';

// Mock gh-client.ts. The authenticated user is `testuser` (see getAuthHosts);
// searchPrs is keyed on the authenticated login to model `author:@me`.
vi.mock('../lib/gh-client.js', () => ({
  fetchMergeState: vi.fn(async (_ctx, _url) => ({
    state: 'OPEN',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    title: 'Test PR',
    baseRefName: 'main',
    reviewDecision: 'APPROVED',
    headRefName: 'feature',
    author: { login: 'testuser', name: 'Test User' },
    isDraft: false,
    body: 'body',
    createdAt: Date.now(),
  })),
  fetchChecks: vi.fn(async () => [{ name: 'CI', state: 'SUCCESS', bucket: 'pass' }]),
  ghApi: vi.fn(async () => null),
  getAuthHosts: vi.fn(async () => [
    { host: 'github.com', login: 'testuser', apiBaseUrl: 'https://api.github.com', active: true },
  ]),
  searchPrs: vi.fn(async (_ctx, host, login, mode, _repos) => {
    // Authored-only contract: the module must only ever ask for the `authored`
    // relation. If a caller ever requests a non-authored mode, surface it loudly
    // so the scope-guard test can catch a regression.
    if (mode !== 'authored') {
      return { ok: false, error: `unexpected non-authored mode: ${mode}` };
    }
    // `author:@me` → each host is searched with its OWN authenticated login.
    if (host === 'github.com' && login === 'testuser') {
      return {
        ok: true,
        prs: [
          { url: 'https://github.com/org/repo/pull/1', title: 'PR 1', number: 1, repo: 'org/repo', author: { login: 'testuser' }, isDraft: false },
          { url: 'https://github.com/org/repo/pull/2', title: 'PR 2', number: 2, repo: 'org/repo', author: { login: 'testuser' }, isDraft: false },
        ],
      };
    }
    if (host === 'gitcore.soma.salesforce.com' && login === 'testuser') {
      return {
        ok: true,
        prs: [
          { url: 'https://gitcore.soma.salesforce.com/core-2206/core-262-public/pull/123997', title: 'Core PR', number: 123997, repo: 'core-2206/core-262-public', author: { login: 'testuser' }, isDraft: false },
        ],
      };
    }
    return { ok: true, prs: [] };
  }),
}));

// Mock status.js classifier
vi.mock('../lib/status.js', () => ({
  computeStatus: vi.fn(() => 'green'),
  computeClosedStatus: vi.fn(() => 'closed-merged'),
  destBranches: vi.fn(() => ({ final: null, intermediate: null })),
  parsePrUrl: vi.fn(() => ({ host: 'github.com', owner: 'org', repo: 'repo', number: 1 })),
  SYNC_RE: /SYNC: ([0-9a-f]+)/,
}));

/** Build settings on top of the shipped defaults so tests track the real shape. */
function makeSettings(overrides: Partial<PrMonitorSettings> = {}): PrMonitorSettings {
  return { ...DEFAULT_PR_MONITOR_SETTINGS, ...overrides };
}

describe('auto-discovery (authored-only, author:@me)', () => {
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
      cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    } as unknown as PrMonitorContext;
  });

  it('AC-CORE-1.1: discovers the authenticated user\'s authored PRs (author:@me), deduped by URL', async () => {
    const module = prMonitorMainModule.setup(ctx);
    storage.set('settings', makeSettings());
    storage.set('prs', {});

    await module.pollAll();

    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    // testuser authored #1 + #2 on github.com → both discovered as source:'auto'.
    expect(Object.keys(prs)).toHaveLength(2);
    expect(prs['https://github.com/org/repo/pull/1']).toBeDefined();
    expect(prs['https://github.com/org/repo/pull/2']).toBeDefined();
    expect(prs['https://github.com/org/repo/pull/1'].source).toBe('auto');
    expect(prs['https://github.com/org/repo/pull/1'].discoveredVia).toContain('authored:testuser@github.com');
  });

  it('runs with an empty watch list — discovery is driven by the authenticated user, not watchedPeople', async () => {
    const module = prMonitorMainModule.setup(ctx);
    // watchedPeople stays [] (the default): the old model would discover NOTHING,
    // but author-driven discovery must still find the user's own PRs.
    storage.set('settings', makeSettings({ watchedPeople: [] }));
    storage.set('prs', {});

    await module.pollAll();

    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    expect(Object.keys(prs)).toHaveLength(2);
  });

  it('bounds per-pass work: caps new adds and never fans out more than the concurrency window of PR fetches at once', async () => {
    const { getAuthHosts, searchPrs, fetchMergeState } = await import('../lib/gh-client.js');
    // A busy account: 100 open authored PRs on one host.
    const many = Array.from({ length: 100 }, (_, i) => ({
      url: `https://github.com/org/repo/pull/${1000 + i}`,
      title: `PR ${1000 + i}`,
      number: 1000 + i,
      repo: 'org/repo',
      author: { login: 'testuser' },
      isDraft: false,
    }));
    vi.mocked(getAuthHosts).mockResolvedValueOnce([
      { host: 'github.com', login: 'testuser', apiBaseUrl: 'https://api.github.com', active: true },
    ]);
    vi.mocked(searchPrs).mockResolvedValueOnce({ ok: true, prs: many });

    // Instrument fetchMergeState to record max in-flight concurrency.
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(fetchMergeState).mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return {
        state: 'OPEN', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', title: 'Test PR',
        baseRefName: 'main', reviewDecision: 'APPROVED', headRefName: 'feature',
        author: { login: 'testuser', name: 'Test User' }, isDraft: false, body: 'body', createdAt: 1,
        reviewers: [],
      } as never;
    });

    const module = prMonitorMainModule.setup(ctx);
    storage.set('settings', makeSettings());
    storage.set('prs', {});

    await module.pollAll();

    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    // DISCOVER_ADD_CAP = 40 — the pass adds at most that many, not all 100.
    expect(Object.keys(prs).length).toBeLessThanOrEqual(40);
    expect(Object.keys(prs).length).toBeGreaterThan(0);
    // PR_FETCH_CONCURRENCY = 6 — never more than the bounded window in flight.
    expect(maxInFlight).toBeLessThanOrEqual(6);
    expect(maxInFlight).toBeGreaterThan(1); // did actually run concurrently

    // Restore the default fetchMergeState so this override can't bleed into
    // later tests in this file.
    vi.mocked(fetchMergeState).mockImplementation(async () => ({
      state: 'OPEN', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', title: 'Test PR',
      baseRefName: 'main', reviewDecision: 'APPROVED', headRefName: 'feature',
      author: { login: 'testuser', name: 'Test User' }, isDraft: false, body: 'body', createdAt: 1,
    } as never));
  });

  it('scope guard: searches ONLY the authored relation, never review-requested / involved', async () => {
    const { searchPrs } = await import('../lib/gh-client.js');
    const module = prMonitorMainModule.setup(ctx);
    storage.set('settings', makeSettings());
    storage.set('prs', {});

    await module.pollAll();

    // Every searchPrs call must be authored-only (OQ-CORE-1/2 out-of-scope).
    for (const call of vi.mocked(searchPrs).mock.calls) {
      expect(call[3]).toBe('authored');
    }
  });

  it('discovers across multiple authenticated hosts, each with its own @me login', async () => {
    const { getAuthHosts } = await import('../lib/gh-client.js');
    vi.mocked(getAuthHosts).mockResolvedValueOnce([
      { host: 'github.com', login: 'testuser', apiBaseUrl: 'https://api.github.com', active: true },
      { host: 'gitcore.soma.salesforce.com', login: 'testuser', apiBaseUrl: 'https://gitcore.soma.salesforce.com/api/v3', active: false },
    ]);
    const module = prMonitorMainModule.setup(ctx);
    storage.set('settings', makeSettings());
    storage.set('prs', {});

    await module.pollAll();

    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    // #1 + #2 from github.com, #123997 from gitcore → 3 total.
    expect(Object.keys(prs)).toHaveLength(3);
    expect(prs['https://gitcore.soma.salesforce.com/core-2206/core-262-public/pull/123997']).toBeDefined();
    expect(prs['https://gitcore.soma.salesforce.com/core-2206/core-262-public/pull/123997'].discoveredVia)
      .toContain('authored:testuser@gitcore.soma.salesforce.com');
  });

  it('honors the discoverHosts enable-subset', async () => {
    const { getAuthHosts } = await import('../lib/gh-client.js');
    vi.mocked(getAuthHosts).mockResolvedValueOnce([
      { host: 'github.com', login: 'testuser', apiBaseUrl: 'https://api.github.com', active: true },
      { host: 'gitcore.soma.salesforce.com', login: 'testuser', apiBaseUrl: 'https://gitcore.soma.salesforce.com/api/v3', active: false },
    ]);
    const module = prMonitorMainModule.setup(ctx);
    // Only gitcore enabled → github.com PRs must NOT be discovered.
    storage.set('settings', makeSettings({ discoverHosts: ['gitcore.soma.salesforce.com'] }));
    storage.set('prs', {});

    await module.pollAll();

    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    expect(Object.keys(prs)).toHaveLength(1);
    expect(prs['https://gitcore.soma.salesforce.com/core-2206/core-262-public/pull/123997']).toBeDefined();
    expect(prs['https://github.com/org/repo/pull/1']).toBeUndefined();
  });

  it('skips PRs already tracked (keeps their existing source)', async () => {
    const module = prMonitorMainModule.setup(ctx);
    storage.set('settings', makeSettings());
    // Seed #1 as an already-tracked manual PR.
    const existing: Record<string, MonitoredPr> = {
      'https://github.com/org/repo/pull/1': {
        url: 'https://github.com/org/repo/pull/1',
        repo: 'org/repo',
        number: 1,
        title: 'Existing',
        baseRefName: 'main',
        status: 'green',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        checks: [],
        addedAt: Date.now() - 10000,
        lastChecked: Date.now() - 5000,
        lastStatusChange: Date.now() - 5000,
        source: 'manual',
      },
    };
    storage.set('prs', existing);

    await module.pollAll();

    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    // #1 (existing manual) + #2 (discovered auto).
    expect(Object.keys(prs)).toHaveLength(2);
    expect(prs['https://github.com/org/repo/pull/1'].source).toBe('manual');
    expect(prs['https://github.com/org/repo/pull/2'].source).toBe('auto');
  });

  it('skips PRs in the dismissed set (Risk #2)', async () => {
    const module = prMonitorMainModule.setup(ctx);
    storage.set('settings', makeSettings());
    storage.set('prs', {});
    // Seed #1 as dismissed.
    storage.set('dismissedUrls', { 'https://github.com/org/repo/pull/1': Date.now() - 5000 });

    await module.pollAll();

    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    expect(Object.keys(prs)).toHaveLength(1);
    expect(prs['https://github.com/org/repo/pull/2']).toBeDefined();
    expect(prs['https://github.com/org/repo/pull/1']).toBeUndefined();
  });

  it('dismissPr adds auto PR to dismissed set and removes it', async () => {
    const module = prMonitorMainModule.setup(ctx);
    const url = 'https://github.com/org/repo/pull/1';
    const pr: MonitoredPr = {
      url,
      repo: 'org/repo',
      number: 1,
      title: 'Auto PR',
      baseRefName: 'main',
      status: 'green',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checks: [],
      addedAt: Date.now(),
      lastChecked: Date.now(),
      lastStatusChange: Date.now(),
      source: 'auto',
      discoveredVia: 'authored:testuser@github.com',
    };
    storage.set('prs', { [url]: pr });
    storage.set('dismissedUrls', {});

    const result = await module.dismissPr({ url });
    expect(result.ok).toBe(true);

    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    const dismissed = storage.get('dismissedUrls') as Record<string, number>;
    expect(prs[url]).toBeUndefined();
    expect(dismissed[url]).toBeGreaterThan(0);
  });

  it('dismissPr removes manual PR without adding to dismissed set', async () => {
    const module = prMonitorMainModule.setup(ctx);
    const url = 'https://github.com/org/repo/pull/1';
    const pr: MonitoredPr = {
      url,
      repo: 'org/repo',
      number: 1,
      title: 'Manual PR',
      baseRefName: 'main',
      status: 'green',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checks: [],
      addedAt: Date.now(),
      lastChecked: Date.now(),
      lastStatusChange: Date.now(),
      source: 'manual',
    };
    storage.set('prs', { [url]: pr });
    storage.set('dismissedUrls', {});

    const result = await module.dismissPr({ url });
    expect(result.ok).toBe(true);

    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    const dismissed = storage.get('dismissedUrls') as Record<string, number>;
    expect(prs[url]).toBeUndefined();
    expect(dismissed[url]).toBeUndefined(); // NOT added to dismissed
  });

  it('dismissed auto PR is not re-added on next poll (Risk #2 round-trip)', async () => {
    const module = prMonitorMainModule.setup(ctx);
    storage.set('settings', makeSettings());
    storage.set('prs', {});
    storage.set('dismissedUrls', {});

    // First poll — adds #1, #2.
    await module.pollAll();
    let prs = storage.get('prs') as Record<string, MonitoredPr>;
    expect(Object.keys(prs)).toHaveLength(2);

    // Dismiss #1 (auto).
    await module.dismissPr({ url: 'https://github.com/org/repo/pull/1' });

    // Second poll — must NOT re-add #1.
    await module.pollAll();
    prs = storage.get('prs') as Record<string, MonitoredPr>;
    expect(Object.keys(prs)).toHaveLength(1);
    expect(prs['https://github.com/org/repo/pull/1']).toBeUndefined();
    expect(prs['https://github.com/org/repo/pull/2']).toBeDefined();
  });

  it('source + discoveredVia carry forward through poll', async () => {
    const module = prMonitorMainModule.setup(ctx);
    storage.set('settings', makeSettings());
    storage.set('prs', {});

    // First poll — adds #1 (auto).
    await module.pollAll();
    let prs = storage.get('prs') as Record<string, MonitoredPr>;
    expect(prs['https://github.com/org/repo/pull/1'].source).toBe('auto');
    expect(prs['https://github.com/org/repo/pull/1'].discoveredVia).toContain('authored:testuser');

    // Second poll — refreshOne should carry source + discoveredVia forward.
    await module.pollAll();
    prs = storage.get('prs') as Record<string, MonitoredPr>;
    expect(prs['https://github.com/org/repo/pull/1'].source).toBe('auto');
    expect(prs['https://github.com/org/repo/pull/1'].discoveredVia).toContain('authored:testuser');
  });

  it('logs unauth error when a host search fails', async () => {
    const { getAuthHosts, searchPrs } = await import('../lib/gh-client.js');
    vi.mocked(getAuthHosts).mockResolvedValueOnce([
      { host: 'gitcore.soma.salesforce.com', login: 'testuser', apiBaseUrl: 'https://gitcore.soma.salesforce.com/api/v3', active: true },
    ]);
    // This host's search fails auth on this run.
    vi.mocked(searchPrs).mockResolvedValueOnce({ ok: false, error: 'unauth' });

    const module = prMonitorMainModule.setup(ctx);
    storage.set('settings', makeSettings());
    storage.set('prs', {});

    await module.pollAll();

    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('failed: unauth'));
    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    expect(Object.keys(prs)).toHaveLength(0);
  });

  it('does not discover when there are no authenticated accounts', async () => {
    const { getAuthHosts } = await import('../lib/gh-client.js');
    vi.mocked(getAuthHosts).mockResolvedValueOnce([]);

    const module = prMonitorMainModule.setup(ctx);
    storage.set('settings', makeSettings());
    storage.set('prs', {});

    await module.pollAll();

    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    expect(Object.keys(prs)).toHaveLength(0);
  });
});
