import { z } from 'zod';
import { PeerTunnels, validatePinnedEndpoint, type LocalTunnel } from '@zana-ai/zcc-host-daemon/peer-tunnels';
import { PEER_ID, PrivatePeerStorage, type PeerKeyProvider } from './peer-auth.js';

const port = z.number().int().min(1).max(65535);
export const PeerSshEndpointSchema = z.object({ peerInstanceId: z.string().regex(PEER_ID), host: z.string().min(1).max(253), port,
  user: z.string().min(1).max(32), hostKey: z.string().min(1).max(4200), remoteAppPort: port,
  identityFile: z.string().min(1).max(1024).optional() }).strict();
export type PeerSshEndpoint = z.infer<typeof PeerSshEndpointSchema>;
const stateSchema = z.object({ version: z.literal(1), endpoints: z.array(PeerSshEndpointSchema).max(32) }).strict();
export const PEER_SSH_MAX_ENDPOINTS = 32;
type Entry = { tunnel?: LocalTunnel; opening?: Promise<LocalTunnel>; localPort?: number; timer?: ReturnType<typeof setTimeout>; attempts: number };

/**
 * Owner-registered fixed SSH routes to a peer's loopback app server. SSH only carries bytes: authorization is
 * still the sealed peer.control channel bound to the mutual enrollment keys. Nothing here creates an endpoint
 * implicitly, forwards an agent, or accepts an unpinned host key.
 */
export class PeerSshEndpoints {
  private readonly storage: PrivatePeerStorage<z.infer<typeof stateSchema>>;
  private readonly open = new Map<string, Entry>();
  private disposed = false;

  constructor(private readonly options: { directory: string; instanceId: string; keyProvider: PeerKeyProvider; tunnels?: PeerTunnels;
    reconnectMs?: number; openTimeoutMs?: number }) {
    this.storage = new PrivatePeerStorage(options.directory, 'ssh-endpoints-v1', options.keyProvider, options.instanceId,
      () => ({ version: 1, endpoints: [] }), value => {
        const state = stateSchema.parse(value);
        if (new Set(state.endpoints.map(endpoint => endpoint.peerInstanceId)).size !== state.endpoints.length) throw new Error('invalid ssh endpoints');
        return state;
      });
  }

  private get tunnels(): PeerTunnels { return this.options.tunnels ?? (this.defaultTunnels ??= new PeerTunnels()); }
  private defaultTunnels: PeerTunnels | undefined;
  private assertLive(): void { if (this.disposed) throw new Error('peer ssh endpoints disposed'); }

  async list(): Promise<PeerSshEndpoint[]> {
    this.assertLive();
    return this.storage.transaction(async state => state.endpoints.map(endpoint => ({ ...endpoint })));
  }

  /** Explicit owner action only. Replacing an endpoint drops its tunnel so the new pin applies. */
  async register(input: unknown): Promise<PeerSshEndpoint> {
    this.assertLive();
    const parsed = PeerSshEndpointSchema.safeParse(input);
    if (!parsed.success) throw new Error('invalid pinned SSH endpoint');
    const endpoint = parsed.data;
    try { validatePinnedEndpoint(endpoint); } catch { throw new Error('invalid pinned SSH endpoint'); }
    if (endpoint.peerInstanceId === this.options.instanceId) throw new Error('invalid pinned SSH endpoint');
    await this.storage.transaction(async (state, save) => {
      const index = state.endpoints.findIndex(entry => entry.peerInstanceId === endpoint.peerInstanceId);
      if (index >= 0) state.endpoints[index] = endpoint;
      else { if (state.endpoints.length >= PEER_SSH_MAX_ENDPOINTS) throw new Error('peer ssh endpoint capacity exceeded'); state.endpoints.push(endpoint); }
      await save();
    });
    await this.drop(endpoint.peerInstanceId);
    return { ...endpoint };
  }

  async remove(peerInstanceId: string): Promise<boolean> {
    this.assertLive();
    const removed = await this.storage.transaction(async (state, save) => {
      const index = state.endpoints.findIndex(entry => entry.peerInstanceId === peerInstanceId);
      if (index < 0) return false;
      state.endpoints.splice(index, 1); await save(); return true;
    });
    await this.drop(peerInstanceId);
    return removed;
  }

  private async drop(peerInstanceId: string): Promise<void> {
    const entry = this.open.get(peerInstanceId);
    this.open.delete(peerInstanceId);
    if (!entry) return;
    clearTimeout(entry.timer);
    await entry.tunnel?.close();
    await entry.opening?.then(tunnel => tunnel.close(), () => undefined);
  }

  /** The loopback URL of an owner-registered tunnel, or null when the owner registered none for this peer. */
  async routeFor(peerInstanceId: string, signal?: AbortSignal): Promise<string | null> {
    this.assertLive();
    const endpoint = await this.storage.transaction(async state => state.endpoints.find(entry => entry.peerInstanceId === peerInstanceId));
    if (!endpoint) return null;
    const tunnel = await this.tunnel(endpoint, signal);
    return tunnel.url;
  }

  private tunnel(endpoint: PeerSshEndpoint, signal?: AbortSignal): Promise<LocalTunnel> {
    const entry: Entry = this.open.get(endpoint.peerInstanceId) ?? { attempts: 0 };
    this.open.set(endpoint.peerInstanceId, entry);
    if (entry.tunnel && !entry.tunnel.closed) return Promise.resolve(entry.tunnel);
    if (entry.opening) return entry.opening;
    clearTimeout(entry.timer); entry.timer = undefined;
    const opening = this.tunnels.openLocal(endpoint, endpoint.remoteAppPort, { signal, timeoutMs: this.options.openTimeoutMs ?? 20_000,
      ...(entry.localPort ? { localPort: entry.localPort } : {}),
      // A dropped tunnel reopens on the same local port so an enrolled daemon's fixed URL keeps working.
      onClose: () => { entry.tunnel = undefined; this.schedule(endpoint, entry); } });
    entry.opening = opening;
    void opening.then(tunnel => {
      entry.opening = undefined;
      if (this.open.get(endpoint.peerInstanceId) !== entry || this.disposed) { void tunnel.close(); return; }
      entry.tunnel = tunnel; entry.localPort = tunnel.localPort; entry.attempts = 0;
    }, () => { entry.opening = undefined; if (entry.localPort) this.schedule(endpoint, entry); });
    return opening;
  }

  /** Bounded exponential backoff; only for an endpoint that was reachable once and is still registered. */
  private schedule(endpoint: PeerSshEndpoint, entry: Entry): void {
    if (this.disposed || this.open.get(endpoint.peerInstanceId) !== entry || entry.timer || entry.opening) return;
    const delay = Math.min((this.options.reconnectMs ?? 3000) * 2 ** Math.min(entry.attempts++, 5), 60_000);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (this.disposed || this.open.get(endpoint.peerInstanceId) !== entry) return;
      void this.tunnel(endpoint).catch(() => undefined);
    }, delay);
    entry.timer.unref?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [peer, entry] of this.open) {
      clearTimeout(entry.timer);
      this.open.delete(peer);
      void entry.tunnel?.close();
      void entry.opening?.then(tunnel => tunnel.close(), () => undefined);
    }
    this.defaultTunnels?.close();
    this.storage.dispose();
  }

  async whenIdle(): Promise<void> { await this.storage.whenIdle(); }
}
