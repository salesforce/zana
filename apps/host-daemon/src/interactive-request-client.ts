import type { PendingInteractionCreate } from '@zana-ai/zcc-domain/thread-runtime';
import {
  hostDaemonInteractiveInterruptResponseSchema,
  hostDaemonInteractiveRequestResponseSchema,
  type HostDaemonInteractiveInterruptRequest,
  type HostDaemonInteractiveRequestResponse
} from '@zana-ai/zcc-host-daemon-contract';

const REGISTER_ATTEMPTS = 5;

export interface InteractiveRequestHttpClient {
  registerRequest(request: PendingInteractionCreate): Promise<HostDaemonInteractiveRequestResponse>;
  interruptRequests(args: {
    providerId: string;
    threadIds: readonly string[];
    reason: string;
  }): Promise<void>;
}

function jitterDelayMs(): number {
  return 100 + Math.floor(Math.random() * 1900);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createInteractiveRequestHttpClient(options: {
  serverUrl: string;
  hostId: string;
  hostKey: string;
  sessionId: string;
  fetchFn?: typeof fetch;
}): InteractiveRequestHttpClient {
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
    async registerRequest(request) {
      let lastError: Error = new Error('interactive request registration failed');
      for (let attempt = 0; attempt < REGISTER_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetchFn(url('internal/hosts/interactive-request'), {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ sessionId: options.sessionId, interaction: request })
          });
          if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
            throw Object.assign(new Error(`register interactive request failed: ${response.status}`), { retryable: false });
          }
          if (!response.ok) {
            throw new Error(`register interactive request failed: ${response.status}`);
          }
          return hostDaemonInteractiveRequestResponseSchema.parse(await response.json());
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (
            attempt === REGISTER_ATTEMPTS - 1
            || (error instanceof Error && 'retryable' in error && error.retryable === false)
          ) {
            throw lastError;
          }
          await sleep(jitterDelayMs());
        }
      }
      throw lastError;
    },
    async interruptRequests(args) {
      const payload: HostDaemonInteractiveInterruptRequest = {
        sessionId: options.sessionId,
        providerId: args.providerId,
        threadIds: [...args.threadIds],
        reason: args.reason
      };
      try {
        const response = await fetchFn(url('internal/hosts/interactive-request/interrupt'), {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(payload)
        });
        if (!response.ok) return;
        hostDaemonInteractiveInterruptResponseSchema.parse(await response.json());
      } catch {
        /* best-effort */
      }
    }
  };
}
