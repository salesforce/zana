import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_TOOL_POLICY_INPUT_MAX_CHARS } from '@zana-ai/zcc-contracts/runtime';
import { createNativeToolPolicyVerifier, NATIVE_TOOL_POLICY_PROOF_HEADER } from '@zana-ai/zcc-server/http/native-tool-policy-proof';
import { startProductServer, type ProductServer } from '@zana-ai/zcc-server/http/product-server';
import {
  createNativeToolPolicyHook,
  firstToolPolicyDecider,
  NATIVE_TOOL_INPUT_TOO_LARGE,
  parseNativeToolHookEvent,
  productRouteToolPolicyDecider,
  supervisorToolPolicyDecider,
  warnNativeToolPolicy,
  type NativeToolPolicySession
} from './native-tool-policy.js';

const sha = (key: unknown[]) => createHash('sha256').update(JSON.stringify(key)).digest('hex');

// Exactly the keys Claude Code 2.1.296 sends to a PreToolUse hook: no turn_id.
const claudeEvent = {
  session_id: '6f1c2c8e-8a52-4a8b-9d1e-0c9e2f4b7a10',
  transcript_path: '/home/user/.claude/projects/p/6f1c2c8e.jsonl',
  cwd: '/work/project',
  prompt_id: 'a3e1b7c2-5d4f-4e8a-9b6c-2f1d0e9c8b7a',
  permission_mode: 'default',
  effort: 'medium',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'pwd' },
  tool_use_id: 'toolu_01ABC'
};
// Codex's PreToolUse carries the turn id.
const codexEvent = {
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
};
const parse = (event: unknown, sessionId = 'session-1') => parseNativeToolHookEvent(sessionId, JSON.stringify(event));

describe('parseNativeToolHookEvent', () => {
  it('keys a Claude call, which has no turn_id, on the session and the call content', () => {
    expect(Object.keys(claudeEvent).sort()).toEqual([
      'cwd', 'effort', 'hook_event_name', 'permission_mode', 'prompt_id', 'session_id', 'tool_input', 'tool_name', 'tool_use_id', 'transcript_path'
    ]);
    expect(parse(claudeEvent)).toEqual({
      invocationId: sha(['session-1', null, 'toolu_01ABC', 'Bash', { command: 'pwd' }]),
      toolName: 'Bash',
      input: { command: 'pwd' }
    });
  });

  it('keys a Codex call with its turn id under the same formula', () => {
    expect(parse(codexEvent)?.invocationId).toBe(sha(['session-1', 'turn-1', 'call-1', 'Bash', { command: 'pwd' }]));
  });

  it('replays an identical retry and separates any change of session or content', () => {
    const id = parse(codexEvent)!.invocationId;
    expect(parse(codexEvent)!.invocationId).toBe(id);
    const variants = [
      parse(codexEvent, 'session-2'),
      parse({ ...codexEvent, turn_id: 'turn-2' }),
      parse({ ...codexEvent, tool_use_id: 'call-2' }),
      parse({ ...codexEvent, tool_name: 'Write' }),
      parse({ ...codexEvent, tool_input: { command: 'rm -rf /tmp/x' } }),
      parse(claudeEvent)
    ].map((call) => call!.invocationId);
    expect(new Set([id, ...variants]).size).toBe(variants.length + 1);
  });

  it('reads a null turn_id as absent, and a missing or null tool_input as {}', () => {
    expect(parse({ ...claudeEvent, turn_id: null })).toEqual(parse(claudeEvent));
    const { tool_input: _dropped, ...withoutInput } = claudeEvent;
    for (const event of [withoutInput, { ...claudeEvent, tool_input: null }]) {
      expect(parse(event)).toEqual({
        invocationId: sha(['session-1', null, 'toolu_01ABC', 'Bash', {}]), toolName: 'Bash', input: {}
      });
    }
  });

  it('ignores identity the body claims for itself', () => {
    expect(parse({ ...claudeEvent, session_id: 'forged', cwd: '/forged', threadId: 'forged', projectId: 'forged', providerId: 'codex' }))
      .toEqual(parse(claudeEvent));
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', '1']
  ])('rejects a body that is %s', (_label, body) => {
    expect(parseNativeToolHookEvent('session-1', body)).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ['a missing tool_use_id', { tool_use_id: undefined }],
    ['an empty tool_use_id', { tool_use_id: '' }],
    ['an oversized tool_use_id', { tool_use_id: 'x'.repeat(513) }],
    ['a tool_use_id with a newline', { tool_use_id: 'a\nb' }],
    ['a numeric tool_use_id', { tool_use_id: 12 }],
    ['a missing tool_name', { tool_name: undefined }],
    ['an empty tool_name', { tool_name: '' }],
    ['an oversized tool_name', { tool_name: 'x'.repeat(513) }],
    ['a tool_name with NUL', { tool_name: 'Ba\u0000sh' }],
    ['a numeric turn_id', { turn_id: 12 }],
    ['an empty turn_id', { turn_id: '' }],
    ['a turn_id with a newline', { turn_id: 'bad\n' }],
    ['an oversized turn_id', { turn_id: 'x'.repeat(513) }],
    ['an array tool_input', { tool_input: ['pwd'] }],
    ['a string tool_input', { tool_input: 'pwd' }],
    ['a numeric tool_input', { tool_input: 1 }]
  ])('rejects %s', (_label, change) => {
    expect(parse({ ...codexEvent, ...change })).toBeNull();
  });

  it('rejects input too deeply nested to re-serialise instead of throwing', () => {
    // ~100 KB, under the route's cap: V8 parses it, but JSON.stringify overflows the stack.
    const depth = 50_000;
    const body = `{"tool_use_id":"call-1","tool_name":"Bash","tool_input":{"a":${'['.repeat(depth)}${']'.repeat(depth)}}}`;
    expect(parseNativeToolHookEvent('session-1', body)).toBeNull();
  });
});

describe('createNativeToolPolicyHook', () => {
  const live: NativeToolPolicySession = { id: 'session-1', projectId: 'project-1', profile: 'claude', status: 'running' };
  const secret = 'SECRET-INPUT-MARKER';
  const body = JSON.stringify({ ...claudeEvent, tool_input: { command: `echo ${secret}` } });

  function setup(reply: unknown, session: NativeToolPolicySession | null = live) {
    const decide = vi.fn(async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    });
    const log = vi.fn();
    const hook = createNativeToolPolicyHook({ getSession: (id) => (session && id === session.id ? session : null), decider: () => decide, log });
    return { hook, decide, log };
  }

  it.each<[string, NativeToolPolicySession | null, string]>([
    ['the session is unknown', null, 'project-1'],
    ['the session has exited', { ...live, status: 'exited' }, 'project-1'],
    ['the URL names another project', live, 'project-2']
  ])('fails closed without asking the policy when %s', async (_label, session, projectId) => {
    const { hook, decide } = setup({ action: 'allow' }, session);
    await expect(hook(projectId, 'session-1', body)).resolves.toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it('fails closed when no policy is reachable (dev has no runtime supervisor)', async () => {
    const hook = createNativeToolPolicyHook({ getSession: () => live, decider: () => null });
    await expect(hook('project-1', 'session-1', body)).resolves.toBeNull();
  });

  it('fails closed on a malformed event without asking the policy', async () => {
    const { hook, decide } = setup({ action: 'allow' });
    await expect(hook('project-1', 'session-1', JSON.stringify({ ...claudeEvent, tool_use_id: undefined }))).resolves.toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it('measures the parsed tool input in JSON characters, like the runtime contract', async () => {
    const { hook, decide } = setup({ action: 'allow' });
    const fill = NATIVE_TOOL_POLICY_INPUT_MAX_CHARS - '{"content":""}'.length;
    // 3 UTF-8 bytes per character: well past 256 KiB on the wire, still in the limit.
    const atLimit = JSON.stringify({ ...claudeEvent, tool_name: 'Write', tool_input: { content: '\u20ac'.repeat(fill) } });
    await expect(hook('project-1', 'session-1', atLimit)).resolves.toEqual({ decision: 'allow', reason: 'allowed' });
    expect(decide).toHaveBeenCalledTimes(1);
    const overLimit = JSON.stringify({ ...claudeEvent, tool_name: 'Write', tool_input: { content: 'x'.repeat(fill + 1) } });
    await expect(hook('project-1', 'session-1', overLimit)).resolves.toEqual({ decision: 'deny', reason: NATIVE_TOOL_INPUT_TOO_LARGE });
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('asserts the live session identity, whatever the body claims', async () => {
    const { hook, decide } = setup({ action: 'allow' });
    const forged = JSON.stringify({ ...claudeEvent, session_id: 'forged', cwd: '/forged', threadId: 'forged', projectId: 'forged', providerId: 'codex' });
    await expect(hook('project-1', 'session-1', forged)).resolves.toEqual({ decision: 'allow', reason: 'allowed' });
    expect(decide).toHaveBeenCalledWith({
      invocationId: sha(['session-1', null, 'toolu_01ABC', 'Bash', { command: 'pwd' }]),
      threadId: 'session-1',
      projectId: 'project-1',
      profile: 'claude',
      toolName: 'Bash',
      input: { command: 'pwd' }
    });
  });

  it('maps a deny with its reason', async () => {
    const { hook } = setup({ action: 'deny', reason: 'blocked by plugin policy' });
    await expect(hook('project-1', 'session-1', body)).resolves.toEqual({ decision: 'deny', reason: 'blocked by plugin policy' });
  });

  it.each<[string, unknown]>([
    ['a rejected request', new Error('server plugins-tool-policy request timed out')],
    ['null', null],
    ['an array', []],
    ['an empty object', {}],
    ['an uppercase action', { action: 'ALLOW' }],
    ['a deny without a reason', { action: 'deny' }],
    ['a deny with an empty reason', { action: 'deny', reason: '' }],
    ['a deny with an oversized reason', { action: 'deny', reason: 'r'.repeat(1025) }],
    ['an allow with extra keys', { action: 'allow', extra: 1 }]
  ])('fails closed and logs once, without the tool input, on %s', async (_label, reply) => {
    const { hook, log } = setup(reply);
    await expect(hook('project-1', 'session-1', body)).resolves.toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).not.toContain(secret);
    expect(log.mock.calls[0]![0].length).toBeLessThanOrEqual(300);
  });

  it('logs a non-Error rejection without echoing it', async () => {
    const log = vi.fn();
    const hook = createNativeToolPolicyHook({
      getSession: () => live,
      decider: () => () => Promise.reject(`raw ${secret}`),
      log
    });
    await expect(hook('project-1', 'session-1', body)).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith('decision failed for session session-: unknown error');
  });
});

describe('supervisorToolPolicyDecider', () => {
  const request = {
    invocationId: 'a'.repeat(64), threadId: 'session-1', projectId: 'project-1', profile: 'claude', toolName: 'Bash', input: { command: 'pwd' }
  };

  it('has no decider while no supervisor runs, so the hook fails closed', () => {
    expect(supervisorToolPolicyDecider(() => null)()).toBeNull();
  });

  it('reads the supervisor per call and forwards the main-built request unchanged', async () => {
    const decideToolPolicy = vi.fn(async () => ({ action: 'allow' }));
    let supervisor: { decideToolPolicy: typeof decideToolPolicy } | null = null;
    const decider = supervisorToolPolicyDecider(() => supervisor);
    expect(decider()).toBeNull();
    supervisor = { decideToolPolicy };
    await expect(decider()!(request)).resolves.toEqual({ action: 'allow' });
    expect(decideToolPolicy).toHaveBeenCalledWith(request);
  });
});

describe('productRouteToolPolicyDecider (no runtime supervisor)', () => {
  const secret = 'k'.repeat(64);
  const request = {
    invocationId: 'a'.repeat(64), threadId: 'session-1', projectId: 'project-1', profile: 'claude', toolName: 'Bash', input: { command: 'pwd' }
  };

  it('posts the strict request, signed for its exact body, and returns the reply for the hook to check', async () => {
    const verify = createNativeToolPolicyVerifier(secret);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init!.headers as Record<string, string>;
      expect(verify(headers[NATIVE_TOOL_POLICY_PROOF_HEADER], init!.body as string)).toBe(true);
      return Response.json({ action: 'allow' });
    });
    const decide = productRouteToolPolicyDecider({ serverUrl: () => 'http://127.0.0.1:8781/', credential: () => secret, fetch: fetchImpl });
    await expect(decide(request)).resolves.toEqual({ action: 'allow' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:8781/api/v1/native-tool-policy');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify(request), headers: { 'content-type': 'application/json' } });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects on a refused request, so the hook fails closed', async () => {
    const decide = productRouteToolPolicyDecider({
      serverUrl: () => 'http://127.0.0.1:8781/', credential: () => secret, fetch: async () => Response.json({ error: 'no' }, { status: 403 })
    });
    await expect(decide(request)).rejects.toThrow('product server answered HTTP 403');
  });

  it('defaults to the global fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ action: 'allow' }));
    try {
      await expect(productRouteToolPolicyDecider({ serverUrl: () => 'http://127.0.0.1:8781/', credential: () => secret })(request)).resolves.toEqual({ action: 'allow' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('firstToolPolicyDecider', () => {
  it('uses the first decider that is available on each call', () => {
    const supervised = vi.fn();
    const route = vi.fn();
    let supervisor: typeof supervised | null = null;
    const decider = firstToolPolicyDecider(() => supervisor, () => route);
    expect(decider()).toBe(route);
    supervisor = supervised;
    expect(decider()).toBe(supervised);
    expect(firstToolPolicyDecider(() => null, () => null)()).toBeNull();
  });

  it('never falls through to the product route when a running supervisor fails', async () => {
    const route = vi.fn(async () => ({ action: 'allow' }));
    const hook = createNativeToolPolicyHook({
      getSession: () => ({ id: 'session-1', projectId: 'project-1', profile: 'claude', status: 'running' }),
      decider: firstToolPolicyDecider(
        supervisorToolPolicyDecider(() => ({ decideToolPolicy: async () => { throw new Error('server plugins-tool-policy request timed out'); } })),
        () => route
      ),
      log: () => {}
    });
    await expect(hook('project-1', 'session-1', JSON.stringify(claudeEvent))).resolves.toBeNull();
    expect(route).not.toHaveBeenCalled();
  });
});

// `pnpm dev` end to end: main's hook asks a real product server over the
// signed route, and the server's plugin policy decides.
describe('main hook over the product route (pnpm dev)', () => {
  const secret = 'd'.repeat(64);
  const live: NativeToolPolicySession = { id: 'session-1', projectId: 'project-1', profile: 'claude', status: 'running' };
  let server: ProductServer | null = null;
  let dataDir = '';

  afterEach(async () => {
    await server?.close();
    server = null;
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('reaches the dev server\'s plugin policy with main-asserted identity, and fails closed on a wrong credential', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'zcc-native-tool-route-'));
    server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 }, uiSendSecret: secret });
    const decideToolPolicy = vi.fn(async () => ({ action: 'deny' as const, reason: 'blocked by dev policy' }));
    server.ctx.plugins = { decideToolPolicy } as unknown as typeof server.ctx.plugins;
    const hookFor = (credential: string) => createNativeToolPolicyHook({
      getSession: (id) => (id === live.id ? live : null),
      decider: firstToolPolicyDecider(() => null, () => productRouteToolPolicyDecider({ serverUrl: () => server!.url, credential: () => credential })),
      log: () => {}
    });

    await expect(hookFor(secret)('project-1', 'session-1', JSON.stringify({ ...claudeEvent, session_id: 'forged' }))).resolves.toEqual({
      decision: 'deny', reason: 'blocked by dev policy'
    });
    expect(decideToolPolicy).toHaveBeenCalledWith(expect.objectContaining({
      invocationId: sha(['session-1', null, 'toolu_01ABC', 'Bash', { command: 'pwd' }]),
      threadId: 'session-1', projectId: 'project-1', providerId: 'claude-code', toolName: 'Bash'
    }));
    await expect(hookFor('w'.repeat(64))('project-1', 'session-1', JSON.stringify({ ...claudeEvent, tool_use_id: 'toolu_02' }))).resolves.toBeNull();
    expect(decideToolPolicy).toHaveBeenCalledTimes(1);
  });
});

describe('warnNativeToolPolicy', () => {
  it('prefixes the bounded diagnostic for main-process logs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnNativeToolPolicy('invalid decision for session session-');
    expect(warn).toHaveBeenCalledWith('[native-tool-policy] invalid decision for session session-');
    warn.mockRestore();
  });
});
