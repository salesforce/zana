/**
 * Shapes mirrored from the desktop app so the website reads the EXACT SAME feeds:
 *   - RegistryRelease / RegistryIndex  ← packages/extension-sdk/src/index.ts
 *   - the public extension catalog is the same `index.json` the app fetches via
 *     `src/main/extension-registry.ts` (registryUrl).
 *
 * Keep these in sync with the app. They are intentionally a narrow, read-only
 * projection — the website never installs or verifies, it only displays.
 */

export interface RegistryRelease {
  id: string;
  version: string;
  /** Host-contract range this release needs (e.g. "^1.0.0"). */
  zccApi: string;
  /** Absolute URL of the release archive. */
  url: string;
  /** Lowercase hex sha256 of the archive bytes. */
  sha256: string;
  /** Base64 detached signature, when the release is signed. */
  signature?: string;
  title?: string;
  description?: string;
  author?: string;
  /** Lucide icon name. */
  icon?: string;
  permissions?: string[];
}

export interface RegistryIndex {
  schema: 1;
  releases: RegistryRelease[];
}

/** One catalog row, the highest version per id joined across releases. */
export interface CatalogEntry {
  id: string;
  version: string;
  title: string;
  description?: string;
  author?: string;
  icon?: string;
  permissions: string[];
  /** All published versions for this id, newest first. */
  versions: string[];
}

/** SemVer-ish compare: returns >0 when a is newer than b. Loose, display-only. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Project a registry index onto catalog rows (one per id, newest version). */
export function toCatalog(index: RegistryIndex): CatalogEntry[] {
  const byId = new Map<string, RegistryRelease[]>();
  for (const r of index.releases ?? []) {
    const list = byId.get(r.id) ?? [];
    list.push(r);
    byId.set(r.id, list);
  }
  const rows: CatalogEntry[] = [];
  for (const [id, releases] of byId) {
    const sorted = [...releases].sort((a, b) => compareVersions(b.version, a.version));
    const best = sorted[0];
    rows.push({
      id,
      version: best.version,
      title: best.title ?? id,
      description: best.description,
      author: best.author,
      icon: best.icon,
      permissions: best.permissions ?? [],
      versions: sorted.map((r) => r.version)
    });
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Fetch + project the public registry. Returns [] (never throws) when the feed
 * is unset or unreachable — mirrors the app's fail-soft "empty catalog" posture.
 * The URL is supplied per-environment via NEXT_PUBLIC_REGISTRY_URL.
 */
export async function fetchCatalog(registryUrl: string | undefined): Promise<CatalogEntry[]> {
  if (!registryUrl || !/^https:\/\//i.test(registryUrl)) return [];
  try {
    const res = await fetch(registryUrl, { cache: 'no-store' });
    if (!res.ok) return [];
    const index = (await res.json()) as RegistryIndex;
    if (index?.schema !== 1 || !Array.isArray(index.releases)) return [];
    return toCatalog(index);
  } catch {
    return [];
  }
}
