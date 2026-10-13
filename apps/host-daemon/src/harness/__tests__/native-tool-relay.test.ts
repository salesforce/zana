/**
 * The two native-tool-policy (OBL-004) PreToolUse relays — Claude's
 * `--settings` command and Codex's `-c hooks.PreToolUse` entry — run through a
 * real `sh` against a local policy server, with each CLI's own event payload on
 * stdin. A plugin allow must print nothing (the CLI's permission flow still
 * decides), an exact deny is relayed verbatim, and every other outcome is a
 * synthesized deny.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { buildClaudeHookSettings } from '../claude/hooks.js';
import { CodexProvider } from '../codex/provider.js';
import { NATIVE_TOOL_RELAY_UNREACHABLE, nativeToolRelayTail } from '../native-tool-relay.js';

type Respond = (req: IncomingMessage, res: ServerResponse) => void;

const decision = (permissionDecision: string, permissionDecisionReason?: string) => JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision,
    ...(permissionDecisionReason === undefined ? {} : { permissionDecisionReason })
  }
});
const ALLOW = decision('allow', 'allowed');
const DENY = decision('deny', 'blocked "rm -rf" \\ by $(policy) `now`');
const reply = (status: number, body: string): Respond => (_req, res) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
};

// Claude Code 2.1.296's PreToolUse keys: no turn_id.
const CLAUDE_EVENT = JSON.stringify({
  session_id: '6f1c2c8e-8a52-4a8b-9d1e-0c9e2f4b7a10',
  transcript_path: '/home/user/.claude/projects/p/6f1c2c8e.jsonl',
  cwd: '/work/project',
  prompt_id: 'a3e1b7c2-5d4f-4e8a-9b6c-2f1d0e9c8b7a',
  permission_mode: 'default',
  effort: 'medium',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'pwd', description: 'Print the "working" dir' },
  tool_use_id: 'toolu_01RelayProbe'
});
// Codex's PreToolUse carries the turn id.
const CODEX_EVENT = JSON.stringify({
  session_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  transcript_path: '/home/user/.codex/sessions/rollout.jsonl',
  cwd: '/work/project',
  hook_event_name: 'PreToolUse',
  model: 'gpt-5.5',
  permission_mode: 'default',
  turn_id: 'turn-1',
  tool_name: 'Bash',
  tool_use_id: 'call-1',
  tool_input: { command: 'pwd' }
});

interface Relay { command: string; env: Record<string, string> }

function claudeRelay(url: string | undefined): Relay {
  const settings = JSON.parse(buildClaudeHookSettings({ stop: false, notify: false, nativeTool: true })) as {
    hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
  };
  expect(settings.hooks.PreToolUse).toHaveLength(1);
  const [entry] = settings.hooks.PreToolUse;
  expect(entry.matcher).toBe('');
  expect(entry.hooks[0].command).toContain('"$ZCC_NATIVETOOL_URL"');
  return { command: entry.hooks[0].command, env: url === undefined ? {} : { ZCC_NATIVETOOL_URL: url } };
}

function codexRelay(url: string): Relay {
  const override = new CodexProvider().hookArgs('codex', { nativeTool: url }).find((arg) => arg.startsWith('hooks.PreToolUse='));
  expect(override).toBeDefined();
  const { hook } = parse(`hook=${override!.slice('hooks.PreToolUse='.length)}`) as unknown as {
    hook: Array<{ matcher: string; hooks: Array<{ command: string }> }>;
  };
  expect(hook).toHaveLength(1);
  expect(hook[0].matcher).toBe('*');
  return { command: hook[0].hooks[0].command, env: {} };
}

function run(relay: Relay, input: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', relay.command], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...relay.env } });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.end(input);
  });
}

let respond: Respond = reply(200, ALLOW);
let received: { url: string; body: string } | null = null;
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    received = { url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') };
    respond(req, res);
  });
});
let base = '';
let closedPortUrl = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  closedPortUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/hook/nativetool/p/s`;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe.each([
  { name: 'Claude --settings relay', event: CLAUDE_EVENT, build: (url: string) => claudeRelay(url) },
  { name: 'Codex hooks.PreToolUse relay', event: CODEX_EVENT, build: (url: string) => codexRelay(url) }
])('$name', ({ event, build }) => {
  const url = () => `${base}/hook/nativetool/proj-1/sess-1`;

  it('ends in the shared decision tail', () => {
    expect(build(url()).command.endsWith(nativeToolRelayTail())).toBe(true);
  });

  it('posts the provider event byte-for-byte and prints nothing for an exact allow', async () => {
    respond = reply(200, ALLOW);
    received = null;
    await expect(run(build(url()), event)).resolves.toEqual({ code: 0, stdout: '' });
    expect(received).toEqual({ url: '/hook/nativetool/proj-1/sess-1', body: event });
  });

  it('relays an exact deny verbatim, quotes and backslashes included', async () => {
    respond = reply(200, DENY);
    await expect(run(build(url()), event)).resolves.toEqual({ code: 0, stdout: DENY });
  });

  it.each<[string, Respond]>([
    ['a 503 that carries an allow body', reply(503, ALLOW)],
    ['a 200 with a non-decision object', reply(200, '{"error":1}')],
    ['an empty 200', reply(200, '')],
    ['a plain-text 200', reply(200, 'ok')],
    ['an allow without a reason', reply(200, decision('allow'))],
    ['an ask decision', reply(200, decision('ask', 'confirm'))],
    ['an allow cut short by a closed socket (curl exit 18)', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(ALLOW.length + 64) });
      res.write(ALLOW, () => res.socket?.destroy());
    }]
  ])('synthesizes a deny for %s', async (_label, next) => {
    respond = next;
    const result = await run(build(url()), event);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(NATIVE_TOOL_RELAY_UNREACHABLE);
  });

  it('synthesizes a deny when the policy port refuses the connection', async () => {
    const result = await run(build(closedPortUrl), event);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(NATIVE_TOOL_RELAY_UNREACHABLE);
  });

  it('never evaluates shell syntax carried in the callback URL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'native-tool-relay-'));
    const marker = join(dir, 'injected');
    try {
      respond = reply(200, DENY);
      const ifs = '${IFS}';
      const result = await run(build(`${url()}?x=$(touch${ifs}${marker})&y=\`touch${ifs}${marker}\``), event);
      expect(result).toEqual({ code: 0, stdout: DENY });
      await expect(access(marker)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Claude --settings relay without a callback URL', () => {
  it('synthesizes a deny instead of letting the call through unchecked', async () => {
    received = null;
    const result = await run(claudeRelay(undefined), CLAUDE_EVENT);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(NATIVE_TOOL_RELAY_UNREACHABLE);
    expect(received).toBeNull();
  });
});
