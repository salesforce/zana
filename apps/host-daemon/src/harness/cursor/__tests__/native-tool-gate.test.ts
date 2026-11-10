import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CURSOR_GATE_UNREACHABLE,
  CURSOR_HOOK_TIMEOUT_SEC,
  cursorNativeToolGateArgs,
  cursorNativeToolGateCommand,
  cursorNativeToolGateFiles
} from '../native-tool-gate.js';
import { CursorProvider } from '../provider.js';

const EVENT = JSON.stringify({ tool_name: 'Shell', tool_use_id: 'call_1', tool_input: { command: 'pwd' } });
const reply = (decision: string, reason: string) => JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason }
});

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())).then(() => { server = undefined; }));

async function serve(status: number, body: string): Promise<{ url: string; bodies: string[] }> {
  const bodies: string[] = [];
  server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => { bodies.push(data); res.statusCode = status; res.end(body); });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook/nativetool/p/s`, bodies };
}

// Async: the in-process route must keep answering while the hook runs.
function runHook(url: string): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', cursorNativeToolGateCommand(url)], { timeout: 15_000 });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout }));
    child.stdin.end(EVENT);
  });
}

describe('cursor native tool gate', () => {
  it('forwards the event, and prints no decision on an allow', async () => {
    const { url, bodies } = await serve(200, reply('allow', 'ok'));
    expect(await runHook(url)).toEqual({ status: 0, stdout: '{}' });
    expect(JSON.parse(bodies[0]!)).toMatchObject({ tool_name: 'Shell', tool_use_id: 'call_1' });
  });

  it('relays the route reason in Cursor deny shape, including escaped characters', async () => {
    const { url } = await serve(200, reply('deny', 'no "rm" here\\ ok'));
    const result = await runHook(url);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ permission: 'deny', user_message: 'no "rm" here\\ ok' });
  });

  it.each([
    ['non-2xx', 500, reply('allow', 'ok')],
    ['malformed body', 200, 'not json'],
    ['unknown decision', 200, reply('ask', 'hmm')],
    ['truncated allow', 200, reply('allow', 'ok').slice(0, -3)]
  ])('denies on %s', async (_label, status, body) => {
    const { url } = await serve(status, body);
    expect(JSON.parse((await runHook(url)).stdout)).toEqual({ permission: 'deny', user_message: CURSOR_GATE_UNREACHABLE });
  });

  it('denies when the route refuses the connection', async () => {
    expect(JSON.parse((await runHook('http://127.0.0.1:1/x')).stdout)).toEqual({ permission: 'deny', user_message: CURSOR_GATE_UNREACHABLE });
  });

  it('quotes a URL containing a single quote safely', async () => {
    expect(JSON.parse((await runHook("http://127.0.0.1:1/it's")).stdout)).toMatchObject({ permission: 'deny' });
  });

  it('writes a fail-closed preToolUse plugin manifest and hook file', () => {
    const files = cursorNativeToolGateFiles('http://127.0.0.1:9/hook/nativetool/p/s');
    expect(files.map((f) => f.path)).toEqual(['.cursor-plugin/plugin.json', 'hooks/hooks.json']);
    const manifest = JSON.parse(files[0]!.contents);
    expect(manifest).toMatchObject({ name: 'zcc-native-tool-gate', hooks: './hooks/hooks.json' });
    const hooks = JSON.parse(files[1]!.contents);
    expect(hooks.version).toBe(1);
    expect(Object.keys(hooks.hooks)).toEqual(['preToolUse']);
    expect(hooks.hooks.preToolUse).toEqual([expect.objectContaining({ type: 'command', failClosed: true, timeout: CURSOR_HOOK_TIMEOUT_SEC })]);
    expect(hooks.hooks.preToolUse[0].matcher).toBeUndefined();
  });

  it('provider exposes the directory gate and names it on argv', () => {
    const provider = new CursorProvider();
    expect(provider.nativeToolGateViaDirectory).toBe(true);
    const bundle = provider.nativeToolGateDirectory('cursor' as never, 'http://127.0.0.1:9/h', '/tmp/gate');
    expect(bundle?.args).toEqual(cursorNativeToolGateArgs('/tmp/gate'));
    expect(bundle?.args).toEqual(['--plugin-dir', '/tmp/gate']);
    expect(bundle?.files).toHaveLength(2);
  });
});
