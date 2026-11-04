import { publicKeyLine, generateSeed } from '@zana-ai/zcc-host-daemon/ssh-keys';
import type { PeerTunnels } from '@zana-ai/zcc-host-daemon/peer-tunnels';
import { PEER_ID, PrivatePeerStorage, type PeerKeyProvider } from './peer-auth.js';
import { SSH_REASONS, type AuthorizedKeys, type OpenTunnelInput, type PeerSshTransport, type PeerSshTunnel, type SshReason } from './peer-ssh-contract.js';

/**
 * The real `PeerSshTransport`: A's sshd endpoint and self-test, the refcounted peer forwarder, the authorized_keys
 * lines, and B's ssh tunnel (host-daemon `PeerTunnels.openPeerLink`). The redeemer's per-link key seed is kept sealed
 * here, because the contract hands out only its public line.
 */

export const PEER_LINK_MAX_KEYS = 64;
const PREFLIGHT_MS = 10_000;

/** `created` is optional so state written before seeds were timestamped still loads (such seeds count as old). */
interface KeyState { version: 1; seeds: Record<string, string>; created?: Record<string, number> }
/** A seed minted for a redeem whose link record is not written yet must survive a reconcile that runs in between. */
export const PEER_LINK_KEY_GRACE_MS = 10 * 60_000;

export interface PeerSshTransportOptions {
  /** `<dataDir>/peer-link-keys`; PrivatePeerStorage owns it. */
  directory: string;
  instanceId: string;
  keyProvider: PeerKeyProvider;
  tunnels: Pick<PeerTunnels, 'openPeerLink'>;
  forwarder: PeerSshTransport['forwarder'];
  authorizedKeys: AuthorizedKeys;
  localEndpoint: PeerSshTransport['localEndpoint'];
  /** B: confirm A's name resolves and its sshd accepts TCP before opening the tunnel. */
  preflight: (host: string, port: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

export interface PeerSshTransportHandle extends PeerSshTransport {
  dispose(): void;
  whenIdle(): Promise<void>;
}

const SEED = /^[A-Za-z0-9_-]{43}$/;

/** A fixed reason passes through; anything else is reduced so no foreign text (keys, hosts) reaches the UI. */
function reasonError(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  return new Error((SSH_REASONS as readonly string[]).includes(message) ? message as SshReason : 'peer link step failed');
}

export function createPeerSshTransport(options: PeerSshTransportOptions): PeerSshTransportHandle {
  const storage = new PrivatePeerStorage<KeyState>(options.directory, 'link-keys-v1', options.keyProvider, options.instanceId,
    () => ({ version: 1, seeds: {} }), value => {
      const state = value as KeyState;
      if (state?.version !== 1 || typeof state.seeds !== 'object' || !state.seeds) throw new Error('invalid peer link key state');
      for (const [id, seed] of Object.entries(state.seeds)) if (!PEER_ID.test(id) || !SEED.test(seed)) throw new Error('invalid peer link key state');
      if (state.created !== undefined) {
        if (typeof state.created !== 'object' || !state.created) throw new Error('invalid peer link key state');
        for (const [id, at] of Object.entries(state.created)) if (!PEER_ID.test(id) || !Number.isSafeInteger(at)) throw new Error('invalid peer link key state');
      }
      return state;
    });

  const seedFor = (linkId: string): Promise<string> => storage.transaction(async (state, save) => {
    const existing = state.seeds[linkId];
    if (existing) return existing;
    if (Object.keys(state.seeds).length >= PEER_LINK_MAX_KEYS) throw new Error('peer link key capacity');
    const seed = generateSeed();
    state.seeds[linkId] = seed;
    (state.created ??= {})[linkId] = (options.now ?? Date.now)();
    await save();
    return seed;
  });

  return {
    localEndpoint: signal => options.localEndpoint(signal),
    forwarder: options.forwarder,
    authorizedKeys: options.authorizedKeys,

    async openTunnel(linkId, input: OpenTunnelInput, onState): Promise<PeerSshTunnel> {
      let held = false;
      try {
        await options.preflight(input.endpoint.host, input.endpoint.port, AbortSignal.timeout(PREFLIGHT_MS));
        const seed = 'seed' in input.identity ? input.identity.seed : await seedFor(linkId);
        // B's own forwarder: A's `-R` port delivers into it. Idempotent per link, so a key swap keeps the same port.
        const reversePort = await options.forwarder.acquire(linkId);
        held = true;
        const link = await options.tunnels.openPeerLink({
          endpoint: { host: input.endpoint.host, port: input.endpoint.port, user: input.endpoint.user, hostKey: input.endpoint.hostKey },
          seed, listenPort: input.listenPort, targetPort: input.targetPort, reversePort,
          ...(input.localPort === undefined ? {} : { localPort: input.localPort })
        }, onState);
        return { url: link.url, localPort: link.localPort, close: () => link.close() };
      } catch (error) {
        if (held) await options.forwarder.release(linkId).catch(() => undefined);
        throw reasonError(error);
      }
    },

    async linkKey(linkId) {
      return publicKeyLine(await seedFor(linkId));
    },

    async dropLinkKey(linkId) {
      await options.forwarder.release(linkId).catch(() => undefined);
      await storage.transaction(async (state, save) => {
        if (!(linkId in state.seeds)) return;
        delete state.seeds[linkId];
        delete state.created?.[linkId];
        await save();
      });
    },

    async reconcileLinkKeys(liveLinkIds) {
      const cutoff = (options.now ?? Date.now)() - PEER_LINK_KEY_GRACE_MS;
      await storage.transaction(async (state, save) => {
        let changed = false;
        for (const id of Object.keys(state.seeds)) {
          if (liveLinkIds.has(id) || (state.created?.[id] ?? 0) > cutoff) continue;
          delete state.seeds[id];
          delete state.created?.[id];
          changed = true;
        }
        if (changed) await save();
      });
    },

    dispose: () => storage.dispose(),
    whenIdle: () => storage.whenIdle()
  };
}
