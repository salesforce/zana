import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginPackIdentity } from '@zana-ai/zcc-domain';
import type { MarketplaceCatalogRow } from './marketplace-store.js';
import { createPluginPackService, pluginPackStorePath } from './plugin-packs.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const identity: PluginPackIdentity = { marketplaceSource: 'git:https://example.test/team/catalog', packId: 'essentials' };
const memberEntry = (id: string) => ({ id, displayName: id.toUpperCase(), description: `${id} description`, author: { name: 'Author' }, source: { npm: { package: `@test/${id}`, range: '1.2.0' } } });

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'plugin-packs-'));
  dirs.push(dataDir);
  let clock = 1000;
  const catalogs: MarketplaceCatalogRow[] = [{
    source: identity.marketplaceSource, sourceKind: 'git', name: 'internal', displayName: 'Internal', addedAt: 0,
    entryCount: 3, lastRefreshAt: 0, lastAttemptAt: 0, lastError: null, official: false,
    cachedIndex: { schemaVersion: 1, name: 'internal', displayName: 'Internal', plugins: ['notes', 'search', 'optional'].map(memberEntry) },
    cachedPacks: { schemaVersion: 1, packs: [{ id: 'essentials', displayName: 'Essentials', description: 'A useful pack', members: [{ pluginId: 'notes' }, { pluginId: 'search' }, { pluginId: 'optional' }] }] }
  }];
  const installed: Array<{ id: string; version: string; source: string; enabled?: boolean }> = [];
  const installMember = vi.fn(async ({ entry }: { entry: ReturnType<typeof memberEntry> }) => {
    const row = { id: entry.id, version: '1.2.0', source: `npm:@test/${entry.id}@1.2.0` };
    installed.push(row);
    return row;
  });
  const create = () => createPluginPackService({
    dataDir, catalogs: () => catalogs, installed: () => installed,
    installMember: (input) => installMember(input as Parameters<typeof installMember>[0]), now: () => clock
  });
  return { dataDir, catalogs, installed, installMember, create, service: create(), advance: (ms: number) => { clock += ms; } };
}

describe('plugin pack service', () => {
  it('lists source-qualified packs and returns a detached snapshot', async () => {
    const f = fixture();
    expect(f.service.list()).toEqual([expect.objectContaining({ identity, marketplaceName: 'internal' })]);
    f.service.list()[0]!.pack.members.length = 0;
    expect(f.service.list()[0]!.pack.members).toHaveLength(3);
    const plan = await f.service.plan(identity);
    expect(plan.members.map((member) => member.status)).toEqual(['available', 'available', 'available']);
    expect(plan.members[0]).toMatchObject({ sourceLabel: 'npm:@test/notes@1.2.0', targetVersion: '1.2.0', required: false });
  });

  it('installs only explicit selections through the ordinary installer and persists grouping', async () => {
    const f = fixture();
    const plan = await f.service.plan(identity);
    const result = await f.service.install({ identity, planId: plan.planId, pluginIds: ['notes', 'search'] });
    expect(result.members.map((member) => [member.pluginId, member.status, member.selected])).toEqual([
      ['notes', 'installed', true], ['search', 'installed', true], ['optional', 'skipped', false]
    ]);
    expect(f.installMember).toHaveBeenCalledTimes(2);
    expect(f.installMember.mock.calls[0]?.[0]).toMatchObject({ marketplaceSource: identity.marketplaceSource, marketplaceName: 'internal', pluginId: 'notes', entry: memberEntry('notes') });
    expect(f.create().listInstalled()).toEqual([result]);
    await expect(f.service.install({ identity, planId: plan.planId, pluginIds: ['notes'] })).rejects.toThrow(/expired/);
  });

  it('keeps existing versions, sources and enabled state even when the pack uses another source', async () => {
    const f = fixture();
    const existing = { id: 'notes', version: '9.0.0', source: 'path:/private/work', enabled: false };
    f.installed.push(existing);
    const plan = await f.service.plan(identity);
    expect(plan.members[0]).toMatchObject({ status: 'installed', installedVersion: '9.0.0', installedSource: 'path:/private/work' });
    const result = await f.service.install({ identity, planId: plan.planId, pluginIds: ['notes'] });
    expect(result.members[0]).toMatchObject({ status: 'installed', version: '9.0.0', source: 'path:/private/work' });
    expect(f.installMember).not.toHaveBeenCalled();
    expect(f.installed).toEqual([existing]);
  });

  it('continues after individual failures and retries only requested failures, preserving successes', async () => {
    const f = fixture();
    const ordinary = f.installMember.getMockImplementation()!;
    f.installMember.mockImplementation(async (input) => {
      if (input.entry.id === 'search') throw new Error('network unavailable');
      return ordinary(input);
    });
    const plan = await f.service.plan(identity);
    const first = await f.service.install({ identity, planId: plan.planId, pluginIds: ['notes', 'search', 'optional'] });
    expect(first.members.map((member) => member.status)).toEqual(['installed', 'failed', 'installed']);
    expect(first.members[1]?.error).toBe('network unavailable');
    f.installMember.mockImplementation(ordinary);
    f.advance(10);
    const retry = await f.service.plan(identity);
    const second = await f.service.install({ identity, planId: retry.planId, pluginIds: ['search'] });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second.members.every((member) => member.selected && member.status === 'installed')).toBe(true);
    expect(f.installMember.mock.calls.map(([input]) => input.entry.id)).toEqual(['notes', 'search', 'optional', 'search']);
  });

  it('forgets grouping without removing installed members or needing the original catalogue', async () => {
    const f = fixture();
    const plan = await f.service.plan(identity);
    await f.service.install({ identity, planId: plan.planId, pluginIds: ['notes'] });
    f.catalogs.length = 0;
    expect(await f.service.forget(identity)).toBe(true);
    expect(await f.service.forget(identity)).toBe(false);
    expect(f.service.listInstalled()).toEqual([]);
    expect(f.installed.map((member) => member.id)).toEqual(['notes']);
  });

  it('does not reinstall a previously successful member removed before retry unless it is selected again', async () => {
    const f = fixture();
    const first = await f.service.plan(identity);
    await f.service.install({ identity, planId: first.planId, pluginIds: ['notes'] });
    f.installed.length = 0;
    const retry = await f.service.plan(identity);
    const result = await f.service.install({ identity, planId: retry.planId, pluginIds: ['search'] });
    expect(f.installMember.mock.calls.map(([input]) => input.entry.id)).toEqual(['notes', 'search']);
    expect(result.members[0]).toMatchObject({ selected: true, status: 'failed', error: expect.stringContaining('Select it to reinstall') });
  });

  it('rejects injected members, other identities, duplicates and missing required selections', async () => {
    const f = fixture();
    f.catalogs[0]!.cachedPacks!.packs[0]!.members[0]!.required = true;
    const plan = await f.service.plan(identity);
    await expect(f.service.install({ identity, planId: plan.planId, pluginIds: ['not-in-pack'] })).rejects.toThrow(/not a member/);
    await expect(f.service.install({ identity, planId: plan.planId, pluginIds: ['search'] })).rejects.toThrow(/required/);
    await expect(f.service.install({ identity: { ...identity, packId: 'elsewhere' }, planId: plan.planId, pluginIds: ['notes'] })).rejects.toThrow(/does not match/);
    expect(() => f.service.install({ identity, planId: plan.planId, pluginIds: ['notes', 'notes'] })).toThrow(/unique/);
    expect(f.installMember).not.toHaveBeenCalled();
  });

  it('does not silently add newly published members or install sources changed after review', async () => {
    const f = fixture();
    const plan = await f.service.plan(identity);
    f.catalogs[0]!.cachedPacks!.packs[0]!.members.push({ pluginId: 'added-later' });
    await expect(f.service.install({ identity, planId: plan.planId, pluginIds: ['notes'] })).rejects.toThrow(/changed since review/);
    const fresh = await f.service.plan(identity);
    f.catalogs[0]!.cachedIndex!.plugins[0]!.source.npm!.range = '2.0.0';
    await expect(f.service.install({ identity, planId: fresh.planId, pluginIds: ['notes'] })).rejects.toThrow(/changed since review/);
    expect(f.installMember).not.toHaveBeenCalled();
  });

  it('rejects expired and evicted reviews and allows a fresh review', async () => {
    const f = fixture();
    const first = await f.service.plan(identity);
    f.advance(15 * 60_000);
    await expect(f.service.install({ identity, planId: first.planId, pluginIds: ['notes'] })).rejects.toThrow(/expired/);
    const old = await f.service.plan(identity);
    for (let n = 0; n < 128; n++) await f.service.plan(identity);
    await expect(f.service.install({ identity, planId: old.planId, pluginIds: ['notes'] })).rejects.toThrow(/expired/);
    const fresh = await f.service.plan(identity);
    await expect(f.service.install({ identity, planId: fresh.planId, pluginIds: ['notes'] })).resolves.toMatchObject({ displayName: 'Essentials' });
  });

  it('requires a configured unique source and cached pack without looking up by marketplace name', async () => {
    const f = fixture();
    await expect(f.service.plan({ ...identity, marketplaceSource: 'https://unconfigured.test/marketplace.json' })).rejects.toThrow(/unavailable/);
    await expect(f.service.plan({ ...identity, packId: 'unknown' })).rejects.toThrow(/unavailable/);
    f.catalogs.push({ ...f.catalogs[0]! });
    await expect(f.service.plan(identity)).rejects.toThrow(/ambiguous/);
    expect(f.installMember).not.toHaveBeenCalled();
  });

  it('marks missing catalogue entries unavailable, but preserves already-installed missing entries', async () => {
    const f = fixture();
    f.catalogs[0]!.cachedIndex!.plugins = [];
    f.installed.push({ id: 'notes', version: '7', source: 'builtin:notes' });
    const plan = await f.service.plan(identity);
    expect(plan.members[0]?.status).toBe('installed');
    expect(plan.members[1]).toMatchObject({ status: 'unavailable', displayName: 'search' });
    const result = await f.service.install({ identity, planId: plan.planId, pluginIds: ['notes', 'search'] });
    expect(result.members[1]).toMatchObject({ status: 'failed', error: 'Plugin is not available in this marketplace' });
  });

  it('serializes concurrent packs and rechecks installed members rather than replacing them', async () => {
    const f = fixture();
    f.catalogs[0]!.cachedPacks!.packs.push({ ...f.catalogs[0]!.cachedPacks!.packs[0]!, id: 'second' });
    const secondIdentity = { ...identity, packId: 'second' };
    const [first, second] = await Promise.all([f.service.plan(identity), f.service.plan(secondIdentity)]);
    await Promise.all([
      f.service.install({ identity, planId: first.planId, pluginIds: ['notes'] }),
      f.service.install({ identity: secondIdentity, planId: second.planId, pluginIds: ['notes'] })
    ]);
    expect(f.installMember).toHaveBeenCalledTimes(1);
    expect(f.service.listInstalled()).toHaveLength(2);
  });

  it('rechecks each member after a different install races ahead and preserves successful race errors', async () => {
    const f = fixture();
    const ordinary = f.installMember.getMockImplementation()!;
    f.installMember.mockImplementation(async (input) => {
      if (input.entry.id === 'notes') {
        f.installed.push({ id: 'search', version: '5', source: 'path:/raced' });
        return ordinary(input);
      }
      f.installed.push({ id: input.entry.id, version: '6', source: 'path:/another-race' });
      throw new Error('already installed');
    });
    const plan = await f.service.plan(identity);
    const result = await f.service.install({ identity, planId: plan.planId, pluginIds: ['notes', 'search', 'optional'] });
    expect(f.installMember.mock.calls.map(([input]) => input.entry.id)).toEqual(['notes', 'optional']);
    expect(result.members.map((member) => member.version)).toEqual(['1.2.0', '5', '6']);
  });

  it('rejects mismatched installer identities and safely handles non-Error rejection', async () => {
    const f = fixture();
    f.installMember.mockResolvedValueOnce({ id: 'wrong-plugin', version: '1', source: 'npm:wrong@1' }).mockRejectedValueOnce('opaque failure');
    const plan = await f.service.plan(identity);
    const result = await f.service.install({ identity, planId: plan.planId, pluginIds: ['notes', 'search'] });
    expect(result.members[0]?.error).toMatch(/different plugin identity/);
    expect(result.members[1]?.error).toBe('Plugin installation failed');
  });

  it('does not overwrite malformed or oversized grouping metadata', async () => {
    const f = fixture();
    const file = pluginPackStorePath(f.dataDir);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{broken');
    expect(() => f.service.listInstalled()).toThrow(/malformed/);
    await expect(f.service.forget(identity)).rejects.toThrow(/malformed/);
    expect(readFileSync(file, 'utf8')).toBe('{broken');
    writeFileSync(file, 'x'.repeat(1_048_577));
    expect(() => f.service.listInstalled()).toThrow(/size limit/);
  });

  it('rejects new groupings at the retention cap before installing any member', async () => {
    const f = fixture();
    const file = pluginPackStorePath(f.dataDir);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 1, installations: Array.from({ length: 256 }, (_, n) => ({
      identity: { ...identity, packId: `existing-${n}` }, displayName: `Pack ${n}`, description: 'Saved',
      createdAt: 1, updatedAt: 1, members: []
    })) }));
    const plan = await f.service.plan(identity);
    await expect(f.service.install({ identity, planId: plan.planId, pluginIds: ['notes'] })).rejects.toThrow(/limit reached/);
    expect(f.installMember).not.toHaveBeenCalled();
    expect(f.service.listInstalled()).toHaveLength(256);
  });

  it('does not retain mutable returned plans as the installation authority', async () => {
    const f = fixture();
    const plan = await f.service.plan(identity);
    plan.members.push({ pluginId: 'injected', displayName: 'Injected', description: '', required: false, status: 'available' });
    await expect(f.service.install({ identity, planId: plan.planId, pluginIds: ['injected'] })).rejects.toThrow(/not a member/);
    expect(f.installMember).not.toHaveBeenCalled();
  });

  it('does not lose required-member checks when a previously installed member is removed after review', async () => {
    const f = fixture();
    f.catalogs[0]!.cachedPacks!.packs[0]!.members[0]!.required = true;
    f.installed.push({ id: 'notes', version: '9', source: 'path:/existing' });
    const plan = await f.service.plan(identity);
    f.installed.length = 0;
    await expect(f.service.install({ identity, planId: plan.planId, pluginIds: ['search'] })).rejects.toThrow(/required/);
    expect(f.installMember).not.toHaveBeenCalled();
  });

  it('requires a fresh review if a selected installed member disappears rather than silently installing its catalogue alternative', async () => {
    const f = fixture();
    f.installed.push({ id: 'notes', version: '9', source: 'path:/existing' });
    const reviewed = await f.service.plan(identity);
    expect(reviewed.members[0]).toMatchObject({ status: 'installed', installedSource: 'path:/existing' });
    f.installed.length = 0;
    await expect(f.service.install({ identity, planId: reviewed.planId, pluginIds: ['notes', 'search'] })).rejects.toThrow(/removed since review/);
    expect(f.installMember).not.toHaveBeenCalled();
    expect(f.service.listInstalled()).toEqual([]);
    const fresh = await f.service.plan(identity);
    expect(fresh.members[0]).toMatchObject({ status: 'available', sourceLabel: 'npm:@test/notes@1.2.0' });
    await expect(f.service.install({ identity, planId: fresh.planId, pluginIds: ['notes'] })).resolves.toMatchObject({ displayName: 'Essentials' });
  });

  it('makes persisted interrupted members retryable while live progress remains pending', async () => {
    const f = fixture();
    let resolve!: (value: { id: string; version: string; source: string }) => void;
    let started!: () => void;
    const seen = new Promise<void>((r) => { started = r; });
    f.installMember.mockImplementation(() => { started(); return new Promise((r) => { resolve = r; }); });
    const plan = await f.service.plan(identity);
    const run = f.service.install({ identity, planId: plan.planId, pluginIds: ['notes'] });
    await seen;
    expect(f.service.listInstalled()[0]?.members[0]?.status).toBe('pending');
    expect(f.create().listInstalled()[0]?.members[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('interrupted') });
    resolve({ id: 'notes', version: '1', source: 'npm:notes@1' });
    await run;
  });

  it('resolves Git selector labels including subdirectories and default HEAD', async () => {
    const f = fixture();
    f.catalogs[0]!.cachedIndex!.plugins = [
      { ...memberEntry('notes'), source: { git: { url: 'https://example.test/notes.git', ref: 'v1', subdir: 'release' } } },
      { ...memberEntry('search'), source: { git: { url: 'https://example.test/search.git', range: '^2' } } },
      { ...memberEntry('optional'), source: { git: { url: 'https://example.test/optional.git' } } }
    ];
    const plan = await f.service.plan(identity);
    expect(plan.members.map((member) => member.targetVersion)).toEqual(['v1', '^2', 'HEAD']);
    expect(plan.members[0]?.sourceLabel).toContain('(release)');
  });
});
