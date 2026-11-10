import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRuntime, AgentRuntimeOptions } from '@zana-ai/zcc-agent-runtime';
import { createAgentRuntimeAdapter } from './agent-runtime-adapter.js';

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'zcc-native-adapter-')); });
afterEach(() => rmSync(cwd, { recursive: true, force: true }));
const request = { threadId: 'thread', providerThreadId: 'provider-thread', providerId: 'provider', projectId: 'project',
  environmentId: 'environment', callId: 'call', toolName: 'Write', input: {} };
function fixture(handler?: AgentRuntimeOptions['onNativeToolDecision']) {
  let options!: AgentRuntimeOptions;
  const session = vi.fn(() => ({ providerId: 'provider', providerThreadId: 'provider-thread' }));
  const runtime = { getProviderSession: session, startThread: vi.fn(async () => ({ providerThreadId: 'provider-thread' })),
    resumeThread: vi.fn(async () => ({ providerThreadId: 'provider-thread' })), shutdown: vi.fn(async () => {}),
    stopThread: vi.fn(async () => {}), getLiveThreadIds: () => [], hasOpenBackgroundWork: () => false } as unknown as AgentRuntime;
  const adapter = createAgentRuntimeAdapter({ dataDir: cwd, emit() {}, onNativeToolDecision: handler,
    createRuntime: input => { options = input; return runtime; } });
  const start = () => adapter.startWork({ threadId: 'thread', projectId: 'project', environmentId: 'environment', providerId: 'provider', cwd, input: [] });
  return { adapter, session, start, decide: (value = request, signal = new AbortController().signal) => options.onNativeToolDecision!(value, signal) };
}
describe('native policy adapter ownership', () => {
  it('forwards only live runtime identity', async () => {
    const handler = vi.fn(async () => ({ action: 'allow' as const })); const test = fixture(handler);
    try {
      await test.start(); expect(await test.decide()).toEqual({ action: 'allow' });
      expect(handler).toHaveBeenCalledWith(request, expect.any(AbortSignal));
    } finally { test.adapter.dispose(); }
  });
  it.each(['threadId', 'projectId', 'environmentId', 'providerId', 'providerThreadId'] as const)('denies wrong %s before dispatch', async field => {
    const handler = vi.fn(async () => ({ action: 'allow' as const })); const test = fixture(handler);
    try {
      await test.start(); expect((await test.decide({ ...request, [field]: 'wrong' })).action).toBe('deny');
      expect(handler).not.toHaveBeenCalled();
    } finally { test.adapter.dispose(); }
  });
  it('denies missing policy transport and aborted or stopped sessions', async () => {
    const test = fixture();
    try { await test.start(); expect((await test.decide()).action).toBe('deny'); } finally { test.adapter.dispose(); }
    const handler = vi.fn(async () => ({ action: 'allow' as const })); const live = fixture(handler);
    try {
      await live.start(); const controller = new AbortController(); controller.abort();
      expect((await live.decide(request, controller.signal)).action).toBe('deny');
      await live.adapter.stopWork({ threadId: 'thread' });
      expect((await live.decide()).action).toBe('deny'); expect(handler).not.toHaveBeenCalled();
    } finally { live.adapter.dispose(); }
  });
  it.each(['stop', 'resume', 'provider', 'provider-thread', 'dispose', 'abort'])('rejects late allow after %s', async change => {
    const controller = new AbortController();
    const handler = vi.fn(async () => {
      if (change === 'stop') await test.adapter.stopWork({ threadId: 'thread' });
      if (change === 'resume') await test.adapter.resumeWork({ threadId: 'thread', projectId: 'project', environmentId: 'environment', providerId: 'provider', providerThreadId: 'provider-thread', cwd });
      if (change === 'provider') test.session.mockReturnValue({ providerId: 'replaced', providerThreadId: 'provider-thread' });
      if (change === 'provider-thread') test.session.mockReturnValue({ providerId: 'provider', providerThreadId: 'replaced' });
      if (change === 'dispose') test.adapter.dispose();
      if (change === 'abort') controller.abort();
      return { action: 'allow' as const };
    });
    const test = fixture(handler);
    try { await test.start(); expect((await test.decide(request, controller.signal)).action).toBe('deny'); }
    finally { test.adapter.dispose(); }
  });
});
