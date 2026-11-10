import { open, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentSoundClip, AgentSoundFilesSelection, AgentSoundKind } from '@zana-ai/zcc-domain/product';

export const MAX_SOUND_FILE_BYTES = 1024 * 1024;
const KINDS: AgentSoundKind[] = ['done', 'needs-you', 'idle'];
const MAX_RECORD_BYTES = Math.ceil(MAX_SOUND_FILE_BYTES / 3) * 4 + 4096;

export function isAgentSoundKind(kind: unknown): kind is AgentSoundKind {
  return KINDS.includes(kind as AgentSoundKind);
}

function clipFromBytes(bytes: Buffer): AgentSoundClip {
  if (!bytes.length || bytes.length > MAX_SOUND_FILE_BYTES) throw new Error('Choose an audio file up to 1 MB.');
  const mime = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE' ? 'audio/wav'
    : bytes.subarray(0, 4).toString() === 'OggS' ? 'audio/ogg'
      : bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) ? 'audio/mpeg' : null;
  if (!mime) throw new Error('Choose an MP3, WAV, or OGG audio file.');
  return { mime, base64: bytes.toString('base64') };
}

async function readBounded(path: string, max: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > max) throw new Error('Choose an audio file up to 1 MB.');
    // A growing or special file cannot turn a size check into an unbounded read.
    const bytes = Buffer.alloc(max + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await file.read(bytes, total, bytes.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > max) throw new Error('Choose an audio file up to 1 MB.');
    return bytes.subarray(0, total);
  } finally { await file.close(); }
}

/** Main-owned copies, one fixed record per event. No caller-supplied playback paths. */
export class AgentSoundFiles {
  private files = new Map<AgentSoundKind, { name: string; clip: AgentSoundClip }>();
  private pending: Promise<unknown>;
  readonly ready: Promise<void>;
  constructor(private directory: string) {
    this.ready = this.load();
    this.pending = this.ready;
  }

  private async load(): Promise<void> {
    await Promise.all(KINDS.map(async kind => {
      try {
        const value = JSON.parse((await readBounded(this.path(kind), MAX_RECORD_BYTES)).toString());
        if (typeof value.name !== 'string' || !value.name || value.name.length > 255 || typeof value.clip?.base64 !== 'string'
          || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.clip.base64)) return;
        const clip = clipFromBytes(Buffer.from(value.clip.base64, 'base64'));
        this.files.set(kind, { name: value.name, clip });
      } catch { /* Missing or damaged local preferences must not prevent app startup. */ }
    }));
  }

  private path(kind: AgentSoundKind): string {
    if (!isAgentSoundKind(kind)) throw new Error('Unknown agent sound');
    return join(this.directory, `${kind}.json`);
  }

  selections(): AgentSoundFilesSelection {
    return Object.fromEntries([...this.files].map(([kind, file]) => [kind, { name: file.name }]));
  }

  current(kind: AgentSoundKind): AgentSoundClip | undefined { return this.files.get(kind)?.clip; }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => undefined);
    return next;
  }

  import(kind: AgentSoundKind, selectedPath: string): Promise<{ name: string }> {
    const target = this.path(kind);
    return this.serialize(async () => {
      const clip = clipFromBytes(await readBounded(selectedPath, MAX_SOUND_FILE_BYTES));
      const name = basename(selectedPath).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255) || 'Custom audio';
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ name, clip }), { flag: 'wx', mode: 0o600 });
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(() => undefined); }
      this.files.set(kind, { name, clip });
      return { name };
    });
  }

  clear(kind: AgentSoundKind): Promise<void> {
    const target = this.path(kind);
    return this.serialize(async () => {
      await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
      this.files.delete(kind);
    });
  }
}
