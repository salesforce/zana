import type { HostRpcCommand } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from '../../http/product-context.js';
import { LIVE_TURN_COMMAND_TIMEOUT_MS } from '../../http/host-hub.js';

export function startLiveTurnCommand(
  ctx: ProductHttpContext,
  args: {
    hostId: string;
    command: HostRpcCommand;
    timeoutMs?: number;
    onSuccess?: (result: unknown) => void;
    onError?: (error: unknown) => void;
  }
): void {
  void ctx.hostHub.callHostOnlineRpc({
    hostId: args.hostId,
    command: args.command,
    timeoutMs: args.timeoutMs ?? LIVE_TURN_COMMAND_TIMEOUT_MS
  }).then(
    (result) => {
      try {
        args.onSuccess?.(result);
      } catch {
        /* Success side effects are advisory once the HTTP response has returned. */
      }
    },
    (error) => {
      try {
        args.onError?.(error);
      } catch {
        /* Failure settlement is best-effort after a live command is dispatched. */
      }
    }
  );
}
