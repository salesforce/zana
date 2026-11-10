export type Cue = 'needs-you' | 'idle';
export interface Clip { name: string; mime: 'audio/wav' | 'audio/mpeg' | 'audio/ogg'; base64: string }
export interface SoundPack { id: string; name: string; needsYou?: Clip; idle?: Clip }
export interface Preferences { enabled: boolean; needsYou: boolean; idle: boolean; volume: number; idleSpacingSeconds: number; packId: string }
export interface SoundState { preferences: Preferences; packs: SoundPack[] }
export const DEFAULTS: Preferences = { enabled: false, needsYou: true, idle: false, volume: 35, idleSpacingSeconds: 15, packId: 'chimes' };
export const MAX_CLIP_BYTES = 1024 * 1024;
export const MAX_PACKS = 8;

export function preferences(value: unknown): Preferences {
  const v = value && typeof value === 'object' ? value as Partial<Preferences> : {};
  return { enabled: v.enabled === true, needsYou: v.needsYou !== false, idle: v.idle === true,
    volume: typeof v.volume === 'number' && Number.isFinite(v.volume) ? Math.max(0, Math.min(100, Math.round(v.volume))) : DEFAULTS.volume,
    idleSpacingSeconds: [5, 10, 15, 30, 60].includes(v.idleSpacingSeconds ?? 0) ? v.idleSpacingSeconds! : DEFAULTS.idleSpacingSeconds,
    packId: typeof v.packId === 'string' && v.packId.length <= 80 ? v.packId : 'chimes' };
}

/** Folder entries are data, never executable hooks or paths to read on the server. */
export function openPeonSelection(manifest: unknown): { name: string; needsYou?: string; idle?: string } {
  if (!manifest || typeof manifest !== 'object') throw new Error('Choose a folder containing openpeon.json.');
  const m = manifest as { name?: unknown; display_name?: unknown; categories?: Record<string, { sounds?: { file?: unknown }[] }> };
  if (!m.categories || typeof m.categories !== 'object') throw new Error('The pack has no sound categories.');
  const file = (category: string) => {
    const candidate = m.categories?.[category]?.sounds?.[0]?.file;
    if (candidate === undefined) return undefined;
    if (typeof candidate !== 'string' || candidate.length > 240 || candidate.startsWith('/') || candidate.includes('\\') || candidate.split('/').some(s => s === '..' || !s) || candidate.includes(':')) throw new Error('The pack contains an invalid sound path.');
    return candidate.replace(/^\.\//, '');
  };
  const needsYou = file('input.required');
  // CESP has no generic idle category. This maps its completion clip to the idle cue, without claiming success.
  const idle = file('task.complete');
  if (!needsYou && !idle) throw new Error('The pack needs input.required or task.complete sounds.');
  const label = m.display_name ?? m.name;
  return { name: typeof label === 'string' ? label.slice(0, 80) : 'Imported pack', needsYou, idle };
}
