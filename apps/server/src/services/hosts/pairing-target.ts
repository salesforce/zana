import type { PairingTarget } from '@zana-ai/zcc-contracts/runtime';
import { isLoopbackHttpHost } from '../../browser-bootstrap.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { PairingRelayHandle } from '../../http/pairing-relay-controller.js';
import {
  isRelaySessionId,
  pairingSessionServerUrl,
  relayJoinWindowOpen,
  type PairingRelaySnapshot
} from '../../http/pairing-session-url.js';
import { resolvePublicAppUrl } from '../../http/public-app-url.js';

export type { PairingTarget } from '@zana-ai/zcc-contracts/runtime';

export interface PairingTargetInput {
  /** Resolved public app URL (`resolvePublicAppUrl`). */
  publicOrigin: string | null;
  /** The relay client's configured origin, independent of the token. */
  relayOrigin: string | null;
  relayTokenPresent: boolean;
  snapshot: PairingRelaySnapshot | null;
}

function normalizedOrigin(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The single rule for which URL a remote host daemon joins. A relay session is
 * only ever appended to the relay's own origin; a public origin that is not the
 * relay is used as-is, and everything else falls back to an SSH tunnel.
 */
export function selectPairingTarget(input: PairingTargetInput): PairingTarget {
  const publicOrigin = normalizedOrigin(input.publicOrigin);
  if (!publicOrigin || isLoopbackHttpHost(new URL(publicOrigin).hostname)) {
    return { kind: 'tunnel', reason: 'no_public_origin' };
  }
  const relayOrigin = normalizedOrigin(input.relayOrigin);
  if (publicOrigin !== relayOrigin) {
    return { kind: 'direct', serverUrl: input.publicOrigin!.trim().replace(/\/+$/u, '') };
  }
  if (!input.relayTokenPresent) return { kind: 'tunnel', reason: 'relay_unconfigured' };
  const snapshot = input.snapshot;
  // Relay configured but no client state yet: the door is not open.
  if (!snapshot || snapshot.state === 'offline') return { kind: 'tunnel', reason: 'relay_offline' };
  if (snapshot.state === 'unconfigured') return { kind: 'tunnel', reason: 'relay_unconfigured' };
  if (!isRelaySessionId(snapshot.sessionId)) return { kind: 'tunnel', reason: 'no_session' };
  return { kind: 'relay', serverUrl: pairingSessionServerUrl(input.relayOrigin!, snapshot.sessionId) };
}

export type PairingRelaySource = Pick<
  PairingRelayHandle,
  'snapshot' | 'renewJoinWindow' | 'relayOrigin' | 'tokenPresent'
>;

export interface ResolvePairingTargetDeps {
  publicOrigin: string | null;
  relay: PairingRelaySource | null | undefined;
  now?: () => number;
}

/**
 * Select a target, renewing a closed relay join window first. A failed renewal
 * means the relay cannot admit a join right now, so it falls back to a tunnel.
 */
export async function resolvePairingTarget(deps: ResolvePairingTargetDeps): Promise<PairingTarget> {
  const relay = deps.relay ?? null;
  const base = {
    publicOrigin: deps.publicOrigin,
    relayOrigin: relay?.relayOrigin() ?? null,
    relayTokenPresent: relay?.tokenPresent() ?? false
  };
  const snapshot = relay?.snapshot() ?? null;
  const first = selectPairingTarget({ ...base, snapshot });
  const wantsRelay = first.kind === 'relay' || (first.kind === 'tunnel' && first.reason === 'no_session');
  if (!relay || !wantsRelay || relayJoinWindowOpen(snapshot, deps.now?.() ?? Date.now())) return first;
  let renewed: PairingRelaySnapshot;
  try {
    renewed = await relay.renewJoinWindow();
  } catch {
    return { kind: 'tunnel', reason: 'relay_offline' };
  }
  return selectPairingTarget({ ...base, snapshot: renewed });
}

/** {@link resolvePairingTarget} with the product context's public URL and relay. */
export function resolvePairingTargetForContext(
  ctx: Pick<ProductHttpContext, 'config' | 'pairingRelay'>
): Promise<PairingTarget> {
  return resolvePairingTarget({
    publicOrigin: resolvePublicAppUrl({ configUrl: ctx.config.getConfig().publicAppUrl }) ?? null,
    relay: ctx.pairingRelay
  });
}
