import { describe, expect, it, vi } from 'vitest';
import { installedSourceIntent, parseRemoteGitRefs, pluginEngineProblems, pluginUpdateFingerprint, remoteGitRef, resolvePluginUpdate, type PluginSourceIntent, type PluginUpdateResolver } from './plugin-update-resolver.js';
import type { InstalledPluginRow } from './plugin-store.js';

const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
const npm: PluginSourceIntent = { kind: 'npm', name: 'test-plugin', spec: '^1.0.0', specKind: 'range' };
const git: PluginSourceIntent = { kind: 'git', url: 'https://example.test/repo', selector: { kind: 'ref', ref: 'HEAD' }, refKind: 'branch', subdir: 'plugins/test' };
const range: PluginSourceIntent = { kind: 'git', url: git.url, selector: { kind: 'range', range: '^1.0.0', tagPrefix: 'test-' }, resolvedTag: 'test-v1.0.0' };
const row = (extra: Partial<InstalledPluginRow> = {}): InstalledPluginRow => ({
  id: 'test', version: '1.0.0', sourceKind: 'git', source: 'git:https://example.test/repo@HEAD', provenance: 'direct',
  rootDir: '/installed', gitResolvedCommit: a, npmResolvedVersion: '1.0.0', sourceIntent: git,
  ...extra
} as InstalledPluginRow);
const version = (v: string, engines = {}, integrity: string | undefined = 'sha512-hash') => ({ version: v, engines, 'dist.integrity': integrity });
function setup(intent: PluginSourceIntent = git, extra: Partial<InstalledPluginRow> = {}) {
  const resolver: PluginUpdateResolver = {
    npmVersions: vi.fn(async () => [version('1.0.0'), version('1.1.0')]),
    gitRefs: vi.fn(async () => `${b}\tHEAD\n${a}\trefs/tags/test-v1.0.0\n${b}\trefs/tags/test-v1.1.0\n`),
    gitManifest: vi.fn(async () => ({ id: 'test', version: '1.1.0', engines: {} }))
  };
  const args = { row: row({ sourceKind: intent.kind, sourceIntent: intent, ...extra }), intent, resolver, hostVersion: '1.2.0', sdkVersion: '0.5.0', now: 123 };
  return { resolver, args, run: () => resolvePluginUpdate(args) };
}

describe('independent plugin update resolution', () => {
  it('selects newer npm releases within the recorded range and retains integrity', async () => {
    const s = setup(npm);
    s.resolver.npmVersions = async () => [version('1.1.0-beta.1'), version('2.0.0'), version('1.2.0'), version('1.0.0')];
    expect(await s.run()).toMatchObject({ checkedAt: 123, outcome: 'available', candidate: { version: '1.2.0', integrity: 'sha512-hash' } });
  });
  it('uses npm stable releases by default and allows intentional prerelease tags', async () => {
    const s = setup({ ...npm, spec: '', specKind: 'default' });
    s.resolver.npmVersions = async () => [version('1.2.0-beta.1'), version('1.1.0')];
    expect(await s.run()).toMatchObject({ candidate: { version: '1.1.0' } });
    s.args.intent = { ...npm, spec: 'next', specKind: 'tag' };
    s.resolver.npmVersions = async () => version('1.2.0-beta.1');
    expect(await s.run()).toMatchObject({ candidate: { version: '1.2.0-beta.1' } });
  });
  it('finds a compatible npm release and reports the newest blocked one', async () => {
    const s = setup(npm);
    s.resolver.npmVersions = async () => [version('1.3.0', { zcc: '>=9' }), version('1.2.0', { zccPluginSdk: '^0.5.0' })];
    expect(await s.run()).toMatchObject({ outcome: 'available', candidate: { version: '1.2.0' }, blocked: { version: '1.3.0', reasons: [expect.stringContaining('requires zcc')] } });
  });
  it('reports incompatibility while preserving a current compatible version', async () => {
    const s = setup(npm);
    s.resolver.npmVersions = async () => [version('1.2.0', { zccPluginSdk: '>=8' }), version('1.0.0')];
    expect(await s.run()).toMatchObject({ outcome: 'incompatible', blocked: { version: '1.2.0' } });
  });
  it.each(['1.0.0', '0.9.0'])('never offers the npm version %s as a downgrade', async v => {
    const s = setup({ ...npm, spec: '*', specKind: 'range' }); s.resolver.npmVersions = async () => version(v);
    expect(await s.run()).toMatchObject({ outcome: 'current' });
  });
  it('does not contact the registry for exact npm pins', async () => {
    const s = setup({ ...npm, spec: '1.0.0', specKind: 'exact' });
    expect(await s.run()).toMatchObject({ outcome: 'pinned' }); expect(s.resolver.npmVersions).not.toHaveBeenCalled();
  });
  it.each([[], [version('1.1.0', {}, '')], [null], Array(25_001).fill({})])('rejects unusable or unbounded registry metadata', async metadata => {
    const s = setup(npm); s.resolver.npmVersions = async () => metadata;
    await expect(s.run()).rejects.toThrow();
  });
  it('checks a branch commit and probes only its manifest', async () => {
    const s = setup();
    expect(await s.run()).toMatchObject({ outcome: 'available', candidate: { version: '1.1.0', commit: b } });
    expect(s.resolver.gitManifest).toHaveBeenCalledWith(git, b);
    s.resolver.gitRefs = async () => `${a}\tHEAD\n`;
    expect(await s.run()).toMatchObject({ outcome: 'current' });
  });
  it('reports incompatible branch manifests and rejects changed plugin identities', async () => {
    const s = setup(); s.resolver.gitManifest = async () => ({ id: 'test', version: '2.0.0', engines: { zcc: '>=3' } });
    expect(await s.run()).toMatchObject({ outcome: 'incompatible', blocked: { version: '2.0.0' } });
    s.resolver.gitManifest = async () => ({ id: 'other', version: '1.1.0', engines: {} });
    await expect(s.run()).rejects.toThrow(/identity/);
  });
  it('keeps exact commits and ambiguous legacy refs pinned', async () => {
    for (const intent of [
      { ...git, selector: { kind: 'ref' as const, ref: a }, refKind: 'commit' as const },
      { ...git, selector: { kind: 'ref' as const, ref: 'release' }, refKind: undefined }
    ]) {
      const s = setup(intent); expect(await s.run()).toMatchObject({ outcome: 'pinned' }); expect(s.resolver.gitRefs).not.toHaveBeenCalled();
    }
  });
  it('refuses moved or missing tags, including installed range tags', async () => {
    for (const intent of [range, { ...git, selector: { kind: 'ref' as const, ref: 'test-v1.0.0' }, refKind: 'tag' as const }]) {
      const s = setup(intent); s.resolver.gitRefs = async () => `${b}\trefs/tags/test-v1.0.0\n`;
      await expect(s.run()).rejects.toThrow(/moved/);
      s.resolver.gitRefs = async () => ''; await expect(s.run()).rejects.toThrow(/unavailable/);
    }
  });
  it('keeps immutable tags pinned even when a branch shares their name', async () => {
    const s = setup({ ...git, selector: { kind: 'ref', ref: 'test-v1.0.0' }, refKind: 'tag' });
    expect(await s.run()).toMatchObject({ outcome: 'pinned' });
  });
  it('uses annotated tag commits, range and monorepo prefix', async () => {
    const s = setup(range);
    s.resolver.gitRefs = async () => `${a}\trefs/tags/test-v1.0.0\n${a}\trefs/tags/test-v1.1.0\n${b}\trefs/tags/test-v1.1.0^{}\n${c}\trefs/tags/other-v8.0.0\n`;
    expect(await s.run()).toMatchObject({ candidate: { tag: 'test-v1.1.0', commit: b, version: '1.1.0' } });
  });
  it('skips incompatible Git releases and preserves their reasons', async () => {
    const s = setup(range);
    s.resolver.gitRefs = async () => `${a}\trefs/tags/test-v1.0.0\n${b}\trefs/tags/test-v1.1.0\n${c}\trefs/tags/test-v1.2.0\n`;
    s.resolver.gitManifest = async (_intent, commit) => ({ id: 'test', version: commit === c ? '1.2.0' : '1.1.0', engines: commit === c ? { zcc: '>=2' } : {} });
    expect(await s.run()).toMatchObject({ outcome: 'available', candidate: { commit: b }, blocked: { version: '1.2.0' } });
  });
  it('reports current, incompatible, missing and malformed Git ranges', async () => {
    const s = setup(range);
    s.resolver.gitRefs = async () => `${a}\trefs/tags/test-v1.0.0\n`;
    expect(await s.run()).toMatchObject({ outcome: 'current' });
    s.resolver.gitRefs = async () => `${a}\trefs/tags/test-v1.0.0\n${b}\trefs/tags/test-v1.1.0\n`;
    s.resolver.gitManifest = async () => ({ id: 'test', version: '1.1.0', engines: { zcc: '>=9' } });
    expect(await s.run()).toMatchObject({ outcome: 'incompatible' });
    s.args.intent = { ...range, selector: { kind: 'range', range: '>=8', tagPrefix: 'test-' } };
    await expect(s.run()).rejects.toThrow(/No Git release/);
    s.args.intent = { ...range, selector: { kind: 'range', range: 'invalid', tagPrefix: '' } };
    await expect(s.run()).rejects.toThrow(/Invalid/);
    s.args.intent = { ...range, resolvedTag: undefined };
    await expect(s.run()).rejects.toThrow(/Legacy/);
  });
  it('rejects Git releases whose manifest version differs from their tag', async () => {
    const s = setup(range); s.resolver.gitManifest = async () => ({ id: 'test', version: '9.0.0', engines: {} });
    await expect(s.run()).rejects.toThrow(/does not match/);
  });
  it('bounds manifest probes even if many newer tags are incompatible', async () => {
    const s = setup(range);
    s.resolver.gitRefs = async () => `${a}\trefs/tags/test-v1.0.0\n` + Array.from({ length: 11 }, (_, i) => `${b}\trefs/tags/test-v1.${i + 1}.0\n`).join('');
    let i = 12;
    s.resolver.gitManifest = vi.fn(async () => ({ id: 'test', version: `1.${--i}.0`, engines: { zcc: '>=9' } }));
    await expect(s.run()).rejects.toThrow(/candidate limit/); expect(s.resolver.gitManifest).toHaveBeenCalledTimes(10);
  });
  it('validates refs and preserves a known branch when a new tag shadows it', () => {
    expect(() => parseRemoteGitRefs('bad refs/heads/main')).toThrow(/malformed/);
    expect(() => parseRemoteGitRefs(`${a} ref extra`)).toThrow(/malformed/);
    const refs = parseRemoteGitRefs(`${a}\trefs/tags/main\n${b}\trefs/heads/main\n`);
    expect(remoteGitRef(refs, 'main')).toEqual({ commit: a, refKind: 'tag' });
    expect(remoteGitRef(refs, 'main', 'branch')).toEqual({ commit: b, refKind: 'branch' });
    expect(remoteGitRef(refs, a)).toEqual({ commit: a, refKind: 'commit' });
  });
  it('validates host and SDK ranges using full SemVer semantics', () => {
    expect(pluginEngineProblems({ zcc: '^0.1.0', zccPluginSdk: '0.5.x || >=1' }, '0.2.0', '0.5.0')).toHaveLength(1);
    expect(pluginEngineProblems({ zcc: 'garbage' }, '1.0.0', '0.5.0')).toEqual(['Invalid engines.zcc range']);
    expect(pluginEngineProblems({ zcc: '*' }, 'bad', '0.5.0')).toHaveLength(1);
  });
  it('recovers only safe legacy intent and binds checks to install plus host identity', () => {
    expect(installedSourceIntent(row())).toEqual(git);
    expect(installedSourceIntent(row({ sourceIntent: undefined }))).toMatchObject({ kind: 'git', refKind: 'branch' });
    expect(() => installedSourceIntent(row({ sourceIntent: undefined, provenance: 'catalog' }))).toThrow(/Reinstall/);
    expect(installedSourceIntent(row({ sourceIntent: undefined, sourceKind: 'npm', source: 'npm:test@^1.0.0' }))).toMatchObject({ kind: 'npm' });
    expect(installedSourceIntent(row({ sourceIntent: undefined, sourceKind: 'path', source: '/local' }))).toBeUndefined();
    expect(pluginUpdateFingerprint(row(), '1', '1')).not.toBe(pluginUpdateFingerprint(row(), '2', '1'));
    expect(pluginUpdateFingerprint(row(), '1', '1')).not.toBe(pluginUpdateFingerprint(row({ rootDir: '/new' }), '1', '1'));
  });
});
