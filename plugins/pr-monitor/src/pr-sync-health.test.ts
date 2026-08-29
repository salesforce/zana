/**
 * Integration of the R-REPO-013/015/016 sync-health model into pr-main: the
 * pollAll probe pass, the kept-gone sync-gate exclusion, and the getSyncHealth /
 * resolveRemoteGone capabilities. gh-client is mocked so probeRepoFault returns a
 * scripted fault per repo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrMonitorContext } from '../lib/context.js';
import type { MonitoredPr, MonitoredRepo, PrMonitorSettings, SyncHealthState } from '../lib/types.js';
import prMonitorMainModule from '../lib/pr-main.js';

const H = vi.hoisted(() => ({
  faultByRepo: new Map<string, string>(),
  probeCalls: [] as string[],
}));

vi.mock('../lib/gh-client.js', () => ({
  fetchMergeState: vi.fn(async () => ({
    state: 'OPEN', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', title: 'PR',
    baseRefName: 'main', reviewDecision: 'APPROVED', headRefName: 'f', author: { login: 'me' },
    isDraft: false, body: '', createdAt: 1, updatedAt: 1, reviewers: [],
  })),
  fetchChecks: vi.fn(async () => [{ name: 'CI', state: 'SUCCESS', bucket: 'pass' }]),
  ghApi: vi.fn(async () => null),
  getAuthHosts: vi.fn(async () => [
    { host: 'github.com', login: 'me', apiBaseUrl: 'https://api.github.com', active: true },
  ]),
  getAuthUser: vi.fn(async () => ({ login: 'me', name: 'Me' })),
  searchPrs: vi.fn(async () => ({ ok: true, prs: [] })),
  isSafeRepoArg: (v: unknown) =>
    typeof v === 'string' && /^[A-Za-z0-9._][A-Za-z0-9._-]*\/[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(v),
  probeRepoFault: vi.fn(async (_ctx: unknown, _host: string, owner: string, repo: string) => {
    const key = `${owner}/${repo}`.toLowerCase();
    H.probeCalls.push(key);
    return H.faultByRepo.get(key) ?? 'ok';
  }),
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
    owner: 'acme', repo: 'widgets', host: 'github.com', orgLogin: 'acme',
    active: true, tisPreset: 'standard', createdAt: 0, notifyInApp: true, ...over,
  };
}
function pr(url: string, repoName: string): MonitoredPr {
  return {
    url, repo: repoName, number: 1, title: 'PR', baseRefName: 'main', status: 'yellow',
    mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', checks: [], addedAt: 0,
    lastChecked: 0, lastStatusChange: 0,
  } as MonitoredPr;
}

let ctx: PrMonitorContext;
let storage: Map<string, unknown>;
function seedSettings(over: Partial<PrMonitorSettings>): void {
  storage.set('settings', { repositories: [], organizations: [], ...over });
}

beforeEach(() => {
  storage = new Map();
  H.faultByRepo.clear();
  H.probeCalls.length = 0;
  ctx = {
    log: vi.fn(),
    exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    storage: {
      get: vi.fn((k: string) => storage.get(k)),
      set: vi.fn((k: string, v: unknown) => storage.set(k, v)),
    },
  } as unknown as PrMonitorContext;
});

describe('pollAll sync-health pass (R-REPO-013/015/016)', () => {
  it('healthy repos → clean health, no clue', async () => {
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({ repositories: [repo()] });
    const res = await module.pollAll();
    expect(res.ok).toBe(true);
    expect(res.health).toEqual({ disconnectedHosts: [], outageHosts: [], remoteGone: [], keptGone: [] });
  });

  it('AC-REPO-15.1: all connected repos outage → host outage', async () => {
    H.faultByRepo.set('acme/widgets', 'outage');
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({ repositories: [repo()] });
    const res = await module.pollAll();
    expect(res.health?.outageHosts).toEqual(['github.com']);
    expect(res.health?.disconnectedHosts).toEqual([]);
  });

  it('AC-REPO-16.5: 404 needs two passes before it surfaces as remote-gone', async () => {
    H.faultByRepo.set('acme/widgets', 'remote-gone');
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({ repositories: [repo()] });
    const first = await module.pollAll();
    expect(first.health?.remoteGone).toEqual([]);
    const second = await module.pollAll();
    expect(second.health?.remoteGone).toEqual(['acme/widgets']);
  });

  it('AC-REPO-16.3: keep excludes the repo from the sync pass (PR not refreshed)', async () => {
    // Confirm remote-gone over 2 passes, then keep.
    H.faultByRepo.set('acme/widgets', 'remote-gone');
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({ repositories: [repo()] });
    storage.set('prs', { u1: pr('u1', 'acme/widgets') });
    await module.pollAll();
    await module.pollAll();
    const kept = await module.resolveRemoteGone({ repo: 'acme/widgets', action: 'keep' });
    expect(kept.ok).toBe(true);

    // A kept repo is gated out — the PR keeps its last-known status, no delta.
    const state = storage.get('syncHealth') as SyncHealthState;
    expect(state.kept).toContain('acme/widgets');
    // Reset the row to a sentinel status; if the kept repo were still synced the
    // mocked refresh would flip it to 'green'. Gated out → it stays 'yellow'.
    storage.set('prs', { u1: pr('u1', 'acme/widgets') });
    const after = await module.pollAll();
    const row = after.prs?.find((p) => p.url === 'u1');
    expect(row?.status).toBe('yellow'); // unchanged — not re-synced
    expect(after.deltas).toEqual([]);
    expect(after.health?.keptGone).toContain('acme/widgets');
  });

  it('AC-REPO-16.2: remove deletes the repo and its PRs', async () => {
    H.faultByRepo.set('acme/widgets', 'remote-gone');
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({ repositories: [repo()] });
    storage.set('prs', { u1: pr('u1', 'acme/widgets') });
    await module.pollAll();
    await module.pollAll();
    const removed = await module.resolveRemoteGone({ repo: 'acme/widgets', action: 'remove' });
    expect(removed.ok).toBe(true);
    expect(removed.settings?.repositories).toEqual([]);
    const prs = storage.get('prs') as Record<string, MonitoredPr>;
    expect(prs.u1).toBeUndefined();
  });

  it('resolveRemoteGone rejects an untracked or unsafe repo (Rule 1/2)', async () => {
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({ repositories: [repo()] });
    expect((await module.resolveRemoteGone({ repo: '../etc', action: 'remove' })).ok).toBe(false);
    expect((await module.resolveRemoteGone({ repo: 'not/tracked', action: 'keep' })).ok).toBe(false);
  });

  it('getSyncHealth re-derives disconnected + remote-gone without a probe pass', async () => {
    // Seed a persisted state with a confirmed-gone repo; auth still connected.
    const module = prMonitorMainModule.setup(ctx);
    seedSettings({ repositories: [repo()] });
    storage.set('syncHealth', { gone404: { 'acme/widgets': 2 }, kept: [] });
    H.probeCalls.length = 0;
    const res = await module.getSyncHealth();
    expect(res.ok).toBe(true);
    expect(res.health?.remoteGone).toEqual(['acme/widgets']);
    expect(H.probeCalls).toEqual([]); // no probes — cheap read
  });
});
