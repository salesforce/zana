import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASK_APPROVAL_MS, TOOL_POLICY_ASK_RENDERER_ID } from '@zana-ai/zcc-domain/native-tool-policy-budget';
import { createPluginService } from './plugin-service.js';

const roots: string[] = [];
const services: ReturnType<typeof createPluginService>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const service of services.splice(0)) service.stop();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-tool-policy-ask-'));
  roots.push(dir);
  return dir;
}

function writePlugin(id: string, handlerBody: string): string {
  const dir = join(root(), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `zcc-plugin-${id}`, version: '0.1.0',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: id, description: id, branding: { icon: 'Puzzle' }, server: './server.mjs' }
  }));
  writeFileSync(join(dir, 'server.mjs'), `export default async function plugin(zcc) { zcc.hooks.onToolPolicy(async (req) => { ${handlerBody} }); }\n`);
  return dir;
}

type Interaction = (input: any) => Promise<any>;
async function setup(handlerBody: string, requestPluginInteraction?: Interaction) {
  const service = createPluginService({ dataDir: root(), bundledRoot: root(), requestPluginInteraction } as never);
  services.push(service);
  await service.install(writePlugin('asker', handlerBody));
  return service;
}

let seq = 0;
const call = (over: Record<string, unknown> = {}) => ({
  invocationId: `inv-${++seq}`, threadId: 't1', projectId: 'p1', providerId: 'claude-code', toolName: 'Bash', input: { command: 'ls' }, ...over
});
const ASK = `return { action: 'ask', prompt: 'Run it?' };`;

describe('tool policy ask resolution', () => {
  it('allows only when a human submits an allow decision, through the host renderer', async () => {
    const ask = vi.fn(async () => ({ outcome: 'submitted', actor: 'human', value: { decision: 'allow' } }));
    const service = await setup(ASK, ask);
    await expect(service.decideToolPolicy(call())).resolves.toEqual({ action: 'allow' });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'asker', threadId: 't1', rendererId: TOOL_POLICY_ASK_RENDERER_ID, requireHuman: 'native-sheet',
      timeoutMs: ASK_APPROVAL_MS.default,
      payload: expect.objectContaining({ kind: 'tool-policy-ask', toolName: 'Bash', prompt: 'Run it?' })
    }));
  });

  it('caches the final human decision per invocation so a replay does not re-ask', async () => {
    const ask = vi.fn(async () => ({ outcome: 'submitted', actor: 'human', value: { decision: 'allow' } }));
    const service = await setup(ASK, ask);
    const req = call();
    await service.decideToolPolicy(req);
    await expect(service.decideToolPolicy(req)).resolves.toEqual({ action: 'allow' });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['human deny', { outcome: 'submitted', actor: 'human', value: { decision: 'deny' } }],
    ['agent answer', { outcome: 'submitted', actor: 'agent', value: { decision: 'allow' } }],
    ['plugin answer', { outcome: 'submitted', actor: 'plugin', value: { decision: 'allow' } }],
    ['missing actor', { outcome: 'submitted', value: { decision: 'allow' } }],
    ['allow with extra fields', { outcome: 'submitted', actor: 'human', value: { decision: 'allow', extra: 1 } }],
    ['string allow', { outcome: 'submitted', actor: 'human', value: 'allow' }],
    ['cancel', { outcome: 'cancelled', reason: 'cancelled' }],
    ['timeout', { outcome: 'cancelled', reason: 'timeout' }]
  ])('denies on %s', async (_name, result) => {
    const service = await setup(ASK, vi.fn(async () => result));
    await expect(service.decideToolPolicy(call())).resolves.toMatchObject({ action: 'deny' });
  });

  it('labels timeout and cancel denials distinctly', async () => {
    const timeout = await setup(ASK, vi.fn(async () => ({ outcome: 'cancelled', reason: 'timeout' })));
    await expect(timeout.decideToolPolicy(call())).resolves.toEqual({ action: 'deny', reason: 'Tool call approval timed out' });
  });

  it('denies when the approval transport throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = await setup(ASK, vi.fn(async () => { throw new Error('socket closed'); }));
    await expect(service.decideToolPolicy(call())).resolves.toEqual({ action: 'deny', reason: 'Tool call approval is unavailable' });
  });

  it('denies when no approval UI is wired', async () => {
    const service = await setup(ASK, undefined);
    await expect(service.decideToolPolicy(call())).resolves.toMatchObject({ action: 'deny', reason: expect.stringContaining('no approval UI') });
  });

  it.each([
    ['missing prompt', `return { action: 'ask' };`],
    ['blank prompt', `return { action: 'ask', prompt: '   ' };`],
    ['non-string prompt', `return { action: 'ask', prompt: 5 };`]
  ])('denies on %s without opening an interaction', async (_name, body) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ask = vi.fn();
    const service = await setup(body, ask);
    await expect(service.decideToolPolicy(call())).resolves.toMatchObject({ action: 'deny' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('clamps the requested approval window', async () => {
    const ask = vi.fn(async () => ({ outcome: 'submitted', actor: 'human', value: { decision: 'allow' } }));
    const service = await setup(`return { action: 'ask', prompt: 'p', timeoutMs: 999999999 };`, ask);
    await service.decideToolPolicy(call());
    expect(ask.mock.calls[0]![0].timeoutMs).toBeLessThanOrEqual(ASK_APPROVAL_MS.max);
    expect(ask.mock.calls[0]![0].timeoutMs).toBeGreaterThan(ASK_APPROVAL_MS.max - 2000);
  });

  it('serialises asks per thread and charges queue wait to the budget', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ask = vi.fn(async (input: any) => {
      order.push(`start:${input.payload.toolName}`);
      if (order.length === 1) await gate;
      order.push(`end:${input.payload.toolName}`);
      return { outcome: 'submitted', actor: 'human', value: { decision: 'allow' } };
    });
    const service = await setup(ASK, ask);
    const first = service.decideToolPolicy(call({ toolName: 'A' }));
    const second = service.decideToolPolicy(call({ toolName: 'B' }));
    await expect.poll(() => order.length).toBe(1);
    expect(ask).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['start:A', 'end:A', 'start:B', 'end:B']);
  });

  it('denies a queued ask whose budget was spent waiting', async () => {
    const ask = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      return { outcome: 'submitted', actor: 'human', value: { decision: 'allow' } };
    });
    const service = await setup(`return { action: 'ask', prompt: 'p', timeoutMs: ${ASK_APPROVAL_MS.min} };`, ask);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const first = service.decideToolPolicy(call());
      const second = service.decideToolPolicy(call());
      await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
      vi.setSystemTime(Date.now() + ASK_APPROVAL_MS.min);
      const [a, b] = await Promise.all([first, second]);
      expect(a).toEqual({ action: 'allow' });
      expect(b).toMatchObject({ action: 'deny', reason: expect.stringContaining('waiting for an earlier approval') });
    } finally { vi.useRealTimers(); }
  });

  it('does not serialise asks across different threads', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ask = vi.fn(async () => { await gate; return { outcome: 'submitted', actor: 'human', value: { decision: 'allow' } }; });
    const service = await setup(ASK, ask);
    const a = service.decideToolPolicy(call({ threadId: 'ta' }));
    const b = service.decideToolPolicy(call({ threadId: 'tb' }));
    await expect.poll(() => ask.mock.calls.length).toBe(2);
    release();
    await Promise.all([a, b]);
  });
});
