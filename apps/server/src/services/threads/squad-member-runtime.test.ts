import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendConversationThreadEvent, createConversationThread, createEnvironment, getConversationThread,
  deleteConversationThreadEventsAfter, getEnvironment, getThreadPluginMetadata, listDeferredThreadMessages,
  openDatabase, patchThreadPluginMetadata, upsertHost, type ZccDatabase
} from '@zana-ai/zcc-db';
import { threadPluginMetadataQuerySchema, updateThreadPluginMetadataRequestSchema } from '@zana-ai/zcc-server-contract';
import type { ProductHttpContext } from '../../http/product-context.js';
import { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';
import { createConversationFromRequest } from './conversation-create.js';
import { readConversationPluginMetadata, updateConversationPluginMetadata } from './conversation-plugin-metadata.js';
import { registerThreadProvider } from './thread-provider-catalog.js';
import {
  activateSquadMemberConversation, completeSquadMemberDelivery, createSquadMemberConversation, deliverSquadMemberConversation, MODERN_SQUAD_BINDING_ORIGIN,
  preflightSquadRuntime, squadMemberStatus, stopSquadMemberConversation, handleMainSquadRuntimeHttp,
  isSquadMemberThread, resolveSquadMember
} from './squad-member-runtime.js';
import { createNativeToolPolicyVerifier, signNativeToolPolicyRequest } from '../../http/native-tool-policy-proof.js';
import { SQUAD_RUNTIME_OPERATION_PATH } from '@zana-ai/zcc-contracts/runtime';
import { startProductServer } from '../../http/product-server.js';
import { enrollDaemonHost } from '../../../../host-daemon/src/enroll.js';
import { startEnrolledHostConnection } from '../../../../host-daemon/src/server-connection.js';

let db: ZccDatabase;
let dir: string;
let ctx: ProductHttpContext;
let hostId: string;
let unregister: () => void;
let commands: Array<{ type: string; path?: string; cwd?: string; environmentId?: string }>;
const bindingId = '22222222-2222-4222-8222-222222222222';
const control = { bindingId, projectId: 'p', generation: 2 };
const member = { ...control, teamId: 'team', cohortId: '33333333-3333-4333-8333-333333333333',
  providerId: 'test-provider', role: 'worker' as const, prompt: 'Do work', title: 'Worker' };
const delivery = { ...control, assignmentId: 'assignment-1', idempotencyKey: 'delivery-1', message: 'Next task' };
const completion = { ...control, assignmentId: delivery.assignmentId, idempotencyKey: delivery.idempotencyKey };
const privateNamespace = '.host-modern-squad';
const receiptKey = `delivery_${createHash('sha256').update(JSON.stringify(delivery.idempotencyKey)).digest('hex')}`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-squad-runtime-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  hostId = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64), isPrimary: true }).id;
  unregister = registerThreadProvider('test', {
    id: 'test-provider', displayName: 'Test', capabilities: { supportsServiceTier: true, fork: 'tip',
      supportsManualCompaction: false, supportsThreadArchive: false, supportsThreadRename: false,
      permissionModes: ['full'] }, composerActions: []
  }).unregister;
  const artifacts = new PluginHostArtifactRegistry();
  artifacts.set('test', { path: '/tmp/host.js', digest: 'a'.repeat(64), byteLength: 12, generation: 'g1' });
  const project = { id: 'p', name: 'Test', path: dir, hostId };
  commands = [];
  ctx = { db, dataDir: dir, toProjects: () => [project], projects: { list: () => [project] },
    config: { getConfig: () => ({}) }, hub: { emit: vi.fn() }, pluginHostArtifacts: artifacts,
    plugins: { get: vi.fn(), toolPolicyReadiness: vi.fn(async () => ({ ready: true, required: [] })), admitDispatch: vi.fn(async () => ({ action: 'proceed' })),
      sessionTools: vi.fn(async () => ({})), emitThreadEvent: vi.fn(async () => {}) },
    pendingInteractions: { interruptPendingInteractionsForThreadIds: vi.fn(), hasPendingThreadInteraction: () => false },
    hostHub: { resolveHostId: () => hostId, ensureHostSessionReady: () => {}, connectedHostIds: () => [hostId],
      callHostOnlineRpc: vi.fn(async ({ command }: { command: typeof commands[number] }) => {
        commands.push(command);
        if (command.type === 'provider.status') return { providers: [], extraInstalledAgents: [{ providerId: 'test-provider', installed: true }] };
        if (command.type === 'environment.provision') return { path: command.path, isGitRepo: true, isWorktree: true };
        if (command.type === 'thread.start') return { providerThreadId: 'native-thread' };
        if (command.type === 'thread.stop') return { threadId: bindingId, stopped: true };
        return { accepted: true };
      }) }
  } as unknown as ProductHttpContext;
});
afterEach(() => { unregister(); db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('trusted Modern member runtime', () => {
  it.each(['worker', 'orchestrator'] as const)('prepares idle %s using reserved UUID and attached worktree without provider start', async role => {
    mkdirSync(join(dir, 'worktree')); const worktreePath = realpathSync(join(dir, 'worktree'));
    expect(await createSquadMemberConversation(ctx, { ...member, role, worktreePath })).toEqual({ threadId: bindingId });
    const thread = getConversationThread(db, bindingId)!;
    expect(thread).toMatchObject({ status: 'idle', providerThreadId: null });
    expect(thread.visibility).toBe(role === 'worker' ? 'hidden' : 'visible');
    expect(getEnvironment(db, thread.environmentId!)?.path).toBe(worktreePath);
    expect(commands.find(command => command.type === 'environment.provision')).toMatchObject({ path: worktreePath });
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
    expect(ctx.plugins!.sessionTools).not.toHaveBeenCalled();
    expect(squadMemberStatus(ctx, control)).toMatchObject({ status: 'idle', providerStarted: false, live: false });
    expect(readConversationPluginMetadata(db, bindingId, MODERN_SQUAD_BINDING_ORIGIN)).toMatchObject({
      squadBinding: bindingId, squadGeneration: 2, squadRole: role, squadHost: hostId
    });
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata).toMatchObject({
      squadBinding: bindingId, squadGeneration: 2, squadRole: role, squadHost: hostId, squadEnvironmentPath: worktreePath
    });
  });

  it.each([false, true])('dedupes concurrent and persisted prepare retries without starting (reuse=%s)', async reuse => {
    if (reuse) createEnvironment(db, { projectId: 'p', hostId, path: dir, status: 'ready', workspaceProvisionType: 'unmanaged' });
    const [first, retry] = await Promise.all([createSquadMemberConversation(ctx, member), createSquadMemberConversation(ctx, member)]);
    expect(first).toEqual(retry);
    await expect(createSquadMemberConversation(ctx, member)).resolves.toEqual(first);
    db.close(); db = openDatabase(join(dir, 'db.sqlite')); ctx.db = db;
    await expect(createSquadMemberConversation(ctx, member)).resolves.toEqual(first);
    expect(getConversationThread(db, bindingId)).toMatchObject({ status: 'idle', providerThreadId: null });
    expect(commands.filter(command => command.type === 'environment.provision')).toHaveLength(1);
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
    expect(ctx.plugins!.sessionTools).not.toHaveBeenCalled();
    await expect(createSquadMemberConversation(ctx, { ...member, prompt: 'Changed' })).rejects.toThrow('retry context mismatch');
    await expect(createSquadMemberConversation(ctx, { ...member, generation: 3 })).rejects.toThrow('stale squad member binding generation');
  });

  it('rejects conflicting concurrent prepare retry without any provider start', async () => {
    const first = createSquadMemberConversation(ctx, member);
    await expect(createSquadMemberConversation(ctx, { ...member, title: 'Changed' })).rejects.toThrow('retry context mismatch');
    await first;
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
  });

  it.each(['worker', 'orchestrator'] as const)('activates prepared %s with identical request and attached worktree', async role => {
    mkdirSync(join(dir, 'worktree')); const worktreePath = realpathSync(join(dir, 'worktree'));
    const request = { ...member, role, worktreePath, permissionMode: 'full' as const };
    await createSquadMemberConversation(ctx, request);
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
    expect(await activateSquadMemberConversation(ctx, request)).toEqual({ threadId: bindingId });
    await vi.waitFor(() => expect(getConversationThread(db, bindingId)?.providerThreadId).toBe('native-thread'));
    const thread = getConversationThread(db, bindingId)!;
    const starts = commands.filter(command => command.type === 'thread.start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      threadId: bindingId, projectId: 'p', providerId: 'test-provider', environmentId: thread.environmentId,
      input: [{ type: 'text', text: member.prompt, mentions: [] }], permissionMode: 'full'
    });
    // Host confines explicit cwd or falls back to the attached environment root.
    expect(starts[0].cwd ?? getEnvironment(db, thread.environmentId!)?.path).toBe(worktreePath);
    expect(commands.findIndex(command => command.type === 'environment.provision')).toBeLessThan(commands.findIndex(command => command.type === 'thread.start'));
    expect(ctx.plugins!.sessionTools).toHaveBeenCalledTimes(1);
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: true, providerStarted: true });
    await expect(createSquadMemberConversation(ctx, request)).resolves.toEqual({ threadId: bindingId });
    await expect(activateSquadMemberConversation(ctx, request)).resolves.toEqual({ threadId: bindingId });
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(1);
  });

  it('persists main-authorized skill selection and sends it at activation', async () => {
    const automatedSkillIds = ['zcc:built-in/test'];
    const request = { ...member, automatedSkillIds };
    await createSquadMemberConversation(ctx, request);
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata).toMatchObject({ automatedSkillIds });
    await activateSquadMemberConversation(ctx, request);
    await vi.waitFor(() => expect(commands.find(command => command.type === 'thread.start')).toMatchObject({ automatedSkillIds }));
  });

  it('persists the squad execution id for a member', async () => {
    const executionId = '44444444-4444-4444-8444-444444444444';
    await createSquadMemberConversation(ctx, { ...member, executionId });
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata).toMatchObject({
      squadExecution: executionId
    });
  });

  it('persists and sends an empty automated skill selection by default', async () => {
    await createSquadMemberConversation(ctx, member);
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata).toMatchObject({ automatedSkillIds: [] });
    await activateSquadMemberConversation(ctx, member);
    await vi.waitFor(() => expect(commands.find(command => command.type === 'thread.start')).toMatchObject({ automatedSkillIds: [] }));
  });

  it('persists and sends an explicit empty automated skill selection', async () => {
    const request = { ...member, automatedSkillIds: [] };
    await createSquadMemberConversation(ctx, request);
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata).toMatchObject({ automatedSkillIds: [] });
    await activateSquadMemberConversation(ctx, request);
    await vi.waitFor(() => expect(commands.find(command => command.type === 'thread.start')).toMatchObject({ automatedSkillIds: [] }));
  });

  it('single-flights concurrent activation before async preflight without duplicate starts', async () => {
    await createSquadMemberConversation(ctx, member);
    const preflight = Promise.withResolvers<void>();
    const rpc = vi.mocked(ctx.hostHub.callHostOnlineRpc).getMockImplementation()!;
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockClear().mockImplementation(async input => {
      if (input.command.type === 'provider.status') await preflight.promise;
      return rpc(input);
    });
    const activating = activateSquadMemberConversation(ctx, member);
    const joined = activateSquadMemberConversation(ctx, member);
    try {
      // Nothing durable is written until the send boundary.
      expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadActivationStarted).toBeUndefined();
      expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, providerStarted: false });
      await expect(activateSquadMemberConversation(ctx, { ...member, prompt: 'Changed' })).rejects.toThrow('prepared squad member binding changed or stopped');
      expect(ctx.hostHub.callHostOnlineRpc).toHaveBeenCalledTimes(1);
      expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
    } finally { preflight.resolve(); }
    await expect(activating).resolves.toEqual({ threadId: bindingId });
    await expect(joined).resolves.toEqual({ threadId: bindingId });
    await vi.waitFor(() => expect(getConversationThread(db, bindingId)?.providerThreadId).toBe('native-thread'));
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata).toMatchObject({
      squadActivationStarted: true, squadActivationAccepted: true
    });
    await expect(activateSquadMemberConversation(ctx, member)).resolves.toEqual({ threadId: bindingId });
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(1);
    expect(vi.mocked(ctx.hostHub.callHostOnlineRpc).mock.calls.filter(([input]) => input.command.type === 'provider.status')).toHaveLength(1);
    expect(ctx.plugins!.sessionTools).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['provider unavailable', 'one or more Modern providers are unavailable'],
    ['corrupt policy inventory', 'plugin tool policy inventory is not ready'],
    ['missing plugins', 'plugin tool policy inventory is not ready'],
    ['preflight throws', 'host offline']
  ])('pre-send activation failure leaves binding retryable: %s', async (change, message) => {
    await createSquadMemberConversation(ctx, member);
    const plugins = ctx.plugins;
    const rpc = vi.mocked(ctx.hostHub.callHostOnlineRpc).getMockImplementation()!;
    if (change === 'provider unavailable') {
      vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(async input =>
        input.command.type === 'provider.status' ? { providers: [] } : rpc(input));
    } else if (change === 'preflight throws') {
      vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(async input => {
        if (input.command.type === 'provider.status') throw new Error('host offline');
        return rpc(input);
      });
    } else if (change === 'corrupt policy inventory') {
      vi.mocked(ctx.plugins!.toolPolicyReadiness).mockResolvedValueOnce({
        ready: false, required: [], reason: 'plugin tool policy inventory unavailable: corrupt' });
    } else {
      ctx.plugins = undefined;
    }
    await expect(activateSquadMemberConversation(ctx, member)).rejects.toThrow(message);
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
    expect(plugins!.sessionTools).not.toHaveBeenCalled();
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadActivationStarted).toBeUndefined();
    expect(squadMemberStatus(ctx, control)).toMatchObject({ status: 'idle', live: false, providerStarted: false });
    ctx.plugins = plugins;
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(rpc);
    await expect(activateSquadMemberConversation(ctx, member)).resolves.toEqual({ threadId: bindingId });
    await vi.waitFor(() => expect(getConversationThread(db, bindingId)?.providerThreadId).toBe('native-thread'));
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(1);
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata).toMatchObject({
      squadActivationStarted: true, squadActivationAccepted: true
    });
  });

  it('activation failing after the send boundary stays uncertain and never re-sends', async () => {
    await createSquadMemberConversation(ctx, member);
    const rpc = vi.mocked(ctx.hostHub.callHostOnlineRpc).getMockImplementation()!;
    // Synchronous dispatch failure surfaces only after the durable fence is written.
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(((input: Parameters<typeof rpc>[0]) => {
      if (input.command.type === 'thread.start') throw new Error('dispatch transport failed');
      return rpc(input);
    }) as typeof rpc);
    await expect(activateSquadMemberConversation(ctx, member)).rejects.toThrow('dispatch transport failed');
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadActivationStarted).toBe(true);
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadActivationAccepted).toBeUndefined();
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(rpc).mockClear();
    vi.mocked(ctx.plugins!.sessionTools).mockClear();
    await expect(activateSquadMemberConversation(ctx, member)).rejects.toThrow('squad member activation outcome is uncertain');
    db.close(); db = openDatabase(join(dir, 'db.sqlite')); ctx.db = db;
    await expect(activateSquadMemberConversation(ctx, member)).rejects.toThrow('squad member activation outcome is uncertain');
    expect(ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
    expect(ctx.plugins!.sessionTools).not.toHaveBeenCalled();
  });

  it('persists accepted activation replay across DB reopen without preflight or restart', async () => {
    await createSquadMemberConversation(ctx, member);
    await expect(activateSquadMemberConversation(ctx, member)).resolves.toEqual({ threadId: bindingId });
    await vi.waitFor(() => expect(getConversationThread(db, bindingId)?.providerThreadId).toBe('native-thread'));
    db.close(); db = openDatabase(join(dir, 'db.sqlite')); ctx.db = db;
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata).toMatchObject({
      squadActivationStarted: true, squadActivationAccepted: true
    });
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockClear().mockRejectedValue(new Error('host unavailable'));
    vi.mocked(ctx.plugins!.sessionTools).mockClear();
    await expect(activateSquadMemberConversation(ctx, member)).resolves.toEqual({ threadId: bindingId });
    expect(ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
    expect(ctx.plugins!.sessionTools).not.toHaveBeenCalled();
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(1);
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: true, providerStarted: true });
    await expect(activateSquadMemberConversation(ctx, { ...member, prompt: 'Changed' })).rejects.toThrow('prepared squad member binding changed or stopped');
  });

  it.each([
    [{ generation: 1 }, 'stale squad member binding generation'],
    [{ projectId: 'other' }, 'unknown squad member binding'],
    [{ prompt: 'Changed' }, 'prepared squad member binding changed or stopped'],
    [{ title: 'Changed' }, 'prepared squad member binding changed or stopped'],
    [{ role: 'orchestrator' as const }, 'prepared squad member binding changed or stopped'],
    [{ hostId: '44444444-4444-4444-8444-444444444444' }, 'prepared squad member binding changed or stopped'],
    [{ worktreePath: '/different' }, 'prepared squad member binding changed or stopped']
  ])('rejects stale or mismatched activation request: %j', async (changed, message) => {
    await createSquadMemberConversation(ctx, member);
    await expect(activateSquadMemberConversation(ctx, { ...member, ...changed })).rejects.toThrow(message);
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
    expect(ctx.plugins!.sessionTools).not.toHaveBeenCalled();
    expect(getConversationThread(db, bindingId)).toMatchObject({ status: 'idle', providerThreadId: null });
  });

  it.each(['squadStopRequested', 'squadStopped'] as const)('rejects activation fenced by %s', async fence => {
    await createSquadMemberConversation(ctx, member);
    patchThreadPluginMetadata(db, { threadId: bindingId, pluginId: privateNamespace, set: { [fence]: true }, remove: [] });
    await expect(activateSquadMemberConversation(ctx, member)).rejects.toThrow('prepared squad member binding changed or stopped');
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
    expect(ctx.plugins!.sessionTools).not.toHaveBeenCalled();
  });

  it.each(['host_id', 'path'] as const)('rejects activation after environment %s changes', async column => {
    await createSquadMemberConversation(ctx, member);
    const wrongHost = upsertHost(db, { name: 'wrong', hostKeyHash: 'w'.repeat(64) }).id;
    db.sqlite.prepare(`UPDATE environments SET ${column} = ? WHERE id = ?`).run(
      column === 'host_id' ? wrongHost : join(dir, 'different'), getConversationThread(db, bindingId)!.environmentId
    );
    await expect(activateSquadMemberConversation(ctx, member)).rejects.toThrow('project/environment/host mismatch');
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
    expect(ctx.plugins!.sessionTools).not.toHaveBeenCalled();
  });

  it('binding revalidation failure after async tooling never reaches the provider and stays retryable', async () => {
    await createSquadMemberConversation(ctx, member);
    const tooling = Promise.withResolvers<void>();
    ctx.plugins!.sessionTools = vi.fn(async () => { await tooling.promise; return {}; });
    const activating = activateSquadMemberConversation(ctx, member);
    const rejected = expect(activating).rejects.toThrow('stale squad member binding generation');
    try {
      await vi.waitFor(() => expect(ctx.plugins!.sessionTools).toHaveBeenCalledTimes(1));
      patchThreadPluginMetadata(db, { threadId: bindingId, pluginId: privateNamespace, set: { squadGeneration: 3 }, remove: [] });
    } finally { tooling.resolve(); }
    await rejected;
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
    expect(getConversationThread(db, bindingId)).toMatchObject({ status: 'idle', providerThreadId: null });
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadActivationStarted).toBeUndefined();
    patchThreadPluginMetadata(db, { threadId: bindingId, pluginId: privateNamespace, set: { squadGeneration: 2 }, remove: [] });
    db.close(); db = openDatabase(join(dir, 'db.sqlite')); ctx.db = db;
    ctx.plugins!.sessionTools = vi.fn(async () => ({}));
    await expect(activateSquadMemberConversation(ctx, member)).resolves.toEqual({ threadId: bindingId });
    await vi.waitFor(() => expect(getConversationThread(db, bindingId)?.providerThreadId).toBe('native-thread'));
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(1);
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: true, providerStarted: true });
  });

  it.each([false, true])('stop racing async activation tooling prevents provider start (confirmed=%s)', async confirmed => {
    await createSquadMemberConversation(ctx, member);
    const tooling = Promise.withResolvers<void>();
    ctx.plugins!.sessionTools = vi.fn(async () => { await tooling.promise; return {}; });
    const activating = activateSquadMemberConversation(ctx, member);
    const rejected = expect(activating).rejects.toMatchObject({ code: 'send_cancelled' });
    try {
      await vi.waitFor(() => expect(ctx.plugins!.sessionTools).toHaveBeenCalledTimes(1));
      expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
      if (confirmed) {
        await expect(stopSquadMemberConversation(ctx, control)).resolves.toBe(true);
      } else {
        const rpc = vi.mocked(ctx.hostHub.callHostOnlineRpc).getMockImplementation()!;
        vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(async input => {
          if (input.command.type === 'thread.stop') throw new Error('thread is not running on this host');
          return rpc(input);
        });
        await expect(stopSquadMemberConversation(ctx, control)).rejects.toThrow('thread is not running on this host');
      }
    } finally { tooling.resolve(); }
    await rejected;
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
    expect(getConversationThread(db, bindingId)?.providerThreadId).toBeNull();
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadStopRequested).toBe(true);
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, providerStarted: false, status: confirmed ? 'stopped' : 'stopping' });
    await expect(activateSquadMemberConversation(ctx, member)).rejects.toThrow('prepared squad member binding changed or stopped');
  });

  it('retires member resolution on confirmed stop while durable member state persists', async () => {
    const plain = createConversationThread(db, { projectId: 'p', hostId, providerId: 'test-provider' });
    expect(isSquadMemberThread(ctx, plain.id)).toBe(false);
    expect(isSquadMemberThread(ctx, 'missing-thread')).toBe(false);
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    expect(resolveSquadMember(ctx, bindingId, 'p')).toEqual({ bindingId, generation: 2, role: 'worker' });
    expect(resolveSquadMember(ctx, bindingId, 'other')).toBeUndefined();
    await expect(stopSquadMemberConversation(ctx, control)).resolves.toBe(true);
    expect(resolveSquadMember(ctx, bindingId, 'p')).toBeUndefined();
    expect(isSquadMemberThread(ctx, bindingId)).toBe(true);
    // Private metadata alone (or corrupt metadata) still counts as a former member.
    patchThreadPluginMetadata(db, { threadId: plain.id, pluginId: privateNamespace, set: { squadBinding: plain.id }, remove: [] });
    expect(isSquadMemberThread(ctx, plain.id)).toBe(true);
  });

  it('never adopts unrelated same-project thread', async () => {
    const environment = createEnvironment(db, { projectId: 'p', hostId, path: dir, workspaceProvisionType: 'unmanaged' });
    createConversationThread(db, { id: bindingId, projectId: 'p', hostId, environmentId: environment.id, providerId: 'test-provider' });
    await expect(createSquadMemberConversation(ctx, member)).rejects.toThrow('unknown squad member binding');
    expect(commands).toEqual([]);
  });

  it('refuses renderer-reserved namespace and mismatched authorized context', async () => {
    await expect(createConversationFromRequest(ctx, { projectId: 'p', providerId: 'test-provider', input: ['work'],
      originPluginId: MODERN_SQUAD_BINDING_ORIGIN })).rejects.toMatchObject({ code: 'invalid-authorized-context' });
    await expect(createConversationFromRequest(ctx, { projectId: 'p', providerId: 'test-provider', input: ['work'] },
      { source: 'main-authorized', projectId: 'other' })).rejects.toMatchObject({ code: 'invalid-authorized-context' });
    await expect(createConversationFromRequest(ctx, { projectId: 'p', providerId: 'test-provider', input: ['work'] },
      { source: 'main-authorized', projectId: 'p', hostId: 'wrong' })).rejects.toMatchObject({ code: 'host-workspace-mismatch' });
  });

  it('validates generation, environment and host on status/stop/delivery', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    appendConversationThreadEvent(db, { threadId: bindingId, type: 'item/updated', payload: {} });
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: true, hostOnline: true, eventSequence: expect.any(Number) });
    expect(() => squadMemberStatus(ctx, { ...control, generation: 1 })).toThrow('stale squad member binding generation');
    await expect(stopSquadMemberConversation(ctx, { ...control, generation: 1 })).rejects.toThrow('stale squad member binding generation');
    expect(commands.filter(command => command.type === 'turn.interrupt')).toHaveLength(0);
    expect(commands.filter(command => command.type === 'thread.stop')).toHaveLength(0);
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadStopRequested).toBeUndefined();
    const wrongHost = upsertHost(db, { name: 'wrong', hostKeyHash: 'w'.repeat(64) }).id;
    db.sqlite.prepare('UPDATE environments SET host_id = ? WHERE id = ?').run(wrongHost, getConversationThread(db, bindingId)!.environmentId);
    expect(() => squadMemberStatus(ctx, control)).toThrow('project/environment/host mismatch');
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected' });
  });

  it('reports offline honestly and fences stopped bindings before another delivery', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    ctx.hostHub.connectedHostIds = () => [];
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, hostOnline: false });
    ctx.hostHub.connectedHostIds = () => [hostId];
    await stopSquadMemberConversation(ctx, control);
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopped' });
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected' });
    await expect(createSquadMemberConversation(ctx, member)).rejects.toThrow('reserve a new binding');
  });

  it.each([
    ['host stop rejected', 'provider_error'],
    ['host rpc timed out: thread.stop', 'host-unavailable'],
    ['thread is not running on this host', 'unknown_thread']
  ])(
    'retains stopping after %s without confirming cancellation', async (message, code) => {
      await createSquadMemberConversation(ctx, member);
      await activateSquadMemberConversation(ctx, member);
      const failure = Object.assign(new Error(message), { code });
      vi.mocked(ctx.hostHub.callHostOnlineRpc).mockRejectedValue(failure);
      await expect(stopSquadMemberConversation(ctx, control)).rejects.toBe(failure);
      expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata).toMatchObject({ squadStopRequested: true });
      expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadStopped).toBeUndefined();
      expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopping' });
      expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected' });
      expect(ctx.plugins!.admitDispatch).not.toHaveBeenCalled();
      expect(listDeferredThreadMessages(db, bindingId)).toHaveLength(0);
      db.close(); db = openDatabase(join(dir, 'db.sqlite')); ctx.db = db;
      expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopping' });
      expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected' });
    }
  );

  it('confirms only completed exact host stop and dedupes confirmed retries', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    let confirm!: (result: unknown) => void;
    const pending = new Promise(resolve => { confirm = resolve; });
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(async ({ command }) => {
      expect(command).toEqual({ type: 'thread.stop', threadId: bindingId });
      expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadStopRequested).toBe(true);
      return pending;
    });
    const stopping = stopSquadMemberConversation(ctx, control);
    await vi.waitFor(() => expect(ctx.hostHub.callHostOnlineRpc).toHaveBeenLastCalledWith({
      hostId, command: { type: 'thread.stop', threadId: bindingId }
    }));
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopping' });
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadStopped).toBeUndefined();
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected' });
    expect(ctx.plugins!.admitDispatch).not.toHaveBeenCalled();
    confirm({ threadId: bindingId, stopped: true });
    await expect(stopping).resolves.toBe(true);
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopped' });
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadStopped).toBe(true);
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockClear();
    await expect(stopSquadMemberConversation(ctx, control)).resolves.toBe(true);
    expect(ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it.each([undefined, { accepted: true }, { threadId: bindingId, stopped: false },
    { threadId: '44444444-4444-4444-8444-444444444444', stopped: true }])(
    'rejects missing or mismatched host stop evidence: %j', async confirmation => {
      await createSquadMemberConversation(ctx, member);
      await activateSquadMemberConversation(ctx, member);
      vi.mocked(ctx.hostHub.callHostOnlineRpc).mockResolvedValue(confirmation);
      await expect(stopSquadMemberConversation(ctx, control)).rejects.toThrow('squad member host stop was not confirmed');
      expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopping' });
      expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadStopped).toBeUndefined();
    }
  );

  it('does not confirm archived or missing bindings as stopped', async () => {
    await expect(stopSquadMemberConversation(ctx, control)).rejects.toThrow('unknown squad member binding');
    expect(ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
    await createSquadMemberConversation(ctx, member);
    db.sqlite.prepare('UPDATE threads SET archived_at = ? WHERE id = ?').run(Date.now(), bindingId);
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopping' });
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadStopped).toBeUndefined();
  });

  it('revalidates generation after host stop before persisting confirmation', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(async () => {
      patchThreadPluginMetadata(db, { threadId: bindingId, pluginId: privateNamespace,
        set: { squadGeneration: 3 }, remove: [] });
      return { threadId: bindingId, stopped: true };
    });
    await expect(stopSquadMemberConversation(ctx, control)).rejects.toThrow('stale squad member binding generation');
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadStopped).toBeUndefined();
    expect(squadMemberStatus(ctx, { ...control, generation: 3 })).toMatchObject({ live: false, status: 'stopping' });
  });

  it.each(['idle', 'error'] as const)('retains stopping when best-effort %s stop fails', async status => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    db.sqlite.prepare('UPDATE threads SET status = ? WHERE id = ?').run(status, bindingId);
    const failure = Object.assign(new Error('host rpc timed out: thread.stop'), { code: 'host-unavailable' });
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockRejectedValue(failure);
    await expect(stopSquadMemberConversation(ctx, control)).rejects.toBe(failure);
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopping' });
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadStopped).toBeUndefined();
  });

  it('allows retry after uncertain stop but never resends previous delivery receipts', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    await deliverSquadMemberConversation(ctx, delivery);
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockRejectedValue(new Error('host stop rejected'));
    await expect(stopSquadMemberConversation(ctx, control)).rejects.toThrow('host stop rejected');
    ctx.plugins!.admitDispatch = vi.fn(async () => ({ action: 'proceed' }));
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'accepted' });
    expect(await deliverSquadMemberConversation(ctx, { ...delivery, idempotencyKey: 'new' })).toMatchObject({ state: 'rejected' });
    expect(ctx.plugins!.admitDispatch).not.toHaveBeenCalled();
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockResolvedValue({ threadId: bindingId, stopped: true });
    await expect(stopSquadMemberConversation(ctx, control)).resolves.toBe(true);
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopped' });
  });

  it('cancels in-flight delivery admission even when host stop fails', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    const admission = Promise.withResolvers<void>();
    ctx.plugins!.admitDispatch = vi.fn(async () => {
      await admission.promise;
      return { action: 'proceed' };
    });
    const sending = deliverSquadMemberConversation(ctx, delivery);
    await vi.waitFor(() => expect(ctx.plugins!.admitDispatch).toHaveBeenCalled());
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockRejectedValue(new Error('host stop rejected'));
    await expect(stopSquadMemberConversation(ctx, control)).rejects.toThrow('host stop rejected');
    admission.resolve();
    expect(await sending).toMatchObject({ state: 'uncertain' });
    expect(listDeferredThreadMessages(db, bindingId)).toHaveLength(0);
    expect(commands.filter(command => ['thread.resume', 'turn.submit'].includes(command.type))).toHaveLength(0);
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopping' });
  });

  it.each([false, true])('cancels pending provisioning even when host stop is uncertain (reuse=%s)', async reuse => {
    if (reuse) createEnvironment(db, { projectId: 'p', hostId, path: dir, status: 'ready', workspaceProvisionType: 'unmanaged' });
    const provision = Promise.withResolvers<unknown>();
    const rpc = vi.mocked(ctx.hostHub.callHostOnlineRpc).getMockImplementation()!;
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(async input => {
      if (input.command.type === 'environment.provision') return provision.promise;
      if (input.command.type === 'thread.stop') throw new Error('thread is not running on this host');
      return rpc(input);
    });
    const creating = createSquadMemberConversation(ctx, member).catch(error => error);
    await vi.waitFor(() => expect(ctx.hostHub.callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ type: 'environment.provision' })
    })));
    await expect(stopSquadMemberConversation(ctx, control)).rejects.toThrow('thread is not running on this host');
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopping' });
    provision.resolve({ path: dir, isGitRepo: false, isWorktree: false });
    expect(await creating).toMatchObject({ code: 'send_cancelled' });
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
    expect(getThreadPluginMetadata(db, bindingId, privateNamespace).metadata.squadStopped).toBeUndefined();
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopping' });
  });

  it('durably dedupes delivery and rejects changed assignment correlation', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    const accepted = await deliverSquadMemberConversation(ctx, delivery);
    expect(accepted).toEqual({ ...control, assignmentId: delivery.assignmentId, idempotencyKey: delivery.idempotencyKey, state: 'accepted' });
    expect(await deliverSquadMemberConversation(ctx, delivery)).toEqual(accepted);
    expect(listDeferredThreadMessages(db, bindingId)).toHaveLength(1);
    expect(await deliverSquadMemberConversation(ctx, { ...delivery, assignmentId: 'different' })).toMatchObject({ state: 'rejected' });
    expect(await deliverSquadMemberConversation(ctx, { ...delivery, generation: 1 })).toMatchObject({ state: 'rejected' });
  });

  it('retains uncertain durable receipt across retry after ambiguous failure', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    ctx.pendingInteractions.hasPendingThreadInteraction = () => { throw new Error('ambiguous'); };
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'uncertain' });
    ctx.plugins!.admitDispatch = vi.fn(async () => ({ action: 'proceed' }));
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'uncertain' });
    expect(ctx.plugins!.admitDispatch).not.toHaveBeenCalled();
  });

  it('renderer metadata edits cannot change generation, stop fence or delivery dedupe', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    await deliverSquadMemberConversation(ctx, delivery);
    updateConversationPluginMetadata(db, { threadId: bindingId, pluginId: MODERN_SQUAD_BINDING_ORIGIN,
      set: { squadGeneration: 3 }, remove: ['squadBinding'] });
    expect(squadMemberStatus(ctx, control)).toMatchObject({ generation: 2 });
    expect(() => squadMemberStatus(ctx, { ...control, generation: 3 })).toThrow('stale');
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'accepted' });
    expect(listDeferredThreadMessages(db, bindingId)).toHaveLength(1);
  });

  it('records definitive dispatch rejection', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    ctx.plugins!.admitDispatch = vi.fn(async () => ({ action: 'reject', message: 'No' }));
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected' });
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected' });
    expect(listDeferredThreadMessages(db, bindingId)).toHaveLength(0);
    expect(completeSquadMemberDelivery(ctx, completion)).toMatchObject({ state: 'rejected' });
  });

  it('private namespace cannot be read, patched or pre-populated through public schemas', () => {
    expect(threadPluginMetadataQuerySchema.safeParse({ pluginId: privateNamespace }).success).toBe(false);
    expect(updateThreadPluginMetadataRequestSchema.safeParse({ pluginId: privateNamespace, set: { squadGeneration: 3 } }).success).toBe(false);
  });

  it('retains binding, receipt and stop fence through transcript rewind and DB restart', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    await deliverSquadMemberConversation(ctx, delivery);
    deleteConversationThreadEventsAfter(db, bindingId, 0);
    db.close(); db = openDatabase(join(dir, 'db.sqlite')); ctx.db = db;
    await expect(createSquadMemberConversation(ctx, member)).resolves.toEqual({ threadId: bindingId });
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'accepted' });
    expect(listDeferredThreadMessages(db, bindingId)).toHaveLength(1);
    expect(completeSquadMemberDelivery(ctx, completion)).toMatchObject({ state: 'completed' });
    await stopSquadMemberConversation(ctx, control);
    updateConversationPluginMetadata(db, { threadId: bindingId, pluginId: MODERN_SQUAD_BINDING_ORIGIN,
      set: { squadStopped: false }, remove: [] });
    deleteConversationThreadEventsAfter(db, bindingId, 0);
    db.close(); db = openDatabase(join(dir, 'db.sqlite')); ctx.db = db;
    expect(squadMemberStatus(ctx, control)).toMatchObject({ live: false, status: 'stopped', eventSequence: 0 });
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'completed' });
    expect(await deliverSquadMemberConversation(ctx, { ...delivery, idempotencyKey: 'new' })).toMatchObject({ state: 'rejected' });
  });

  it('completes only correlated admitted or uncertain receipts and never infers completion from idle', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    expect(completeSquadMemberDelivery(ctx, completion)).toMatchObject({ state: 'rejected' });
    await deliverSquadMemberConversation(ctx, delivery);
    db.sqlite.prepare("UPDATE threads SET status = 'idle' WHERE id = ?").run(bindingId);
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'accepted' });
    expect(completeSquadMemberDelivery(ctx, { ...completion, assignmentId: 'wrong' })).toMatchObject({ state: 'rejected' });
    expect(completeSquadMemberDelivery(ctx, { ...completion, idempotencyKey: 'wrong' })).toMatchObject({ state: 'rejected' });
    expect(() => completeSquadMemberDelivery(ctx, { ...completion, generation: 1 })).toThrow('stale');
    expect(completeSquadMemberDelivery(ctx, completion)).toMatchObject({ state: 'completed' });
    expect(completeSquadMemberDelivery(ctx, completion)).toMatchObject({ state: 'completed' });
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'completed' });
    expect(await deliverSquadMemberConversation(ctx, { ...delivery, message: 'changed' })).toMatchObject({ state: 'rejected' });
  });

  it.each(['proceed', 'reject', 'error'] as const)('completion wins over late %s send admission', async action => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    ctx.plugins!.admitDispatch = vi.fn(async () => {
      await pending;
      if (action === 'error') throw new Error('ambiguous');
      return action === 'reject' ? { action: 'reject', message: 'No' } : { action: 'proceed' };
    });
    const sending = deliverSquadMemberConversation(ctx, delivery);
    await vi.waitFor(() => expect(ctx.plugins!.admitDispatch).toHaveBeenCalled());
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'uncertain' });
    expect(completeSquadMemberDelivery(ctx, completion)).toMatchObject({ state: 'completed' });
    release();
    expect(await sending).toMatchObject({ state: 'completed' });
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'completed' });
    expect(ctx.plugins!.admitDispatch).toHaveBeenCalledTimes(1);
  });

  it('caps receipts without eviction or re-sending existing assignments', async () => {
    await createSquadMemberConversation(ctx, member);
    await activateSquadMemberConversation(ctx, member);
    ctx.plugins!.admitDispatch = vi.fn(async () => ({ action: 'reject', message: 'No' }));
    for (let i = 0; i < 128; i++) {
      expect(await deliverSquadMemberConversation(ctx, { ...delivery, idempotencyKey: `key-${i}` })).toMatchObject({ state: 'rejected', reason: 'dispatch rejected' });
    }
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected', reason: 'squad delivery receipt capacity reached' });
    expect(await deliverSquadMemberConversation(ctx, { ...delivery, idempotencyKey: 'key-0' })).toMatchObject({ state: 'rejected' });
    expect(ctx.plugins!.admitDispatch).toHaveBeenCalledTimes(128);
  });

  it('rejects missing or corrupt private binding and malformed receipts instead of re-sending', async () => {
    await createSquadMemberConversation(ctx, member);
    const metadata = getThreadPluginMetadata(db, bindingId, privateNamespace).metadata;
    patchThreadPluginMetadata(db, { threadId: bindingId, pluginId: privateNamespace, set: { [receiptKey]: 'broken' }, remove: [] });
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected', reason: 'invalid delivery receipt' });
    expect(completeSquadMemberDelivery(ctx, completion)).toMatchObject({ state: 'rejected' });
    expect(ctx.plugins!.admitDispatch).not.toHaveBeenCalled();
    db.sqlite.prepare('UPDATE thread_plugin_metadata SET metadata_json = ? WHERE thread_id = ? AND plugin_id = ?').run('broken', bindingId, privateNamespace);
    expect(() => squadMemberStatus(ctx, control)).toThrow('unknown squad member binding');
    db.sqlite.prepare('DELETE FROM thread_plugin_metadata WHERE thread_id = ? AND plugin_id = ?').run(bindingId, privateNamespace);
    expect(() => squadMemberStatus(ctx, control)).toThrow('unknown squad member binding');
    patchThreadPluginMetadata(db, { threadId: bindingId, pluginId: privateNamespace, set: metadata, remove: [] });
    ctx.toProjects = () => [];
    expect(() => squadMemberStatus(ctx, control)).toThrow('project/environment/host mismatch');
  });

  it('rolls back thread creation when trusted binding hook fails in new or reused environment', async () => {
    const input = { id: bindingId, projectId: 'p', providerId: 'test-provider', input: ['work'] };
    const context = { source: 'main-authorized' as const, projectId: 'p', onCreated: () => { throw new Error('binding failed'); } };
    await expect(createConversationFromRequest(ctx, input, context)).rejects.toThrow('binding failed');
    expect(getConversationThread(db, bindingId)).toBeNull();
    createEnvironment(db, { projectId: 'p', hostId, path: dir, workspaceProvisionType: 'unmanaged' });
    await expect(createConversationFromRequest(ctx, input, context)).rejects.toThrow('binding failed');
    expect(getConversationThread(db, bindingId)).toBeNull();
    expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
  });
});

describe('Modern runtime preflight', () => {
  it('reports registered host providers and refuses unknown provider, missing plugins and required native policy', async () => {
    expect(await preflightSquadRuntime(ctx, { projectId: 'p', providerIds: ['test-provider'] })).toMatchObject({ ready: true, policyInventoryReady: true });
    expect(await preflightSquadRuntime(ctx, { projectId: 'p', providerIds: ['missing'] })).toMatchObject({ ready: false, providers: [{ available: false }] });
    expect(await preflightSquadRuntime(ctx, { projectId: 'p', providerIds: ['test-provider'], nativeToolPolicyRequired: true })).toMatchObject({
      ready: false, nativeToolPolicyWired: false, reason: 'Modern provider-native tool policy is not wired'
    });
    await expect(createSquadMemberConversation(ctx, { ...member, nativeToolPolicyRequired: true })).rejects.toThrow('not wired');
    ctx.plugins = undefined;
    expect(await preflightSquadRuntime(ctx, { projectId: 'p', providerIds: ['test-provider'] })).toMatchObject({ ready: false, policyInventoryReady: false });
  });

  it('refuses corrupt inventory and unknown policy classification without fallback', async () => {
    const readiness = vi.mocked(ctx.plugins!.toolPolicyReadiness);
    readiness.mockResolvedValueOnce({ ready: false, required: [], reason: 'plugin tool policy inventory unavailable: broken' });
    expect(await preflightSquadRuntime(ctx, { projectId: 'p', providerIds: ['test-provider'] })).toMatchObject({ ready: false, policyInventoryReady: false });
    readiness.mockResolvedValueOnce({ ready: false, required: [{ pluginId: 'policy', toolPolicy: 'unknown', status: 'running', sealed: false }],
      reason: 'policy (unknown, running, unsealed)' });
    expect(await preflightSquadRuntime(ctx, { projectId: 'p', providerIds: ['test-provider'] })).toMatchObject({ ready: false, policyInventoryReady: false, nativeToolPolicyRequired: true });
  });

  it('surfaces the plugin service reason and never reads installed.json itself', async () => {
    mkdirSync(join(dir, 'plugins'));
    writeFileSync(join(dir, 'plugins', 'installed.json'), 'broken');
    expect(await preflightSquadRuntime(ctx, { projectId: 'p', providerIds: ['test-provider'] })).toMatchObject({ ready: true, policyInventoryReady: true });
    vi.mocked(ctx.plugins!.toolPolicyReadiness).mockResolvedValueOnce({ ready: false, required: [], reason: 'plugin service is stopped' });
    expect(await preflightSquadRuntime(ctx, { projectId: 'p', providerIds: ['test-provider'] })).toMatchObject({
      ready: false, policyInventoryReady: false, reason: 'plugin tool policy inventory is not ready: plugin service is stopped'
    });
    ctx.plugins = undefined;
    expect(await preflightSquadRuntime(ctx, { projectId: 'p', providerIds: ['test-provider'] })).toMatchObject({
      ready: false, policyInventoryReady: false, reason: 'plugin tool policy inventory is not ready: plugin service is unavailable'
    });
  });

  it('refuses removed known inventory and unavailable host provider', async () => {
    vi.mocked(ctx.plugins!.toolPolicyReadiness).mockResolvedValueOnce({
      ready: false, required: [], reason: 'plugin tool policy inventory unavailable: plugin registry missing after it existed' });
    expect(await preflightSquadRuntime(ctx, { projectId: 'p', providerIds: ['test-provider'] })).toMatchObject({ ready: false, policyInventoryReady: false });
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockResolvedValue({ providers: [] });
    expect(await preflightSquadRuntime(ctx, { projectId: 'p', providerIds: ['test-provider'] })).toMatchObject({ ready: false, providers: [{ available: false }] });
  });
});

describe('authenticated main HTTP seam', () => {
  it('allows signed operations only, rejects browser, replay, wrong proof, malformed and oversized input', async () => {
    const secret = 's'.repeat(64);
    ctx.verifyNativeToolPolicy = createNativeToolPolicyVerifier(secret);
    const server = createServer((req, res) => { void handleMainSquadRuntimeHttp(req, res, ctx).then(handled => { if (!handled) res.writeHead(404).end(); }); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${SQUAD_RUNTIME_OPERATION_PATH}`;
    const post = (body: string, proof?: string, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json',
      ...(proof ? { 'x-zcc-native-tool-policy-proof': proof } : {}), ...headers }, body });
    try {
      const body = JSON.stringify({ operation: 'squad-member-create', request: member });
      const proof = signNativeToolPolicyRequest(secret, body);
      expect((await post(body)).status).toBe(403);
      expect((await post(body, signNativeToolPolicyRequest('w'.repeat(64), body))).status).toBe(403);
      expect((await post(body, proof, { origin: 'http://127.0.0.1' })).status).toBe(403);
      expect(await (await post(body, proof)).json()).toEqual({ value: { threadId: bindingId } });
      expect(getConversationThread(db, bindingId)).toMatchObject({ status: 'idle', providerThreadId: null });
      expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(0);
      expect((await post(body, proof)).status).toBe(403);
      expect((await fetch(url)).status).toBe(405);
      const operations = [
        { operation: 'squad-runtime-preflight', request: { projectId: 'p', providerIds: ['test-provider'] } },
        { operation: 'squad-member-activate', request: member },
        { operation: 'squad-member-status', request: control },
        { operation: 'squad-member-deliver', request: delivery },
        { operation: 'squad-member-delivery-complete', request: completion },
        { operation: 'squad-member-stop', request: control }
      ];
      for (const operation of operations) {
        const body = JSON.stringify(operation);
        const response = await post(body, signNativeToolPolicyRequest(secret, body));
        expect(response.status).toBe(200);
        if (operation.operation === 'squad-member-activate') {
          expect(await response.json()).toEqual({ value: { threadId: bindingId } });
          expect(commands.filter(command => command.type === 'thread.start')).toHaveLength(1);
        }
        if (operation.operation === 'squad-member-delivery-complete') expect(await response.json()).toMatchObject({ value: { state: 'completed' } });
      }
      for (const body of ['{', '{}', JSON.stringify({ operation: 'squad-member-stop', request: { ...control, generation: 1 } })]) {
        const response = await post(body, signNativeToolPolicyRequest(secret, body));
        expect(response.status).toBe(body.includes('squad-member-stop') ? 409 : 400);
      }
      const oversized = 'x'.repeat(512 * 1024 + 1);
      expect((await post(oversized, signNativeToolPolicyRequest(secret, oversized))).status).toBe(413);
      ctx.verifyNativeToolPolicy = undefined;
      expect((await post(body, signNativeToolPolicyRequest(secret, body))).status).toBe(403);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

describe('enrolled Modern provider integration', () => {
  it('genuinely launches worker and orchestrator provider processes with trusted worktree and signed main transport', async () => {
    vi.stubEnv('ZCC_FAKE_PROVIDER', '1');
    const home = join(dir, 'isolated-host'); mkdirSync(home);
    const projectPath = join(home, 'project'); mkdirSync(projectPath);
    const worktreePath = realpathSync(join(home, 'project'));
    const secret = 'm'.repeat(64);
    let product: Awaited<ReturnType<typeof startProductServer>> | undefined;
    let connection: ReturnType<typeof startEnrolledHostConnection> | undefined;
    try {
      product = await startProductServer({ dataDir: join(home, 'product-data'), uiSendSecret: secret, origins: { serverPort: 0 },
        fallback: (req, res) => handleMainSquadRuntimeHttp(req, res, product!.ctx) });
      const enrolled = await enrollDaemonHost({ serverUrl: product.url, token: product.ctx.enrollToken, hostId: randomUUID(),
        instanceId: randomUUID(), hostName: 'Squad fixture host' });
      connection = startEnrolledHostConnection({ serverUrl: product.url, hostId: enrolled.hostId, hostKey: enrolled.hostKey,
        dataDir: join(home, 'host-data') });
      await connection.ready;
      const project = await product.ctx.projects.add(projectPath, { hostId: enrolled.hostId });
      product.ctx.plugins = { get: () => undefined, toolPolicyReadiness: async () => ({ ready: true, required: [] }), sessionTools: async () => ({}), emitThreadEvent: async () => {},
        admitDispatch: async () => ({ action: 'proceed' }) } as unknown as ProductHttpContext['plugins'];
      for (const role of ['worker', 'orchestrator'] as const) {
        const request = { ...member, bindingId: randomUUID(), projectId: project.id, hostId: enrolled.hostId,
          providerId: 'fake', role, worktreePath, prompt: `Respond ${role} fixture`, permissionMode: 'full' as const };
        const body = JSON.stringify({ operation: 'squad-member-create', request });
        const response = await fetch(new URL(SQUAD_RUNTIME_OPERATION_PATH, product.url), { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-zcc-native-tool-policy-proof': signNativeToolPolicyRequest(secret, body) }, body });
        const result = await response.json();
        expect(response.status, JSON.stringify(result)).toBe(200);
        expect(result).toEqual({ value: { threadId: request.bindingId } });
        expect(getConversationThread(product.ctx.db, request.bindingId)).toMatchObject({ status: 'idle', providerThreadId: null });
        expect(squadMemberStatus(product.ctx, { bindingId: request.bindingId, projectId: project.id, generation: 2 })).toMatchObject({ providerStarted: false });
        const activationBody = JSON.stringify({ operation: 'squad-member-activate', request });
        const activated = await fetch(new URL(SQUAD_RUNTIME_OPERATION_PATH, product.url), { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-zcc-native-tool-policy-proof': signNativeToolPolicyRequest(secret, activationBody) }, body: activationBody });
        const activationResult = await activated.json();
        expect(activated.status, JSON.stringify(activationResult)).toBe(200);
        expect(activationResult).toEqual({ value: { threadId: request.bindingId } });
        await vi.waitFor(() => expect(getConversationThread(product!.ctx.db, request.bindingId)).toMatchObject({ status: 'idle', providerThreadId: expect.any(String) }), { timeout: 20_000 });
        const thread = getConversationThread(product.ctx.db, request.bindingId)!;
        expect(getEnvironment(product.ctx.db, thread.environmentId!)?.path).toBe(worktreePath);
        expect(squadMemberStatus(product.ctx, { bindingId: request.bindingId, projectId: project.id, generation: 2 })).toMatchObject({ providerStarted: true, live: true });
        const control = { bindingId: request.bindingId, projectId: project.id, generation: 2 };
        await expect(stopSquadMemberConversation(product.ctx, control)).resolves.toBe(true);
        expect(squadMemberStatus(product.ctx, control)).toMatchObject({ live: false, status: 'stopped' });
      }
    } finally {
      await connection?.close(); await product?.close(); vi.unstubAllEnvs();
    }
  }, 60_000);
});
