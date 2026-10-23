import { nativeToolDecisionSchema, type NativeToolDecision } from '@zana-ai/zcc-provider-bridge-protocol';
import type { AgentRuntimeOptions } from '@zana-ai/zcc-agent-runtime';
import { joinServerUrl } from './server-url.js';

/** Only an explicit, bounded response from the authenticated server can allow execution. */
export function createNativeToolPolicyHttpClient(options: {
  serverUrl: string;
  hostId: string;
  hostKey: string;
  sessionId: string;
  fetchFn?: typeof fetch;
}): NonNullable<AgentRuntimeOptions['onNativeToolDecision']> {
  return async (request, signal): Promise<NativeToolDecision> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    try {
      const response = await (options.fetchFn ?? fetch)(joinServerUrl(options.serverUrl, '/internal/hosts/native-tool-policy').href, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${options.hostKey}`, 'x-zcc-host-id': options.hostId, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: options.sessionId, threadId: request.threadId,
          providerId: request.providerId, providerThreadId: request.providerThreadId,
          callId: request.callId, toolName: request.toolName, input: request.input })
      });
      if (!response.ok || !response.body) throw new Error('native policy unavailable');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 16_384) throw new Error('native policy response exceeds limit');
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const parsed = nativeToolDecisionSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (parsed.success && !controller.signal.aborted) return parsed.data;
    } catch {
      // Transport and validation failures cannot inherit a permissive default.
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      controller.abort();
    }
    return { action: 'deny', reason: 'native policy unavailable or invalid' };
  };
}
