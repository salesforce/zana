import { z } from 'zod';
import { PrivatePeerStorage, type PeerKeyProvider } from './peer-auth.js';

export const PEER_ROUTE_ORIGINS_MAX = 32;
const ORIGIN_INPUT_MAX = 256;
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);
const stateSchema = z.object({ version: z.literal(1), origins: z.array(z.string().min(1).max(ORIGIN_INPUT_MAX)).max(PEER_ROUTE_ORIGINS_MAX) }).strict();
type State = z.infer<typeof stateSchema>;

/**
 * Canonical origin for the owner allowlist: https, or http on loopback only. No credentials, path (other than a bare
 * trailing slash), query, fragment or wildcard. Returns `scheme://host[:port]` without a trailing slash.
 */
export function normalizePeerRouteOrigin(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > ORIGIN_INPUT_MAX || input !== input.trim() || input.includes('*')) {
    throw new Error('invalid peer route origin');
  }
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('invalid peer route origin'); }
  const bare = input.replace(/\/$/, '');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.hostname ||
    bare.toLowerCase() !== url.origin.toLowerCase()) throw new Error('invalid peer route origin');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('invalid peer route origin');
  return url.origin;
}

/**
 * Owner-managed allowlist of advertised peer route origins, persisted sealed in this app's own storage. Only the
 * authenticated product API changes it; the installer reads it on every route decision, so edits apply live.
 */
export class PeerRouteOrigins {
  private readonly storage: PrivatePeerStorage<State>;
  private disposed = false;

  constructor(options: { directory: string; instanceId: string; keyProvider: PeerKeyProvider }) {
    this.storage = new PrivatePeerStorage(options.directory, 'route-origins-v1', options.keyProvider, options.instanceId,
      () => ({ version: 1, origins: [] }), value => {
        const state = stateSchema.parse(value);
        if (state.origins.some(origin => normalizePeerRouteOrigin(origin) !== origin) || new Set(state.origins).size !== state.origins.length) {
          throw new Error('invalid peer route origins');
        }
        return state;
      });
  }

  private assertLive(): void { if (this.disposed) throw new Error('peer route origins disposed'); }

  async list(): Promise<string[]> {
    this.assertLive();
    return this.storage.transaction(async state => [...state.origins]);
  }

  /** Idempotent: adding a present origin returns it unchanged. */
  async add(input: unknown): Promise<string> {
    this.assertLive();
    const origin = normalizePeerRouteOrigin(input);
    await this.storage.transaction(async (state, save) => {
      if (state.origins.includes(origin)) return;
      if (state.origins.length >= PEER_ROUTE_ORIGINS_MAX) throw new Error('peer route origin capacity exceeded');
      state.origins.push(origin); await save();
    });
    return origin;
  }

  async remove(input: unknown): Promise<boolean> {
    this.assertLive();
    const origin = normalizePeerRouteOrigin(input);
    return this.storage.transaction(async (state, save) => {
      const index = state.origins.indexOf(origin);
      if (index < 0) return false;
      state.origins.splice(index, 1); await save(); return true;
    });
  }

  dispose(): void { this.disposed = true; this.storage.dispose(); }
  whenIdle(): Promise<void> { return this.storage.whenIdle(); }
}
