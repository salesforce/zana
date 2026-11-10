import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginService, toPluginAppSnapshot } from './plugin-service.js';
import { DECISION_PHASE_MAX_MS } from '@zana-ai/zcc-domain/native-tool-policy-budget';

const roots: string[] = [];
const services: ReturnType<typeof createPluginService>[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const service of services.splice(0)) service.stop();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-tool-policy-timeout-'));
  roots.push(dir);
  return dir;
}

function writePlugin(id: string, handlerBody: string, timeoutMs?: unknown): string {
  const dir = join(root(), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `zcc-plugin-${id}`, version: '0.1.0',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: {
      name: id, description: id, branding: { icon: 'Puzzle' }, server: './server.mjs', toolPolicy: true,
      ...(timeoutMs === undefined ? {} : { toolPolicyTimeoutMs: timeoutMs })
    }
  }));
  writeFileSync(join(dir, 'server.mjs'), `export default async function plugin(zcc) { zcc.hooks.onToolPolicy(async (req) => { ${handlerBody} }); }\n`);
  return dir;
}

const sleepThenAllow = (ms: number) => `await new Promise((r) => setTimeout(r, ${ms})); return { action: 'allow' };`;
const HANG = `await new Promise(() => {});`;

async function setup(plugins: Array<[string, string, unknown?]>, requestPluginInteraction?: (input: unknown) => Promise<unknown>) {
  const service = createPluginService({ dataDir: root(), bundledRoot: root(), requestPluginInteraction } as never);
  services.push(service);
  for (const [id, body, timeout] of plugins) await service.install(writePlugin(id, body, timeout));
  return service;
}

let seq = 0;
const call = () => ({
  invocationId: `inv-${++seq}`, threadId: 't1', projectId: 'p1', providerId: 'claude-code', toolName: 'Bash', input: { command: 'ls' }
});

/** Advance fake time in small steps so chained timers and microtasks interleave. */
async function advance(ms: number) {
  for (let spent = 0; spent < ms; spent += 100) await vi.advanceTimersByTimeAsync(Math.min(100, ms - spent));
}

async function decideWithin(service: Awaited<ReturnType<typeof setup>>, ms: number) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  let settled: unknown;
  const pending = service.decideToolPolicy(call()).then((value) => { settled = value; return value; });
  await advance(ms);
  const early = settled;
  return { early, pending };
}

describe('per-plugin tool policy timeout', () => {
  it('defaults to 5 s: a hanging handler is still pending at 4.9 s and denies at 5 s', async () => {
    const service = await setup([['slow', HANG]]);
    const { early, pending } = await decideWithin(service, 4_900);
    expect(early).toBeUndefined();
    await advance(200);
    await expect(pending).resolves.toEqual({ action: 'deny', reason: 'Plugin tool policy unavailable: slow' });
  });

  it('clamps a too-small request up to 1 s and denies on expiry', async () => {
    const service = await setup([['fast', HANG, 5]]);
    const { early, pending } = await decideWithin(service, 900);
    expect(early).toBeUndefined();
    await advance(200);
    await expect(pending).resolves.toMatchObject({ action: 'deny' });
  });

  it('clamps a too-large request down to 9 s', async () => {
    const service = await setup([['huge', HANG, 600_000]]);
    const { early, pending } = await decideWithin(service, 8_900);
    expect(early).toBeUndefined();
    await advance(200);
    await expect(pending).resolves.toMatchObject({ action: 'deny' });
  });

  it('honors a 9 s plugin that answers at 8.5 s', async () => {
    const service = await setup([['patient', sleepThenAllow(8_500), 9_000]]);
    const { pending } = await decideWithin(service, 8_600);
    await expect(pending).resolves.toEqual({ action: 'allow' });
  });

  it('denies a default-timeout plugin that answers after 5 s', async () => {
    const service = await setup([['late', sleepThenAllow(6_000)]]);
    const { pending } = await decideWithin(service, 5_200);
    await expect(pending).resolves.toMatchObject({ action: 'deny' });
  });

  it('cuts a second 9 s plugin at the remaining decision budget', async () => {
    const service = await setup([['first', sleepThenAllow(6_000), 9_000], ['second', HANG, 9_000]]);
    const { early, pending } = await decideWithin(service, 8_900);
    expect(early).toBeUndefined();
    await advance(200);
    // Evaluation order follows the live set; either way the pair is bounded by one 9 s budget.
    await expect(pending).resolves.toMatchObject({ action: 'deny', reason: expect.stringMatching(/^Plugin tool policy unavailable: (first|second)$/) });
  });

  it('two plugins plus one ask: the human approval time is never charged to the 9 s decision budget', async () => {
    // Real timers for the handlers; only Date jumps, so a regression that measures the
    // approval inside a handler's spent time would leave `plain` with no budget and deny.
    const approval = vi.fn(async () => {
      vi.setSystemTime(Date.now() + DECISION_PHASE_MAX_MS + 1_000);
      return { outcome: 'submitted', actor: 'human', value: { decision: 'allow' } };
    });
    const service = await setup([
      ['asker', `return { action: 'ask', prompt: 'Run it?' };`, 9_000],
      ['plain', sleepThenAllow(50), 9_000]
    ], approval);
    vi.useFakeTimers({ toFake: ['Date'] });
    await expect(service.decideToolPolicy(call())).resolves.toEqual({ action: 'allow' });
    expect(approval).toHaveBeenCalledTimes(1);
  });

  it('uses the live plugin set at call time: a removed plugin no longer constrains the call', async () => {
    const service = await setup([['stuck', HANG, 1_000], ['ok', `return { action: 'allow' };`]]);
    await service.remove('stuck');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await expect(service.decideToolPolicy(call())).resolves.toEqual({ action: 'allow' });
  });

  it('exposes the clamped timeout only for tool policy plugins', async () => {
    const service = await setup([['shown', `return { action: 'allow' };`, 99_999]]);
    const row = service.snapshot().find((entry) => entry.id === 'shown');
    expect(row?.toolPolicyTimeoutMs).toBe(9_000);
    expect(toPluginAppSnapshot(row!).toolPolicyTimeoutMs).toBe(9_000);
  });
});
