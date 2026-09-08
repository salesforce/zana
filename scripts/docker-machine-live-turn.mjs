#!/usr/bin/env node
/**
 * Start one Modern thread on a connected host and wait for an assistant
 * `pong` (item/agentMessage/delta only — not the user prompt).
 *
 * Usage:
 *   node scripts/docker-machine-live-turn.mjs \
 *     --server http://127.0.0.1:8780 \
 *     --host-id <id> --project-id <id> \
 *     --provider <id> [--model <id>] [--permission-mode full]
 */
const args = parseArgs(process.argv.slice(2));
const base = (args.server ?? `http://127.0.0.1:${process.env.ZCC_SERVER_PORT || '8780'}`).replace(/\/$/, '');
const hostId = required(args, 'host-id');
const projectId = required(args, 'project-id');
const providerId = required(args, 'provider');
const permissionMode = args['permission-mode'] ?? 'full';
const model = args.model;
const timeoutMs = Number(args['timeout-ms'] ?? 180_000);

const created = await json('POST', '/api/v1/threads', {
  projectId,
  hostId,
  providerId,
  permissionMode,
  ...(model ? { model } : {}),
  input: ['Reply with the single word pong and nothing else.'],
  environment: { kind: 'unmanaged' },
  cwd: '/home/zcc/workspace'
});
const threadId = created.body.value?.id ?? created.body.thread?.id;
if (!threadId || created.body.ok === false) {
  fail(`thread.start ${created.status} ${created.text.slice(0, 1500)}`);
}
process.stdout.write(`thread ${threadId}\n`);

const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  const events = await json('GET', `/api/v1/threads/${threadId}/events`);
  const list = events.body.events ?? [];
  const err = rejection(list);
  if (err) fail(err);
  const reply = assistantText(list);
  if (/\bpong\b/i.test(reply)) {
    process.stdout.write(`pong ${reply.trim().slice(0, 120)}\n`);
    process.exit(0);
  }
  await sleep(2000);
}
fail('timed out waiting for assistant pong');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = '1';
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function required(parsed, key) {
  const value = parsed[key];
  if (!value) fail(`missing --${key}`);
  return value;
}

function assistantText(events) {
  const parts = [];
  for (const event of events ?? []) {
    if (event.type === 'item/agentMessage/delta' && typeof event.payload?.delta === 'string') {
      parts.push(event.payload.delta);
    }
  }
  return parts.join('');
}

function rejection(events) {
  for (const event of events ?? []) {
    if (event.type === 'client/turn/rejected' || event.type === 'system/error') {
      return event.payload?.detail || event.payload?.message || event.type;
    }
  }
  return null;
}

async function json(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed, text };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
