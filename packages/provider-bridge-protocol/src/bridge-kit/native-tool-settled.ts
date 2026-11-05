import {
  NATIVE_TOOL_SETTLED_METHOD,
  NATIVE_TOOL_SETTLED_OUTPUT_MAX_CHARS,
  type NativeToolSettledParams,
} from '../bridge-requests.js';

export interface BridgeNativeToolSettledNotification {
  jsonrpc: '2.0';
  method: typeof NATIVE_TOOL_SETTLED_METHOD;
  params: NativeToolSettledParams;
}

export type NativeToolSettledReport = Omit<NativeToolSettledParams, 'durationMs' | 'outputBytes' | 'output'> & {
  /** Raw tool output; bounded here and reduced to a redacted preview by the server, never logged. */
  output?: string | undefined;
};

/**
 * Fire-and-forget reporter for tool completions. `started` records when a
 * policy-approved call began (bounded, oldest-first eviction); `settled` sends
 * the notification and never throws or waits.
 */
export function createNativeToolSettledReporter(
  send: (notification: BridgeNativeToolSettledNotification) => void,
  now: () => number = Date.now,
  capacity = 4_096,
) {
  const starts = new Map<string, number>();
  const key = (threadId: string, callId: string) => `${threadId}\u0000${callId}`;
  return {
    started(threadId: string, callId: string): void {
      const k = key(threadId, callId);
      starts.delete(k);
      starts.set(k, now());
      while (starts.size > capacity) starts.delete(starts.keys().next().value as string);
    },
    settled(report: NativeToolSettledReport): void {
      const k = key(report.threadId, report.callId);
      const began = starts.get(k);
      starts.delete(k);
      const { output, ...rest } = report;
      const bounded = output === undefined || output.length === 0
        ? undefined
        : output.slice(0, NATIVE_TOOL_SETTLED_OUTPUT_MAX_CHARS);
      try {
        send({
          jsonrpc: '2.0',
          method: NATIVE_TOOL_SETTLED_METHOD,
          params: {
            ...rest,
            durationMs: began === undefined ? 0 : Math.max(0, now() - began),
            ...(bounded !== undefined ? { outputBytes: Buffer.byteLength(output ?? '', 'utf8'), output: bounded } : {}),
          },
        });
      } catch {
        // Observational: a transport failure drops the event.
      }
    },
    /** Drops start times of a thread whose session ended. */
    forget(threadId: string): void {
      const prefix = `${threadId}\u0000`;
      for (const k of starts.keys()) if (k.startsWith(prefix)) starts.delete(k);
    },
  };
}
