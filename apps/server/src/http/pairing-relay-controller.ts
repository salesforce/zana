import type { ProductHttpContext } from './product-context.js';
import {
  createPairingRelayClient,
  pairingRelayTargets,
  type PairingRelayClient,
  type PairingRelayState
} from './pairing-relay-client.js';

export interface PairingRelayHandle {
  state(): PairingRelayState;
  refresh(): void;
  stop(): void;
}

export function attachPairingRelay(ctx: ProductHttpContext, productPort: number): PairingRelayHandle {
  let client: PairingRelayClient | null = null;

  const emit = (state: PairingRelayState) => {
    ctx.hub.emit('relay:changed', { state });
  };

  const startFromConfig = () => {
    client?.stop();
    const config = ctx.config.getConfig();
    const targets = pairingRelayTargets({
      configUrl: config.publicAppUrl,
      configToken: config.relayToken
    });
    client = createPairingRelayClient({
      productPort,
      origin: targets.origin,
      token: targets.token
    });
    client.onState(emit);
    client.start();
    emit(client.state());
  };

  startFromConfig();

  const handle: PairingRelayHandle = {
    state: () => client?.state() ?? 'unconfigured',
    refresh: startFromConfig,
    stop() {
      client?.stop();
      client = null;
    }
  };
  ctx.pairingRelay = handle;
  return handle;
}
