/**
 * Test-only laptop: attaches to a local front door and answers pairing HTTP.
 * Used by the docker remote-machine E2E so the tunnel stays inside the door
 * container (Docker Desktop's published-port path drops later WS frames).
 *
 *   RELAY_ORIGIN=http://127.0.0.1:4321 ZCC_RELAY_TOKEN=… node echo-laptop.mjs
 */
import { writeFileSync } from 'node:fs';
import { connectWs } from './ws-raw.mjs';
import { FLAG, TYPE, decodeFrame, encodeFrame, encodeJsonPayload } from './protocol.mjs';

const origin = new URL(process.env.RELAY_ORIGIN ?? 'http://127.0.0.1:4321');
const token = process.env.ZCC_RELAY_TOKEN ?? '';
const script = Buffer.from('#!/bin/sh\necho docker-session-pair\n');
const enrolled = Buffer.from(JSON.stringify({
  hostId: '44444444-4444-4444-8444-444444444444',
  hostKey: 'k'.repeat(32)
}));

const laptop = await connectWs({
  hostname: origin.hostname,
  port: Number(origin.port || (origin.protocol === 'https:' ? 443 : 80)),
  path: '/_zcc/relay',
  headers: { Authorization: `Bearer ${token}` }
});

function reply(streamId, status, headers, body) {
  laptop.send(encodeFrame(TYPE.HTTP_RES, FLAG.META, streamId, encodeJsonPayload({ status, headers })));
  laptop.send(encodeFrame(TYPE.HTTP_RES, FLAG.FIN, streamId, body));
}

laptop.on('message', (payload) => {
  const frame = decodeFrame(payload);
  if (!frame) return;
  if (frame.type === TYPE.HELLO) {
    const hello = JSON.parse(frame.payload.toString());
    writeFileSync('/tmp/echo-session-id', `${hello.sessionId}\n`);
    process.stdout.write(`HELLO ${hello.sessionId}\n`);
    return;
  }
  if (frame.type === TYPE.PING) {
    laptop.send(encodeFrame(TYPE.PONG, 0, frame.streamId));
    return;
  }
  if (frame.type !== TYPE.HTTP_REQ || !(frame.flags & FLAG.META)) return;
  const meta = JSON.parse(frame.payload.toString());
  const url = String(meta.url ?? '/');
  if (url.includes('/internal/hosts/enroll')) {
    reply(frame.streamId, 201, [['content-type', 'application/json; charset=utf-8']], enrolled);
    return;
  }
  reply(frame.streamId, 200, [['content-type', 'text/x-shellscript; charset=utf-8']], script);
});

laptop.on('close', (code, reason) => {
  process.stderr.write(`echo-laptop closed ${code} ${reason}\n`);
  process.exit(1);
});
laptop.on('error', (error) => {
  process.stderr.write(`echo-laptop error ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
