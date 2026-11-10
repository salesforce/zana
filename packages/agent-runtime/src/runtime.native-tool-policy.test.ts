import { RELAY_BACKSTOP_MS } from '@zana-ai/zcc-domain/native-tool-policy-budget';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRuntimeProviderRequest, type HandleRuntimeProviderRequestArgs } from './runtime-provider-requests.js';
import { createAgentRuntimeWithAdapters } from './runtime.js';
import { RuntimeProviderProcessManager } from './runtime-provider-process.js';
import { createFakeAdapter, fullRuntimeOptions } from './test/runtime-test-harness.js';
import { fakeProviderScriptPath } from './test/index.js';

const request = { threadId: 'thread', providerThreadId: 'prov-1', callId: 'call', toolName: 'Write', input: { path: '/tmp/file' } };
const identity = { ...request, projectId: 'project', environmentId: 'environment', providerId: 'fake' };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function dispatch(overrides: Partial<HandleRuntimeProviderRequestArgs> = {}, params: unknown = request) {
  const write = vi.fn();
  const callback = vi.fn(async () => ({ action: 'allow' as const }));
  handleRuntimeProviderRequest({
    parsedId: 'policy-call', parsedMethod: 'tool/policy/decide',
    rawRequest: { jsonrpc: '2.0', id: 'policy-call', method: 'tool/policy/decide', params } as never,
    providerProcess: { adapter: createFakeAdapter(fakeProviderScriptPath),
      child: { stdin: { write, on() {}, writable: true, destroyed: false }, exitCode: null, killed: false } as unknown as ChildProcess, interactiveRequestScope: 'scope' },
    getActiveTurnId: () => null, getThreadExecutionOptions: () => undefined,
    onToolCall: vi.fn(), resolveThreadId: vi.fn(() => 'thread'),
    onNativeToolDecision: callback, resolveNativeToolIdentity: () => identity, ...overrides
  });
  return { callback, write, result: () => JSON.parse(write.mock.calls[0]![0] as string).result };
}

describe('native tool decision dispatch', () => {
  it('awaits explicit allow without requiring an active turn or using dynamic-tool handlers', async () => {
    const test = dispatch();
    await vi.waitFor(() => expect(test.write).toHaveBeenCalledOnce());
    expect(test.result()).toEqual({ action: 'allow' });
    expect(test.callback).toHaveBeenCalledWith(identity, expect.any(AbortSignal));
  });
  it.each([undefined, null, {}, { action: 'allow', extra: true }, { action: 'deny', reason: '' }])('denies invalid reply %j', async response => {
    const test = dispatch({ onNativeToolDecision: async () => response as never });
    await vi.waitFor(() => expect(test.write).toHaveBeenCalledOnce());
    expect(test.result().action).toBe('deny');
  });
  it('preserves a valid deny reason', async () => {
    const test = dispatch({ onNativeToolDecision: async () => ({ action: 'deny', reason: 'blocked' }) });
    await vi.waitFor(() => expect(test.write).toHaveBeenCalledOnce());
    expect(test.result()).toEqual({ action: 'deny', reason: 'blocked' });
  });
  it.each([
    { onNativeToolDecision: undefined },
    { resolveNativeToolIdentity: undefined },
    { resolveNativeToolIdentity: () => null },
    { resolveNativeToolIdentity: () => { throw new Error('gone'); } },
    { onNativeToolDecision: () => { throw new Error('offline'); } }
  ] satisfies Partial<HandleRuntimeProviderRequestArgs>[])('denies missing or failing handler/identity', async overrides => {
    const test = dispatch(overrides);
    await vi.waitFor(() => expect(test.write).toHaveBeenCalledOnce());
    expect(test.result().action).toBe('deny');
  });
  it.each([{ ...request, toolName: '' }, { ...request, input: [] }, { ...request, providerThreadId: '' }])('rejects malformed request without policy dispatch', async params => {
    const test = dispatch({}, params);
    await vi.waitFor(() => expect(test.write).toHaveBeenCalledOnce());
    expect(test.result().action).toBe('deny'); expect(test.callback).not.toHaveBeenCalled();
  });
  it.each(['threadId', 'providerThreadId', 'projectId', 'providerId', 'environmentId'] as const)('denies identity change in %s during policy wait', async field => {
    let calls = 0;
    const test = dispatch({ resolveNativeToolIdentity: () => ++calls === 1 ? identity : { ...identity, [field]: 'replaced' } });
    await vi.waitFor(() => expect(test.write).toHaveBeenCalledOnce());
    expect(test.result().action).toBe('deny');
  });
  it('times out, aborts callback and ignores a late allow', async () => {
    vi.useFakeTimers(); let allow!: (value: { action: 'allow' }) => void; let signal!: AbortSignal;
    const test = dispatch({ onNativeToolDecision: (_identity, received) => {
      signal = received; return new Promise(resolve => { allow = resolve; });
    } });
    await vi.advanceTimersByTimeAsync(RELAY_BACKSTOP_MS);
    expect(test.result()).toEqual({ action: 'deny', reason: 'native policy timed out' });
    expect(signal.aborted).toBe(true); allow({ action: 'allow' });
    await vi.advanceTimersByTimeAsync(0); expect(test.write).toHaveBeenCalledOnce();
  });
});

describe('live runtime native tool identity', () => {
  it('derives identity from process records and rejects forged/stale ownership', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-native-policy-'));
    const requireProcess = vi.spyOn(RuntimeProviderProcessManager.prototype, 'requireProviderProcess');
    const callback = vi.fn(async () => ({ action: 'allow' as const }));
    const runtime = createAgentRuntimeWithAdapters({ workspacePath: cwd, onEvent() {}, onToolCall: vi.fn(),
      onNativeToolDecision: callback, adapterFactory: () => createFakeAdapter(fakeProviderScriptPath) });
    try {
      await runtime.startThread({ threadId: 'thread', projectId: 'project', environmentId: 'environment', providerId: 'fake', options: fullRuntimeOptions });
      const proc = requireProcess.mock.results.find(result => result.type === 'return')!.value;
      const write = vi.spyOn(proc.child.stdin, 'write').mockReturnValue(true);
      const send = async (params: unknown) => {
        write.mockClear();
        proc.child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'native', method: 'tool/policy/decide', params }) + '\n'));
        await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
        return JSON.parse(write.mock.calls[0]![0] as string).result;
      };
      expect(await send(request)).toEqual({ action: 'allow' });
      expect(callback).toHaveBeenCalledWith(identity, expect.any(AbortSignal));
      callback.mockClear();
      expect((await send({ ...request, threadId: 'forged' })).action).toBe('deny');
      expect((await send({ ...request, providerThreadId: 'unknown' })).action).toBe('deny');
      const processKey = proc.processKey; proc.processKey = 'wrong-process';
      write.mockClear();
      proc.child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'native', method: 'tool/policy/decide', params: request }) + '\n'));
      await new Promise(resolve => setImmediate(resolve));
      expect(write).not.toHaveBeenCalled(); proc.processKey = processKey;
      const adapterId = proc.adapter.id; proc.adapter.id = 'wrong-adapter';
      expect((await send(request)).action).toBe('deny'); proc.adapter.id = adapterId;
      const original = proc.providerId; proc.providerId = 'wrong';
      expect((await send(request)).action).toBe('deny'); proc.providerId = original;
      proc.expectedShutdownExpectations = 1;
      expect((await send(request)).action).toBe('deny'); proc.expectedShutdownExpectations = 0;
      requireProcess.mockReturnValue({ ...proc });
      expect((await send(request)).action).toBe('deny');
      requireProcess.mockImplementation(() => { throw new Error('process exited'); });
      expect((await send(request)).action).toBe('deny');
      requireProcess.mockRestore();
      expect(callback).not.toHaveBeenCalled();
      write.mockRestore();
    } finally { await runtime.shutdown(); rmSync(cwd, { recursive: true, force: true }); }
  });
});

describe('native tool settled notification (OBL-011)', () => {
  const settled = { threadId: 'thread', providerThreadId: 'prov-1', callId: 'call', toolName: 'Write', state: 'succeeded', durationMs: 4, outputBytes: 2, output: 'hi' };
  it('scopes the event from the live process records, never the notification, and never reaches the adapter', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-native-settled-'));
    const requireProcess = vi.spyOn(RuntimeProviderProcessManager.prototype, 'requireProviderProcess');
    const onNativeToolSettled = vi.fn();
    const onEvent = vi.fn();
    const runtime = createAgentRuntimeWithAdapters({ workspacePath: cwd, onEvent, onToolCall: vi.fn(),
      onNativeToolSettled, adapterFactory: () => createFakeAdapter(fakeProviderScriptPath) });
    try {
      await runtime.startThread({ threadId: 'thread', projectId: 'project', environmentId: 'environment', providerId: 'fake', options: fullRuntimeOptions });
      const proc = requireProcess.mock.results.find(result => result.type === 'return')!.value;
      const send = async (params: unknown) => {
        onNativeToolSettled.mockClear();
        proc.child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'tool/policy/settled', params }) + '\n'));
        await new Promise(resolve => setImmediate(resolve));
      };
      const before = onEvent.mock.calls.length;
      await send({ ...settled, projectId: 'forged', providerId: 'forged' });
      expect(onNativeToolSettled).toHaveBeenCalledOnce();
      expect(onNativeToolSettled.mock.calls[0]![0]).toMatchObject({ ...settled, projectId: 'project', environmentId: 'environment', providerId: 'fake' });
      expect(onNativeToolSettled.mock.calls[0]![0]).not.toHaveProperty('input');
      expect(onEvent.mock.calls.length).toBe(before);
      for (const bad of [{ ...settled, threadId: 'forged' }, { ...settled, providerThreadId: 'unknown' }, { ...settled, state: 'weird' }, { ...settled, durationMs: -1 }]) {
        await send(bad);
        expect(onNativeToolSettled).not.toHaveBeenCalled();
      }
      proc.expectedShutdownExpectations = 1;
      await send(settled);
      expect(onNativeToolSettled).not.toHaveBeenCalled();
      proc.expectedShutdownExpectations = 0;
    } finally { requireProcess.mockRestore(); await runtime.shutdown(); rmSync(cwd, { recursive: true, force: true }); }
  });
  it('contains a throwing callback', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-native-settled-'));
    const requireProcess = vi.spyOn(RuntimeProviderProcessManager.prototype, 'requireProviderProcess');
    const runtime = createAgentRuntimeWithAdapters({ workspacePath: cwd, onEvent() {}, onToolCall: vi.fn(),
      onNativeToolSettled: () => { throw new Error('boom'); }, adapterFactory: () => createFakeAdapter(fakeProviderScriptPath) });
    try {
      await runtime.startThread({ threadId: 'thread', projectId: 'project', environmentId: 'environment', providerId: 'fake', options: fullRuntimeOptions });
      const proc = requireProcess.mock.results.find(result => result.type === 'return')!.value;
      expect(() => proc.child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'tool/policy/settled', params: settled }) + '\n'))).not.toThrow();
    } finally { requireProcess.mockRestore(); await runtime.shutdown(); rmSync(cwd, { recursive: true, force: true }); }
  });
});
