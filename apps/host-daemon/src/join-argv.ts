export interface JoinCliOptions {
  joinCode?: string;
  hostId?: string;
  serverUrl: string;
  hostDaemonPort: number;
  autoUpdate: boolean;
  dataDir: string;
}

export function parseJoinArgv(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): JoinCliOptions {
  const args = argv[0] === 'join' ? argv.slice(1) : argv;
  const read = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    return args[index + 1];
  };
  const serverUrl = (read('--server-url') ?? env.ZCC_SERVER_URL ?? '').replace(/\/$/, '');
  const portRaw = read('--host-daemon-port') ?? env.ZCC_HOST_DAEMON_PORT ?? '38888';
  const port = Number(portRaw);
  if (!serverUrl) {
    throw new Error('join requires --server-url');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('join requires a valid --host-daemon-port');
  }
  return {
    joinCode: read('--join-code'),
    hostId: read('--host-id'),
    serverUrl,
    hostDaemonPort: port,
    autoUpdate: args.includes('--auto-update') || env.ZCC_HOST_AUTO_UPDATE === '1',
    dataDir: env.ZCC_DATA_DIR ?? ''
  };
}
