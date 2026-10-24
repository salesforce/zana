import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { HOST_RPC_PROTOCOL_VERSION, HostHelloOkMessageSchema, HostRpcCommandSchema, HostRpcRequestMessageSchema,
  PeerControlCommandSchema, PeerControlPacketSchema, PEER_CONTROL_MAX_BYTES, PEER_CONTROL_ROUTE, parseHostRpcResult } from './host-rpc.js';

const packet = { version: 1, senderId: 'app-a', recipientId: 'app-b', senderHostId: randomUUID(), recipientHostId: randomUUID(),
  route: PEER_CONTROL_ROUTE, nonce: 'c'.repeat(48), issuedAt: 1_000_000, sealed: 's'.repeat(43) };
const command = { type: 'peer.control', packet, timeoutMs: 15_000 };
it('core control uses the combined host protocol without changing canonical peer.forward v2', () => {
  expect(HOST_RPC_PROTOCOL_VERSION).toBe(46);
  expect(PeerControlCommandSchema.parse(command)).toEqual(command);
  expect(HostRpcCommandSchema.parse(command)).toEqual(command);
  expect(HostRpcRequestMessageSchema.parse({ type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION, requestId: 'control', command }).command).toEqual(command);
  expect(parseHostRpcResult('peer.control', { status: 403, body: '{}' })).toEqual({ status: 403, body: '{}' });
  expect(HostHelloOkMessageSchema.parse({ type: 'host.hello-ok', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: packet.senderHostId,
    productInstanceId: randomUUID(), enrollmentCapability: 'peer.forward' })).toMatchObject({ enrollmentCapability: 'peer.forward' });
});
it.each(Object.keys(packet))('requires control packet %s', field => {
  const missing = { ...packet }; delete missing[field as keyof typeof missing];
  expect(PeerControlPacketSchema.safeParse(missing).success).toBe(false);
});
it.each([{ version: 2 }, { senderId: 'app\n' }, { recipientId: packet.senderId }, { senderHostId: 'host' }, { recipientHostId: 'host' },
  { route: '/api/v1/peer-control?x=1' }, { route: 'http://evil.test/' }, { nonce: 'a'.repeat(47) }, { nonce: 'A'.repeat(48) },
  { issuedAt: -1 }, { issuedAt: 1.5 }, { issuedAt: Number.MAX_SAFE_INTEGER + 1 }, { sealed: 'short' },
  { sealed: '+'.repeat(43) }, { sealed: 's'.repeat(PEER_CONTROL_MAX_BYTES + 1) }, { authorization: 'secret' }])
  ('rejects malformed packet %j', patch => expect(PeerControlPacketSchema.safeParse({ ...packet, ...patch }).success).toBe(false));
it.each([{ timeoutMs: 0 }, { timeoutMs: 15_001 }, { timeoutMs: 1.5 }, { url: 'http://evil.test/' }, { type: 'peer.forward' }])
  ('rejects malformed command %j', patch => expect(PeerControlCommandSchema.safeParse({ ...command, ...patch }).success).toBe(false));
it.each([{ status: 0, body: '' }, { status: 600, body: '' }, { status: 200, body: 1 },
  { status: 200, body: 'x'.repeat(PEER_CONTROL_MAX_BYTES + 1) }, { status: 200, body: '', headers: {} }])
  ('rejects malformed response', response => expect(() => parseHostRpcResult('peer.control', response)).toThrow());
