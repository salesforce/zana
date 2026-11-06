import { randomUUID } from 'node:crypto';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { DEFAULTS, MAX_CLIP_BYTES, MAX_PACKS, preferences, type Clip, type SoundState } from './model.js';

export function validateClip(value: unknown): Clip | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new Error('Invalid audio file.');
  const v = value as Clip;
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 160 || typeof v.base64 !== 'string' || v.base64.length > Math.ceil(MAX_CLIP_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.base64)) throw new Error('Audio files must be 1 MB or smaller.');
  const bytes = Buffer.from(v.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_CLIP_BYTES || bytes.toString('base64') !== v.base64) throw new Error('Invalid audio data.');
  const mime = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE' ? 'audio/wav'
    : bytes.subarray(0, 4).toString() === 'OggS' ? 'audio/ogg'
      : bytes.subarray(0, 3).toString() === 'ID3' || bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0 ? 'audio/mpeg' : null;
  if (!mime) throw new Error('Use a WAV, MP3, or OGG audio file.');
  return { name: v.name, mime, base64: v.base64 };
}

export default async function plugin(zcc: ZccPluginApi) {
  const saved = await zcc.storage.kv.get<SoundState>('state');
  let state: SoundState = { preferences: preferences(saved?.preferences), packs: Array.isArray(saved?.packs) ? saved.packs.slice(0, MAX_PACKS) : [] };
  if (state.preferences.packId !== 'chimes' && !state.packs.some(p => p.id === state.preferences.packId)) state.preferences.packId = 'chimes';
  let pending: Promise<unknown> = Promise.resolve();
  // Inactive packs need only catalogue metadata in the renderer. Bound each read
  // to two clips instead of resending every imported audio file on volume changes.
  const view = (): SoundState => ({ preferences: state.preferences, packs: state.packs.map(pack =>
    pack.id === state.preferences.packId ? pack : { id: pack.id, name: pack.name }) });
  const mutate = (change: (current: SoundState) => SoundState) => {
    const work = pending.then(async () => {
      const next = change(state);
      await zcc.storage.kv.set('state', next);
      state = next;
      zcc.realtime.publish('changed', null);
      return view();
    });
    pending = work.catch(() => undefined);
    return work;
  };
  zcc.rpc.method('read', view);
  zcc.rpc.method('configure', input => mutate(current => {
    const next = preferences({ ...current.preferences, ...(input && typeof input === 'object' ? input : {}) });
    if (next.packId !== 'chimes' && !current.packs.some(p => p.id === next.packId)) throw new Error('That sound pack is no longer installed.');
    return { ...current, preferences: next };
  }));
  zcc.rpc.method('importPack', input => mutate(current => {
    if (current.packs.length >= MAX_PACKS) throw new Error('Remove a pack before importing another (8 pack limit).');
    const v = input as { name?: unknown; needsYou?: unknown; idle?: unknown } | null;
    if (!v || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 80) throw new Error('Give this pack a name (up to 80 characters).');
    const needsYou = validateClip(v.needsYou), idle = validateClip(v.idle);
    if (!needsYou && !idle) throw new Error('Choose at least one sound.');
    const pack = { id: randomUUID(), name: v.name.trim(), ...(needsYou ? { needsYou } : {}), ...(idle ? { idle } : {}) };
    return { preferences: { ...current.preferences, packId: pack.id }, packs: [...current.packs, pack] };
  }));
  zcc.rpc.method('remove', input => mutate(current => {
    if (typeof input !== 'string' || !current.packs.some(p => p.id === input)) throw new Error('Sound pack not found.');
    return { preferences: { ...current.preferences, packId: current.preferences.packId === input ? 'chimes' : current.preferences.packId }, packs: current.packs.filter(p => p.id !== input) };
  }));
  zcc.log.info('Sound Studio loaded. Notifications are opt-in.');
}
