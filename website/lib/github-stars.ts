/**
 * Public GitHub star count for the marketing nav. Isolated from OAuth
 * (`github.ts`) so a failed count fetch can never affect publisher login.
 *
 * Prefers `GET https://api.github.com/repos/{owner}/{repo}` and reads
 * `stargazers_count`. Extra query params (`page`, `type=star`, `count`,
 * `size`) are not part of that endpoint and are ignored by GitHub, so we
 * don't send them. Falls back to shields.io when GitHub is rate-limited.
 */

const GITHUB_API = 'https://api.github.com/repos';
const SHIELDS_STARS = 'https://img.shields.io/github/stars';
const STAR_REVALIDATE_SECONDS = 3600;

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export function parseGitHubRepo(repoUrl: string): GitHubRepoRef | null {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'github.com') return null;
  const [, owner, rawRepo] = parsed.pathname.split('/');
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/i, '');
  if (!repo) return null;
  return { owner, repo };
}

export function formatStarCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '0';
  if (count < 1000) return String(Math.floor(count));
  const thousands = count / 1000;
  const compact = Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1).replace(/\.0$/, '');
  return `${compact}k`;
}

export function parseShieldsStarValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = (match[2] ?? '').toLowerCase();
  const mul = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1000 : 1;
  return Math.floor(n * mul);
}

function requestInit(opts?: { fetchImpl?: typeof fetch; token?: string; authorize?: boolean }): RequestInit & { next?: { revalidate: number } } {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'zana-command-center-website'
  };
  const token = opts?.token ?? process.env.GITHUB_TOKEN;
  if (opts?.authorize !== false && token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit & { next?: { revalidate: number } } = { headers };
  if (!opts?.fetchImpl) init.next = { revalidate: STAR_REVALIDATE_SECONDS };
  return init;
}

async function readGitHubStars(url: string, doFetch: typeof fetch, init: RequestInit): Promise<number | null> {
  const res = await doFetch(url, init);
  if (!res.ok) return null;
  const body = (await res.json()) as { stargazers_count?: unknown };
  return typeof body.stargazers_count === 'number' && Number.isFinite(body.stargazers_count) && body.stargazers_count >= 0
    ? Math.floor(body.stargazers_count)
    : null;
}

async function readShieldsStars(url: string, doFetch: typeof fetch, init: RequestInit): Promise<number | null> {
  const res = await doFetch(url, init);
  if (!res.ok) return null;
  const body = (await res.json()) as { value?: unknown; message?: unknown };
  return parseShieldsStarValue(body.value) ?? parseShieldsStarValue(body.message);
}

export async function fetchRepoStarCount(opts?: {
  repoUrl?: string;
  fetchImpl?: typeof fetch;
  token?: string;
}): Promise<number | null> {
  const parsed = parseGitHubRepo(opts?.repoUrl ?? '');
  if (!parsed) return null;
  const doFetch = opts?.fetchImpl ?? fetch;
  const githubInit = requestInit(opts);
  const shieldsInit = requestInit({ ...opts, authorize: false });
  const githubUrl = `${GITHUB_API}/${parsed.owner}/${parsed.repo}`;
  const shieldsUrl = `${SHIELDS_STARS}/${parsed.owner}/${parsed.repo}.json`;
  try {
    const fromGitHub = await readGitHubStars(githubUrl, doFetch, githubInit);
    if (fromGitHub != null) return fromGitHub;
  } catch {
    /* fall through to shields */
  }
  try {
    return await readShieldsStars(shieldsUrl, doFetch, shieldsInit);
  } catch {
    return null;
  }
}
