import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';

const h = vi.hoisted(() => ({
  context: null as any,
  handlers: new Map<string, () => void>(),
  launchOptions: null as any,
  squad: {
    preflightSquadRuntime: vi.fn(), createSquadMemberConversation: vi.fn(), activateSquadMemberConversation: vi.fn(),
    deliverSquadMemberConversation: vi.fn(), completeSquadMemberDelivery: vi.fn(), squadMemberStatus: vi.fn(),
    stopSquadMemberConversation: vi.fn(), resolveSquadMember: vi.fn()
  }
}));
vi.mock('./services/threads/squad-member-runtime.js', () => h.squad);
vi.mock('./services/agents/modern-team-launch-config.js', () => ({
  createModernTeamLaunchConfigSource: (options: unknown) => { h.launchOptions = options; return {}; }
}));
vi.mock('./services/threads/thread-reads.js', async original => ({
  ...await original<typeof import('./services/threads/thread-reads.js')>(), prepareThreadReads: async () => undefined
}));
vi.mock('./http/product-context.js', async original => ({
  ...await original<typeof import('./http/product-context.js')>(), createProductHttpContext: () => h.context
}));
vi.mock('./http/product-plugins.js', async original => ({
  ...await original<typeof import('./http/product-plugins.js')>(),
  createAttachedProductPluginService: () => ({ stop() {}, refreshSafeMode: async () => undefined }),
  startAttachedProductPluginService: async () => undefined
}));
vi.mock('./static-host.js', () => ({ startStaticHost: async () => ({ url: 'http://127.0.0.1:0/', close: async () => undefined }) }));
vi.mock('./runtime-database.js', () => ({ createRuntimeDatabase: () => ({ close() {} }) }));
vi.mock('./terminal-execution-service.js', () => ({ createTerminalExecutionService: () => ({ binding: { hostId: 'test-host' } }) }));
vi.mock('./terminal-session-service.js', () => ({ TerminalSessionService: class {
  refreshHostConnection() { return Promise.resolve(); }
} }));
vi.mock('@zana-ai/zcc-process-utils', async original => ({
  ...await original<typeof import('@zana-ai/zcc-process-utils')>(), installRuntimeLog() {}
}));

const projectId = 'project-1';
const control = { bindingId: randomUUID(), generation: 1, projectId };
const member = {
  ...control, teamId: 'team', cohortId: randomUUID(), providerId: 'claude-code', role: 'worker',
  prompt: 'do it', title: 'Worker'
};
const delivery = { ...control, assignmentId: 'a1', idempotencyKey: 'k1', message: 'go' };
const completion = { ...control, assignmentId: 'a1', idempotencyKey: 'k1' };
const preflight = { projectId, providerIds: ['claude-code'] };

describe('squad member runtime operations over the runtime channel', () => {
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
  const send = async (operation: string, request: unknown) => {
    const id = randomUUID();
    parent.emit('message', { data: {
      type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id,
      deadlineAt: new Date(Date.now() + 20_000).toISOString(), operation, request
    } });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id })));
    return parent.postMessage.mock.calls.map(([m]) => m).find((m) => m.id === id);
  };
  const ops: Array<[string, unknown, keyof typeof h.squad]> = [
    ['squad-runtime-preflight', preflight, 'preflightSquadRuntime'],
    ['squad-member-create', member, 'createSquadMemberConversation'],
    ['squad-member-activate', member, 'activateSquadMemberConversation'],
    ['squad-member-deliver', delivery, 'deliverSquadMemberConversation'],
    ['squad-member-delivery-complete', completion, 'completeSquadMemberDelivery'],
    ['squad-member-status', control, 'squadMemberStatus']
  ];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'utility-squad-'));
    Object.defineProperty(process, 'parentPort', { configurable: true, value: parent });
    exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    h.context = {
      db: {}, config: { getConfig: () => ({}) },
      hub: { emit() {}, subscribe: (name: string, fn: () => void) => { h.handlers.set(name, fn); return () => h.handlers.delete(name); } }
    };
    await import('./utility-entry.js');
  });

  afterAll(async () => {
    if (!stopped) await stop();
    exit.mockRestore();
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor);
    else Reflect.deleteProperty(process, 'parentPort');
    await rm(root, { recursive: true, force: true });
  });

  it('fails closed before start: errors for member ops, false for stop', async () => {
    for (const [op, request] of ops) {
      await expect(send(op, request)).resolves.toMatchObject({ type: 'error', message: 'squad member runtime is unavailable' });
    }
    await expect(send('squad-member-stop', control)).resolves.toMatchObject({ type: 'result', value: false });
    for (const name of Object.keys(h.squad)) expect(h.squad[name as keyof typeof h.squad]).not.toHaveBeenCalled();
  });

  it('delegates each operation to the squad runtime once started', async () => {
    parent.emit('message', { data: {
      type: 'start', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, rendererRoot: root, dataDir: root,
      hostUrl: 'http://127.0.0.1:1', hostToken: 't'.repeat(32), hostSigningKey: 's'.repeat(32),
      hostBinding: { hostId: randomUUID(), instanceId: randomUUID() }, version: '0.0.0-test'
    } });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' })));
    for (const [op, request, fn] of ops) {
      h.squad[fn].mockReturnValueOnce({ op });
      await expect(send(op, request)).resolves.toMatchObject({ type: 'result', value: { op } });
      expect(h.squad[fn]).toHaveBeenCalledWith(h.context, request);
    }
    h.squad.stopSquadMemberConversation.mockResolvedValueOnce(true);
    await expect(send('squad-member-stop', control)).resolves.toMatchObject({ type: 'result', value: true });
    expect(h.squad.stopSquadMemberConversation).toHaveBeenCalledWith(h.context, control);
  });

  it('replies with an error when a squad operation throws', async () => {
    h.squad.createSquadMemberConversation.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(send('squad-member-create', member)).resolves.toMatchObject({ type: 'error', message: 'provider unavailable' });
    h.squad.stopSquadMemberConversation.mockRejectedValueOnce(new Error('stop failed'));
    await expect(send('squad-member-stop', control)).resolves.toMatchObject({ type: 'error', message: 'stop failed' });
  });

  it('wires the launch-config member resolver to the product context', () => {
    h.squad.resolveSquadMember.mockReturnValueOnce({ role: 'worker', generation: 2 });
    expect(h.launchOptions.resolveMember('thread-1', projectId)).toEqual({ role: 'worker', generation: 2 });
    expect(h.squad.resolveSquadMember).toHaveBeenCalledWith(h.context, 'thread-1', projectId);
    h.squad.resolveSquadMember.mockReturnValueOnce(null);
    expect(h.launchOptions.resolveMember('thread-x', projectId)).toBeNull();
  });

  it('coalesces thread status and progress events into one leading menubar hint', async () => {
    expect([...h.handlers.keys()].sort()).toEqual(['threads:event', 'threads:updated']);
    const hints = () => parent.postMessage.mock.calls.filter(([m]) => m.type === 'menubar-threads-changed').length;
    const before = hints();
    h.handlers.get('threads:event')!();
    h.handlers.get('threads:updated')!();
    h.handlers.get('threads:event')!();
    await vi.waitFor(() => expect(hints()).toBe(before + 1));
    await new Promise((r) => setTimeout(r, 150));
    expect(hints()).toBe(before + 1);
    h.handlers.get('threads:updated')!();
    await vi.waitFor(() => expect(hints()).toBe(before + 2));
  });

  it('disposes both hint subscriptions on stop', async () => {
    await stop();
    expect(h.handlers.size).toBe(0);
  });
});
