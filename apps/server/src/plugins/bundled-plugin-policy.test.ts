import { describe, expect, it } from 'vitest';
import { readPluginManifest } from '@zana-ai/zcc-domain';
import { assertBundledPluginInstall, bundledPluginById, bundledPluginSourceNotice, reconcileBundledPluginMetadata } from './bundled-plugin-policy.js';
import type { InstalledPluginRow, PluginSourceKind } from './plugin-store.js';

const manifest = readPluginManifest({
  name: 'zcc-plugin-docs', version: '2.0.0',
  engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
  zcc: { name: 'Library', description: 'New bundled library', branding: { icon: 'Library' }, server: './new.mjs' }
});

function row(): InstalledPluginRow {
  return {
    id: 'docs', version: '1.0.0', name: 'Old library', description: 'Old description', icon: 'Puzzle',
    enabled: false, status: 'disabled', statusDetail: null, provenance: 'builtin', sourceKind: 'builtin',
    source: 'builtin:docs', rootDir: '/old', serverEntry: './old.mjs', appEntry: './old.js',
    npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null,
    installedAt: 1, updatedAt: 2, toolPolicy: 'true'
  };
}

describe('bundled plugin ownership', () => {
  it('resolves only host-registered identities', () => {
    expect(bundledPluginById('docs')?.name).toBe('docs');
    expect(bundledPluginById('third-party')).toBeUndefined();
  });

  it.each(['git', 'npm', 'path'] as PluginSourceKind[])('rejects %s shadowing in production', sourceKind => {
    expect(() => assertBundledPluginInstall({ id: 'docs', sourceKind, source: 'external', development: false }))
      .toThrow(/reserved.*builtin:docs/);
  });

  it.each(['git', 'npm'] as PluginSourceKind[])('rejects %s shadowing even in development', sourceKind => {
    expect(() => assertBundledPluginInstall({ id: 'docs', sourceKind, source: 'external', development: true }))
      .toThrow(/reserved/);
  });

  it('allows explicit managed local development and unrelated independent identities', () => {
    expect(() => assertBundledPluginInstall({ id: 'docs', sourceKind: 'path', source: 'path:/dev', development: true })).not.toThrow();
    expect(() => assertBundledPluginInstall({ id: 'third-party', sourceKind: 'git', source: 'git:repo', development: false })).not.toThrow();
    expect(() => assertBundledPluginInstall({ id: 'docs', sourceKind: 'builtin', source: 'builtin:docs', development: false })).not.toThrow();
  });

  it.each(['builtin:missing', 'builtin:tasks'])('refuses a mismatched bundled manifest from %s', source => {
    expect(() => assertBundledPluginInstall({ id: 'docs', sourceKind: 'builtin', source, development: true })).toThrow(/identity mismatch/);
  });

  it('provides migration guidance without claiming that old data was migrated', () => {
    expect(bundledPluginSourceNotice({ id: 'docs', sourceKind: 'git' }, true)).toMatch(/current code and data are retained.*remote updates are blocked/);
    expect(bundledPluginSourceNotice({ id: 'docs', sourceKind: 'path' }, false)).toContain('migrate');
    expect(bundledPluginSourceNotice({ id: 'docs', sourceKind: 'path' }, true)).toBeNull();
    expect(bundledPluginSourceNotice({ id: 'docs', sourceKind: 'builtin' }, false)).toBeNull();
    expect(bundledPluginSourceNotice({ id: 'third-party', sourceKind: 'git' }, false)).toBeNull();
  });

  it('refreshes shipped metadata without changing user choices or learned policy', () => {
    const original = { ...row(), catalogMarketplace: 'old', catalogEntryId: 'docs', gitResolvedCommit: 'old' };
    const updated = reconcileBundledPluginMetadata(original, '/new', manifest, 10);
    expect(updated).toMatchObject({
      version: '2.0.0', name: 'Library', description: 'New bundled library', icon: 'Library', rootDir: '/new',
      serverEntry: './new.mjs', appEntry: null, catalogMarketplace: null, catalogEntryId: null, gitResolvedCommit: null,
      enabled: false, status: 'disabled', installedAt: 1, updatedAt: 10, toolPolicy: 'true'
    });
    expect(original.updatedAt).toBe(2);
    expect(reconcileBundledPluginMetadata(updated, '/new', manifest, 20)).toBe(updated);
  });

  it('refuses to repoint a corrupted installed identity', () => {
    expect(() => reconcileBundledPluginMetadata({ ...row(), id: 'tasks' }, '/new', manifest, 10)).toThrow(/identity changed/);
  });

  it('uses the standard icon fallback when branding has no icon', () => {
    expect(reconcileBundledPluginMetadata(row(), '/new', { ...manifest, branding: {} }, 10).icon).toBe('Puzzle');
  });
});


describe('externalized plugin ownership', () => {
  const install = (sourceKind: PluginSourceKind, source: string) => assertBundledPluginInstall({ id: 'salesforce', sourceKind, source, development: false });
  it('accepts the independent repository, local development and retained legacy registrations', () => {
    expect(() => install('git', 'git:https://github.com/grebmann1/zcc-plugin-salesforce.git@runtime')).not.toThrow();
    expect(() => install('git', 'git:https://github.com/grebmann1/zcc-plugin-salesforce@v0.1.0')).not.toThrow();
    expect(() => install('path', 'path:/local/salesforce')).not.toThrow();
    expect(() => install('builtin', 'builtin:salesforce')).not.toThrow();
    expect(bundledPluginById('salesforce')).toBeUndefined();
  });
  it.each([
    ['git', 'git:https://github.com/attacker/salesforce.git@runtime'],
    ['git', 'git:https://github.com/grebmann1/zcc-plugin-salesforce.git.evil@runtime'],
    ['npm', 'npm:salesforce'], ['builtin', 'builtin:docs']
  ] as [PluginSourceKind, string][])('rejects identity takeover from %s %s', (kind, source) => {
    expect(() => install(kind, source)).toThrow(/reserved/);
  });
});
