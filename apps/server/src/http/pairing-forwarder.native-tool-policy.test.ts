import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createNativeToolPolicyHttpClient, createNativeToolSettledHttpClient } from '../../../host-daemon/src/native-tool-policy-client.js';
import { startPairingForwarder, type PairingForwarder } from './pairing-forwarder.js';

/**
 * The daemon's real policy client must get an explicit decision back through
 * the SSH pairing tunnel. Before the routes were forwarded the tunnel answered
 * 403, the client read that as "unavailable" and every remote tool was denied.
 */
const request = { threadId: 'thread', providerThreadId: 'provider-thread', providerId: 'provider',
  projectId: 'project', environmentId: 'environment', callId: 'call', toolName: 'Bash', input: { command: 'true' } };

let product: Server;
let forwarder: PairingForwarder;
let seen: Array<{ path: string; authorization: string | undefined; body: string }>;

beforeEach(async () => {
  seen = [];
  product = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ path: req.url ?? '', authorization: req.headers.authorization, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ action: 'allow' }));
    });
  });
  await new Promise<void>(resolve => product.listen(0, '127.0.0.1', resolve));
  forwarder = await startPairingForwarder((product.address() as AddressInfo).port);
});

afterEach(async () => {
  await forwarder.close();
  await new Promise<void>(resolve => product.close(() => resolve()));
});

const options = () => ({ serverUrl: `http://127.0.0.1:${forwarder.port}`, hostId: 'host', hostKey: 'key', sessionId: 'instance' });

it('delivers a native tool policy decision from the server through the tunnel', async () => {
  const decide = createNativeToolPolicyHttpClient(options());
  await expect(decide(request, new AbortController().signal)).resolves.toEqual({ action: 'allow' });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ path: '/internal/hosts/native-tool-policy', authorization: 'Bearer key' });
  expect(JSON.parse(seen[0]!.body)).toMatchObject({ sessionId: 'instance', callId: 'call', toolName: 'Bash' });
});

it('forwards the settled-tool event through the tunnel', async () => {
  createNativeToolSettledHttpClient(options())({ ...request, state: 'succeeded', durationMs: 1 });
  await expect.poll(() => seen.map(entry => entry.path)).toEqual(['/internal/hosts/tool-settled']);
});
