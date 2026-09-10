import { describe, it, expect, vi } from 'vitest';
import {
  fetchRepoStarCount,
  formatStarCount,
  parseGitHubRepo,
  parseShieldsStarValue
} from '../github-stars.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('parseGitHubRepo', () => {
  it('extracts owner and repo from a github.com URL', () => {
    expect(parseGitHubRepo('https://github.com/salesforce/zana')).toEqual({
      owner: 'salesforce',
      repo: 'zana'
    });
  });

  it('strips a trailing .git and extra path', () => {
    expect(parseGitHubRepo('https://github.com/salesforce/zana.git/')).toEqual({
      owner: 'salesforce',
      repo: 'zana'
    });
  });

  it('returns null for a non-GitHub URL', () => {
    expect(parseGitHubRepo('https://example.com/salesforce/zana')).toBeNull();
  });

  it('returns null for garbage, a host-only URL, or a .git-only name', () => {
    expect(parseGitHubRepo('not a url')).toBeNull();
    expect(parseGitHubRepo('https://github.com/salesforce')).toBeNull();
    expect(parseGitHubRepo('https://github.com/salesforce/.git')).toBeNull();
  });
});

describe('formatStarCount', () => {
  it('keeps counts under 1000 exact', () => {
    expect(formatStarCount(0)).toBe('0');
    expect(formatStarCount(30)).toBe('30');
    expect(formatStarCount(999)).toBe('999');
  });

  it('compacts thousands with a k suffix', () => {
    expect(formatStarCount(1000)).toBe('1k');
    expect(formatStarCount(1234)).toBe('1.2k');
    expect(formatStarCount(10500)).toBe('10.5k');
  });

  it('treats non-finite and negative counts as zero', () => {
    expect(formatStarCount(Number.NaN)).toBe('0');
    expect(formatStarCount(-4)).toBe('0');
  });
});

describe('parseShieldsStarValue', () => {
  it('parses exact and compact badge values', () => {
    expect(parseShieldsStarValue(30)).toBe(30);
    expect(parseShieldsStarValue('30')).toBe(30);
    expect(parseShieldsStarValue('1.2k')).toBe(1200);
    expect(parseShieldsStarValue('2M')).toBe(2_000_000);
  });

  it('rejects junk', () => {
    expect(parseShieldsStarValue('stars')).toBeNull();
    expect(parseShieldsStarValue(-1)).toBeNull();
    expect(parseShieldsStarValue(undefined)).toBeNull();
  });
});

describe('fetchRepoStarCount', () => {
  it('reads stargazers_count from the GitHub API', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ stargazers_count: 30 }));
    await expect(
      fetchRepoStarCount({
        repoUrl: 'https://github.com/salesforce/zana',
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).resolves.toBe(30);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.github.com/repos/salesforce/zana');
  });

  it('falls back to shields.io when GitHub is rate-limited', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) return new Response('nope', { status: 403 });
      return jsonResponse({ value: '30' });
    });
    await expect(
      fetchRepoStarCount({
        repoUrl: 'https://github.com/salesforce/zana',
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).resolves.toBe(30);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain('https://api.github.com/repos/salesforce/zana');
    expect(urls).toContain('https://img.shields.io/github/stars/salesforce/zana.json');
  });

  it('sends a bearer token when one is provided', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ stargazers_count: 30 }));
    await fetchRepoStarCount({
      repoUrl: 'https://github.com/salesforce/zana',
      fetchImpl: fetchMock as unknown as typeof fetch,
      token: 'ghs_test'
    });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghs_test');
  });

  it('does not send the GitHub token to shields.io', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) return new Response('nope', { status: 403 });
      return jsonResponse({ value: '30' });
    });
    await fetchRepoStarCount({
      repoUrl: 'https://github.com/salesforce/zana',
      fetchImpl: fetchMock as unknown as typeof fetch,
      token: 'ghs_test'
    });
    const shieldsCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('shields.io'));
    const headers = shieldsCall?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('returns null when GitHub and shields both fail', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 403 }));
    await expect(
      fetchRepoStarCount({
        repoUrl: 'https://github.com/salesforce/zana',
        fetchImpl: failing as unknown as typeof fetch
      })
    ).resolves.toBeNull();

    const exploding = vi.fn(async () => {
      throw new Error('network');
    });
    await expect(
      fetchRepoStarCount({
        repoUrl: 'https://github.com/salesforce/zana',
        fetchImpl: exploding as unknown as typeof fetch
      })
    ).resolves.toBeNull();
  });

  it('does not call the network for a URL it cannot parse', async () => {
    const fetchMock = vi.fn();
    await expect(
      fetchRepoStarCount({
        repoUrl: 'https://example.com/not-github',
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when repoUrl is omitted', async () => {
    const fetchMock = vi.fn();
    await expect(fetchRepoStarCount({ fetchImpl: fetchMock as unknown as typeof fetch })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attaches a one-hour revalidate when using the platform fetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ stargazers_count: 30.9 }));
    const previous = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(
        fetchRepoStarCount({ repoUrl: 'https://github.com/salesforce/zana' })
      ).resolves.toBe(30);
    } finally {
      globalThis.fetch = previous;
    }
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ next: { revalidate: 3600 } });
  });

  it('falls through when GitHub returns a non-finite count', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) {
        return jsonResponse({ stargazers_count: Number.POSITIVE_INFINITY });
      }
      return jsonResponse({ message: '30' });
    });
    await expect(
      fetchRepoStarCount({
        repoUrl: 'https://github.com/salesforce/zana',
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).resolves.toBe(30);
  });
});
