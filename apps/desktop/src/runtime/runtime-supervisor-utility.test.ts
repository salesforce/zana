import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ children: [] as any[], queued: undefined as unknown, queueRequests: [] as any[], pv: 0, enroll: vi.fn(async () => 'host-1'), proof: undefined as unknown, forks: [] as Array<{ env: Record<string, string> }> }));

vi.mock('electron', () => ({
  utilityProcess: {
    fork: (entry: string, _args?: unknown, options?: { env: Record<string, string> }) => {
      if (options) h.forks.push({ env: { ...options.env } });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { EventEmitter: Emitter } = require('node:events') as typeof import('node:events');
      const child: any = Object.assign(new Emitter(), { entry, pid: 7 + h.children.length, kill: () => { child.emit('exit', 0); } });
      child.postMessage = vi.fn((message: any) => {
        if (message.type === 'start') {
          setImmediate(() => child.emit('message', {
            type: 'ready', protocolVersion: h.pv, url: `http://127.0.0.1/${entry}`, hostId: 'host-1', instanceId: 'inst-1'
          }));
        } else if (message.type === 'request' && message.operation === 'desktop-host-enrollment') {
          setImmediate(() => child.emit('message', { type: 'result', protocolVersion: h.pv, id: message.id,
            value: h.proof ?? { serverInstanceId: '33333333-3333-4333-8333-333333333333', serverUrl: 'http://127.0.0.1:8780', host: null } }));
        } else if (message.type === 'request' && (['thread-queue-turn', 'plugins-update-all', 'plugins-dispatch-admission', 'plugins-tool-settled', 'plugins-tool-policy-inventory'].includes(message.operation) || message.operation.startsWith('plugins-pty-') || message.operation.startsWith('plugin-packs-'))) {
          h.queueRequests.push(message);
          setImmediate(() => child.emit('message', h.queued === 'runtime-error'
            ? { type: 'error', protocolVersion: h.pv, id: message.id, message: 'thread store unavailable' }
            : { type: 'result', protocolVersion: h.pv, id: message.id, value: h.queued }));
        } else if (message.type === 'stop') {
          setImmediate(() => child.emit('message', { type: 'stopped', protocolVersion: h.pv }));
        }
      });
      h.children.push(child);
      setImmediate(() => child.emit('spawn'));
      return child;
    }
  }
}));
vi.mock('./enroll-host-utility.js', () => ({ enrollHostUtility: h.enroll }));

h.pv = (await import('@zana-ai/zcc-contracts/runtime')).SERVER_RUNTIME_PROTOCOL_VERSION;
const { startRuntimeSupervisor } = await import('./runtime-supervisor.js');

afterEach(() => { h.children.length = 0; h.forks.length = 0; h.proof = undefined; h.enroll.mockReset().mockResolvedValue('host-1'); vi.useRealTimers(); });

describe('utility-backed runtime supervisor', () => {
  it('forks every utility with the desktop PID, earlier children and the audit path in its env', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-protected-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    try {
      expect(h.forks.length).toBeGreaterThanOrEqual(2);
      const listed = (i: number) => (h.forks[i].env.ZANA_PROTECTED_PIDS ?? '').split(',');
      expect(listed(0)).toContain(String(process.pid));
      expect(listed(1)).toContain(String(h.children[0].pid));
      expect(h.forks[0].env.ZANA_TREE_KILL_AUDIT).toBe(join(dataDir, 'logs', 'tree-kill.log'));
    } finally { await runtime.close(); vi.unstubAllEnvs(); }
  });
  it('opens the window after the startup bound while keeping only one enrollment in flight', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-initial-bound-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const pending = Promise.withResolvers<string>(); h.enroll.mockReturnValueOnce(pending.promise);
    const boot = startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    // Child boot and RPC replies use real setImmediate; enrollment timers are virtual.
    await vi.waitFor(() => expect(h.enroll).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(15_000);
    const runtime = await boot;
    try {
      const server = h.children.find(child => child.entry.endsWith('server-runtime.js'));
      expect(server.postMessage.mock.calls.some(([message]: any[]) => message.type === 'local-host')).toBe(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.enroll).toHaveBeenCalledOnce();
      pending.resolve('host-1');
      await vi.advanceTimersByTimeAsync(0);
      expect(server.postMessage).toHaveBeenCalledWith({ type: 'local-host', protocolVersion: h.pv, hostId: 'host-1' });
      expect(vi.getTimerCount()).toBe(0);
    } finally { await runtime.close(); error.mockRestore(); vi.unstubAllEnvs(); }
  });
  it('retries failed initial enrollment and clears the retry after reconnection', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-retry-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.enroll.mockRejectedValueOnce(new Error('temporary handshake failure'));
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    try {
      expect(h.enroll).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(h.enroll).toHaveBeenCalledTimes(2), { timeout: 8_000 });
      const server = h.children.find(child => child.entry.endsWith('server-runtime.js'));
      expect(server.postMessage).toHaveBeenCalledWith({ type: 'local-host', protocolVersion: h.pv, hostId: 'host-1' });
    } finally { await runtime.close(); error.mockRestore(); vi.unstubAllEnvs(); }
  }, 12_000);
  it('does not publish an enrollment acknowledgement after shutdown', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-shutdown-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    try {
      const pending = Promise.withResolvers<string>(); h.enroll.mockReturnValueOnce(pending.promise);
      const restart = runtime.relaunchEnrolledHost();
      await vi.waitFor(() => expect(h.enroll).toHaveBeenCalledTimes(2));
      await runtime.close(); pending.resolve('host-1');
      await expect(restart).resolves.toEqual({ ok: false, message: 'Background service unavailable' });
      const server = h.children.find(child => child.entry.endsWith('server-runtime.js'));
      expect(server.postMessage.mock.calls.filter(([message]: any[]) => message.type === 'local-host')).toHaveLength(1);
    } finally { await runtime.close(); vi.unstubAllEnvs(); }
  });
  it('coalesces concurrent restarts and recovers a failed attempt with fresh server evidence', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-enrollment-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    try {
      const pending = Promise.withResolvers<string>(); h.enroll.mockReturnValueOnce(pending.promise);
      const a = runtime.relaunchEnrolledHost(), b = runtime.relaunchEnrolledHost();
      await vi.waitFor(() => expect(h.enroll).toHaveBeenCalledTimes(2));
      pending.resolve('host-1');
      await expect(a).resolves.toEqual({ ok: true }); await expect(b).resolves.toEqual({ ok: true });
      h.enroll.mockRejectedValueOnce(new Error('temporary handshake failure'));
      await expect(runtime.relaunchEnrolledHost()).resolves.toEqual({ ok: false, message: 'temporary handshake failure' });
      await expect(runtime.relaunchEnrolledHost()).resolves.toEqual({ ok: true });
      h.proof = {};
      const calls = h.enroll.mock.calls.length;
      expect((await runtime.relaunchEnrolledHost()).ok).toBe(false);
      expect(h.enroll).toHaveBeenCalledTimes(calls);
    } finally { await runtime.close(); vi.unstubAllEnvs(); }
  });
  it('forwards validated local thread activity and clears it on runtime loss and shutdown', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-power-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const onLocalThreadWork = vi.fn();
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir, onLocalThreadWork });
    const server = h.children.find(child => child.entry.endsWith('server-runtime.js'));
    expect(server.postMessage).toHaveBeenCalledWith({ type: 'local-host', protocolVersion: h.pv, hostId: 'host-1' });
    const emit = (localThreadsWorking: unknown) => server.emit('message', {
      type: 'menubar-threads-changed', protocolVersion: h.pv, localThreadsWorking
    });
    try {
      emit('true');
      expect(onLocalThreadWork).not.toHaveBeenCalled();
      emit(true);
      expect(onLocalThreadWork).toHaveBeenLastCalledWith(true);
      emit(false);
      expect(onLocalThreadWork).toHaveBeenLastCalledWith(false);
      emit(true);
      server.emit('exit', 1);
      expect(onLocalThreadWork).toHaveBeenLastCalledWith(false);
      onLocalThreadWork.mockClear();
      emit(true);
      expect(onLocalThreadWork).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
      expect(onLocalThreadWork).toHaveBeenLastCalledWith(false);
      vi.unstubAllEnvs();
    }
  });
  it('forwards a valid plugin capability message to the host daemon process as well as the main listener', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-caps-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    const server = h.children.find(child => child.entry.endsWith('server-runtime.js'));
    const host = h.children.find(child => child.entry.endsWith('host-daemon.js') || (child !== server && child.entry !== server.entry));
    const listener = vi.fn();
    runtime.onPluginCapabilitiesChanged(listener);
    try {
      const message = { type: 'plugin-capabilities', protocolVersion: h.pv, contributors: [{ id: 'p', enabled: true, rootDir: '/p', skillsRootPaths: [], skillNames: [], mcpServers: [{ name: 's', type: 'stdio', command: 'node', alwaysOn: true }] }] };
      server.emit('message', message);
      expect(listener).toHaveBeenCalledWith(message.contributors);
      expect(host.postMessage).toHaveBeenCalledWith(message);
      host.postMessage.mockClear(); listener.mockClear();
      server.emit('message', { ...message, contributors: [{ id: 'p' }] });
      expect(listener).not.toHaveBeenCalled();
      expect(host.postMessage).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
      vi.unstubAllEnvs();
    }
  });
  it('routes PTY plugin-host operations to the server utility with the main-asserted request', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-pty-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    try {
      const request = { sessionId: 's-1', projectId: 'p-1' } as never;
      const actions = [
        { operation: 'plugins-dispatch-admission', call: () => runtime.admitDispatch(request), withRequest: true },
        { operation: 'plugins-pty-lifecycle-event', call: () => runtime.emitPtyLifecycle(request), withRequest: true },
        { operation: 'plugins-tool-settled', call: () => runtime.emitToolSettled(request), withRequest: true },
        { operation: 'plugins-pty-session-instructions', call: () => runtime.ptySessionInstructions(request), withRequest: true },
        { operation: 'plugins-pty-session-tools', call: () => runtime.ptySessionTools(request), withRequest: true },
        { operation: 'plugins-pty-session-tool-call', call: () => runtime.ptySessionToolCall(request), withRequest: true },
        { operation: 'plugins-tool-policy-inventory', call: () => runtime.toolPolicyReadiness(), withRequest: false }
      ];
      for (const action of actions) {
        h.queued = { ack: action.operation };
        await expect(action.call()).resolves.toEqual(h.queued);
        const message = h.queueRequests.at(-1);
        expect(message.operation).toBe(action.operation);
        if (action.withRequest) expect(message.request).toEqual(request);
        else expect(message).not.toHaveProperty('request');
      }
      h.queued = 'runtime-error';
      await expect(runtime.ptySessionToolCall(request)).rejects.toThrow('thread store unavailable');
    } finally {
      await runtime.close();
      vi.unstubAllEnvs();
    }
  });
  it('routes plugin pack operations to the server utility with reviewed identities and plans', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-packs-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    try {
      const identity = { marketplaceSource: 'https://catalog.test/marketplace.json', packId: 'essentials' };
      const request = { identity, planId: '00000000-0000-4000-8000-000000000001', pluginIds: ['tools'] };
      const actions = [
        { operation: 'plugin-packs-list', call: () => runtime.listPluginPacks(), fields: {} },
        { operation: 'plugin-packs-plan', call: () => runtime.planPluginPack(identity), fields: { identity } },
        { operation: 'plugin-packs-install', call: () => runtime.installPluginPack(request), fields: { request } },
        { operation: 'plugin-packs-installed', call: () => runtime.listInstalledPluginPacks(), fields: {} },
        { operation: 'plugin-packs-forget', call: () => runtime.forgetPluginPack(identity), fields: { identity } }
      ];
      const { ServerRuntimeInboundSchema } = await import('@zana-ai/zcc-contracts/runtime');
      for (const action of actions) {
        h.queued = { acknowledged: action.operation };
        await expect(action.call()).resolves.toEqual(h.queued);
        const message = h.queueRequests.at(-1);
        expect(message).toMatchObject({ operation: action.operation, ...action.fields });
        expect(ServerRuntimeInboundSchema.safeParse(message).success).toBe(true);
        const remaining = Date.parse(message.deadlineAt) - Date.now();
        expect(remaining).toBeGreaterThan(action.operation === 'plugin-packs-install' ? 290_000 : 10_000);
      }
      h.queued = 'runtime-error';
      await expect(runtime.planPluginPack(identity)).rejects.toThrow('thread store unavailable');
    } finally {
      await runtime.close();
      vi.unstubAllEnvs();
    }
  });

  it('round-trips bulk plugin updates through the utility protocol and propagates errors', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-updates-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    try {
      const result = { updated: ['plugin-1'], failed: [{ id: 'plugin-2', message: 'unavailable' }] };
      h.queued = result;
      await expect(runtime.updateAllPlugins()).resolves.toEqual(result);
      expect(h.queueRequests.at(-1)).toMatchObject({ operation: 'plugins-update-all' });
      h.queued = 'runtime-error';
      await expect(runtime.updateAllPlugins()).rejects.toThrow('thread store unavailable');
    } finally {
      await runtime.close();
      vi.unstubAllEnvs();
    }
  });

  it('queues a thread turn through the server runtime and rejects a malformed reply', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-utility-sup-'));
    vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
    const runtime = await startRuntimeSupervisor({ rendererRoot: dataDir, dataDir, runtimeDir: dataDir });
    try {
      h.queued = { ok: true, queued: true };
      await expect(runtime.queueThreadTurn('thread-1', 'project-1', 'hello')).resolves.toEqual({ ok: true, queued: true });
      expect(h.queueRequests.at(-1)).toMatchObject({ operation: 'thread-queue-turn', threadId: 'thread-1', projectId: 'project-1', text: 'hello' });
      h.queued = { ok: 'yes' };
      await expect(runtime.queueThreadTurn('thread-1', 'project-1', 'hello')).resolves.toEqual({ ok: false, reason: 'invalid thread response' });
      // A request the runtime rejects (error reply, timeout, dead child) resolves ok:false, never throws.
      h.queued = 'runtime-error';
      await expect(runtime.queueThreadTurn('thread-1', 'project-1', 'hello')).resolves.toEqual({ ok: false, reason: 'thread store unavailable' });
    } finally {
      await runtime.close();
      vi.unstubAllEnvs();
    }
  });
});
