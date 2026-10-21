import { describe, expect, it, vi } from 'vitest';
import { detectPlatform, fetchLatestRelease, latestReleaseApiUrl, pickReleaseAssets } from './downloads';

describe('detectPlatform', () => {
  it('prefers the client-hint platform', () => {
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)', 'Windows')).toBe('windows');
  });

  it('reads desktop user agents', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)')).toBe('mac');
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
  });

  it('treats phones, tablets, and unknown agents as other', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('other');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14)')).toBe('other');
    expect(detectPlatform('curl/8.0')).toBe('other');
  });
});

describe('pickReleaseAssets', () => {
  const url = (name: string) => `https://github.com/salesforce/zana/releases/download/v2.3.6/${name}`;
  const asset = (name: string) => ({ name, browser_download_url: url(name) });

  it('maps the published installers and strips the tag prefix', () => {
    expect(
      pickReleaseAssets({
        tag_name: 'v2.3.6',
        published_at: '2026-10-18T17:48:08Z',
        assets: [
          asset('latest.yml'),
          asset('Zana-Command-Center-2.3.6-arm64.dmg.blockmap'),
          asset('Zana-Command-Center-2.3.6-arm64.dmg'),
          asset('Zana-Command-Center-2.3.6-arm64.zip'),
          asset('Zana-Command-Center-2.3.6-x64.dmg'),
          asset('Zana-Command-Center-2.3.6-win-x64-Setup.exe.blockmap'),
          asset('Zana-Command-Center-2.3.6-win-x64-Setup.exe')
        ]
      })
    ).toEqual({
      version: '2.3.6',
      releaseDate: '2026-10-18T17:48:08Z',
      macArm: url('Zana-Command-Center-2.3.6-arm64.dmg'),
      macIntel: url('Zana-Command-Center-2.3.6-x64.dmg'),
      windows: url('Zana-Command-Center-2.3.6-win-x64-Setup.exe')
    });
  });

  it('tolerates malformed payloads and rejects non-https URLs', () => {
    expect(pickReleaseAssets({})).toEqual({});
    expect(
      pickReleaseAssets({
        tag_name: 7,
        assets: [null, { name: 'a-arm64.dmg', browser_download_url: 'http://evil/a-arm64.dmg' }, { name: 1 }]
      })
    ).toEqual({});
  });
});

describe('latestReleaseApiUrl', () => {
  it('derives the API URL from a GitHub repo URL', () => {
    expect(latestReleaseApiUrl('https://github.com/salesforce/zana')).toBe(
      'https://api.github.com/repos/salesforce/zana/releases/latest'
    );
    expect(latestReleaseApiUrl('https://github.com/salesforce/zana/')).toBe(
      'https://api.github.com/repos/salesforce/zana/releases/latest'
    );
  });

  it('returns undefined for non-GitHub hosts', () => {
    expect(latestReleaseApiUrl('https://git.example.com/a/b')).toBeUndefined();
  });
});

describe('fetchLatestRelease', () => {
  const repo = 'https://github.com/salesforce/zana';

  it('fetches the latest release with a cached, time-bounded request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: 'v1.2.3' }) });
    await expect(fetchLatestRelease(repo, fetchImpl)).resolves.toEqual({ version: '1.2.3' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/salesforce/zana/releases/latest');
    expect(init.next).toEqual({ revalidate: 600 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns no assets when GitHub rejects, fails, or the repo is not on GitHub', async () => {
    await expect(fetchLatestRelease(repo, vi.fn().mockResolvedValue({ ok: false }))).resolves.toEqual({});
    await expect(fetchLatestRelease(repo, vi.fn().mockRejectedValue(new Error('offline')))).resolves.toEqual({});
    const fetchImpl = vi.fn();
    await expect(fetchLatestRelease('https://git.example.com/a/b', fetchImpl)).resolves.toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
