import { createServer } from 'node:net';

/**
 * Ask the OS for a currently free loopback port. Ephemeral ports are handed out
 * by the kernel across processes, so parallel test workers do not collide the
 * way a random pick from a fixed range does.
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
