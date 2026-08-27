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

export function createKvArtifactStore(kv: {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}): ArtifactStore {
  return {
    async put(kind, payload) {
      const id = `${kind}-${Date.now().toString(36)}`;
      const serialized = JSON.stringify(payload);
      const clipped =
        serialized.length > ARTIFACT_MAX_CHARS
          ? `${serialized.slice(0, ARTIFACT_MAX_CHARS)}…`
          : serialized;
      await kv.set(`artifact:${id}`, clipped);
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
