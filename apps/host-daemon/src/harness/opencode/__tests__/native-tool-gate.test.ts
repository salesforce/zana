import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  mergeOpenCodeGatePlugin,
  OPENCODE_GATE_UNREACHABLE,
  openCodeNativeToolGateSource
} from '../native-tool-gate.js';

type Hook = (input: { tool: string; callID: string }, output: { args: unknown }) => Promise<void>;
type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void;

const reply = (decision: 'allow' | 'deny', reason: string) => JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason }
});

let dir: string;
let server: Server | undefined;
let seen: Array<{ method?: string; body: Record<string, unknown> }> = [];

async function loadGate(handler: Handler | null): Promise<Hook> {
  let url = 'http://127.0.0.1:1/hook/nativetool/p/s';
  if (handler) {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', chunk => { body += String(chunk); });
      request.on('end', () => {
        try { seen.push({ method: request.method, body: JSON.parse(body) }); } catch { seen.push({ method: request.method, body: {} }); }
        handler(request, body, response);
      });
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook/nativetool/p/s`;
  }
  const file = join(dir, `gate-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, openCodeNativeToolGateSource(url));
  const mod = await import(pathToFileURL(file).href) as { default: () => Promise<{ 'tool.execute.before': Hook }> };
  return (await mod.default())['tool.execute.before'];
}

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'oc-gate-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(async () => {
  seen = [];
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
});

describe('OpenCode native tool gate module', () => {
  it('lets a call run only on an exact allow, sending the call in PreToolUse shape', async () => {
    const hook = await loadGate((_r, _b, res) => { res.end(reply('allow', 'allowed')); });
    await expect(hook({ tool: 'bash', callID: 'call_1' }, { args: { command: 'pwd' } })).resolves.toBeUndefined();
    expect(seen).toEqual([{ method: 'POST', body: {
      hook_event_name: 'PreToolUse', tool_name: 'bash', tool_use_id: 'call_1', tool_input: { command: 'pwd' }
    } }]);
  });

  it('blocks a deny and surfaces the plugin reason', async () => {
    const hook = await loadGate((_r, _b, res) => { res.end(reply('deny', 'no shell')); });
    await expect(hook({ tool: 'bash', callID: 'c' }, { args: {} })).rejects.toThrow('Blocked by tool policy: no shell');
  });

  it.each([
    ['a non-2xx status', (res: ServerResponse) => { res.statusCode = 500; res.end(reply('allow', 'allowed')); }],
    ['an unrelated body', (res: ServerResponse) => { res.end('{"ok":true}'); }],
    ['a body that is not JSON', (res: ServerResponse) => { res.end('<html>'); }],
    ['a deny with no reason', (res: ServerResponse) => { res.end(reply('deny', '')); }],
    ['an unknown decision', (res: ServerResponse) => { res.end(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask' } })); }],
    ['a connection that closes', (res: ServerResponse) => { res.destroy(); }]
  ])('fails closed on %s', async (_name, respond) => {
    const hook = await loadGate((_r, _b, res) => respond(res));
    await expect(hook({ tool: 'write', callID: 'c' }, { args: {} })).rejects.toThrow(`Blocked by tool policy: ${OPENCODE_GATE_UNREACHABLE}`);
  });

  it('fails closed when the route is unreachable', async () => {
    const hook = await loadGate(null);
    await expect(hook({ tool: 'bash', callID: 'c' }, { args: {} })).rejects.toThrow(OPENCODE_GATE_UNREACHABLE);
  });

  it('sends an empty input when the args are not an object', async () => {
    const hook = await loadGate((_r, _b, res) => { res.end(reply('allow', 'allowed')); });
    await hook({ tool: 'x', callID: 'c' }, { args: ['a'] });
    await hook({ tool: 'x', callID: 'c' }, { args: null });
    expect(seen.map(row => row.body.tool_input)).toEqual([{}, {}]);
  });
});

describe('mergeOpenCodeGatePlugin', () => {
  it('appends a file URL after existing plugins and keeps the rest of the config', () => {
    const merged = JSON.parse(mergeOpenCodeGatePlugin(JSON.stringify({ mcp: { a: 1 }, plugin: ['user-plugin'] }), '/tmp/a b/gate.mjs'));
    expect(merged).toEqual({ mcp: { a: 1 }, plugin: ['user-plugin', 'file:///tmp/a%20b/gate.mjs'] });
  });
  it('creates the list when absent and passes a non-JSON document through', () => {
    expect(JSON.parse(mergeOpenCodeGatePlugin('{}', '/g.mjs')).plugin).toEqual(['file:///g.mjs']);
    expect(mergeOpenCodeGatePlugin('nope', '/g.mjs')).toBe('nope');
  });
});
