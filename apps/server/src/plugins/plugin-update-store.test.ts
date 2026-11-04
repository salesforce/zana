import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPluginUpdateStore } from './plugin-update-store.js';
import type { PluginUpdateCheck } from './plugin-update-resolver.js';

const dirs: string[] = [];
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'update-store-')); dirs.push(dir); return join(dir, 'checks.json'); }
const check: PluginUpdateCheck = { fingerprint: 'a'.repeat(64), checkedAt: 123, outcome: 'available', candidate: { version: '2.0.0' } };
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
describe('persisted plugin update checks', () => {
  it('survives restart, serializes writers and prunes removed installs', async () => {
    const file = fixture(), store = createPluginUpdateStore(file);
    expect(store.get('one')).toBeUndefined();
    await Promise.all(['one', 'two'].map(id => store.set(id, check, ['one', 'two'])));
    expect(createPluginUpdateStore(file).get('one')).toEqual(check); expect(store.get('two')).toEqual(check);
    await store.set('two', check, ['two']); expect(store.get('one')).toBeUndefined();
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);
  });
  it.each(['broken', '{}', '{"version":2,"checks":{}}', '{"version":1,"checks":{"bad!":{},"ok":{"fingerprint":"a","checkedAt":1,"outcome":"available"}}}'])('ignores corrupt advisory data %s', value => {
    const file = fixture(); writeFileSync(file, value); expect(createPluginUpdateStore(file).get('ok')).toBeUndefined();
  });
  it('ignores oversized check files', () => {
    const file = fixture(); writeFileSync(file, ' '.repeat(1_048_577)); expect(createPluginUpdateStore(file).get('ok')).toBeUndefined();
  });
  it.each([
    null, [], { checkedAt: -1 }, { detail: {} }, { detail: 'x'.repeat(1025) },
    { candidate: null }, { candidate: { version: 2 } }, { candidate: { version: '2.0.0', commit: 'bad' } },
    { candidate: { version: '2.0.0', tag: '' } }, { candidate: { version: '2.0.0', integrity: 42 } },
    { candidate: undefined }, { blocked: null }, { blocked: { version: 2, reasons: [] } },
    { blocked: { version: '3.0.0', reasons: {} } }, { blocked: { version: '3.0.0', reasons: [null] } },
    { blocked: { version: '3.0.0', reasons: Array(9).fill('incompatible') } }
  ])('discards malformed nested metadata without hiding valid checks: %j', invalid => {
    const file = fixture();
    writeFileSync(file, JSON.stringify({ version: 1, checks: { bad: invalid === null || Array.isArray(invalid) ? invalid : { ...check, ...invalid }, good: check } }));
    const store = createPluginUpdateStore(file);
    expect(store.get('bad')).toBeUndefined(); expect(store.get('good')).toEqual(check);
  });
  it('restores bounded candidate and compatibility metadata', () => {
    const file = fixture();
    const saved = { ...check, detail: 'Checked', candidate: { version: '2.0.0', commit: 'b'.repeat(40), tag: 'v2.0.0', integrity: 'sha512-valid' }, blocked: { version: '3.0.0', reasons: ['Needs a newer host'] } };
    writeFileSync(file, JSON.stringify({ version: 1, checks: { good: saved } }));
    expect(createPluginUpdateStore(file).get('good')).toEqual(saved);
  });
  it('bounds retained checks to 256 installations', async () => {
    const file = fixture();
    const checks = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`p-${i}`, { ...check, checkedAt: i }]));
    writeFileSync(file, JSON.stringify({ version: 1, checks }));
    const store = createPluginUpdateStore(file);
    await store.set('new', { ...check, checkedAt: 999 }, [...Object.keys(checks), 'new']);
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).checks)).toHaveLength(256);
    expect(store.get('new')).toBeDefined(); expect(store.get('p-0')).toBeUndefined();
  });
});
