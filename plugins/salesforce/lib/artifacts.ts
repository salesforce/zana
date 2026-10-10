import { randomUUID } from 'node:crypto';
import { ARTIFACT_MAX_CHARS } from './types.js';

export interface ArtifactStore {
  put(kind: string, payload: unknown): Promise<string>;
  get(id: string): Promise<unknown>;
}

export function createMemoryArtifactStore(): ArtifactStore {
  const items = new Map<string, unknown>();
  let seq = 0;
  return {
    async put(kind, payload) {
      seq += 1;
      const id = `${kind}-${seq}`;
      items.set(id, payload);
      return id;
    },
    async get(id) {
      return items.get(id);
    }
  };
}

/** Newest artifacts kept in kv; each put past the cap deletes the oldest. */
export const ARTIFACT_RETENTION = 200;
const INDEX_KEY = 'artifact-index';

export function createKvArtifactStore(kv: {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}): ArtifactStore {
  // One in-process chain serializes the index read-modify-write.
  let queue: Promise<unknown> = Promise.resolve();
  const track = (id: string) => {
    const next = queue.then(async () => {
      const stored = await kv.get<string[]>(INDEX_KEY);
      // Artifacts written before the index existed count as the oldest.
      const ids = Array.isArray(stored)
        ? stored
        : (await kv.list('artifact:')).map((key) => key.slice('artifact:'.length)).filter((known) => known !== id);
      ids.push(id);
      const dropped = ids.splice(0, Math.max(0, ids.length - ARTIFACT_RETENTION));
      await kv.set(INDEX_KEY, ids);
      await Promise.all(dropped.map((old) => kv.delete(`artifact:${old}`)));
    });
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    async put(kind, payload) {
      // The random suffix keeps two artifacts written in the same millisecond apart.
      const id = `${kind}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const serialized = JSON.stringify(payload);
      const clipped =
        serialized.length > ARTIFACT_MAX_CHARS
          ? `${serialized.slice(0, ARTIFACT_MAX_CHARS)}…`
          : serialized;
      await kv.set(`artifact:${id}`, clipped);
      // Retention is housekeeping: a failed prune never fails the call that produced the artifact.
      await track(id).catch(() => undefined);
      return id;
    },
    async get(id) {
      const raw = await kv.get<string>(`artifact:${id}`);
      if (typeof raw !== 'string') return undefined;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return raw;
      }
    }
  };
}
