import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';
import { z } from 'zod';

interface EnrollmentChild {
  on(event: 'message', listener: (message: unknown) => void): unknown;
  off?(event: 'message', listener: (message: unknown) => void): unknown;
  postMessage(message: unknown): void;
}

/** Return the product registry identity from the authenticated utility channel.
 * The private terminal transport has a separate identity; it must never be used
 * to authorize a product host selection or to classify project ownership. */
export function enrollHostUtility(
  child: EnrollmentChild,
  input: { serverUrl: string; token: string; dataDir: string },
  type: 'enroll' | 'relaunch' = 'enroll'
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, hostId?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.('message', onMessage);
      if (error) reject(error);
      else resolve(hostId!);
    };
    const timer = setTimeout(
      () => finish(new Error(type === 'relaunch' ? 'host relaunch timed out' : 'host enroll timed out')),
      type === 'relaunch' ? 20_000 : 15_000
    );
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const data = message as { type?: string; protocolVersion?: number; message?: string; hostId?: unknown };
      if (data.type !== 'enrolled' && data.type !== 'error') return;
      if (data.protocolVersion !== SERVER_RUNTIME_PROTOCOL_VERSION) {
        finish(new Error('incompatible host enrollment protocol version'));
      } else if (data.type === 'enrolled') {
        const identity = z.string().uuid().safeParse(data.hostId);
        if (!identity.success) finish(new Error('host enrollment did not return a valid identity'));
        else finish(undefined, identity.data);
      } else {
        finish(new Error(typeof data.message === 'string' ? data.message : (type === 'relaunch' ? 'host relaunch failed' : 'host enroll failed')));
      }
    };
    child.on('message', onMessage);
    try {
      child.postMessage({ type, protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, ...input,
        provenance: 'non-tunnel', replaceEnrollment: false,
        path: process.env.PATH, ghBinary: process.env.ZCC_GH_BINARY });
    } catch (error) {
      finish(error instanceof Error ? error : new Error('host enrollment transport failed'));
    }
  });
}
