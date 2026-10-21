/** Download-page helpers: visitor OS detection and GitHub release asset lookup. */

export type Platform = 'mac' | 'windows' | 'linux' | 'other';

export interface ReleaseAssets {
  version?: string;
  releaseDate?: string;
  macArm?: string;
  macIntel?: string;
  windows?: string;
}

interface GitHubRelease {
  tag_name?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

/** Best-effort OS from `navigator.userAgentData.platform` or the user-agent string. */
export function detectPlatform(userAgent: string, platformHint?: string): Platform {
  const source = `${platformHint ?? ''} ${userAgent}`.toLowerCase();
  // iOS/Android cannot run the desktop app; check them before mac/linux tokens.
  if (/iphone|ipad|ipod|android/.test(source)) return 'other';
  if (/windows|win32|win64/.test(source)) return 'windows';
  if (/mac/.test(source)) return 'mac';
  if (/linux|x11|cros/.test(source)) return 'linux';
  return 'other';
}

/** Project the GitHub "latest release" API payload onto the installers we link. */
export function pickReleaseAssets(release: GitHubRelease): ReleaseAssets {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const find = (pattern: RegExp): string | undefined => {
    for (const asset of assets) {
      const { name, browser_download_url: url } = (asset ?? {}) as Record<string, unknown>;
      if (typeof name === 'string' && typeof url === 'string' && pattern.test(name) && url.startsWith('https://')) {
        return url;
      }
    }
    return undefined;
  };
  const tag = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : undefined;
  return {
    version: tag || undefined,
    releaseDate: typeof release.published_at === 'string' ? release.published_at : undefined,
    macArm: find(/-arm64\.dmg$/),
    macIntel: find(/-x64\.dmg$/),
    windows: find(/-win-x64-Setup\.exe$/i)
  };
}

/** `https://github.com/owner/repo` → `https://api.github.com/repos/owner/repo/releases/latest`. */
export function latestReleaseApiUrl(repoUrl: string): string | undefined {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/.exec(repoUrl);
  return match ? `https://api.github.com/repos/${match[1]}/${match[2]}/releases/latest` : undefined;
}

/** Seconds the download page caches the latest-release lookup (keeps us far below GitHub's anonymous rate limit). */
export const RELEASE_REVALIDATE_SECONDS = 600;

/** Server-side lookup of the latest release's installers; `{}` when GitHub is unreachable or rate-limited. */
export async function fetchLatestRelease(repoUrl: string, fetchImpl: typeof fetch = fetch): Promise<ReleaseAssets> {
  const api = latestReleaseApiUrl(repoUrl);
  if (!api) return {};
  try {
    const response = await fetchImpl(api, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: RELEASE_REVALIDATE_SECONDS }
    } as RequestInit);
    return response.ok ? pickReleaseAssets(await response.json()) : {};
  } catch {
    return {};
  }
}
