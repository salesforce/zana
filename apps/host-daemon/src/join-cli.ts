import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { startEnrolledHostDaemon } from './enroll-runtime.js';
import { parseJoinArgv, type JoinCliOptions } from './join-argv.js';
import { startLocalStatusServer } from './local-status.js';
import { handleProtocolMismatch } from './protocol-self-update.js';

export type { JoinCliOptions } from './join-argv.js';
export { parseJoinArgv } from './join-argv.js';

async function selfUpdateAndMaybeExit(options: JoinCliOptions, force: boolean): Promise<void> {
  const result = await handleProtocolMismatch({
    dataDir: options.dataDir,
    serverUrl: options.serverUrl,
    enabled: options.autoUpdate,
    force
  });
  if (result === 'updated') process.exit(0);
}

export async function runJoin(options: JoinCliOptions): Promise<{ close(): Promise<void> }> {
  if (!options.dataDir) {
    throw new Error('ZCC_DATA_DIR is required for an isolated machine install');
  }
  let connected = false;
  let hostId = options.hostId ?? null;
  const status = startLocalStatusServer(options.hostDaemonPort, () => ({
    hostId,
    serverUrl: options.serverUrl,
    connected,
    protocolVersion: HOST_RPC_PROTOCOL_VERSION,
    autoUpdate: options.autoUpdate
  }));

  try {
    const daemon = await startEnrolledHostDaemon({
      dataDir: options.dataDir,
      serverUrl: options.serverUrl.endsWith('/') ? options.serverUrl : `${options.serverUrl}/`,
      token: options.joinCode,
      hostId: options.hostId,
      onSocketClose: (code) => {
        connected = false;
        if (!options.autoUpdate) return;
        if (code === 4001 || code === 4002) {
          void selfUpdateAndMaybeExit(options, code === 4001);
        }
      }
    });
    hostId = daemon.hostId;
    connected = true;
    process.stdout.write(`zcc-host-daemon joined hostId=${daemon.hostId}\n`);
    return {
      async close() {
        connected = false;
        await daemon.close();
        await new Promise<void>((resolve, reject) => {
          status.close((error) => (error ? reject(error) : resolve()));
        });
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.autoUpdate && /incompatible host-rpc protocol version|409/.test(message)) {
      await selfUpdateAndMaybeExit(options, true);
    }
    status.close();
    throw error;
  }
}

const launchedDirectly = (() => {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('join-cli.ts') || entry.endsWith('join-cli.js') || entry.endsWith('join.mjs');
})();

if (launchedDirectly && process.argv.includes('join')) {
  const options = parseJoinArgv(process.argv.slice(2));
  const running = await runJoin(options);
  const shutdown = () => {
    void running.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
