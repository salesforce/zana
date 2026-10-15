import type { ProductHttpContext } from './product-context.js';
import { isLoopbackHttpHost } from '../browser-bootstrap.js';
import { resolvePublicAppUrl } from './public-app-url.js';
import {
  createPairingRelayClient,
  pairingRelayTargets,
  resolveRelayToken,
  type PairingRelayClient,
  type PairingRelaySnapshot,
  type PairingRelayState
} from './pairing-relay-client.js';
import { isRelaySessionId } from './pairing-session-url.js';

export interface PairingRelayHandle {
  state(): PairingRelayState;
  snapshot(): PairingRelaySnapshot;
  sessionId(): string | undefined;
  joinUntil(): number | undefined;
  /**
   * The relay's configured public origin (env/bake/repo file, never Settings),
   * even when no token is set; `null` when absent or loopback.
   */
  relayOrigin(): string | null;
  /** Whether a relay token is configured (env/bake only). */
  tokenPresent(): boolean;
  renewJoinWindow(): Promise<PairingRelaySnapshot>;
  refresh(): void;
  stop(): void;
}

export function attachPairingRelay(ctx: ProductHttpContext, productPort: number): PairingRelayHandle {
  let client: PairingRelayClient | null = null;
  let origin: string | null = null;
  let hasToken = false;

  const emit = () => {
    ctx.hub.emit('relay:changed', client?.snapshot() ?? { state: 'unconfigured' as const });
  };

  const persistSessionId = (sessionId: string) => {
    if (ctx.config.getConfig().relaySessionId === sessionId) return;
    ctx.config.setConfig({ relaySessionId: sessionId });
  };

  const startFromConfig = () => {
    client?.stop();
    const config = ctx.config.getConfig();
    const targets = pairingRelayTargets({
      env: process.env
    });
    origin = relayOriginFromEnv(process.env);
    hasToken = Boolean(resolveRelayToken({ env: process.env }));
    if (!targets.origin || !targets.token) {
      if (config.relaySessionId) ctx.config.setConfig({ relaySessionId: undefined });
    }
    client = createPairingRelayClient({
      productPort,
      origin: targets.origin,
      token: targets.token,
      sessionId: isRelaySessionId(config.relaySessionId) ? config.relaySessionId : undefined,
      onHello: (hello) => {
        persistSessionId(hello.sessionId);
        emit();
      }
    });
    client.onState(() => emit());
    client.start();
    emit();
  };

  startFromConfig();

  const handle: PairingRelayHandle = {
    state: () => client?.state() ?? 'unconfigured',
    snapshot: () => client?.snapshot() ?? { state: 'unconfigured' },
    sessionId: () => client?.sessionId(),
    joinUntil: () => client?.joinUntil(),
    relayOrigin: () => origin,
    tokenPresent: () => hasToken,
    async renewJoinWindow() {
      return client?.renewJoinWindow() ?? { state: 'unconfigured' as const };
    },
    refresh: startFromConfig,
    stop() {
      client?.stop();
      client = null;
    }
  };
  ctx.pairingRelay = handle;
  return handle;
}

/** Same origin resolution as {@link pairingRelayTargets}, without requiring a token. */
export function relayOriginFromEnv(env: NodeJS.ProcessEnv, bundledUrl?: string | null): string | null {
  const resolved = resolvePublicAppUrl({ env, ...(bundledUrl !== undefined ? { bundledUrl } : {}) });
  // resolvePublicAppUrl only returns URLs it has already parsed.
  if (!resolved || isLoopbackHttpHost(new URL(resolved).hostname)) return null;
  return resolved;
}
