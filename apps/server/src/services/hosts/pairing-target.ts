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
  /**
   * Public app URL from env, build bake, or the repo file — never Settings.
   * See {@link PairingTargetInput.settingsOrigin}.
   */
  publicOrigin: string | null;
  /**
   * The Settings "Relay pairing URL". It applies only while the relay is
   * connected, so on its own it is never a direct join target.
   */
  settingsOrigin?: string | null;
  /** The relay client's configured origin, independent of the token. */
  relayOrigin: string | null;
  relayTokenPresent: boolean;
  snapshot: PairingRelaySnapshot | null;
}

/**
 * A bare http(s) origin, or null. Userinfo, a path, a query, or a fragment make
 * the value unusable: it is spliced into a shell command for the remote host.
 */
export function normalizedOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    // `new URL` drops an empty `?` / `#`; refuse them in the raw text too.
    if (/[?#@]/u.test(raw)) return null;
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
    // A Settings-only relay URL means the relay is not set up: same as no token.
    const settingsOrigin = normalizedOrigin(input.settingsOrigin);
    if (settingsOrigin && !isLoopbackHttpHost(new URL(settingsOrigin).hostname)) {
      return { kind: 'tunnel', reason: 'relay_unconfigured' };
    }
    return { kind: 'tunnel', reason: 'no_public_origin' };
  }
  const relayOrigin = normalizedOrigin(input.relayOrigin);
  if (publicOrigin !== relayOrigin) {
    // Bare origin only: never the raw configured text.
    return { kind: 'direct', serverUrl: publicOrigin };
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
  settingsOrigin?: string | null;
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
    settingsOrigin: deps.settingsOrigin ?? null,
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

/**
 * {@link resolvePairingTarget} with the product context's public URL and relay.
 * The Settings URL is kept apart: it never becomes a direct target by itself.
 */
export function resolvePairingTargetForContext(
  ctx: Pick<ProductHttpContext, 'config' | 'pairingRelay'>,
  options: { env?: NodeJS.ProcessEnv; bundledUrl?: string | null; cwd?: string } = {}
): Promise<PairingTarget> {
  const configUrl = ctx.config.getConfig().publicAppUrl;
  return resolvePairingTarget({
    publicOrigin: resolvePublicAppUrl({ ...options, configUrl: null }) ?? null,
    settingsOrigin: configUrl ?? null,
    relay: ctx.pairingRelay
  });
}
