import type { ToolCallRequest, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import {
  hostDaemonToolCallResponseSchema,
  type HostDaemonToolCallRequest
} from '@zana-ai/zcc-host-daemon-contract';

export interface PluginToolCallHttpClient {
  invoke(request: ToolCallRequest): Promise<ToolCallResponse>;
}

export function createPluginToolCallHttpClient(options: {
  serverUrl: string;
  hostId: string;
  hostKey: string;
  sessionId: string;
  fetchFn?: typeof fetch;
}): PluginToolCallHttpClient {
  const fetchFn = options.fetchFn ?? fetch;

  function url(path: string): string {
    return new URL(path, options.serverUrl.endsWith('/') ? options.serverUrl : `${options.serverUrl}/`).toString();
  }

  function headers(): Record<string, string> {
    return {
      authorization: `Bearer ${options.hostKey}`,
      'content-type': 'application/json',
      'x-zcc-host-id': options.hostId
    };
  }

  return {
    async invoke(request) {
      const payload: HostDaemonToolCallRequest = {
        sessionId: options.sessionId,
        threadId: request.threadId,
        providerThreadId: request.providerThreadId,
        turnId: request.turnId,
        callId: request.callId,
        tool: request.tool,
        ...(request.arguments !== undefined ? { arguments: request.arguments } : {})
      };
      const response = await fetchFn(url('internal/hosts/tool-call'), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`plugin tool call failed: ${response.status}`);
      }
      return hostDaemonToolCallResponseSchema.parse(await response.json());
    }
  };
}
