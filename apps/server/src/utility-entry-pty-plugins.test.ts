import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';

// The real runtime boundary stays in place: requests must pass the v14 schema,
// and a handler throw becomes an `error` reply carrying the request id.
const h = vi.hoisted(() => ({
  context: null as any,
  readiness: vi.fn(),
  close: vi.fn(async () => undefined),
  settled: vi.fn(),
  admit: vi.fn(),
  lifecycle: vi.fn(),
  instructions: vi.fn(),
  tools: vi.fn(),
  toolCall: vi.fn(),
  retain: vi.fn()
}));
// The per-operation helpers have their own unit tests; here only the dispatch
// (which identity/plugin service each operation receives, and the reply shape) is under test.
vi.mock('./plugins/tool-settled.js', () => ({ emitMainOwnedToolSettled: h.settled }));
vi.mock('./plugins/dispatch-admission.js', () => ({ admitMainOwnedDispatch: h.admit }));
vi.mock('./plugins/pty-session-events.js', () => ({ emitMainOwnedPtyLifecycle: h.lifecycle }));
vi.mock('./plugins/pty-session-instructions.js', () => ({ resolveMainOwnedPtyInstructions: h.instructions }));
vi.mock('./plugins/pty-session-tools.js', () => ({ listMainOwnedPtyTools: h.tools, callMainOwnedPtyTool: h.toolCall }));
vi.mock('./services/threads/thread-reads.js', async original => ({
  ...await original<typeof import('./services/threads/thread-reads.js')>(), prepareThreadReads: async () => undefined
}));
vi.mock('./http/product-context.js', async original => ({
  ...await original<typeof import('./http/product-context.js')>(), createProductHttpContext: () => h.context
}));
vi.mock('./http/product-plugins.js', async original => ({
  ...await original<typeof import('./http/product-plugins.js')>(),
  // Mirrors the real wrapper: stop() clears ctx.plugins.
  createAttachedProductPluginService: (ctx: any) => {
    const service = {
      toolPolicyReadiness: h.readiness,
      refreshSafeMode: async () => undefined,
      stop() { if (ctx.plugins === service) ctx.plugins = undefined; }
    };
    ctx.plugins = service;
    return service;
  },
  startAttachedProductPluginService: async () => undefined
}));
vi.mock('./static-host.js', () => ({ startStaticHost: async () => ({ url: 'http://127.0.0.1:0/', close: h.close }) }));
vi.mock('./runtime-database.js', () => ({ createRuntimeDatabase: () => ({ close() {} }) }));
vi.mock('./terminal-execution-service.js', () => ({ createTerminalExecutionService: () => ({ binding: { hostId: 'test-host' } }) }));
vi.mock('./terminal-session-service.js', () => ({ TerminalSessionService: class {
  refreshHostConnection() { return Promise.resolve(); }
} }));
vi.mock('./http/cli-agent-ops.js', async original => ({
  ...await original<typeof import('./http/cli-agent-ops.js')>(), retainProductServerCredential: h.retain
}));
vi.mock('@zana-ai/zcc-process-utils', async original => ({
  ...await original<typeof import('@zana-ai/zcc-process-utils')>(), installRuntimeLog() {}
}));


const session = { sessionId: 'session-1', projectId: 'project-1', profile: 'claude' };
const OPS: Array<{ operation: string; request: Record<string, unknown>; helper: keyof typeof h; arg: 'plugins' | 'context' }> = [
  { operation: 'plugins-tool-settled', helper: 'settled', arg: 'plugins', request: { ...session, invocationId: 'a'.repeat(64), toolName: 'Bash', state: 'succeeded', durationMs: 1 } },
  { operation: 'plugins-dispatch-admission', helper: 'admit', arg: 'context', request: { projectId: 'project-1', entry: 'reply', origin: 'user' } },
  { operation: 'plugins-pty-lifecycle-event', helper: 'lifecycle', arg: 'context', request: { ...session, kind: 'created' } },
  { operation: 'plugins-pty-session-instructions', helper: 'instructions', arg: 'plugins', request: session },
  { operation: 'plugins-pty-session-tools', helper: 'tools', arg: 'plugins', request: session },
  { operation: 'plugins-pty-session-tool-call', helper: 'toolCall', arg: 'plugins', request: { ...session, invocationId: '11111111-1111-4111-8111-111111111111', name: 'weather', arguments: { city: 'a' } } }
];

// utility-entry is a process singleton, so the phases share one import and
// run in order: before start, while running, after stop.
describe('main-owned PTY plugin operations over the runtime channel', () => {
  const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  let exit: ReturnType<typeof vi.spyOn>;
  let root = '';
  let stopped = false;
  const stop = async () => {
    parent.emit('message', { data: { type: 'stop', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION } });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    stopped = true;
  };
  const ask = async (operation: string, request?: Record<string, unknown>) => {
    const id = randomUUID();
    parent.emit('message', { data: {
      type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id,
      deadlineAt: new Date(Date.now() + 20_000).toISOString(), operation, ...(request ? { request } : {})
    } });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id })));
    return parent.postMessage.mock.calls.map(([message]) => message).find((message) => message.id === id);
  };
  const start = (extra: Record<string, unknown> = {}) => parent.emit('message', { data: {
    type: 'start', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, rendererRoot: root, dataDir: root,
    hostUrl: 'http://127.0.0.1:1', hostToken: 't'.repeat(32), hostSigningKey: 's'.repeat(32),
    hostBinding: { hostId: randomUUID(), instanceId: randomUUID() }, version: '0.0.0-test', ...extra
  } });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'utility-pty-plugins-'));
    Object.defineProperty(process, 'parentPort', { configurable: true, value: parent });
    exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    h.context = { db: {}, hub: { emit() {}, subscribe: () => () => undefined }, config: { getConfig: () => ({}) } };
    await import('./utility-entry.js');
  });

  afterAll(async () => {
    if (!stopped) await stop();
    exit.mockRestore();
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor);
    else Reflect.deleteProperty(process, 'parentPort');
    await rm(root, { recursive: true, force: true });
  });

  it('hands each operation no plugin service or context before the runtime starts, and reports readiness as unavailable', async () => {
    for (const op of OPS) {
      h[op.helper].mockReturnValueOnce({ echoed: op.operation });
      const reply = await ask(op.operation, op.request);
      expect(reply).toEqual({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: expect.any(String), value: { echoed: op.operation } });
      expect(h[op.helper]).toHaveBeenLastCalledWith(undefined, op.request);
    }
    await expect(ask('plugins-tool-policy-inventory')).resolves.toMatchObject({
      type: 'result', value: { ready: false, required: [], reason: 'plugin service is unavailable' }
    });
    expect(h.readiness).not.toHaveBeenCalled();
  });

  it('adopts a credential sent in the start message', async () => {
    const credential = 'c'.repeat(40);
    h.retain.mockClear();
    start({ productServerCredential: credential });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' })));
    expect(h.retain).toHaveBeenCalledWith(credential);
  });

  it('routes each operation to the attached plugin service or product context and relays the helper reply', async () => {
    for (const op of OPS) {
      h[op.helper].mockReturnValueOnce({ live: op.operation });
      const reply = await ask(op.operation, op.request);
      expect(reply).toMatchObject({ type: 'result', value: { live: op.operation } });
      const [first, second] = h[op.helper].mock.calls.at(-1)!;
      expect(second).toEqual(op.request);
      if (op.arg === 'plugins') expect(first).toMatchObject({ toolPolicyReadiness: h.readiness });
      else expect(first).toBe(h.context);
    }
  });

  it('answers the pre-spawn inventory from the plugin service readiness, and relays a failure as an error', async () => {
    const readiness = { ready: true, required: ['claude'] };
    h.readiness.mockResolvedValueOnce(readiness);
    await expect(ask('plugins-tool-policy-inventory')).resolves.toMatchObject({ type: 'result', value: readiness });
    h.readiness.mockRejectedValueOnce(new Error('inventory torn'));
    await expect(ask('plugins-tool-policy-inventory')).resolves.toMatchObject({ type: 'error', message: 'inventory torn' });
  });

  it('rejects an operation request outside the contract without invoking the helper', async () => {
    const calls = h.admit.mock.calls.length;
    await expect(ask('plugins-dispatch-admission', { projectId: 'project-1', entry: 'bogus', origin: 'user' })).resolves.toMatchObject({ type: 'error' });
    expect(h.admit).toHaveBeenCalledTimes(calls);
  });

  it('reports the inventory as unavailable again once the runtime has stopped', async () => {
    await stop();
    await expect(ask('plugins-tool-policy-inventory')).resolves.toMatchObject({
      type: 'result', value: { ready: false, required: [], reason: 'plugin service is unavailable' }
    });
  });
});
