import { startHostDaemon } from './daemon.js';
import { createLocalPtyTerminalManager } from './local-pty-host.js';

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) throw new Error('host utility entry requires an Electron utility process');

let close: (() => Promise<void>) | null = null;
parentPort.on('message', async ({ data }) => {
  if (!data || typeof data !== 'object') return;
  const message = data as { type?: string; token?: string; signingKey?: string };
  if (message.type === 'start' && message.token && message.signingKey && !close) {
    try {
      const host = await startHostDaemon({
        token: message.token,
      signingKey: message.signingKey,
        // Parent transport is authenticated by Electron's utility-process
        // channel. The desktop supervisor validates and forwards only typed
        // events; renderer code never sees this control channel.
        terminalManager: createLocalPtyTerminalManager((event) => parentPort.postMessage({ type: 'terminal-event', event }))
      });
      close = host.close;
      parentPort.postMessage({ type: 'ready', url: host.url });
    } catch (error) {
      parentPort.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (message.type === 'stop') {
    await close?.();
    process.exit(0);
  }
});
