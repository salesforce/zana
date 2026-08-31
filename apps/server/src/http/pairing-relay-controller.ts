import type { ProductHttpContext } from './product-context.js';
import {
  createPairingRelayClient,
  pairingRelayTargets,
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
  renewJoinWindow(): Promise<PairingRelaySnapshot>;
  refresh(): void;
  stop(): void;
}

export function attachPairingRelay(ctx: ProductHttpContext, productPort: number): PairingRelayHandle {
  let client: PairingRelayClient | null = null;

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
