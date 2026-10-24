import type { Server } from 'node:http';
import { registerLocalPeerApp } from '@zana-ai/zcc-host-daemon/peer-forward';

/** Only the listener serving product peer routes may publish this machine's endpoint. */
export async function registerBoundLocalPeerApp(server: Server, dataDir: string, instanceId: string): Promise<() => Promise<void>> {
  const address = server.address();
  if (!server.listening || !address || typeof address === 'string' || address.address !== '127.0.0.1') {
    throw new Error('local peer app requires a bound IPv4 loopback listener');
  }
  let ended = false;
  let remove: (() => Promise<void>) | undefined;
  let removal: Promise<void> | undefined;
  const retire = (): Promise<void> => {
    ended = true;
    if (remove) removal ??= remove();
    return removal ?? Promise.resolve();
  };
  const onEnd = () => {
    server.off('close', onEnd);
    server.off('error', onEnd);
    void retire().catch(error => console.warn(`[zcc] local peer app endpoint retirement failed: ${error instanceof Error ? error.message : String(error)}`));
  };
  server.once('close', onEnd);
  server.once('error', onEnd);
  try {
    remove = await registerLocalPeerApp(dataDir, { port: address.port, instanceId });
    if (ended || !server.listening) {
      await retire();
      throw new Error('local peer app listener closed during registration');
    }
    return async () => {
      server.off('close', onEnd);
      server.off('error', onEnd);
      await retire();
    };
  } catch (error) {
    server.off('close', onEnd);
    server.off('error', onEnd);
    await retire();
    throw error;
  }
}
