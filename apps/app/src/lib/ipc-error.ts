import { CONNECT_ACCESS_REVOKED_MESSAGE } from '@zana-ai/zcc-domain/product';

const IPC_PREFIX = /^(?:Uncaught )?Error invoking remote method '[^']*':\s*(?:Error:\s*)?/;

/** Message of a rejected IPC call without Electron's "Error invoking remote method" wrapper. */
export function ipcErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : '';
  return raw.replace(IPC_PREFIX, '').trim() || fallback;
}

/** True when Zana Connect rejected this computer's saved credential. Main owns the stable message. */
export function isConnectAccessRevoked(error: unknown): boolean {
  return ipcErrorMessage(error, '').includes(CONNECT_ACCESS_REVOKED_MESSAGE);
}
