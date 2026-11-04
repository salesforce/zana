import { expect, it } from 'vitest';
import { parsePluginSource } from '@zana-ai/zcc-domain';
import { exactResolutionLabel, marketplaceInstallSpec, parseMarketplaceIndex, type MarketplaceEntry } from './marketplace.js';

const entry: MarketplaceEntry = { id: 'fixture', displayName: 'Fixture', description: 'Fixture', author: { name: 'Fixture' },
  source: { git: { url: 'https://example.test/repo' } } };

it.each([
  {}, { ref: 'main' }, { range: '^1.0.0' }, { range: '^1.0.0', tagPrefix: 'fixture- &+' },
  { ref: 'a'.repeat(40), subdir: 'plugins/fixture &+#' }, { range: '^1.0.0', subdir: 'plugins/fixture', tagPrefix: 'fixture-' }
])('round-trips a complete catalog Git source: %o', options => {
  const source = { ...entry, source: { git: { url: 'https://example.test/repo', ...options } } };
  const parsed = parsePluginSource(marketplaceInstallSpec(source));
  expect(parsed).toMatchObject({ kind: 'git', url: source.source.git.url,
    selector: 'range' in options ? { kind: 'range', range: options.range, tagPrefix: 'tagPrefix' in options ? options.tagPrefix : '' }
      : { kind: 'ref', ref: 'ref' in options ? options.ref : 'HEAD' } });
  if ('subdir' in options) expect(parsed).toMatchObject({ subdir: options.subdir });
});

it('preserves npm sources and rejects entries without an installable source', () => {
  const npm = { ...entry, source: { npm: { package: '@fixture/plugin', range: '^1.0.0' } } };
  expect(marketplaceInstallSpec(npm)).toBe('npm:@fixture/plugin@^1.0.0');
  expect(() => marketplaceInstallSpec({ ...entry, source: {} })).toThrow('no installable source');
  expect(parseMarketplaceIndex({ schemaVersion: 1, name: 'fixture', displayName: 'Fixture', plugins: [npm] }).plugins).toHaveLength(1);
  expect(() => parseMarketplaceIndex({})).toThrow();
});

it('labels npm and Git resolutions without losing the displayed selector', () => {
  const npm = { ...entry, source: { npm: { package: '@fixture/plugin', range: '^1.0.0' } } };
  expect(exactResolutionLabel(npm)).toBe('npm @fixture/plugin@^1.0.0');
  expect(exactResolutionLabel(npm, { version: '1.2.0' })).toBe('npm @fixture/plugin@1.2.0');
  expect(exactResolutionLabel(entry)).toBe('git https://example.test/repo@HEAD');
  expect(exactResolutionLabel(entry, { commit: 'abc' })).toBe('git https://example.test/repo@abc');
  expect(exactResolutionLabel({ ...entry, source: { git: { url: 'https://example.test/repo', ref: 'main' } } })).toContain('@main');
  expect(exactResolutionLabel({ ...entry, source: { git: { url: 'https://example.test/repo', range: '^1' } } })).toContain('@^1');
  expect(exactResolutionLabel({ ...entry, source: {} })).toContain('@HEAD');
});
