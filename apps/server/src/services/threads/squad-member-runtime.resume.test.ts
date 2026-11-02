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
  isSquadMemberThread, resolveSquadMember, resumeSquadMemberConversation
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
let startResult: Record<string, unknown>;
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
  startResult = { providerThreadId: 'native-thread' };
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
        if (command.type === 'thread.start') return startResult;
        if (command.type === 'thread.stop') return { threadId: bindingId, stopped: true };
        return { accepted: true };
      }) }
  } as unknown as ProductHttpContext;
});
afterEach(() => { unregister(); db.close(); rmSync(dir, { recursive: true, force: true }); });


const resumeRequest = { bindingId, projectId: 'p', expectedGeneration: 2, newGeneration: 3, expectedProviderThreadId: 'native-thread' };
const meta = () => getThreadPluginMetadata(db, bindingId, privateNamespace).metadata;
let resumeResult: Record<string, unknown>;
let worktreePath: string;

async function stoppedMember() {
  mkdirSync(join(dir, 'worktree')); worktreePath = realpathSync(join(dir, 'worktree'));
  await createSquadMemberConversation(ctx, { ...member, worktreePath });
  await activateSquadMemberConversation(ctx, { ...member, worktreePath });
  await stopSquadMemberConversation(ctx, control);
}
const resumeCommands = () => commands.filter(command => command.type === 'thread.resume');
const stopCommands = () => commands.filter(command => command.type === 'thread.stop');

describe('Modern member resume', () => {
  beforeEach(() => {
    resumeResult = { threadId: bindingId, providerThreadId: 'native-thread', nativeLoaded: true };
    const base = vi.mocked(ctx.hostHub.callHostOnlineRpc).getMockImplementation()!;
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(async input => {
      if (input.command.type === 'thread.resume') { commands.push(input.command); return resumeResult; }
      return base(input);
    });
  });

  it('resumes a confirmed-stopped member with ONE metadata write, bumps generation and fences the old one', async () => {
    await stoppedMember();
    expect(meta()).toMatchObject({ squadStopped: true, squadStopRequested: true, squadGeneration: 2 });
    const result = await resumeSquadMemberConversation(ctx, resumeRequest);
    expect(result).toEqual({ bindingId, projectId: 'p', generation: 3, providerThreadId: 'native-thread' });
    expect(resumeCommands()).toHaveLength(1);
    expect(resumeCommands()[0]).toMatchObject({ requireNativeLoad: true, providerThreadId: 'native-thread' });
    expect(meta()).toMatchObject({ squadStopped: false, squadStopRequested: false, squadGeneration: 3, squadActivationAccepted: true });
    expect(meta().squadResumeStarted).toBeUndefined();
    expect(meta().squadResumeFailed).toBeUndefined();
    // stale generation is rejected; new generation delivers
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected', reason: 'stale squad member binding generation' });
    expect(await deliverSquadMemberConversation(ctx, { ...delivery, generation: 3, idempotencyKey: 'resume-key' })).toMatchObject({ state: 'accepted' });
    expect(resolveSquadMember(ctx, bindingId, 'p')).toMatchObject({ bindingId, generation: 3 });
  });

  it('keeps stop flags set (deliveries rejected) for the whole resume window', async () => {
    await stoppedMember();
    const gate = Promise.withResolvers<void>();
    const impl = vi.mocked(ctx.hostHub.callHostOnlineRpc).getMockImplementation()!;
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(async input => {
      if (input.command.type === 'thread.resume') await gate.promise;
      return impl(input);
    });
    const resuming = resumeSquadMemberConversation(ctx, resumeRequest);
    await vi.waitFor(() => expect(meta().squadResumeStarted).toBe(3));
    expect(meta()).toMatchObject({ squadStopped: true, squadStopRequested: true, squadGeneration: 2 });
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected', reason: 'squad member is stopped' });
    expect(resolveSquadMember(ctx, bindingId, 'p')).toBeUndefined();
    gate.resolve();
    await resuming;
    expect(meta().squadStopped).toBe(false);
  });

  it('joins a concurrent resume with one host load and rejects a conflicting one', async () => {
    await stoppedMember();
    const [a, b] = [resumeSquadMemberConversation(ctx, resumeRequest), resumeSquadMemberConversation(ctx, resumeRequest)];
    await expect(resumeSquadMemberConversation(ctx, { ...resumeRequest, newGeneration: 4 })).rejects.toThrow('STALE_BINDING');
    expect(await a).toEqual(await b);
    expect(resumeCommands()).toHaveLength(1);
  });

  it.each([
    ['generation mismatch', { expectedGeneration: 1, newGeneration: 2 }, 'STALE_BINDING'],
    ['non-consecutive new generation', { newGeneration: 5 }, 'STALE_BINDING'],
    ['provider thread id mismatch', { expectedProviderThreadId: 'other' }, 'NOT_RESUMABLE']
  ])('refuses %s without touching the host', async (_name, patch, code) => {
    await stoppedMember();
    await expect(resumeSquadMemberConversation(ctx, { ...resumeRequest, ...patch })).rejects.toThrow(code);
    expect(resumeCommands()).toHaveLength(0);
    expect(meta().squadStopped).toBe(true);
    expect(meta().squadResumeStarted).toBeUndefined();
  });

  it('refuses a member that is not stopped, archived, or unknown', async () => {
    mkdirSync(join(dir, 'worktree')); worktreePath = realpathSync(join(dir, 'worktree'));
    await createSquadMemberConversation(ctx, { ...member, worktreePath });
    await activateSquadMemberConversation(ctx, { ...member, worktreePath });
    await expect(resumeSquadMemberConversation(ctx, resumeRequest)).rejects.toThrow('NOT_RESUMABLE: squad member is not stopped');
    await stopSquadMemberConversation(ctx, control);
    db.sqlite.prepare('UPDATE threads SET archived_at = ? WHERE id = ?').run(Date.now(), bindingId);
    await expect(resumeSquadMemberConversation(ctx, resumeRequest)).rejects.toThrow('NOT_RESUMABLE');
    await expect(resumeSquadMemberConversation(ctx, { ...resumeRequest, bindingId: randomUUID() })).rejects.toThrow('STALE_BINDING');
    expect(resumeCommands()).toHaveLength(0);
  });

  it('fails WORKTREE_MISSING before any host call or metadata write', async () => {
    await stoppedMember();
    rmSync(worktreePath, { recursive: true, force: true });
    await expect(resumeSquadMemberConversation(ctx, resumeRequest)).rejects.toThrow('WORKTREE_MISSING');
    expect(resumeCommands()).toHaveLength(0);
    expect(meta().squadResumeStarted).toBeUndefined();
    expect(meta().squadStopped).toBe(true);
  });

  it.each([
    ['nativeLoaded false', { threadId: bindingId, providerThreadId: 'native-thread', nativeLoaded: false }, 'native_load_unconfirmed'],
    ['nativeLoaded missing', { threadId: bindingId, providerThreadId: 'native-thread' }, 'native_load_unconfirmed'],
    ['replacement provider thread', { threadId: bindingId, providerThreadId: 'fresh', nativeLoaded: true }, 'provider_thread_mismatch']
  ])('re-retires and stops the host thread on %s', async (_name, result, code) => {
    await stoppedMember();
    resumeResult = result;
    const before = stopCommands().length;
    await expect(resumeSquadMemberConversation(ctx, resumeRequest)).rejects.toThrow(code);
    expect(stopCommands().length).toBe(before + 1);
    expect(meta()).toMatchObject({ squadStopped: true, squadStopRequested: true, squadGeneration: 2, squadResumeFailed: code, squadResumeStarted: 3 });
    expect(await deliverSquadMemberConversation(ctx, delivery)).toMatchObject({ state: 'rejected' });
  });

  it('re-retires on a host RPC failure and still tolerates a failing best-effort stop', async () => {
    await stoppedMember();
    const impl = vi.mocked(ctx.hostHub.callHostOnlineRpc).getMockImplementation()!;
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(async input => {
      if (input.command.type === 'thread.resume' || input.command.type === 'thread.stop') throw new Error('host down');
      return impl(input);
    });
    await expect(resumeSquadMemberConversation(ctx, resumeRequest)).rejects.toThrow('RESUME_FAILED');
    expect(meta()).toMatchObject({ squadStopped: true, squadResumeFailed: 'RESUME_FAILED' });
  });

  it('retries idempotently after a crash recorded squadResumeStarted: stops the host thread first', async () => {
    await stoppedMember();
    patchThreadPluginMetadata(db, { threadId: bindingId, pluginId: privateNamespace, set: { squadResumeStarted: 3 }, remove: [] });
    const before = stopCommands().length;
    await expect(resumeSquadMemberConversation(ctx, resumeRequest)).resolves.toMatchObject({ generation: 3 });
    expect(stopCommands().length).toBe(before + 1);
    const order = commands.map(command => command.type);
    expect(order.lastIndexOf('thread.stop')).toBeLessThan(order.lastIndexOf('thread.resume'));
    expect(meta().squadResumeStarted).toBeUndefined();
    expect(meta().squadGeneration).toBe(3);
  });

  it('refuses a recorded resume toward a different generation', async () => {
    await stoppedMember();
    patchThreadPluginMetadata(db, { threadId: bindingId, pluginId: privateNamespace, set: { squadResumeStarted: 9 }, remove: [] });
    await expect(resumeSquadMemberConversation(ctx, resumeRequest)).rejects.toThrow('STALE_BINDING');
    expect(resumeCommands()).toHaveLength(0);
  });

  it('stop during an in-flight resume cancels it: host stopped, member stays retired, no un-retire at commit', async () => {
    await stoppedMember();
    const gate = Promise.withResolvers<void>();
    const impl = vi.mocked(ctx.hostHub.callHostOnlineRpc).getMockImplementation()!;
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(async input => {
      if (input.command.type === 'thread.resume') await gate.promise;
      return impl(input);
    });
    const resuming = resumeSquadMemberConversation(ctx, resumeRequest);
    const outcome = resuming.then(() => 'resolved', (error: Error) => error.message);
    await vi.waitFor(() => expect(meta().squadResumeStarted).toBe(3));
    const stopsBefore = stopCommands().length;
    await expect(stopSquadMemberConversation(ctx, control)).resolves.toBe(true);
    expect(meta().squadResumeCancelled).toBe(3);
    expect(stopCommands().length).toBeGreaterThan(stopsBefore);
    gate.resolve();
    expect(await outcome).toContain('RESUME_CANCELLED');
    expect(meta()).toMatchObject({ squadStopped: true, squadStopRequested: true, squadGeneration: 2, squadResumeFailed: 'RESUME_CANCELLED' });
    expect(resolveSquadMember(ctx, bindingId, 'p')).toBeUndefined();
    // host is stopped again after the late resume returned
    expect(stopCommands().length).toBeGreaterThanOrEqual(stopsBefore + 2);
  });

  it('a fresh resume after a cancelled one clears the cancel marker and commits', async () => {
    await stoppedMember();
    patchThreadPluginMetadata(db, { threadId: bindingId, pluginId: privateNamespace, set: { squadResumeStarted: 3, squadResumeCancelled: 3 }, remove: [] });
    await expect(resumeSquadMemberConversation(ctx, resumeRequest)).resolves.toMatchObject({ generation: 3 });
    expect(meta().squadResumeCancelled).toBeUndefined();
    expect(meta()).toMatchObject({ squadStopped: false, squadGeneration: 3 });
  });

  it('stop on an already-stopped member with no resume in flight stays an early no-op', async () => {
    await stoppedMember();
    const before = stopCommands().length;
    await expect(stopSquadMemberConversation(ctx, control)).resolves.toBe(true);
    expect(stopCommands().length).toBe(before);
    expect(meta().squadResumeCancelled).toBeUndefined();
  });

  it('stops the host thread when the commit write fails after a successful native load', async () => {
    await stoppedMember();
    const original = db.sqlite.prepare.bind(db.sqlite);
    const stopsBefore = stopCommands().length;
    let armed = false;
    const impl = vi.mocked(ctx.hostHub.callHostOnlineRpc).getMockImplementation()!;
    vi.mocked(ctx.hostHub.callHostOnlineRpc).mockImplementation(async input => {
      const out = await impl(input);
      if (input.command.type === 'thread.resume') armed = true;
      return out;
    });
    const spy = vi.spyOn(db.sqlite, 'prepare').mockImplementation(((sql: string) => {
      if (armed && /thread_plugin_metadata/i.test(sql) && /insert|update|replace/i.test(sql) && !/squadResumeFailed/.test(sql)) {
        armed = false; throw new Error('disk full');
      }
      return original(sql);
    }) as typeof db.sqlite.prepare);
    await expect(resumeSquadMemberConversation(ctx, resumeRequest)).rejects.toThrow('RESUME_FAILED');
    spy.mockRestore();
    expect(stopCommands().length).toBe(stopsBefore + 1);
    expect(meta()).toMatchObject({ squadStopped: true, squadGeneration: 2 });
  });

  it('is reachable only through the signed main operation schema', async () => {
    const { SquadRuntimeOperationSchema } = await import('@zana-ai/zcc-contracts/runtime');
    expect(SquadRuntimeOperationSchema.safeParse({ operation: 'squad-member-resume', request: resumeRequest }).success).toBe(true);
    expect(SquadRuntimeOperationSchema.safeParse({ operation: 'squad-member-resume', request: { ...resumeRequest, newGeneration: 1 } }).success).toBe(false);
    expect(SquadRuntimeOperationSchema.safeParse({ operation: 'squad-member-resume', request: { ...resumeRequest, extra: 1 } }).success).toBe(false);
  });
});
