import { startStaticHost } from './static-host.js';
import { ServerRuntimeInboundSchema } from '@zana-ai/zcc-contracts/runtime';
import { readProjectSnapshot } from './project-reader.js';
import { createTerminalExecutionService, type TerminalExecutionService } from './terminal-execution-service.js';

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) throw new Error('server utility entry requires an Electron utility process');

let close: (() => Promise<void>) | null = null;
let version = '';
let dataDir = '';
let terminalExecution: TerminalExecutionService | null = null;
parentPort.on('message', async ({ data }) => {
  const parsed = ServerRuntimeInboundSchema.safeParse(data);
  if (!parsed.success) {
    parentPort.postMessage({ type: 'error', message: 'invalid server runtime message' });
    return;
  }
  const message = parsed.data;
  if (message.type === 'start' && message.rendererRoot && !close) {
    try {
      const host = await startStaticHost({ rootDir: message.rendererRoot });
      close = host.close;
      version = message.version ?? '';
      dataDir = message.dataDir;
      terminalExecution = createTerminalExecutionService({
        hostUrl: message.hostUrl,
        token: message.hostToken,
        signingKey: message.hostSigningKey
      });
      parentPort.postMessage({ type: 'ready', url: host.url });
    } catch (error) {
      parentPort.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (message.type === 'request') {
    if (Date.parse(message.deadlineAt) <= Date.now()) {
      parentPort.postMessage({ type: 'error', id: message.id, message: 'server runtime request expired' });
      return;
    }
    if (message.operation === 'app-version') {
      parentPort.postMessage({ type: 'result', id: message.id, value: version });
    }
    if (message.operation === 'projects-list') {
      parentPort.postMessage({ type: 'result', id: message.id, value: await readProjectSnapshot(dataDir) });
    }
    if (message.operation === 'terminal-execute') {
      if (!message.command || !terminalExecution) {
        parentPort.postMessage({ type: 'error', id: message.id, message: 'terminal execution is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', id: message.id, value: await terminalExecution.execute(message.command) });
    }
  }
  if (message.type === 'stop') {
    await close?.();
    parentPort.postMessage({ type: 'stopped' });
    process.exit(0);
  }
});
