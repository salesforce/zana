import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginService, type PluginServiceOptions } from './plugin-service.js';

const roots: string[] = [];
const services: ReturnType<typeof createPluginService>[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), 'plugin-service-packs-')); roots.push(dir); return dir; }
function writePlugin(dir: string, id: string, version = '1.2.0', marker?: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version, zcc: { name: id, description: 'Pack fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(dir, 'server.mjs'), `${marker ? `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');` : ''}export default api => { api.rpc.method('ping', () => ({ ok: true })); };`);
}
function fixture(extra: Partial<PluginServiceOptions> = {}) {
  const dataDir = root();
  const cloneGit = vi.fn(async (_url: string, dest: string) => {
    writePlugin(join(dest, 'release'), 'notes');
    return { commit: 'a'.repeat(40), refKind: 'tag' as const };
  });
  const service = createPluginService({ dataDir, bundledRoot: root(), cloneGit, ...extra });
  services.push(service);
  return { service, dataDir, cloneGit };
}
function catalog(sourceUrl = 'https://example.test/notes.git') {
  const dir = root();
  writeFileSync(join(dir, 'marketplace.json'), JSON.stringify({ schemaVersion: 1, name: 'test', displayName: 'Test', plugins: [{
    id: 'notes', displayName: 'Notes', description: 'Notes', author: { name: 'Author' }, source: { git: { url: sourceUrl, ref: 'v1.2.0', subdir: 'release' } }
  }] }));
  writeFileSync(join(dir, 'packs.json'), JSON.stringify({ schemaVersion: 1, packs: [{ id: 'essentials', displayName: 'Essentials', description: 'Curated tools', members: [{ pluginId: 'notes' }] }] }));
  return { source: `path:${dir}`, dir };
}
beforeEach(() => { vi.stubEnv('ZCC_OFFICIAL_MARKETPLACE_URL', 'off'); vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', 'off'); vi.stubEnv('ZCC_COMMUNITY_MARKETPLACE_SOURCE', 'off'); });
afterEach(() => { services.splice(0).forEach((service) => service.stop()); roots.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); vi.unstubAllEnvs(); });

describe('plugin packs through the normal PluginService boundary', () => {
  it('discovers sidecars at add/refresh, installs the selected Git subdirectory and preserves ordinary provenance', async () => {
    const f = fixture();
    const c = catalog();
    await f.service.addMarketplace(c.source);
    expect(f.service.pluginPacks.list()).toHaveLength(1);
    const identity = { marketplaceSource: c.source, packId: 'essentials' };
    const plan = await f.service.pluginPacks.plan(identity);
    const result = await f.service.pluginPacks.install({ identity, planId: plan.planId, pluginIds: ['notes'] });
    expect(result.members[0]).toMatchObject({ status: 'installed', version: '1.2.0' });
    expect(f.service.get('notes')).toMatchObject({ enabled: true, provenance: 'catalog', catalogMarketplace: 'test', catalogEntryId: 'notes', sourceIntent: { subdir: 'release', selector: { kind: 'ref', ref: 'v1.2.0' } } });
    expect(await f.service.callRpc('notes', 'ping', {})).toEqual({ ok: true });
    writeFileSync(join(c.dir, 'packs.json'), JSON.stringify({ schemaVersion: 1, packs: [] }));
    await f.service.refreshMarketplace(c.source);
    expect(f.service.pluginPacks.list()).toEqual([]);
    expect(f.service.pluginPacks.listInstalled()).toHaveLength(1);
  });

  it('keeps an existing disabled local plugin and never fetches its pack replacement', async () => {
    const f = fixture();
    const local = root();
    writePlugin(local, 'notes', '9.0.0');
    await f.service.install(`path:${local}`, { enable: false });
    const existing = f.service.get('notes');
    const c = catalog();
    await f.service.addMarketplace(c.source);
    const identity = { marketplaceSource: c.source, packId: 'essentials' };
    const plan = await f.service.pluginPacks.plan(identity);
    await f.service.pluginPacks.install({ identity, planId: plan.planId, pluginIds: ['notes'] });
    expect(f.service.get('notes')).toEqual(existing);
    expect(f.cloneGit).not.toHaveBeenCalled();
    await f.service.pluginPacks.forget(identity);
    expect(f.service.get('notes')).toEqual(existing);
  });

  it('rejects a mismatched materialized identity before executing plugin code and removes its candidate', async () => {
    const marker = join(root(), 'executed');
    const f = fixture({ cloneGit: async (_url, dest) => {
      writePlugin(join(dest, 'release'), 'unexpected', '1.2.0', marker);
      return { commit: 'a'.repeat(40), refKind: 'tag' };
    } });
    const c = catalog();
    await f.service.addMarketplace(c.source);
    const identity = { marketplaceSource: c.source, packId: 'essentials' };
    const plan = await f.service.pluginPacks.plan(identity);
    const result = await f.service.pluginPacks.install({ identity, planId: plan.planId, pluginIds: ['notes'] });
    expect(result.members[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('identity mismatch') });
    expect(f.service.get('notes')).toBeUndefined();
    expect(f.service.get('unexpected')).toBeUndefined();
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(join(f.dataDir, 'plugins', 'generations'))).toEqual([]);
  });

  it('uses the source-qualified marketplace even when another configured catalogue has the same name', async () => {
    const f = fixture();
    const first = catalog('https://first.test/notes.git');
    const second = catalog('https://second.test/notes.git');
    await f.service.addMarketplace(first.source);
    await f.service.addMarketplace(second.source);
    const identity = { marketplaceSource: second.source, packId: 'essentials' };
    const plan = await f.service.pluginPacks.plan(identity);
    await f.service.pluginPacks.install({ identity, planId: plan.planId, pluginIds: ['notes'] });
    expect(f.cloneGit.mock.calls.map(([url]) => url)).toEqual(['https://second.test/notes.git']);
  });
});
