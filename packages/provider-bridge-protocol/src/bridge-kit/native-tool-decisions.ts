import { RELAY_BACKSTOP_MS } from "@zana-ai/zcc-domain/native-tool-policy-budget";
import { nativeToolDecisionSchema, type NativeToolDecision, type NativeToolDecisionRequest } from '../bridge-requests.js';
import type { BridgeJsonRpcResponse } from './bridge-tool-calls.js';

export interface BridgeNativeToolDecisionRequest {
  jsonrpc: '2.0'; id: string; method: 'tool/policy/decide'; params: NativeToolDecisionRequest;
}

/** Separate ids and bounded waits keep late decisions from settling another call. */
export function createNativeToolDecisionTracker(send: (request: BridgeNativeToolDecisionRequest) => void, timeoutMs = RELAY_BACKSTOP_MS) {
  const pending = new Map<string, { scope: object; finish: (decision: NativeToolDecision) => void }>();
  let serial = 0;
  const deny = (reason: string): NativeToolDecision => ({ action: 'deny', reason });
  return {
    decide(params: NativeToolDecisionRequest, scope: object, signal?: AbortSignal): Promise<NativeToolDecision> {
      if (signal?.aborted) return Promise.resolve(deny('native policy cancelled'));
      if (pending.size >= 128) return Promise.resolve(deny('native policy capacity reached'));
      return new Promise(resolve => {
        const id = `native-policy-${++serial}`;
        const finish = (decision: NativeToolDecision) => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          resolve(decision);
        };
        const abort = () => finish(deny('native policy cancelled'));
        const timer = setTimeout(() => finish(deny('native policy timed out')), timeoutMs);
        pending.set(id, { scope, finish });
        signal?.addEventListener('abort', abort, { once: true });
        try { send({ jsonrpc: '2.0', id, method: 'tool/policy/decide', params }); }
        catch { finish(deny('native policy transport failed')); }
      });
    },
    handle(response: BridgeJsonRpcResponse): boolean {
      const call = typeof response.id === 'string' ? pending.get(response.id) : undefined;
      if (!call) return false;
      const parsed = 'result' in response ? nativeToolDecisionSchema.safeParse(response.result) : null;
      call.finish(parsed?.success ? parsed.data : deny('native policy reply unavailable or invalid'));
      return true;
    },
    cancel(scope: object): void {
      for (const call of pending.values()) if (call.scope === scope) call.finish(deny('native policy session ended'));
    },
  };
}
