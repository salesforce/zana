import { describe, it, expect, vi } from 'vitest';
import type { ExecResult, PrMonitorContext } from '../lib/context.js';
import { classifyGhFault, probeRepoFault } from '../lib/gh-client.js';

/**
 * AC-REPO-16.5 gh-result → fault mapping. `classifyGhFault` is the pure decision
 * that keeps remote-gone (needs a Remove/Keep prompt) apart from a disconnect
 * (re-auth) and a transient outage (retry, auto-clears). "Uncertain" → outage.
 */

function res(over: Partial<ExecResult>): ExecResult {
  return { code: 1, stdout: '', stderr: '', ...over } as ExecResult;
}

describe('classifyGhFault (AC-REPO-16.5)', () => {
  it('code 0 → ok', () => {
    expect(classifyGhFault(res({ code: 0, stdout: '{"full_name":"a/b"}' }))).toBe('ok');
  });

  it('HTTP 404 → remote-gone (deleted/private/renamed)', () => {
    expect(classifyGhFault(res({ stderr: 'HTTP 404: Not Found (https://api.github.com/repos/a/b)' }))).toBe(
      'remote-gone'
    );
  });

  it('HTTP 401 → disconnect (re-auth)', () => {
    expect(classifyGhFault(res({ stderr: 'HTTP 401: Bad credentials' }))).toBe('disconnect');
  });

  it('HTTP 403 with a rate-limit signal → outage (transient)', () => {
    expect(
      classifyGhFault(res({ stderr: 'HTTP 403: API rate limit exceeded for user' }))
    ).toBe('outage');
  });

  it('HTTP 403 without a rate-limit signal → disconnect (forbidden auth)', () => {
    expect(classifyGhFault(res({ stderr: 'HTTP 403: Must have admin rights' }))).toBe('disconnect');
  });

  it('HTTP 429 → outage (rate limited)', () => {
    expect(classifyGhFault(res({ stderr: 'HTTP 429: Too Many Requests' }))).toBe('outage');
  });

  it('HTTP 500/502/503 → outage (server error)', () => {
    expect(classifyGhFault(res({ stderr: 'HTTP 500: Internal Server Error' }))).toBe('outage');
    expect(classifyGhFault(res({ stderr: 'HTTP 503: Service Unavailable' }))).toBe('outage');
  });

  it('network/DNS/timeout (no HTTP status) → outage', () => {
    expect(classifyGhFault(res({ stderr: 'dial tcp: lookup api.github.com: no such host' }))).toBe(
      'outage'
    );
  });

  it('null (could not spawn) → outage, never remote-gone', () => {
    expect(classifyGhFault(null)).toBe('outage');
  });

  it('"not logged in" with no HTTP status → disconnect', () => {
    expect(classifyGhFault(res({ stderr: 'You are not logged into any GitHub hosts. Run gh auth login' }))).toBe(
      'disconnect'
    );
  });

  it('uncertain/ambiguous error → outage (retry, not a removal prompt)', () => {
    expect(classifyGhFault(res({ stderr: 'something unexpected went wrong' }))).toBe('outage');
  });
});

describe('probeRepoFault', () => {
  function ctxWith(exec: PrMonitorContext['exec']): PrMonitorContext {
    return { log: vi.fn(), exec, storage: { get: vi.fn(), set: vi.fn() } } as unknown as PrMonitorContext;
  }

  it('returns outage when exec is unavailable (fail-safe, no prompt)', async () => {
    const ctx = ctxWith(undefined);
    expect(await probeRepoFault(ctx, 'github.com', 'a', 'b')).toBe('outage');
  });

  it('rejects an unsafe owner/repo as outage (never spawns, never prompts)', async () => {
    const exec = vi.fn(async () => res({ code: 0 }));
    const ctx = ctxWith(exec as unknown as PrMonitorContext['exec']);
    expect(await probeRepoFault(ctx, 'github.com', '-x', 'b')).toBe('outage');
    expect(exec).not.toHaveBeenCalled();
  });

  it('probes repos/<owner>/<repo> with flags before `--` and classifies 404', async () => {
    const exec = vi.fn(async () => res({ code: 1, stderr: 'HTTP 404: Not Found' }));
    const ctx = ctxWith(exec as unknown as PrMonitorContext['exec']);
    const fault = await probeRepoFault(ctx, 'github.com', 'acme', 'widgets');
    expect(fault).toBe('remote-gone');
    const args = exec.mock.calls[0][0].args as string[];
    expect(args).toEqual(['api', '--hostname', 'github.com', '--', 'repos/acme/widgets']);
    const dashIdx = args.indexOf('--');
    expect(args.slice(0, dashIdx).every((a) => !a.startsWith('repos/'))).toBe(true);
  });
});
