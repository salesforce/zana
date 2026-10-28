import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertHost } from '@zana-ai/zcc-db';
import { channelHash } from '../services/peers/enrolled-peer-channels.js';

const h = vi.hoisted(() => ({
  hubOptions: undefined as any,
  providers: [] as any[],
  bridgeLaunch: vi.fn(),
  reconcile: vi.fn(),
  flushDue: vi.fn(),
  flushHeld: vi.fn(),
  heal: vi.fn(),
  outcome: vi.fn(),
  pluginStatus: vi.fn(),
  notifyChild: vi.fn()
}));

vi.mock('./host-hub.js', async (orig) => {
  const actual = await orig<typeof import('./host-hub.js')>();
  return { ...actual, createHostHub: (...args: Parameters<typeof actual.createHostHub>) => {
    h.hubOptions = args[3];
    return actual.createHostHub(...args);
  } };
});
vi.mock('../services/threads/thread-provider-catalog.js', async (orig) => ({
  ...await orig<typeof import('../services/threads/thread-provider-catalog.js')>(),
  listThreadProviders: () => h.providers,
  bridgeLaunchForProvider: (...a: unknown[]) => h.bridgeLaunch(...a)
}));
vi.mock('../services/threads/conversation-lifecycle.js', async (orig) => ({
  ...await orig<typeof import('../services/threads/conversation-lifecycle.js')>(),
  reconcileStoppingConversationThreadsOnHostConnect: (...a: unknown[]) => h.reconcile(...a),
  flushDueConversationSendsForHost: (...a: unknown[]) => h.flushDue(...a),
  flushHeldConversationSends: (...a: unknown[]) => h.flushHeld(...a)
}));
vi.mock('../services/threads/conversation-host-recovery.js', () => ({
  healDisconnectedConversationThreadsForHost: (...a: unknown[]) => h.heal(...a)
}));
vi.mock('../services/threads/conversation-lifecycle-outcome.js', () => ({
  publishConversationLifecycleOutcome: (...a: unknown[]) => h.outcome(...a)
}));
vi.mock('../plugins/thread-events.js', () => ({
  emitPluginThreadStatus: (...a: unknown[]) => h.pluginStatus(...a)
}));
vi.mock('../services/threads/conversation-child-notifications.js', () => ({
  notifyParentOfChildNeedsAttention: (...a: unknown[]) => h.notifyChild(...a)
}));

import { createProductHttpContext, type ProductHttpContext } from './product-context.js';
import { HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS } from '../services/threads/conversation-runtime-display.js';

const roots: string[] = [];
const contexts: ProductHttpContext[] = [];
const root = () => { const dir = mkdtempSync(join(tmpdir(), 'zcc-ctx-cov-')); roots.push(dir); return dir; };
const make = (opts: Partial<Parameters<typeof createProductHttpContext>[0]> = {}) => {
  const ctx = createProductHttpContext({ dataDir: root(), origins: { serverPort: 0 }, ...opts });
  contexts.push(ctx);
  return ctx;
};
const originalToken = process.env.ZCC_HOST_ENROLL_TOKEN;

beforeEach(() => {
  vi.clearAllMocks();
  h.providers = [];
  h.reconcile.mockResolvedValue(undefined);
  h.flushDue.mockResolvedValue(undefined);
  h.flushHeld.mockResolvedValue(undefined);
  delete process.env.ZCC_HOST_ENROLL_TOKEN;
});
afterEach(async () => {
  vi.useRealTimers();
  for (const ctx of contexts.splice(0)) { ctx.hostHub.close(); ctx.dispose(); await ctx.whenIdle(); ctx.db.close(); }
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (originalToken === undefined) delete process.env.ZCC_HOST_ENROLL_TOKEN; else process.env.ZCC_HOST_ENROLL_TOKEN = originalToken;
});

describe('enroll token selection', () => {
  it('prefers explicit option and persists it 0600', () => {
    process.env.ZCC_HOST_ENROLL_TOKEN = 'e'.repeat(32);
    const ctx = make({ enrollToken: 'explicit-token-value' });
    expect(ctx.enrollToken).toBe('explicit-token-value');
    const file = join(ctx.dataDir, 'host-enroll.token');
    expect(readFileSync(file, 'utf8')).toBe('explicit-token-value');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
  it('uses env token when long enough', () => {
    process.env.ZCC_HOST_ENROLL_TOKEN = 'e'.repeat(16);
    expect(make().enrollToken).toBe('e'.repeat(16));
  });
  it('ignores a short env token and generates a random 64-hex token', () => {
    process.env.ZCC_HOST_ENROLL_TOKEN = 'short';
    const a = make(), b = make();
    expect(a.enrollToken).toMatch(/^[0-9a-f]{64}$/);
    expect(a.enrollToken).not.toBe(b.enrollToken);
  });
  it('generates a token when env is absent', () => {
    expect(make().enrollToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('construction seams', () => {
  it('reuses an injected project store and exposes its projects', () => {
    const projects = { list: () => [{ id: 'p1', name: 'One', path: '/x' }] } as any;
    const ctx = make({ projects });
    expect(ctx.projects).toBe(projects);
    expect(ctx.toProjects()).toEqual([{ id: 'p1', name: 'One', path: '/x' }]);
  });
  it('forwards library and project change callbacks through the hub', () => {
    const onLibraryChanged = vi.fn(), onProjectsChanged = vi.fn();
    const ctx = make({ onLibraryChanged, onProjectsChanged });
    ctx.hub.emit('library:changed', []);
    expect(onLibraryChanged).toHaveBeenCalledTimes(1);
    expect(onProjectsChanged).not.toHaveBeenCalled();
    ctx.hub.emit('projects:changed', []);
    expect(onProjectsChanged).toHaveBeenCalledTimes(1);
  });
  it('relays inbox, suggestions and saved store events onto the hub', async () => {
    const ctx = make();
    const seen: string[] = [];
    for (const ev of ['inbox:appended', 'inbox:removed', 'inbox:updated', 'inbox:pruned',
      'suggestions:appended', 'suggestions:removed', 'suggestions:updated', 'suggestions:pruned', 'saved:changed']) {
      ctx.hub.subscribe(ev as any, () => { seen.push(ev); });
    }
    const entry = await ctx.inbox.append({ projectId: 'p', projectLabel: 'P', sessionId: 's', comments: 'c' } as any);
    expect(seen).toContain('inbox:appended');
    await ctx.inbox.delete(entry.id);
    expect(seen).toContain('inbox:removed');
    await ctx.saved.save({ projectId: 'p', title: 't', comments: 'b' });
    expect(seen).toContain('saved:changed');
  });
  it('closeSummary appendInbox writes through the inbox and projectLabel resolves names', async () => {
    const projects = { list: () => [{ id: 'p1', name: 'One', path: root() }] } as any;
    const ctx = make({ projects });
    const appended = vi.fn();
    ctx.hub.subscribe('inbox:appended' as any, appended);
    const svc = ctx.closeSummary as any;
    const deps = svc.deps as any;
    {
      expect(deps.projectLabel('p1')).toBe('One');
      expect(deps.projectLabel('nope')).toBeUndefined();
      const { id } = await deps.appendInbox({ projectId: 'p1', projectLabel: 'One', sessionId: 's', comments: 'hi' });
      expect(typeof id).toBe('string');
      expect(appended).toHaveBeenCalled();
      expect(await deps.readLastTurn()).toBe('');
      expect(deps.getSession()).toBeNull();
      expect(deps.hasTranscript()).toBe(false);
      expect(await deps.readDigest()).toBe('');
      expect((await deps.runTurnSummary()).error).toBe('unused');
      // Not run here: this suite does not mock the LLM.
      expect(typeof deps.runSessionSummary).toBe('function');
    }
  });
});

describe('closeSummary follow-ups', () => {
  it('createFollowUp writes into the project .zcc/followups and announces every follow-up file', () => {
    const projectPath = root();
    const projects = { list: () => [{ id: 'p1', name: 'One', path: projectPath }] } as any;
    const ctx = make({ projects });
    const changed = vi.fn();
    ctx.hub.subscribe('followups:changed' as any, changed);
    const id = (ctx.closeSummary as any).deps.createFollowUp({ projectId: 'p1', sessionId: 's1', title: 'T', detail: 'D' });
    const file = join(projectPath, '.zcc', 'followups', `${id}.json`);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      id, projectId: 'p1', title: 'T', detail: 'D', kind: 'note', status: 'open', sessionId: 's1',
      origin: { source: 'agent', sessionId: 's1' }
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(changed.mock.calls[0])).toContain(id);
  });
  it('createFollowUp for an unknown project falls back to the data dir', () => {
    const ctx = make();
    const id = (ctx.closeSummary as any).deps.createFollowUp({ projectId: 'ghost', sessionId: 's', title: 'T', detail: 'D' });
    expect(existsSync(join(ctx.dataDir, 'followups', `${id}.json`))).toBe(true);
  });
});

describe('host hub callbacks', () => {
  it('pluginHostGenerations reports live plugin artifacts', () => {
    const ctx = make();
    expect(h.hubOptions.pluginHostGenerations()).toEqual([]);
    ctx.pluginHostArtifacts.set('plug', { path: '/p', byteLength: 1, digest: 'd', generation: 'g1' });
    expect(h.hubOptions.pluginHostGenerations()).toEqual([{ pluginId: 'plug', generation: 'g1' }]);
  });
  it('onNewHostInstance interrupts pending interactions for that host', () => {
    const ctx = make();
    const spy = vi.spyOn(ctx.pendingInteractions, 'interruptPendingInteractionsForHost').mockReturnValue(undefined as any);
    h.hubOptions.onNewHostInstance('host-a');
    expect(spy).toHaveBeenCalledWith('host-a', 'host-daemon-restarted');
  });
  it('onHostConnected ignores hosts without execution capability', async () => {
    const ctx = make();
    upsertHost(ctx.db, { id: 'peer-h', name: 'peer', hostKeyHash: 'k', enrollmentCapability: 'peer.forward' });
    const spy = vi.spyOn(ctx.remoteEnvironment, 'hostConnected');
    h.hubOptions.onHostConnected('peer-h');
    h.hubOptions.onHostConnected('unknown-host');
    expect(spy).not.toHaveBeenCalled();
    expect(h.reconcile).not.toHaveBeenCalled();
    expect(h.flushDue).not.toHaveBeenCalled();
  });
  it('onHostConnected on an execution host reconciles, flushes, prewarms host-scoped model catalogs and swallows failures', async () => {
    const ctx = make();
    upsertHost(ctx.db, { id: 'exec-h', name: 'exec', hostKeyHash: 'k', enrollmentCapability: 'execution' });
    h.reconcile.mockRejectedValue(new Error('boom'));
    h.flushDue.mockRejectedValue(new Error('boom'));
    h.providers = [
      { id: 'local-prov', models: { scope: 'local' } },
      { id: 'no-models' },
      { id: 'host-ok', models: { scope: 'host' } },
      { id: 'host-bad-bridge', models: { scope: 'host' } },
      { id: 'host-bad-read', models: { scope: 'host' } }
    ];
    h.bridgeLaunch.mockImplementation((id: string) => {
      if (id === 'host-bad-bridge') throw new Error('plugin still building');
      return { launch: id };
    });
    const read = vi.spyOn(ctx.modelCatalogs, 'read').mockImplementation(((input: any) =>
      input.providerId === 'host-bad-read' ? Promise.reject(new Error('rpc')) : Promise.resolve({})) as any);
    const connected = vi.spyOn(ctx.remoteEnvironment, 'hostConnected');
    h.hubOptions.onHostConnected('exec-h');
    expect(connected).toHaveBeenCalledWith('exec-h');
    expect(h.reconcile).toHaveBeenCalledWith(ctx, 'exec-h');
    expect(h.flushDue).toHaveBeenCalledWith(ctx, 'exec-h');
    expect(read.mock.calls.map(([i]: any) => i.providerId)).toEqual(['host-ok', 'host-bad-read']);
    expect(read).toHaveBeenCalledWith({ hostId: 'exec-h', providerId: 'host-ok', scope: 'host', prewarm: true, bridgeLaunch: { launch: 'host-ok' } });
    await new Promise(r => setTimeout(r, 0)); // rejected promises must not surface as unhandled
  });
  it('onHostConnected cancels a pending disconnect-heal timer', () => {
    vi.useFakeTimers();
    const ctx = make();
    h.hubOptions.onHostDisconnected('h1');
    h.hubOptions.onHostConnected('h1');
    vi.advanceTimersByTime(HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS + 10);
    expect(h.heal).not.toHaveBeenCalled();
    void ctx;
  });
  it('onConversationEvent ignores unknown threads', () => {
    const ctx = make();
    const emit = vi.spyOn(ctx.hub, 'emit');
    h.hubOptions.onConversationEvent({ threadId: 'missing-thread' });
    expect(emit).not.toHaveBeenCalledWith('threads:updated', expect.anything());
  });
  it('onConversationLifecycle publishes outcomes and only emits plugin status when applied', () => {
    const ctx = make();
    const thread = { id: 't' };
    h.hubOptions.onConversationLifecycle({ threadId: 't', event: 'e', outcome: { applied: false, thread } });
    expect(h.outcome).toHaveBeenCalledWith(ctx, { threadId: 't', event: 'e' }, { applied: false, thread });
    expect(h.pluginStatus).not.toHaveBeenCalled();
    h.hubOptions.onConversationLifecycle({ threadId: 't', event: 'e', outcome: { applied: true, thread } });
    expect(h.pluginStatus).toHaveBeenCalledWith(ctx, thread);
  });
  it('onPluginHostEvent forwards to plugins when present, tolerates absence and rejection', async () => {
    const ctx = make();
    expect(() => h.hubOptions.onPluginHostEvent({ type: 'x' })).not.toThrow();
    const emitHostEvent = vi.fn().mockRejectedValue(new Error('nope'));
    ctx.plugins = { emitHostEvent } as any;
    h.hubOptions.onPluginHostEvent({ type: 'x' });
    expect(emitHostEvent).toHaveBeenCalledWith({ type: 'x' });
    await new Promise(r => setTimeout(r, 0));
  });
  it('onHostDisconnected heals only when the host is still gone after the grace period', () => {
    vi.useFakeTimers();
    const ctx = make();
    const abortHost = vi.fn();
    ctx.cliCallbacks = { abortHost, dispose: vi.fn() } as any;
    const disconnected = vi.spyOn(ctx.remoteEnvironment, 'hostDisconnected');
    h.hubOptions.onHostDisconnected('h2');
    h.hubOptions.onHostDisconnected('h2'); // re-arming replaces the earlier timer
    expect(disconnected).toHaveBeenCalledTimes(2);
    expect(abortHost).toHaveBeenCalledWith('h2');
    vi.spyOn(ctx.hostHub, 'connectedHostIds').mockReturnValueOnce(['h2']);
    vi.advanceTimersByTime(HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS + 1);
    expect(h.heal).not.toHaveBeenCalled(); // reconnected meanwhile
    h.hubOptions.onHostDisconnected('h3');
    vi.advanceTimersByTime(HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS + 1);
    expect(h.heal).toHaveBeenCalledTimes(1);
    expect(h.heal).toHaveBeenCalledWith(ctx.db, ctx.hub, 'h3');
  });
});

describe('pending interaction hooks', () => {
  const opts = (ctx: ProductHttpContext) => (ctx.pendingInteractions as any);
  it('flushes held sends when an interaction settles, except thread stop/delete or other pending ones', () => {
    const ctx = make();
    const lc: any = opts(ctx);
    const settled = lc.deps.onInteractionSettled;
    const pending = vi.spyOn(ctx.pendingInteractions, 'hasPendingThreadInteraction');
    pending.mockReturnValue(false);
    settled({ threadId: 't', status: 'interrupted', statusReason: 'thread-stopped' });
    settled({ threadId: 't', status: 'interrupted', statusReason: 'thread-deleted' });
    expect(h.flushHeld).not.toHaveBeenCalled();
    pending.mockReturnValue(true);
    settled({ threadId: 't', status: 'answered', statusReason: 'x' });
    expect(h.flushHeld).not.toHaveBeenCalled();
    pending.mockReturnValue(false);
    h.flushHeld.mockRejectedValueOnce(new Error('x'));
    settled({ threadId: 't', status: 'interrupted', statusReason: 'other' });
    expect(h.flushHeld).toHaveBeenCalledWith(ctx, 't');
  });
  it('notifies the parent when a child interaction is created', async () => {
    const ctx = make();
    const lc: any = opts(ctx);
    const created = lc.deps.onPendingInteractionCreated;
    created({ threadId: 't', interaction: { id: 'i' } });
    await vi.waitFor(() => expect(h.notifyChild).toHaveBeenCalledWith(ctx, { threadId: 't', interaction: { id: 'i' } }));
  });
});

describe('peer authority wiring', () => {
  it('without a key provider no installer, ssh endpoints, or route allowlist exist', async () => {
    const ctx = make();
    expect(ctx.peerInstaller).toBeUndefined();
    expect(ctx.peerSshEndpoints).toBeUndefined();
    expect(ctx.peerRouteAllowlist).toBeUndefined();
    await expect(ctx.whenIdle()).resolves.toBeUndefined();
  });
  it('with a key provider the installer stack exists and dispose/whenIdle are safe to repeat', async () => {
    const dispose = vi.fn();
    const ctx = make({ peerKeyProvider: { getKey: async () => randomBytes(32), dispose } });
    expect(ctx.peerInstaller).toBeDefined();
    expect(ctx.peerSshEndpoints).toBeDefined();
    expect(ctx.peerRouteAllowlist).toBeDefined();
    ctx.dispose();
    ctx.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    await ctx.whenIdle();
  });
  it('authority enrollment lookup maps hosts, rejects missing or destroyed hosts', async () => {
    const ctx = make({ peerKeyProvider: { getKey: async () => randomBytes(32) } });
    const enrollment = (ctx.peerAuthority as any).options.enrollment;
    expect(enrollment('absent')).toBeNull();
    upsertHost(ctx.db, { id: 'eh', name: 'n', hostKeyHash: 'hash1', enrollmentCapability: 'execution' });
    expect(enrollment('eh')).toEqual({ hostId: 'eh', keyHash: 'hash1', capability: 'execution', connected: false });
    ctx.db.sqlite.prepare('UPDATE hosts SET destroyed_at = ? WHERE id = ?').run(Date.now(), 'eh');
    expect(enrollment('eh')).toBeNull();
  });
  it('reverse enrollment maps a registered channel and returns null when none exists', async () => {
    const ctx = make({ peerKeyProvider: { getKey: async () => randomBytes(32) } });
    const reverse = (ctx.peerAuthority as any).options.reverseEnrollment;
    const channel = { hostId: 'rh', hostKey: 'secret-key', capability: 'execution' };
    const remote = vi.spyOn(ctx.peerChannels, 'remote').mockResolvedValueOnce(channel as any).mockResolvedValueOnce(null);
    expect(await reverse('remote-1')).toEqual({ hostId: 'rh', keyHash: channelHash(channel as any), capability: 'execution' });
    expect(await reverse('remote-2')).toBeNull();
    expect(remote).toHaveBeenNthCalledWith(1, 'remote-1');
  });
  it('installer local route is derived from the live server port and absent when unbound', () => {
    const ctx = make({ peerKeyProvider: { getKey: async () => randomBytes(32) } });
    const { localRoute } = (ctx.peerInstaller as any).options;
    expect(localRoute()).toBeNull();
    ctx.origins.serverPort = 4321;
    expect(localRoute()).toBe('http://127.0.0.1:4321/');
  });
  it('installer allowed origins merge host-supplied origins with the owner allowlist and tolerate unreadable storage', async () => {
    const withHost = make({ peerKeyProvider: { getKey: async () => randomBytes(32) }, peerRouteOrigins: ['https://host.example'] });
    vi.spyOn(withHost.peerRouteAllowlist!, 'list').mockResolvedValueOnce(['https://owner.example']);
    expect(await (withHost.peerInstaller as any).options.allowedOrigins()).toEqual(['https://host.example', 'https://owner.example']);
    vi.spyOn(withHost.peerRouteAllowlist!, 'list').mockRejectedValueOnce(new Error('unreadable'));
    expect(await (withHost.peerInstaller as any).options.allowedOrigins()).toEqual(['https://host.example']);
    const bare = make({ peerKeyProvider: { getKey: async () => randomBytes(32) } });
    vi.spyOn(bare.peerRouteAllowlist!, 'list').mockResolvedValueOnce(['https://only-owner.example']);
    expect(await (bare.peerInstaller as any).options.allowedOrigins()).toEqual(['https://only-owner.example']);
  });
  it('installer route lookup delegates to the pinned SSH endpoint registry', async () => {
    const ctx = make({ peerKeyProvider: { getKey: async () => randomBytes(32) } });
    const signal = new AbortController().signal;
    const routeFor = vi.spyOn(ctx.peerSshEndpoints!, 'routeFor').mockResolvedValue('http://127.0.0.1:9/' as any);
    expect(await (ctx.peerInstaller as any).options.routeFor('peer-x', signal)).toBe('http://127.0.0.1:9/');
    expect(routeFor).toHaveBeenCalledWith('peer-x', signal);
  });
  it('a periodic tick retries peer recovery and sweeps the installer; it stops after dispose', async () => {
    vi.useFakeTimers();
    const getKey = vi.fn(async () => null);
    const ctx = make({ peerKeyProvider: { getKey } });
    const recover = vi.spyOn(ctx.peerAuthority, 'recover').mockResolvedValue({ pending: 0, blocked: 0 } as any);
    const sweep = vi.spyOn(ctx.peerInstaller!, 'sweep').mockResolvedValue(undefined as any);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    ctx.hub.emit('hosts:changed', []);
    expect(recover).toHaveBeenCalledTimes(2);
    ctx.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    ctx.hub.emit('hosts:changed', []);
    expect(recover).toHaveBeenCalledTimes(2);
    expect(sweep).toHaveBeenCalledTimes(1);
  });
  it('a sweep failure is logged and the next tick still runs', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ctx = make({ peerKeyProvider: { getKey: async () => null } });
    vi.spyOn(ctx.peerAuthority, 'recover').mockResolvedValue({ pending: 0, blocked: 0 } as any);
    const sweep = vi.spyOn(ctx.peerInstaller!, 'sweep').mockRejectedValue(new Error('sweep failed'));
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('installer sweep failed: sweep failed'));
    warn.mockRestore();
  });
  it('a non-key recovery failure is logged, disposes pairs and stops further recovery', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ctx = make({ peerKeyProvider: { getKey: async () => null } });
    const recover = vi.spyOn(ctx.peerAuthority, 'recover').mockRejectedValue(new Error('disk full'));
    const dispose = vi.spyOn(ctx.peerPairs, 'dispose');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(dispose).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('recovery (peer sync disabled) failed: disk full'));
    const calls = recover.mock.calls.length;
    await vi.advanceTimersByTimeAsync(90_000);
    ctx.hub.emit('hosts:changed', []);
    expect(recover.mock.calls.length).toBe(calls);
    warn.mockRestore();
  });
  it('hosts:changed from the installer is suppressed after dispose', async () => {
    const ctx = make({ peerKeyProvider: { getKey: async () => randomBytes(32) } });
    const installer: any = ctx.peerInstaller;
    const onChanged = installer.options.onChanged;
    const seen = vi.fn();
    ctx.hub.subscribe('hosts:changed', seen);
    onChanged();
    expect(seen).toHaveBeenCalledTimes(1);
    ctx.dispose();
    onChanged();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle', () => {
  it('dispose is idempotent and stops plugin runtime and cli callbacks once', () => {
    const ctx = make();
    const stop = vi.fn(), cbDispose = vi.fn();
    ctx.plugins = { stop } as any;
    ctx.cliCallbacks = { dispose: cbDispose, abortHost: vi.fn() } as any;
    ctx.dispose();
    ctx.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(cbDispose).toHaveBeenCalledTimes(1);
  });
  it('dispose tolerates plugins without a stop method', () => {
    const ctx = make();
    ctx.plugins = {} as any;
    expect(() => ctx.dispose()).not.toThrow();
  });
  it('whenIdle waits on the installer stack', async () => {
    const ctx = make({ peerKeyProvider: { getKey: async () => randomBytes(32) } });
    const idle = vi.spyOn(ctx.peerInstaller!, 'whenIdle');
    await ctx.whenIdle();
    expect(idle).toHaveBeenCalled();
  });
  it('creates the data dir at startup', () => {
    const ctx = make();
    expect(existsSync(ctx.dataDir)).toBe(true);
  });
});
