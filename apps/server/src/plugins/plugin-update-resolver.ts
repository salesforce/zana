import semver from 'semver';
import { createHash } from 'node:crypto';
import { parsePluginSource, type ParsedPluginSource } from '@zana-ai/zcc-domain';
import type { InstalledPluginRow } from './plugin-store.js';

export type PluginSourceIntent =
  | { kind: 'npm'; name: string; spec: string; specKind: 'default' | 'exact' | 'tag' | 'range'; registry?: string }
  | { kind: 'git'; url: string; selector: Extract<ParsedPluginSource, { kind: 'git' }>['selector']; subdir?: string;
      refKind?: 'branch' | 'tag' | 'commit'; resolvedTag?: string };

export interface PluginUpdateCandidate {
  version: string;
  commit?: string;
  tag?: string;
  integrity?: string;
}
export interface PluginUpdateCheck {
  fingerprint: string;
  checkedAt: number;
  outcome: 'current' | 'available' | 'pinned' | 'incompatible' | 'unavailable';
  candidate?: PluginUpdateCandidate;
  blocked?: { version: string; reasons: string[] };
  detail?: string;
}
export interface PluginUpdateResolver {
  npmVersions(intent: Extract<PluginSourceIntent, { kind: 'npm' }>): Promise<unknown>;
  gitRefs(url: string): Promise<string>;
  gitManifest(intent: Extract<PluginSourceIntent, { kind: 'git' }>, commit: string): Promise<{
    id: string; version: string; engines: { zcc?: string; zccPluginSdk?: string };
  }>;
}

/** Never re-read a catalog to recover an install's source: the catalog can change owners. */
export function installedSourceIntent(row: InstalledPluginRow): PluginSourceIntent | undefined {
  if (row.sourceIntent) return row.sourceIntent;
  const source = parsePluginSource(row.source);
  if (source.kind === 'npm' && row.sourceKind === 'npm') return source;
  if (source.kind === 'git' && row.sourceKind === 'git') {
    // Older catalog installs did not record monorepo paths or release prefixes.
    if (row.provenance === 'catalog') throw new Error('Reinstall this legacy catalog plugin to record its source and subdirectory before updating.');
    return { kind: 'git', url: source.url, selector: source.selector, subdir: source.subdir,
      refKind: source.selector.kind === 'ref' && source.selector.ref === 'HEAD' ? 'branch' : undefined };
  }
  return undefined;
}

export function pluginUpdateFingerprint(row: InstalledPluginRow, hostVersion: string, sdkVersion: string): string {
  return createHash('sha256').update(JSON.stringify([
    row.id, row.sourceKind, row.source, row.sourceIntent, row.rootDir, row.version,
    row.gitResolvedCommit, row.npmResolvedVersion, row.npmIntegrity, row.installedAt, row.updatedAt,
    hostVersion, sdkVersion
  ])).digest('hex');
}

export function pluginEngineProblems(engines: { zcc?: string; zccPluginSdk?: string }, host: string, sdk: string): string[] {
  return (['zcc', 'zccPluginSdk'] as const).flatMap((engine) => {
    const range = engines[engine];
    if (range === undefined) return [];
    const actual = engine === 'zcc' ? host : sdk;
    if (range.length > 256 || !semver.validRange(range)) return [`Invalid engines.${engine} range`];
    if (!semver.valid(actual) || !semver.satisfies(actual, range)) return [`plugin requires ${engine} ${range}; running ${actual}`];
    return [];
  });
}

export function parseRemoteGitRefs(output: string): Map<string, string> {
  const refs = new Map<string, string>();
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 2 || !/^[0-9a-f]{40}$/i.test(fields[0]!)) throw new Error('Git returned malformed refs');
    refs.set(fields[1]!, fields[0]!.toLowerCase());
  }
  return refs;
}

export function remoteGitRef(refs: Map<string, string>, ref: string, kind?: 'branch' | 'tag' | 'commit') {
  if (/^[0-9a-f]{7,40}$/i.test(ref)) return { commit: ref.toLowerCase(), refKind: 'commit' as const };
  const tag = refs.get(`refs/tags/${ref}^{}`) ?? refs.get(`refs/tags/${ref}`);
  if (kind !== 'branch' && tag) return { commit: tag, refKind: 'tag' as const };
  const branch = refs.get(ref === 'HEAD' ? 'HEAD' : `refs/heads/${ref}`);
  if (kind !== 'tag' && branch) return { commit: branch, refKind: 'branch' as const };
  throw new Error('The recorded Git ref is unavailable');
}

export async function resolvePluginUpdate(args: {
  row: InstalledPluginRow; intent: PluginSourceIntent; resolver: PluginUpdateResolver;
  hostVersion: string; sdkVersion: string; now: number;
}): Promise<PluginUpdateCheck> {
  const { row, intent, resolver } = args;
  const base = { fingerprint: pluginUpdateFingerprint(row, args.hostVersion, args.sdkVersion), checkedAt: args.now };
  const result = (outcome: PluginUpdateCheck['outcome'], extra: Partial<PluginUpdateCheck> = {}): PluginUpdateCheck => ({ ...base, outcome, ...extra });
  const problems = (engines: { zcc?: string; zccPluginSdk?: string }) => pluginEngineProblems(engines, args.hostVersion, args.sdkVersion);
  if (intent.kind === 'npm') {
    if (intent.specKind === 'exact') return result('pinned');
    const raw = await resolver.npmVersions(intent);
    const entries = Array.isArray(raw) ? raw : [raw];
    if (entries.length > 25_000) throw new Error('Registry version list exceeds the limit');
    let blocked: PluginUpdateCheck['blocked'];
    const versions = entries.map((item) => item as {
      version?: string; engines?: { zcc?: string; zccPluginSdk?: string }; 'dist.integrity'?: string; dist?: { integrity?: string };
    }).filter((item) => typeof item?.version === 'string' && semver.valid(item.version))
      .filter((item) => intent.specKind !== 'range' || semver.satisfies(item.version!, intent.spec))
      .filter((item) => intent.specKind !== 'default' || semver.prerelease(item.version!) === null)
      .sort((a, b) => semver.rcompare(a.version!, b.version!));
    for (const item of versions) {
      const version = item.version!;
      if (semver.valid(row.npmResolvedVersion ?? row.version) && !semver.gt(version, row.npmResolvedVersion ?? row.version)) break;
      const reasons = problems(item.engines ?? {});
      if (reasons.length) { blocked ??= { version, reasons }; continue; }
      const integrity = item['dist.integrity'] ?? item.dist?.integrity;
      if (!integrity || !/^sha(?:256|384|512)-\S+$/.test(integrity)) throw new Error('Registry did not provide a strong package integrity hash');
      return result('available', { candidate: { version, integrity }, ...(blocked ? { blocked } : {}) });
    }
    if (!versions.length) throw new Error('No published version matches the recorded source');
    return result(blocked ? 'incompatible' : 'current', blocked ? { blocked } : {});
  }
  const selector = intent.selector;
  if (selector.kind === 'ref' && (intent.refKind === 'commit' || /^[0-9a-f]{7,40}$/i.test(selector.ref))) return result('pinned');
  if (selector.kind === 'ref' && !intent.refKind && selector.ref !== 'HEAD') {
    return result('pinned', { detail: 'Legacy Git ref has no recorded branch/tag identity. Reinstall to enable tracking.' });
  }
  const refs = parseRemoteGitRefs(await resolver.gitRefs(intent.url));
  if (selector.kind === 'ref') {
    const remote = remoteGitRef(refs, selector.ref, intent.refKind);
    if (intent.refKind === 'tag') {
      if (remote.commit !== row.gitResolvedCommit) throw new Error('The installed Git tag moved. Reinstall explicitly to accept its new commit.');
      return result('pinned');
    }
    if (remote.commit === row.gitResolvedCommit) return result('current');
    const manifest = await resolver.gitManifest(intent, remote.commit);
    if (manifest.id !== row.id) throw new Error('The candidate plugin identity changed');
    if (!semver.valid(manifest.version)) throw new Error('The candidate plugin version is invalid');
    const reasons = problems(manifest.engines);
    if (reasons.length) return result('incompatible', { blocked: { version: manifest.version, reasons } });
    return result('available', { candidate: { version: manifest.version, commit: remote.commit } });
  }
  if (!semver.validRange(selector.range)) throw new Error('Invalid recorded Git version range');
  if (intent.resolvedTag) {
    const recorded = remoteGitRef(refs, intent.resolvedTag, 'tag');
    if (recorded.commit !== row.gitResolvedCommit) throw new Error('The installed Git release tag moved. Reinstall explicitly to accept its new commit.');
  } else if (row.gitResolvedCommit) {
    throw new Error('Legacy Git range has no recorded release tag. Reinstall to enable tracking.');
  }
  const tags = [...refs].flatMap(([ref, commit]) => {
    if (!ref.startsWith('refs/tags/') || ref.endsWith('^{}')) return [];
    const tag = ref.slice(10);
    if (!tag.startsWith(selector.tagPrefix)) return [];
    const version = semver.valid(tag.slice(selector.tagPrefix.length));
    if (!version || !semver.satisfies(version, selector.range)) return [];
    return [{ tag, version, commit: refs.get(`${ref}^{}`) ?? commit }];
  }).sort((a, b) => semver.rcompare(a.version, b.version));
  let blocked: PluginUpdateCheck['blocked'];
  let probed = 0;
  for (const tag of tags) {
    if (tag.commit === row.gitResolvedCommit || (semver.valid(row.version) && !semver.gt(tag.version, row.version))) break;
    if (++probed > 10) throw new Error('No compatible Git release found within the candidate limit');
    const manifest = await resolver.gitManifest(intent, tag.commit);
    if ((row.id && manifest.id !== row.id) || !semver.eq(manifest.version, tag.version)) throw new Error('Git release manifest does not match its tag or plugin identity');
    const reasons = problems(manifest.engines);
    if (reasons.length) { blocked ??= { version: tag.version, reasons }; continue; }
    return result('available', { candidate: { ...tag }, ...(blocked ? { blocked } : {}) });
  }
  if (!tags.length) throw new Error('No Git release matches the recorded range and prefix');
  return result(blocked ? 'incompatible' : 'current', blocked ? { blocked } : {});
}
