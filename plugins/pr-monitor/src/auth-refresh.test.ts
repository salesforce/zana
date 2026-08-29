/**
 * Auth/identity refresh tests — the live-connection + Re-discover paths.
 *
 * Covers:
 *  - AC-ORG-5.4: connection state is derived LIVE from `gh` auth on each read
 *    (listOrgs / listRepos), so a poll pass that changes auth updates the pill
 *    without a Re-discover.
 *  - AC-PPL-4.4 / AC-PPL-5.1: Organizations Re-discover (rediscoverOrgs → force)
 *    refreshes the persisted author's per-org identities from current gh auth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrMonitorContext } from '../lib/context.js';
import prMonitorMainModule from '../lib/pr-main.js';

vi.mock('../lib/gh-client.js', () => ({
  fetchMergeState: vi.fn(async () => ({
    state: 'OPEN',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    title: 'PR',
    baseRefName: 'main',
    reviewDecision: 'APPROVED',
    headRefName: 'branch',
    author: null,
    isDraft: false,
    body: '',
    createdAt: 0,
  })),
  fetchChecks: vi.fn(async () => []),
  ghApi: vi.fn(async () => null),
  getAuthHosts: vi.fn(async () => [
    { host: 'github.com', login: 'alice', apiBaseUrl: 'https://api.github.com', active: true },
  ]),
  invalidateAuthHosts: vi.fn(),
  getAuthUser: vi.fn(async () => ({ login: 'alice', name: 'Alice' })),
}));

vi.mock('../lib/status.js', () => ({
  computeStatus: vi.fn(() => 'green'),
  computeClosedStatus: vi.fn(() => 'closed-merged'),
  destBranches: vi.fn(() => ({ final: null, intermediate: null })),
  parsePrUrl: vi.fn(() => ({ host: 'github.com', owner: 'test', repo: 'repo', number: 42 })),
  SYNC_RE: /SYNC: ([0-9a-f]+)/,
}));

describe('auth/identity refresh (AC-ORG-5.4, AC-PPL-4.4/5.1)', () => {
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

  it('AC-ORG-5.4: listOrgs re-derives connection live — a host that drops gh auth flips to disconnected', async () => {
    const { getAuthHosts } = await import('../lib/gh-client.js');
    const module = prMonitorMainModule.setup(ctx);

    // First discovery: github.com authenticates → connected.
    const first = await module.listOrgs();
    expect(first.ok).toBe(true);
    const org = first.orgs!.find((o) => o.host === 'github.com')!;
    expect(org.connection).toBe('connected');

    // gh auth now reports no accounts (e.g. token expired). No Re-discover; the
    // org record stays, but the next read must derive 'disconnected' live.
    vi.mocked(getAuthHosts).mockResolvedValueOnce([]);
    const second = await module.listOrgs();
    const orgAfter = second.orgs!.find((o) => o.host === 'github.com')!;
    expect(orgAfter.connection).toBe('disconnected');
  });

  it('AC-PPL-4.4/5.1: Re-discover refreshes the author identities from current gh auth', async () => {
    const { getAuthHosts } = await import('../lib/gh-client.js');
    const module = prMonitorMainModule.setup(ctx);

    // Seed the author once (single github.com identity).
    const before = await module.getAuthor();
    expect(before.author?.identities.map((i) => i.host)).toEqual(['github.com']);

    // A GHE host is now authenticated too. Ordinary getAuthor stays read-only
    // (still one identity) — only Re-discover pulls the new one in.
    vi.mocked(getAuthHosts).mockResolvedValue([
      { host: 'github.com', login: 'alice', apiBaseUrl: 'https://api.github.com', active: true },
      { host: 'git.soma', login: 'alice-ent', apiBaseUrl: 'https://git.soma/api/v3', active: false },
    ]);
    const stillStale = await module.getAuthor();
    expect(stillStale.author?.identities).toHaveLength(1);

    const res = await module.rediscoverOrgs();
    expect(res.ok).toBe(true);

    const after = await module.getAuthor();
    expect(after.author?.identities.map((i) => i.host).sort()).toEqual(['git.soma', 'github.com']);
    expect(after.author?.identities.find((i) => i.host === 'git.soma')?.login).toBe('alice-ent');
  });
});
