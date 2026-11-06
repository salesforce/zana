import { describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import plugin, { validateClip } from './server.js';
import { DEFAULTS, MAX_CLIP_BYTES, openPeonSelection, preferences } from './model.js';
const wav = { name: 'ping.wav', base64: Buffer.from('RIFFxxxxWAVEdata').toString('base64') };
async function setup() { const host = createFakePluginHost(); await plugin(host.zcc); return { ...host.harness, zcc: host.zcc }; }
describe('sound data and persistence', () => {
  it('starts silent, persists imports, normalizes config and removes the selected pack', async () => {
    const host = await setup(); const rpc = host.behavior.callRpc;
    expect(await rpc('read')).toEqual({ preferences: DEFAULTS, packs: [] });
    const imported = await rpc('importPack', { name: 'My peon', needsYou: wav }) as any;
    expect(imported.packs[0]).toMatchObject({ name: 'My peon', needsYou: { mime: 'audio/wav' } });
    expect(imported.preferences.packId).toBe(imported.packs[0].id);
    expect(await rpc('configure', { enabled: true, volume: 900, idleSpacingSeconds: 1 })).toMatchObject({ preferences: { enabled: true, volume: 100, idleSpacingSeconds: 15 } });
    expect(await rpc('remove', imported.packs[0].id)).toMatchObject({ preferences: { packId: 'chimes' }, packs: [] });
    expect(host.kv.get('state')).toEqual(await rpc('read')); expect(host.published).toHaveLength(3);
  });
  it('rejects invalid packs, missing packs and too many packs without losing prior state', async () => {
    const host = await setup(), rpc = host.behavior.callRpc;
    for (const input of [null, { name: '' }, { name: 'x'.repeat(81) }, { name: 'No audio' }, { name: 'Nope', idle: { ...wav, base64: 'a' } }]) await expect(rpc('importPack', input)).rejects.toThrow();
    await expect(rpc('configure', { packId: 'missing' })).rejects.toThrow(); await expect(rpc('remove', 'missing')).rejects.toThrow();
    for (let i = 0; i < 8; i++) await rpc('importPack', { name: `Pack ${i}`, idle: wav });
    await expect(rpc('importPack', { name: 'Over limit', idle: wav })).rejects.toThrow('8 pack limit');
    expect((await rpc('read') as any).packs).toHaveLength(8);
  });
  it('serializes concurrent writes and recovers from a failed save', async () => {
    const host = await setup(), rpc = host.behavior.callRpc;
    await Promise.all([rpc('configure', { volume: 20 }), rpc('configure', { idle: true })]);
    expect(await rpc('read')).toMatchObject({ preferences: { volume: 20, idle: true } });
    const set = vi.spyOn(host.zcc.storage.kv, 'set'); set.mockRejectedValueOnce(new Error('disk full'));
    await expect(rpc('configure', { volume: 60 })).rejects.toThrow('disk full');
    expect(await rpc('read')).toMatchObject({ preferences: { volume: 20 } });
    await rpc('configure', { needsYou: false });
    expect(await rpc('read')).toMatchObject({ preferences: { volume: 20, needsYou: false } });
    // Fake host KV is durable between factory loads.
    await plugin(host.zcc); expect(await host.behavior.callRpc('read')).toMatchObject({ preferences: { volume: 20, idle: true } });
  });
  it('restores bounded packs and falls back when a saved selection is missing', async () => {
    const host = createFakePluginHost();
    await host.zcc.storage.kv.set('state', { preferences: { packId: 'missing' }, packs: Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: String(i) })) });
    await plugin(host.zcc); const read = await host.harness.behavior.callRpc('read') as any;
    expect(read.preferences.packId).toBe('chimes'); expect(read.packs).toHaveLength(8);
  });
  it('returns audio only for the selected pack while retaining other packs durably', async () => {
    const host = await setup(), rpc = host.behavior.callRpc;
    const first = await rpc('importPack', { name: 'First', idle: wav }) as any;
    const second = await rpc('importPack', { name: 'Second', needsYou: wav }) as any;
    expect(second.packs[0]).toEqual({ id: first.packs[0].id, name: 'First' });
    expect(second.packs[1].needsYou.base64).toBe(wav.base64);
    const switched = await rpc('configure', { packId: first.packs[0].id }) as any;
    expect(switched.packs[0].idle.base64).toBe(wav.base64); expect(switched.packs[1]).toEqual({ id: second.packs[1].id, name: 'Second' });
  });
  it('validates byte signatures, canonical base64, names, quotas and formats', () => {
    expect(validateClip(undefined)).toBeUndefined(); expect(validateClip(wav)?.mime).toBe('audio/wav');
    for (const [data, mime] of [['OggSx', 'audio/ogg'], ['ID3x', 'audio/mpeg']]) expect(validateClip({ name: 'x', base64: Buffer.from(data).toString('base64') })?.mime).toBe(mime);
    expect(validateClip({ name: 'x', base64: Buffer.from([255, 251, 1]).toString('base64') })?.mime).toBe('audio/mpeg');
    for (const value of [null, false, { ...wav, name: '' }, { ...wav, name: 'x'.repeat(161) }, { ...wav, base64: '*' }, { ...wav, base64: Buffer.from('html').toString('base64') }, { ...wav, base64: Buffer.alloc(MAX_CLIP_BYTES + 1).toString('base64') }, { ...wav, base64: 'YR==' }]) expect(() => validateClip(value)).toThrow();
  });
  it('normalizes settings without truthy coercion', () => {
    expect(preferences(null)).toEqual(DEFAULTS); expect(preferences({ volume: NaN, packId: 4 })).toEqual(DEFAULTS);
    expect(preferences({ enabled: 'true', idle: 1, needsYou: false, volume: -3, packId: 'x'.repeat(81) })).toMatchObject({ enabled: false, idle: false, needsYou: false, volume: 0, packId: 'chimes' });
  });
  it('maps CESP categories and confines folder paths', () => {
    const manifest = (file: unknown) => ({ display_name: 'Peon', categories: { 'input.required': { sounds: [{ file }] } } });
    expect(openPeonSelection(manifest('./sounds/ping.wav'))).toEqual({ name: 'Peon', needsYou: 'sounds/ping.wav', idle: undefined });
    expect(openPeonSelection({ categories: { 'task.complete': { sounds: [{ file: 'done.wav' }] } } })).toMatchObject({ name: 'Imported pack', idle: 'done.wav' });
    for (const file of ['../escape.wav', '/etc/x', 'C:/x', 'sounds\\x', 'sounds//x', 1]) expect(() => openPeonSelection(manifest(file))).toThrow('invalid sound path');
    for (const value of [null, {}, { categories: {} }]) expect(() => openPeonSelection(value)).toThrow();
  });
});
