import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentRuntimeOptions } from '@zana-ai/zcc-agent-runtime';
import { startEnrolledHostConnection } from './server-connection.js';

const state = vi.hoisted(() => ({ runtimeOptions: undefined as any, socketOptions: undefined as any,
  socket: { connected: false, ready: Promise.resolve(), close: vi.fn(), send: vi.fn(() => true) },
  savedRevision: 'opaque-generation-1', initialize: vi.fn(async () => {}), clearSaved: vi.fn(async () => {}), reconcile: vi.fn(async () => {}),
  flush: vi.fn(async () => {}), policy: vi.fn(async () => ({ action: 'allow' as const })) }));
vi.mock('./runtime-manager.js', () => ({ createRuntimeManager: (options: unknown) => { state.runtimeOptions = options; return { dispose: vi.fn() }; } }));
vi.mock('./server-socket.js', () => ({ createHostServerSocket: (options: unknown) => { state.socketOptions = options; return state.socket; } }));
vi.mock('./event-sink.js', () => ({ createEventSink: () => ({ emit: vi.fn(), flush: state.flush, dispose: vi.fn(async () => {}) }) }));
vi.mock('./event-delivery.js', () => ({ createEventDelivery: () => ({ cancel: vi.fn() }) }));
vi.mock('./native-tool-policy-client.js', () => ({ createNativeToolPolicyHttpClient: () => state.policy, createNativeToolSettledHttpClient: () => ({ report: vi.fn(async () => {}) }) }));
vi.mock('./plugin-host-manager.js', () => ({ PluginHostManager: class { shutdown = vi.fn(async () => {}); reconcileGenerations = state.reconcile; } }));
vi.mock('./saved-machine-environment.js', () => ({ SavedMachineEnvironment: class {
  get revision() { return state.savedRevision; }
  initialize = state.initialize; clear = state.clearSaved;
} }));
vi.mock('./enrolled-pty.js', () => ({ createEnrolledPty: () => ({ dispose: vi.fn() }) }));
vi.mock('./desktop-browser-broker.js', () => ({ startDesktopBrowserBroker: async () => null }));
vi.mock('./workspace-fs-watch.js', () => ({ hostFsWatcher: () => ({}) }));
vi.mock('./preview-tunnel.js', () => ({ HostPreviewTunnel: class { close() {} setConnected() {} } }));
vi.mock('./machine-environment.js', () => ({ MachineEnvironment: class { clear() {} } }));
vi.mock('./command-dispatch.js', () => ({ createCommandRuntime: () => ({ terminals: new Map(), dataDir: tmpdir() }) }));
const input = { threadId: 'thread', providerId: 'provider', providerThreadId: 'session', projectId: 'project',
  environmentId: 'environment', callId: 'call', toolName: 'Write', input: {} };
afterEach(() => { vi.clearAllMocks(); state.socket.connected = false; });

async function fixture(run: (decide: NonNullable<AgentRuntimeOptions['onNativeToolDecision']>, change: (connected: boolean) => void) => Promise<void>) {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-native-connection-'));
  const connection = startEnrolledHostConnection({ serverUrl: 'http://127.0.0.1:8780', hostId: 'host', hostKey: 'key', instanceId: 'instance', dataDir });
  const change = (connected: boolean) => { state.socket.connected = connected; state.socketOptions.onConnectionChange(connected); };
  try { await run(state.runtimeOptions.onNativeToolDecision, change); }
  finally { await connection.close(); rmSync(dataDir, { recursive: true, force: true }); }
}
describe('enrolled connection native veto', () => {
  it('denies before enrollment, then flushes identity evidence before policy', async () => {
    await fixture(async (decide, change) => {
      expect((await decide(input, new AbortController().signal)).action).toBe('deny');
      expect(state.policy).not.toHaveBeenCalled(); change(true);
      state.flush.mockClear();
      expect(await decide(input, new AbortController().signal)).toEqual({ action: 'allow' });
      expect(state.flush.mock.invocationCallOrder[0]).toBeLessThan(state.policy.mock.invocationCallOrder[0]!);
    });
  });
  it.each(['disconnect', 'reconnect', 'abort'])('denies %s during evidence flush', async mode => {
    await fixture(async (decide, change) => {
      change(true);
      const controller = new AbortController();
      state.flush.mockImplementationOnce(async () => {
        if (mode === 'abort') controller.abort();
        else { change(false); if (mode === 'reconnect') change(true); }
      });
      expect((await decide(input, controller.signal)).action).toBe('deny'); expect(state.policy).not.toHaveBeenCalled();
    });
  });
  it.each(['disconnect', 'reconnect', 'abort'])('denies late allow after %s', async mode => {
    await fixture(async (decide, change) => {
      change(true); const controller = new AbortController();
      state.policy.mockImplementationOnce(async () => {
        if (mode === 'abort') controller.abort();
        else { change(false); if (mode === 'reconnect') change(true); }
        return { action: 'allow' };
      });
      expect((await decide(input, controller.signal)).action).toBe('deny');
    });
  });
});

describe('enrolled connection saved credentials', () => {
  it('loads credentials before acknowledging hello and reads the current opaque launch generation', async () => {
    let finish!: () => void;
    state.initialize.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    await fixture(async () => {
      const hello = state.socketOptions.onHello({ productInstanceId: 'product', enrollmentCapability: 'execution', pluginHostGenerations: [] });
      expect(state.reconcile).not.toHaveBeenCalled(); finish(); await hello;
      expect(state.reconcile).toHaveBeenCalledWith([]);
      expect(state.runtimeOptions.getEnvironmentRevision()).toBe('opaque-generation-1');
      state.savedRevision = 'opaque-generation-2';
      expect(state.runtimeOptions.getEnvironmentRevision()).toBe('opaque-generation-2');
      state.savedRevision = 'opaque-generation-1';
    });
    expect(state.clearSaved).toHaveBeenCalledOnce();
  });
  it('keeps enrollment available when saved storage fails and logs no storage error details', async () => {
    state.initialize.mockRejectedValueOnce(new Error('fixture-secret-must-not-leak'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await fixture(async () => {
        await state.socketOptions.onHello({ productInstanceId: 'product', enrollmentCapability: 'execution', pluginHostGenerations: [] });
        expect(state.reconcile).toHaveBeenCalledWith([]);
        expect(warning).toHaveBeenCalledOnce();
        expect(JSON.stringify(warning.mock.calls)).not.toContain('fixture-secret-must-not-leak');
      });
    } finally { warning.mockRestore(); }
  });
  it('closes the socket immediately and waits for credential cleanup before shutdown completes', async () => {
    let finish!: () => void;
    state.clearSaved.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-env-shutdown-'));
    const connection = startEnrolledHostConnection({ serverUrl: 'http://127.0.0.1:8780', hostId: 'host', hostKey: 'key', instanceId: 'instance', dataDir });
    try {
      let finished = false;
      const closing = connection.close().then(() => { finished = true; });
      await vi.waitFor(() => expect(state.clearSaved).toHaveBeenCalledOnce());
      expect(state.socket.close).toHaveBeenCalledOnce(); expect(finished).toBe(false);
      finish(); await closing; expect(finished).toBe(true);
    } finally { finish(); await connection.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });
});
