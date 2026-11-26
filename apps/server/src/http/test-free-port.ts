import { createServer } from 'node:net';

/**
 * Ask the OS for a currently free loopback port. Ephemeral ports are handed out
 * by the kernel across processes, so parallel test workers do not collide the
 * way a random pick from a fixed range does.
 *
 * Limit: the listener is closed before the caller binds the port, so another
 * process could claim it in that gap (bind-close-rebind race). That is far less
 * likely than a random pick from a small fixed range, but not impossible.
 */
export async function reserveFreePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address() as { port: number };
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}
