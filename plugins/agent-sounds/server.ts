import { randomUUID } from 'node:crypto';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { MAX_CLIP_BYTES, MAX_PACKS, preferences, type Clip, type SoundState } from './model.js';

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
  const db = zcc.storage.database();
  db.migrate([`CREATE TABLE IF NOT EXISTS sound_preferences (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sound_packs (id TEXT PRIMARY KEY, data TEXT NOT NULL);`]);
  const config = db.prepare('SELECT data FROM sound_preferences WHERE id=1').get() as { data: string } | undefined;
  const legacy = config ? undefined : await zcc.storage.kv.get<SoundState>('state');
  const saved: SoundState | undefined = config ? {
    preferences: JSON.parse(config.data),
    packs: (db.prepare('SELECT data FROM sound_packs ORDER BY rowid LIMIT ?').all(MAX_PACKS) as { data: string }[]).map(row => JSON.parse(row.data))
  } : legacy;
  let state: SoundState = { preferences: preferences(saved?.preferences), packs: Array.isArray(saved?.packs) ? saved.packs.slice(0, MAX_PACKS) : [] };
  if (state.preferences.packId !== 'chimes' && !state.packs.some(p => p.id === state.preferences.packId)) state.preferences.packId = 'chimes';
  // Audio belongs in the plugin database: KV limits each value to 1 MiB and
  // its whole namespace to 8 MiB. Only new/removed packs touch their audio rows.
  const persist = (next: SoundState, previous?: SoundState) => db.transaction(() => {
    db.prepare('INSERT INTO sound_preferences(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(next.preferences));
    for (const pack of next.packs) if (!previous?.packs.some(old => old === pack))
      db.prepare('INSERT INTO sound_packs(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(pack.id, JSON.stringify(pack));
    for (const pack of previous?.packs ?? []) if (!next.packs.some(kept => kept.id === pack.id))
      db.prepare('DELETE FROM sound_packs WHERE id=?').run(pack.id);
  });
  if (legacy) { persist(state); await zcc.storage.kv.delete('state'); }
  let pending: Promise<unknown> = Promise.resolve();
  // Inactive packs need only catalogue metadata in the renderer. Bound each read
  // to two clips instead of resending every imported audio file on volume changes.
  const view = (): SoundState => ({ preferences: state.preferences, packs: state.packs.map(pack =>
    pack.id === state.preferences.packId ? pack : { id: pack.id, name: pack.name }) });
  const mutate = (change: (current: SoundState) => SoundState) => {
    const work = pending.then(async () => {
      const next = change(state);
      persist(next, state);
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
