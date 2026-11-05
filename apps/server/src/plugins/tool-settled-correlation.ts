/**
 * Remembers the `invocationId` a Modern native tool call was approved under so
 * the later settled event carries the same id. Policy hashes the tool input;
 * a settled event does not carry it, so the server must remember the result.
 * In memory only, bounded (oldest evicted first), and never holds tool input.
 */
export interface ToolInvocationCorrelation {
  remember(scope: string, callId: string, invocationId: string): void;
  /** Consumes the entry; undefined when never seen or evicted. */
  take(scope: string, callId: string): string | undefined;
}

export function createToolInvocationCorrelation(max = 8_192): ToolInvocationCorrelation {
  const entries = new Map<string, string>();
  const key = (scope: string, callId: string) => `${scope}\u0000${callId}`;
  return {
    remember(scope, callId, invocationId) {
      const k = key(scope, callId);
      entries.delete(k);
      entries.set(k, invocationId);
      while (entries.size > max) entries.delete(entries.keys().next().value as string);
    },
    take(scope, callId) {
      const k = key(scope, callId);
      const found = entries.get(k);
      if (found !== undefined) entries.delete(k);
      return found;
    }
  };
}

export const hostToolInvocations = createToolInvocationCorrelation();
