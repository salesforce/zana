/**
 * Backend tests for the R-REPO-012 sync-pass gate (connected + active) and the
 * R-PPL author-persist / connection-independence contracts.
 *
 * - AC-REPO-12.1/12.4: only connected + active repos are worked in a sync pass.
 * - AC-REPO-12.2: a disconnected repo is skipped (no re-fetch, no delta).
 * - AC-REPO-12.3: an inactive repo is skipped, independent of connection.
 * - AC-REPO-5.3: listRepos reports connection from gh auth regardless of active.
 * - AC-PPL-2.2/5.3: getAuthor reads persisted author; live gh runs once (seed)
 *   and only again via rediscoverOrgs — not on every open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrMonitorContext } from '../lib/context.js';
import type { MonitoredPr, PrMonitorSettings, MonitoredRepo } from '../lib/types.js';
import prMonitorMainModule from '../lib/pr-main.js';

// Controllable gh auth accounts (connection is derived from this set). Hoisted so
// the vi.mock factory (itself hoisted) can reference these without a TDZ error.
const H = vi.hoisted(() => {
  const state = {
    accounts: [] as Array<{ host: string; login: string; apiBaseUrl: string; active: boolean }>,
    refreshCalls: [] as string[],
  };
  return {
    state,
    getAuthHostsSpy: vi.fn(async () => state.accounts),
    getAuthUserSpy: vi.fn(async (_ctx: unknown, _host: string) => ({
      login: 'me',
      name: 'Me User',
      email: 'me@example.com',
    })),
  };
});
const getAuthHostsSpy = H.getAuthHostsSpy;
const getAuthUserSpy = H.getAuthUserSpy;
const refreshCalls = H.state.refreshCalls;

vi.mock('../lib/gh-client.js', () => ({
  fetchMergeState: vi.fn(async (_ctx: unknown, url: string) => {
    H.state.refreshCalls.push(url);
    return {
      state: 'OPEN',
      mergeStateStatus: 'CLEAN',
      mergeable: 'MERGEABLE',
      title: 'PR',
      baseRefName: 'main',
      reviewDecision: 'APPROVED',
      headRefName: 'feature',
      author: { login: 'me' },
      isDraft: false,
      body: '',
      createdAt: 1,
    };
  }),
  fetchChecks: vi.fn(async () => [{ name: 'CI', state: 'SUCCESS', bucket: 'pass' }]),
  ghApi: vi.fn(async () => null),
  getAuthHosts: H.getAuthHostsSpy,
  invalidateAuthHosts: vi.fn(),
  getAuthUser: H.getAuthUserSpy,
  searchPrs: vi.fn(async () => ({ ok: true, prs: [] })),
  searchReposAllHosts: vi.fn(async () => ({ ok: true, repos: [] })),
  isSafeRepoArg: (v: unknown) => typeof v === 'string' && /^[\w.]+\/[\w.-]+$/.test(v),
}));

vi.mock('../lib/status.js', () => ({
  computeStatus: vi.fn(() => 'green'),
  computeClosedStatus: vi.fn(() => 'closed-merged'),
  destBranches: vi.fn(() => ({ final: null, intermediate: null })),
  parsePrUrl: vi.fn(() => ({ host: 'github.com', owner: 'acme', repo: 'widgets', number: 1 })),
  SYNC_RE: /SYNC: ([0-9a-f]+)/,
}));

function repo(over: Partial<MonitoredRepo> = {}): MonitoredRepo {
  return {
    owner: 'acme',
    repo: 'widgets',
    host: 'github.com',
    orgLogin: 'acme',
    active: true,
    tisPreset: 'standard',
    createdAt: 0,
    notifyInApp: true,
    ...over,
  };
}

function pr(url: string, repoName: string): MonitoredPr {
  return {
    url,
    repo: repoName,
    number: 1,
    title: 'PR',
    baseRefName: 'main',
    status: 'yellow',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checks: [],
    addedAt: 0,
    lastChecked: 0,
    lastStatusChange: 0,
  } as MonitoredPr;
}

let ctx: PrMonitorContext;
let storage: Map<string, unknown>;

function seedSettings(over: Partial<PrMonitorSettings>): void {
  storage.set('settings', { repositories: [], organizations: [], ...over });
}

beforeEach(() => {
  storage = new Map();
  refreshCalls.length = 0;
  getAuthHostsSpy.mockClear();
  getAuthUserSpy.mockClear();
  H.state.accounts = [{ host: 'github.com', login: 'me', apiBaseUrl: 'https://api.github.com', active: true }];
  ctx = {
    log: vi.fn(),
    exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    storage: {
      get: vi.fn((key: string) => storage.get(key)),
      set: vi.fn((key: string, val: unknown) => storage.set(key, val)),
    },
  } as unknown as PrMonitorContext;
});

describe('R-REPO-012 sync-pass gate (pollAll refresh)', () => {
  it('AC-REPO-12.1/12.4: refreshes a PR in a connected + active repo', async () => {
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({ repositories: [repo({ active: true })] });
    storage.set('prs', { 'u1': pr('u1', 'acme/widgets') });
    await module.pollAll();
    expect(refreshCalls).toContain('u1');
  });

  it('AC-REPO-12.3: skips a PR in an INACTIVE repo (no re-fetch)', async () => {
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({ repositories: [repo({ active: false })] });
    storage.set('prs', { 'u1': pr('u1', 'acme/widgets') });
    await module.pollAll();
    expect(refreshCalls).not.toContain('u1');
  });

  it('AC-REPO-12.2: skips a PR in a DISCONNECTED repo (host not in gh auth)', async () => {
    H.state.accounts = []; // nothing authenticates → github.com disconnected
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({ repositories: [repo({ active: true })] });
    storage.set('prs', { 'u1': pr('u1', 'acme/widgets') });
    await module.pollAll();
    expect(refreshCalls).not.toContain('u1');
  });

  it('an untracked repo is not gated (people-based discovery may surface any repo)', async () => {
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({ repositories: [] });
    storage.set('prs', { 'u1': pr('u1', 'stranger/repo') });
    await module.pollAll();
    expect(refreshCalls).toContain('u1');
  });
});

describe('AC-REPO-5.3 connection independent of active', () => {
  it('an INACTIVE but reachable repo still reports connection=connected', async () => {
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({
      repositories: [repo({ active: false })],
      organizations: [{ host: 'github.com', login: 'acme', apiBaseUrl: 'https://api.github.com' }],
    });
    const res = await module.listRepos();
    expect(res.ok).toBe(true);
    expect(res.repos?.[0].connection).toBe('connected');
    expect(res.repos?.[0].active).toBe(false);
  });
});

describe('AC-PPL-2.2/5.3 author persist + connection-independence', () => {
  it('seeds the author once, then serves it without re-reading gh on later opens', async () => {
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({});
    const first = await module.getAuthor();
    expect(first.author?.login).toBe('me');
    const seedUserCalls = getAuthUserSpy.mock.calls.length;
    expect(seedUserCalls).toBeGreaterThanOrEqual(1);

    // Second open must NOT re-read the gh profile (persisted author served as-is).
    await module.getAuthor();
    expect(getAuthUserSpy.mock.calls.length).toBe(seedUserCalls);
  });

  it('AC-PPL-5.3: rediscoverOrgs is the path that re-syncs the author from gh', async () => {
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({});
    await module.getAuthor();
    const before = getAuthUserSpy.mock.calls.length;
    await module.rediscoverOrgs();
    expect(getAuthUserSpy.mock.calls.length).toBeGreaterThan(before);
  });
});
