import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startPairingForwarder, type PairingForwarder } from '../../http/pairing-forwarder.js';
import type { PeerSshTransport } from './peer-ssh-contract.js';

export type PeerForwarderLeaseApi = PeerSshTransport['forwarder'];

export interface PeerForwarderLease extends PeerForwarderLeaseApi {
  /** Current forwarder port, or null while nothing holds a lease. */
  readonly port: number | null;
  /** Drop every lease and stop listening (app shutdown). */
  close(): Promise<void>;
}

export interface PeerForwarderLeaseOptions {
  /** `<dataDir>/peer-ssh/forwarder.json` remembers F so authorized_keys `permitopen` stays valid across restarts. */
  dataDir: string;
  productPort: number | (() => number);
  productHost?: string;
  /**
   * Asked when the remembered F is busy: may a different port be chosen? False while any live link's `permitopen` / `-L` target
   * still names the old F, because a local squatter on it would intercept the redeemer's forward. Then the acquire fails closed.
   * Default true.
   */
  canRebind?: () => boolean;
  /** Fired when the remembered F was unavailable and a new one was chosen; A-side lines must be re-issued. */
  onPortChanged?: (port: number) => void;
  /** Test seam. */
  start?: typeof startPairingForwarder;
}

const PORT_FILE = 'forwarder.json';

function isAddrInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE';
}

async function readPersistedPort(file: string): Promise<number | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { port?: unknown };
    const port = parsed.port;
    return typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

async function persistPort(directory: string, file: string, port: number): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify({ port })}\n`, { mode: 0o600, flag: 'wx' });
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/**
 * Refcounted, lazy peer forwarder. The first `acquire` starts a `allow:'peer'`
 * forwarder; the last `release` stops it, so nothing listens while no A-side
 * link exists. F is remembered on disk and reused when still free.
 */
export function createPeerForwarderLease(options: PeerForwarderLeaseOptions): PeerForwarderLease {
  const directory = join(options.dataDir, 'peer-ssh');
  const file = join(directory, PORT_FILE);
  const start = options.start ?? startPairingForwarder;
  const holders = new Set<string>();
  let forwarder: PairingForwarder | null = null;
  // Acquire/release mutate shared state across awaits, so run them one at a time.
  let queue: Promise<unknown> = Promise.resolve();

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function launch(): Promise<PairingForwarder> {
    const productPort = typeof options.productPort === 'function' ? options.productPort() : options.productPort;
    const base = { productHost: options.productHost, allow: 'peer' as const };
    const remembered = await readPersistedPort(file);
    if (remembered !== null) {
      try {
        return await start(productPort, { ...base, port: remembered });
      } catch (error) {
        if (!isAddrInUse(error)) throw error;
        if (options.canRebind && !options.canRebind()) throw new Error('peer forwarder port busy');
      }
    }
    const started = await start(productPort, { ...base, port: 0 });
    try {
      await persistPort(directory, file, started.port);
    } catch (error) {
      await started.close();
      throw error;
    }
    if (remembered !== null) options.onPortChanged?.(started.port);
    return started;
  }

  async function stop(): Promise<void> {
    const current = forwarder;
    forwarder = null;
    await current?.close();
  }

  return {
    get port() {
      return forwarder?.port ?? null;
    },
    acquire(linkId) {
      return serial(async () => {
        if (!forwarder) forwarder = await launch();
        holders.add(linkId);
        return forwarder.port;
      });
    },
    release(linkId) {
      return serial(async () => {
        if (holders.delete(linkId) && holders.size === 0) await stop();
      });
    },
    close() {
      return serial(async () => {
        holders.clear();
        await stop();
      });
    }
  };
}
