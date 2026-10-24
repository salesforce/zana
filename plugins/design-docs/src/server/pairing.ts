import { z } from 'zod';
import type { PeerConnection, PluginPeerRequest, PluginSdkPeers, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { canonicalPeerHash, PeerProtocolError } from '../shared/peer-contract.js';
import { ownerText, syncedWith, UNREADABLE_REPLY, type GroupRoster, type GroupStatus, type PeerLifecycleReason, type RepairResult } from '../shared/peer-group.js';
import { PEER_CALL_TIMEOUT_MS, PEER_PENDING_TICK_MS } from '../shared/peer-limits.js';
import { admissionSchema, capacityRequestId, capacitySchema, DesignDocPeerGroup, parseRoster, retirementJobSchema, rosterCovers, type Admission } from './peer-group.js';
import { currentMemberCount, historicalMembers, isRetiring, ownedSeats, retirementEvidence } from './peer-slots.js';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const helloSchema = z.object({ repoId: id, replicaId: id, peerId: id, scope: id, roster: z.unknown().nullable() }).strict();
const revokeSchema = z.object({ peerId: id, scope: id }).strict();
const localRevokeSchema = revokeSchema.extend({ localOnly: z.boolean().optional() }).strict();
const receiptSchema = z.object({ requestId: id, stage: z.literal('joining'), roster: z.unknown() }).strict();
const introductionSchema = z.object({ peerId: id, sponsorPeerId: id, scope: id }).strict();

/** Core sees an opaque scope; sorted app identities make control negotiation symmetric. */
export function bootstrapScope(a: string, b: string): string {
  id.parse(a); id.parse(b);
  if (a === b) throw new PeerProtocolError('invalid', 'cannot pair with local app');
  return `bootstrap-${canonicalPeerHash([a, b].sort())}`;
}

/** Cap on the per-peer maps (`following`, `restoring`) so a long-lived process cannot grow them without bound. */
const TRACKED_PEER_LIMIT = 6;
const TRACKED_USE_LIMIT = 64;
const UNSUPPORTED_CONNECTIONS = 'this host cannot share computer connections';
const CAPACITY_WAIT = 'waiting for reserved capacity';
/** Thrown by the core pair store while a link re-key or rotation is in flight; it clears on its own, so it is retried, not shown. */
const TRANSIENT_PEER_ERROR = 'peer enrollment changed or revoked';
const LIFECYCLE_REASONS: readonly PeerLifecycleReason[] = ['encryption-unavailable', 'insecure-backend', 'keychain-denied', 'storage-permissions', 'key-missing', 'key-corrupt', 'core-unsupported', 'unknown'];
/** Core tags key failures as `[reason=code]`; anything else is an unclassified failure. */
export function lifecycleReasonOf(error: unknown): PeerLifecycleReason {
  const code = /\[reason=([a-z-]+)\]/.exec(error instanceof Error ? error.message : String(error))?.[1];
  return LIFECYCLE_REASONS.find((reason) => reason === code) ?? 'unknown';
}
const isTransient = (error: unknown): boolean => error instanceof Error &&
  (error.message === TRANSIENT_PEER_ERROR || error.message === 'peer enrollment changed');
/** Cap for the follower's backoff between failed probes of an unreachable initiator. */
const FOLLOWER_PROBE_MAX_MS = 5 * 60 * 1000;
/** An unfrozen setup with a computer that has no connection is dropped after this long (and two looks). */
const ORPHAN_SETUP_GRACE_MS = 60_000;
/** Repair's re-link tears down that link's connector; core lists the peer as enrolled again once it is re-established. */
const RELINK_WAIT = { timeoutMs: 20_000, intervalMs: 500 };
const ENROLLMENT_UNAVAILABLE = 'mutually enrolled peer unavailable';
const RELINK_NOT_BACK = 'The connection was re-linked, but the other computer has not reconnected on the new link yet. ' +
  'Keep Zana open on both computers, wait a few seconds, then press Repair again. If it keeps failing, open Settings → Peers and use Reconnect, or Remove the connection there and connect again.';
/**
 * Setup errors that mean "the other computer must act", in owner words with the way forward. The protocol text stays in
 * the log and the status line; Repair shows this instead of a bare waiting message.
 */
const SETUP_GUIDANCE: Record<string, string> = {
  'waiting for the other computer to set aside the sync group from an earlier removal':
    'The other computer still keeps the sync group from the earlier removal. It sets that aside by itself once it runs this version of Design Docs with Zana open. ' +
    'If this does not clear within a minute, open Design Docs settings on the other computer and press Repair on this computer\'s card. ' +
    'If that does not help either, remove this computer in Settings → Peers and connect again.',
  'the other computer has not finished setting up the connection yet':
    'Keep Zana open on both computers, press Repair on this computer\'s card; if that fails, open Settings → Peers and use Reconnect, or Remove the connection there and connect again.'
};

const NO_GROUP_ANYMORE = 'the other computer no longer keeps this sync group';
/** Failures that cannot clear by retrying the same job: they stop at the retry cap instead of blocking forever. */
const PERMANENT_ERRORS = new Set([NO_GROUP_ANYMORE, 'retirement target identity mismatch', 'retirement delivery peer identity mismatch']);
function isPermanent(error: unknown): boolean {
  return error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof PeerProtocolError && PERMANENT_ERRORS.has(error.message));
}
/** Owner-facing text for a failure: protocol sentences pass through, validator and JSON dumps never do. */
export function readableError(error: unknown): string {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return UNREADABLE_REPLY;
  return ownerText(error instanceof Error ? error.message.trim() : '') ?? 'peer setup failed';
}
/** Log-only detail: validator issues without values (a reply may carry document metadata), else the message. */
function technical(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.slice(0, 4).map((issue) => `${issue.code} at ${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ').slice(0, 400);
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}

/** What the owner sees for one connected computer. `syncing` = it is an authorized, non-retiring member of this sync group. */
export interface ConnectionView {
  computerId: string;
  hostname: string;
  state: 'connected' | 'reconnecting' | 'disconnected';
  usedByThisPlugin: boolean;
  use: 'pending' | 'approved' | 'denied' | null;
  syncing: boolean;
  retiring: boolean;
  /** Sync setup work with this computer is running right now (enable, waiting on the initiator, grant restore or a pending job). */
  settingUp?: boolean;
}

/** The handler core gives an `onConnectionRemoving` call; stay well inside it. */
const REMOVING_BUDGET_MS = 4_000;
/** One best-effort grant revoke while a connection is being removed. */
const REMOVING_STEP_MS = 1_500;
const NOTE_SYNC_MISSING = 'Sync not set up';
type Connections = NonNullable<PluginSdkPeers['connections']>;

/** Computers this owner let this plugin use and that are live right now: the ones sync is set up with automatically. */
function pairedPeers(connections: PeerConnection[]): string[] {
  return connections.filter((connection) => connection.usedByThisPlugin && connection.state === 'connected' && id.safeParse(connection.computerId).success)
    .map((connection) => connection.computerId);
}

/** The other side's roster only while it is a current member of it (`hello.replicaId`); a roster it left is history. */
function liveRemote(hello: z.infer<typeof helloSchema>): GroupRoster | null {
  if (hello.roster === null) return null;
  const roster = parseRoster(hello.roster);
  return roster.members.some((member) => member.replicaId === hello.replicaId && member.machineId === hello.peerId && !isRetiring(roster, member.replicaId)) ? roster : null;
}

export class DesignDocPairing {
  private readonly abort = new AbortController();
  private lifecycleWarning: string | null = null;
  private lifecycleReason: PeerLifecycleReason | null = null;
  private readonly logged = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Last status note sent to core per computer; resent only on change or after the connection reappears. */
  private readonly reportedNotes = new Map<string, 'attention' | 'clear'>();
  /** Last answer of `requestUse` per computer (memory only), so the view can show a pending or denied request. */
  private readonly lastUse = new Map<string, 'pending' | 'approved' | 'denied'>();
  private readonly unsubscribes: Array<() => void> = [];
  private running: Promise<void> | null = null;
  private enabling: Promise<GroupStatus> | null = null;
  /** The computer the running `enabling` negotiates with. */
  private enablingPeer: string | null = null;
  private revoking: Promise<GroupStatus> | null = null;
  private reconciling: Promise<void> | null = null;
  private enableError: string | null = null;
  /** Last non-transient failure of the best-effort auto-enable / grant restore steps; cleared by the next clean pass. */
  private setupError: string | null = null;
  /** Computers the owner stopped syncing with (or core is removing). Only an explicit enable or a new use request re-pairs them. */
  private readonly disabledPeers = new Set<string>();
  /** Computers this (higher-id) side waits on; see `initiatorReady`. */
  private readonly following = new Map<string, { attempts: number; nextAt: number; scope: string | null; failedAt: string | null }>();
  /** Initiator side: earliest next grant restore per member peer (bounded like `following`). */
  private readonly restoring = new Map<string, number>();
  /** The unfrozen setup whose peer has no connection, and since when (see `discardOrphanSetup`). */
  private orphan: { peerId: string; since: number; ticks: number } | null = null;

  /**
   * `stateDigest` is an opaque, convergence-stable hash of the local database state; drift checks compare it and never see
   * content. `stateChanged` fires when a peer says its state moved (e.g. after its Sync Now) so the UI can re-check.
   */
  constructor(readonly group: DesignDocPeerGroup, private readonly peers: PluginSdkPeers,
    private readonly hooks: { stateDigest?: () => string | null; stateChanged?: () => void; relinkWait?: { timeoutMs: number; intervalMs: number }; orphanGraceMs?: number;
      connectionsChanged?: () => void; removingBudgetMs?: number; removingStepMs?: number } = {}) {}

  register(zcc: Pick<ZccPluginApi, 'onDispose'>): void {
    this.peers.handle('group-hello', async (request) => {
      this.fence(request);
      z.object({}).strict().parse(request.body);
      const self = id.parse((await this.peers.localIdentity()).id), local = this.requireLocal();
      if (request.scope !== bootstrapScope(self, request.peerId) && request.scope !== local.repoId) {
        throw new PeerProtocolError('invalid', 'database negotiation scope mismatch');
      }
      this.fence(request);
      return { repoId: local.repoId, replicaId: local.replicaId, peerId: self, scope: request.scope, roster: this.group.roster() };
    });
    this.peers.handle('group-join', async (request) => {
      this.fence(request);
      const input = admissionSchema.parse(request.body);
      const self = id.parse((await this.peers.localIdentity()).id);
      if (request.scope !== input.repoId && request.scope !== bootstrapScope(self, request.peerId)) {
        throw new PeerProtocolError('invalid', 'join scope mismatch');
      }
      if (this.group.roster() && !this.group.hasCapacity() && !this.group.containsAdmission(this.group.roster()!, input)) {
        await request.commitSync(() => { this.fence(request); this.group.authorizeSponsor(input, request.peerId); });
        await this.acquireCapacity(input, request);
      }
      return request.commitSync(() => { this.fence(request); return this.group.admit(input, request.peerId); });
    });
    this.peers.handle('group-capacity', (request) => {
      this.fence(request);
      const input = capacitySchema.parse(request.body);
      if (request.scope !== input.repoId) throw new PeerProtocolError('invalid', 'capacity scope mismatch');
      return request.commitSync(() => {
        this.fence(request);
        try { return this.group.transfer(input, request.peerId); }
        catch (error) {
          if (!(error instanceof PeerProtocolError) || error.message !== CAPACITY_WAIT) throw error;
          // Explicit authenticated refusal is not an unknown commit outcome. Refresh donor state before retrying elsewhere.
          return { requestId: input.requestId, roster: this.group.roster(), unavailable: true };
        }
      });
    });
    this.peers.handle('group-join-receipt', (request) => {
      this.fence(request);
      const input = admissionSchema.parse(request.body);
      if (request.scope !== input.repoId) throw new PeerProtocolError('invalid', 'join receipt scope mismatch');
      return request.commitSync(() => {
        this.fence(request);
        const receipt = this.group.existingReceipt(input, request.peerId);
        if (!receipt) throw new PeerProtocolError('invalid', 'committed admission receipt missing');
        return { receipt, roster: this.group.roster() };
      });
    });
    this.peers.handle('group-roster', async (request) => {
      this.fence(request);
      const roster = parseRoster(request.body);
      if (roster.repoId !== request.scope) throw new PeerProtocolError('invalid', 'roster scope mismatch');
      await request.commitSync(() => {
        this.fence(request);
        if (!this.group.coveredHistoricalAck(roster, request.peerId)) this.group.apply(roster, request.peerId);
        this.group.acknowledgeRoster(roster, request.peerId);
      });
      return { roster: this.group.roster() };
    });
    this.peers.handle('group-retire', (request) => {
      this.fence(request);
      const roster = parseRoster(request.body);
      if (request.scope !== roster.repoId) throw new PeerProtocolError('invalid', 'retirement scope mismatch');
      return request.commitSync(() => { this.fence(request); return { roster: this.group.retire(roster, request.peerId) }; });
    });
    this.peers.handle('group-revoke', async (request) => {
      this.fence(request);
      const input = revokeSchema.parse(request.body);
      const authorize = () => {
        this.fence(request);
        const current = revokeSchema.parse(request.body), roster = this.group.roster();
        if (!roster || !roster.members.some((member) => member.machineId === request.peerId && !isRetiring(roster, member.replicaId)) ||
          input.scope !== roster.repoId || request.scope !== roster.repoId || current.scope !== input.scope || current.peerId !== input.peerId ||
          !historicalMembers(roster).some((member) => member.machineId === input.peerId) ||
          roster.members.some((member) => member.machineId === input.peerId)) throw new PeerProtocolError('invalid', 'removal roster must commit before revocation');
        return roster;
      };
      authorize();
      await request.commitSync(() => {
        const roster = authorize();
        this.group.queueJob(this.group.localPeerId()!, 'local-revoke', roster.rosterEpoch, input);
      });
      return { stage: 'pending' };
    });
    this.peers.handle('state-digest', async (request) => {
      this.fence(request);
      z.object({}).strict().parse(request.body);
      const local = this.requireLocal();
      if (request.scope !== local.repoId) throw new PeerProtocolError('invalid', 'state scope mismatch');
      return { digest: this.hooks.stateDigest?.() ?? null };
    });
    this.peers.handle('state-changed', async (request) => {
      this.fence(request);
      z.object({}).strict().parse(request.body);
      if (request.scope !== this.requireLocal().repoId) throw new PeerProtocolError('invalid', 'state scope mismatch');
      try { this.hooks.stateChanged?.(); } catch { /* a UI nudge must never fail the peer call */ }
      return { ok: true };
    });
    zcc.onDispose(() => {
      this.abort.abort();
      for (const unsubscribe of this.unsubscribes.splice(0)) { try { unsubscribe(); } catch { /* already released */ } }
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    });
    const connections = this.connectionsApi();
    if (connections) {
      if (typeof connections.onConnectionRemoving === 'function') this.unsubscribes.push(connections.onConnectionRemoving((computerId) => this.connectionRemoving(computerId)));
      if (typeof connections.onChange === 'function') {
        this.unsubscribes.push(connections.onChange(() => {
          if (this.abort.signal.aborted) return;
          try { this.hooks.connectionsChanged?.(); } catch { /* a UI nudge must never break core's notification */ }
          void this.reconcile().catch(this.background('connections'));
        }));
      }
    }
    this.timer = setInterval(() => { void this.retry().catch(this.background('retry')); void this.reconcile().catch(this.background('connections')); }, PEER_PENDING_TICK_MS);
    this.timer.unref();
    void this.retry().catch(this.background('retry'));
  }

  /** The local repository, or a typed refusal when a peer calls before one exists. */
  private requireLocal(): NonNullable<ReturnType<DesignDocPeerGroup['sync']['localRepository']>> {
    const local = this.group.sync.localRepository();
    if (!local) throw new PeerProtocolError('invalid', 'no local repository');
    return local;
  }

  /** Catch handler for fire-and-forget loops: aborts are expected at shutdown, anything else is logged once. */
  private background(label: string): (error: unknown) => void {
    return (error) => { if (!this.abort.signal.aborted) this.logOnce(`background:${label}`, `background ${label} failed: ${this.message(error)}`); };
  }

  private connectionsApi(): Connections | null {
    const connections = this.peers.connections;
    return connections && typeof connections.list === 'function' ? connections : null;
  }

  /** Every connected computer core knows, or [] on a host without core connections. */
  private async listConnections(): Promise<PeerConnection[]> {
    const connections = this.connectionsApi();
    return connections ? connections.list({ signal: this.abort.signal }) : [];
  }

  /** One in-flight read of core's connections, then the best-effort sync steps that depend on them. */
  reconcile(): Promise<void> {
    if (!this.connectionsApi() || this.abort.signal.aborted) return Promise.resolve();
    if (!this.reconciling) this.reconciling = this.loadConnections().finally(() => { this.reconciling = null; });
    return this.reconciling;
  }

  /** Last non-transient failure of the automatic setup steps, for the owner's status line. */
  setupFailure(): string | null { return this.enableError ?? this.setupError; }

  private async loadConnections(): Promise<void> {
    const signal = this.abort.signal;
    let connections: PeerConnection[];
    try { connections = await this.listConnections(); }
    catch (error) {
      signal.throwIfAborted();
      this.logOnce('connections', `listing connections failed: ${this.message(error)}`);
      return;
    }
    // A computer whose connection is gone and came back is a new connection: a local stop no longer applies.
    const present = new Set(connections.map((connection) => connection.computerId));
    for (const peerId of [...this.disabledPeers]) if (!present.has(peerId)) this.disabledPeers.delete(peerId);
    for (const computerId of [...this.lastUse.keys()]) if (!present.has(computerId)) this.lastUse.delete(computerId);
    await this.releaseUnused(connections);
    // A new approved use wakes reconciliation immediately. Set aside an obsolete two-member group before auto-enable so the
    // new connection does not wait for the 30-second retry tick while both computers hold stale removal state.
    this.setAsideStaleSetup();
    // Best effort and independent: a failure of one step (e.g. a re-key in flight) must not fail the read or skip the other, and is retried next tick.
    let failure: unknown = null;
    for (const step of [() => this.discardOrphanSetup(connections), () => this.autoEnable(connections), () => this.restoreGrants(connections)]) {
      try { await step(); } catch (error) { signal.throwIfAborted(); if (!isTransient(error)) failure = error; }
    }
    this.setupError = failure ? this.message(failure) : null;
    if (failure) this.logOnce('setup', `peer setup step failed: ${this.setupError}`);
    await this.reportStatusNotes(connections).catch((error) => { if (!signal.aborted) this.logOnce('link-notes', `reporting connection status failed: ${this.message(error)}`); });
  }

  /**
   * A use ended (Stop using on either computer) is final for that use: every local stop always releases core's use too, so
   * once core reports the connection unused, the local stop has done its job. Cleared here, the next approved use (whichever
   * computer asked for it) sets sync up again. The other computer's Stop using only revokes this side's core use and grants,
   * so a sync group that still lists that computer is left here too; otherwise the re-used computer counts as enrolled and
   * this side never negotiates while the other waits on it.
   */
  private async releaseUnused(connections: PeerConnection[]): Promise<void> {
    const unused = new Set(connections.filter((connection) => !connection.usedByThisPlugin).map((connection) => connection.computerId));
    for (const peerId of [...this.disabledPeers]) if (unused.has(peerId)) this.disabledPeers.delete(peerId);
    if (this.enabling || this.revoking) return;
    const roster = this.group.liveRoster(), self = this.group.localPeerId();
    const stale = roster?.members.filter((member) => member.machineId !== self && unused.has(member.machineId) && !isRetiring(roster, member.replicaId)) ?? [];
    for (const member of stale) {
      this.logOnce(`unused:${member.machineId}`, 'leaving the sync group with a computer this plugin no longer uses');
      await this.detachConnection(member.machineId);
      this.disabledPeers.delete(member.machineId);
    }
  }

  /**
   * Tell core, per used computer, when the connection is live but database sync is not set up, so core's connections list
   * agrees with this plugin's computer card. Same definition as the card and Repair (`syncedWith`). Sent on change only;
   * best effort (older hosts lack `setStatus`).
   */
  private async reportStatusNotes(connections: PeerConnection[]): Promise<void> {
    const api = this.connectionsApi();
    if (!api || typeof api.setStatus !== 'function' || this.abort.signal.aborted) return;
    const present = new Set(connections.map((connection) => connection.computerId));
    for (const key of [...this.reportedNotes.keys()]) if (!present.has(key)) this.reportedNotes.delete(key);
    const live = connections.filter((connection) => connection.usedByThisPlugin && connection.state === 'connected');
    if (!live.length && !this.reportedNotes.size) return;
    const status = live.length ? await this.status() : null;
    for (const connection of connections) {
      const want = status && live.includes(connection) && !syncedWith(status, connection.computerId) ? 'attention' as const : 'clear' as const;
      if ((this.reportedNotes.get(connection.computerId) ?? 'clear') === want) continue;
      try {
        api.setStatus(connection.computerId, want === 'attention' ? NOTE_SYNC_MISSING : null);
        this.reportedNotes.set(connection.computerId, want);
      } catch (error) { this.logOnce(`link-note:${connection.computerId}`, `reporting connection status failed: ${this.message(error)}`); }
    }
  }

  /** The view behind the Computers list: core's connections joined with this plugin's use and sync state. */
  async connections(): Promise<ConnectionView[]> {
    if (!this.connectionsApi()) return [];
    const list = await this.listConnections();
    let status: GroupStatus | null = null;
    try { status = await this.status(); } catch { this.abort.signal.throwIfAborted(); }
    return list.map((connection) => {
      const member = status?.members.find((entry) => entry.machineId === connection.computerId && entry.replicaId !== status!.replicaId);
      // Core's approval settles a remembered request: a later Stop using (from either computer) must not show it as still pending.
      if (connection.usedByThisPlugin) this.lastUse.delete(connection.computerId);
      const remembered = this.lastUse.get(connection.computerId) ?? null;
      const use = connection.usedByThisPlugin ? 'approved' as const : remembered === 'approved' ? null : remembered;
      return { computerId: connection.computerId, hostname: connection.hostname, state: connection.state, usedByThisPlugin: connection.usedByThisPlugin,
        use, syncing: !!status && syncedWith(status, connection.computerId), retiring: !!member?.retiring,
        settingUp: connection.usedByThisPlugin && this.settingUp(connection.computerId, status) };
    });
  }

  /** True while setup work with `computerId` is in flight, so the card can show progress instead of an idle "not set up". */
  private settingUp(computerId: string, status: GroupStatus | null): boolean {
    if (this.enablingPeer === computerId) return true;
    if (this.following.get(computerId)?.failedAt === null) return true;
    if ((this.restoring.get(computerId) ?? 0) > Date.now()) return true;
    return !!status?.jobs.some((job) => job.peerId === computerId && job.state === 'pending');
  }

  /** Ask core to let this plugin use a connection. Core's error codes (e.g. `unknown_connection`) pass through unchanged. */
  async useConnection(computerId: string): Promise<{ status: 'pending' | 'approved' | 'denied' }> {
    id.parse(computerId);
    const api = this.connectionsApi();
    if (!api || typeof api.requestUse !== 'function') throw new PeerProtocolError('invalid', UNSUPPORTED_CONNECTIONS);
    const result = await api.requestUse(computerId, { signal: this.abort.signal });
    if (this.lastUse.size >= TRACKED_USE_LIMIT && !this.lastUse.has(computerId)) this.lastUse.delete(this.lastUse.keys().next().value as string);
    this.lastUse.set(computerId, result.status);
    this.disabledPeers.delete(computerId);
    if (result.status === 'approved') void this.reconcile().catch(this.background('connections'));
    return { status: result.status };
  }

  /** Release the core-owned use first. Local roster cleanup never delays Stop using. */
  async stopUsingConnection(computerId: string): Promise<GroupStatus> {
    id.parse(computerId);
    const api = this.connectionsApi();
    if (!api || typeof api.stopUsing !== 'function') throw new PeerProtocolError('invalid', UNSUPPORTED_CONNECTIONS);
    this.disabledPeers.add(computerId);
    await api.stopUsing(computerId, { signal: this.abort.signal });
    // Plugin cleanup is best effort; the core use must be gone even while a peer is offline.
    void this.detachConnection(computerId);
    this.lastUse.delete(computerId);
    this.clearNote(computerId);
    return this.status();
  }

  private clearNote(computerId: string): void {
    this.reportedNotes.delete(computerId);
    try { this.peers.connections?.setStatus?.(computerId, null); } catch { /* best effort */ }
  }

  /**
   * Core is removing a connection: stop syncing with that computer without waiting on it. Idempotent, never throws, and
   * bounded well below core's 5 s: a stuck step is abandoned, and anything left is retried by the normal job loop.
   */
  private async connectionRemoving(computerId: string): Promise<void> {
    if (!id.safeParse(computerId).success || this.abort.signal.aborted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => { timer = setTimeout(resolve, this.hooks.removingBudgetMs ?? REMOVING_BUDGET_MS); timer.unref?.(); });
    try { await Promise.race([this.detachConnection(computerId), budget]); }
    catch (error) { if (!this.abort.signal.aborted) this.logOnce(`removing:${computerId}`, `stopping sync with a removed connection failed: ${this.message(error)}`); }
    finally { clearTimeout(timer); }
  }

  private async detachConnection(computerId: string): Promise<void> {
    if (this.disabledPeers.size >= TRACKED_USE_LIMIT) this.disabledPeers.clear();
    this.disabledPeers.add(computerId);
    this.following.delete(computerId);
    this.restoring.delete(computerId);
    this.lastUse.delete(computerId);
    this.clearNote(computerId);
    const step = (work: () => Promise<unknown>) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.hooks.removingStepMs ?? REMOVING_STEP_MS); timer.unref?.();
      void Promise.resolve().then(work).then(() => undefined, () => undefined).finally(() => { clearTimeout(timer); resolve(); });
    });
    const local = this.group.sync.localRepository(), self = this.group.localPeerId();
    // Grants first: with them gone, undeliverable work for that computer ends instead of waiting on it.
    const scopes = new Set<string>();
    if (local) scopes.add(local.repoId);
    const roster = this.group.roster();
    if (roster) scopes.add(roster.repoId);
    if (self && self !== computerId) scopes.add(bootstrapScope(self, computerId));
    await Promise.all([...scopes].map((scope) => step(() => this.peers.revoke(computerId, { scope }))));
    this.group.cancelSetup(computerId);
    this.group.discardUnfrozenSetup(computerId);
    const current = this.group.roster();
    const member = current?.members.find((entry) => entry.machineId === computerId && !isRetiring(current, entry.replicaId));
    if (member) {
      try { this.group.remove(this.dissolvesTo(member.replicaId) ?? member.replicaId); }
      catch (error) { this.logOnce(`removing-leave:${computerId}`, `leaving the sync group with a removed connection failed: ${this.message(error)}`); }
    }
    await step(() => this.retry(true));
  }

  /**
   * A link re-key (Reconnect, the scheduled rotation) revokes every grant on that link, so a member's database grant can
   * vanish after the group formed. The initiator (lower id) re-enables it for a ready, linked, connected member; core
   * imports the new binding on the follower. Bounded: at most one enable per tick, then a per-peer back-off.
   */
  private async restoreGrants(connections: PeerConnection[]): Promise<void> {
    if (this.enabling || this.revoking || this.group.consent()) return;
    const roster = this.group.liveRoster(), local = this.group.sync.localRepository(), self = this.group.localPeerId();
    if (!roster || !local?.groupId || roster.repoId !== local.repoId || !self) return;
    const now = Date.now();
    const due = pairedPeers(connections).filter((peerId) => self < peerId && !this.disabledPeers.has(peerId) &&
      roster.members.some((member) => member.machineId === peerId && !isRetiring(roster, member.replicaId)) &&
      (this.restoring.get(peerId) ?? 0) <= now);
    if (!due.length) return;
    const grants = await this.peers.list({ signal: this.abort.signal });
    for (const peerId of due) {
      if (grants.some((grant) => grant.id === peerId && grant.scope === roster.repoId)) continue;
      if (this.restoring.size >= TRACKED_PEER_LIMIT && !this.restoring.has(peerId)) this.restoring.delete(this.restoring.keys().next().value as string);
      this.restoring.set(peerId, now + PEER_PENDING_TICK_MS);
      await this.peers.enable(peerId, { scope: roster.repoId, signal: this.abort.signal }).catch((error) => {
        this.logOnce(`restore:${peerId}`, `restoring database grant failed: ${this.message(error)}`);
      });
      return;
    }
  }

  /**
   * The owner approved this plugin's use of the connection, and that approval is the pairing consent. So once a used
   * computer is connected but not in this computer's sync group, run the existing mutual-proof `enable` so group-hello /
   * group-join negotiate as before. Computers the owner stopped syncing with never re-enable until they are used again.
   */
  private async autoEnable(connections: PeerConnection[]): Promise<void> {
    if (this.enabling || this.revoking || this.group.consent()) return;
    const roster = this.group.liveRoster();
    const candidates = pairedPeers(connections).filter((peerId) =>
      // An already-enrolled member must not occupy the single enable slot of this tick.
      !roster?.members.some((member) => member.machineId === peerId && !isRetiring(roster, member.replicaId)) &&
      // A peer the owner disabled stays off until it is used again or enabled explicitly.
      !this.disabledPeers.has(peerId));
    if (!candidates.length) return;
    const enrolled = await this.peers.enrolled({ signal: this.abort.signal });
    const self = id.parse((await this.peers.localIdentity()).id);
    for (const peerId of candidates) {
      if (!enrolled.some((peer) => peer.id === peerId && peer.connected)) continue;
      // Governance left from an earlier removal is archived before either side negotiates, so the other side never
      // joins (or waits on) a group this computer already left. A blocked one is skipped; Repair states why.
      if (!this.prepareRejoin(self, peerId)) continue;
      if (self > peerId && !(await this.initiatorReady(self, peerId))) continue;
      if (this.enabling || this.revoking || this.group.consent()) return;
      this.following.delete(peerId);
      this.disabledPeers.delete(peerId);
      void this.enableNow(peerId).then(() => { this.enableError = null; }).catch((error) => {
        this.enableError = this.message(error);
        this.logOnce(`auto-enable:${peerId}`, `automatic database sync enable failed: ${this.enableError}`);
      });
      return;
    }
  }

  /**
   * Both machines see the approved connection at once. If both ran `enable`, each would create its own core link
   * binding for the same scope and every later enable would fail as ambiguous. So the lower instance id initiates and the
   * higher one only answers: it runs the same bilateral `enable` once the initiator's bindings for the bootstrap scope and
   * the database scope already exist, so core reuses them. Waiting never holds a lifecycle lock; the poll tick re-checks,
   * and only a failed remote probe backs off (bounded), so an offline initiator cannot deadlock or flood this side.
   */
  private async initiatorReady(self: string, peerId: string): Promise<boolean> {
    let wait = this.following.get(peerId);
    if (!wait) {
      if (this.following.size >= TRACKED_PEER_LIMIT) this.following.delete(this.following.keys().next().value as string);
      wait = { attempts: 0, nextAt: 0, scope: null, failedAt: null };
      this.following.set(peerId, wait);
    }
    const bootstrap = bootstrapScope(self, peerId);
    const grant = await this.grant(peerId, bootstrap).catch(() => null);
    // A re-key revokes and re-issues grants (new epoch); the stale-grant window it opens is short, so a failure seen
    // before it must not keep delaying the probe. A genuinely unreachable initiator keeps its own backoff.
    const identity = grant ? String(grant.grantEpoch) : null;
    if (wait.failedAt !== null && (!identity || identity !== wait.failedAt)) {
      if (identity) { wait.attempts = 0; wait.nextAt = 0; wait.failedAt = null; }
      else wait.failedAt = '';
    }
    if (!identity) return false;
    // A learned database scope is re-read at most once per tick, so a later relabel on the initiator is still followed.
    if (!wait.scope || Date.now() >= wait.nextAt) {
      if (!wait.scope && Date.now() < wait.nextAt) return false;
      try {
        const hello = helloSchema.parse(await this.peers.call(peerId, 'group-hello', {}, this.options(bootstrap)));
        if (hello.peerId !== peerId || hello.scope !== bootstrap) throw new PeerProtocolError('invalid', 'setup peer identity or scope changed');
        const remote = hello.roster === null ? null : parseRoster(hello.roster);
        // Same choice `negotiate` makes on both sides; the initiator enables this scope right after its hello.
        wait.scope = this.group.roster()?.repoId ?? remote?.repoId ?? hello.repoId;
        wait.attempts = 0;
        wait.nextAt = Date.now() + PEER_PENDING_TICK_MS;
      } catch {
        wait.scope = null;
        wait.failedAt = identity;
        wait.attempts = Math.min(wait.attempts + 1, 16);
        wait.nextAt = Date.now() + Math.min(PEER_PENDING_TICK_MS * 2 ** (wait.attempts - 1), FOLLOWER_PROBE_MAX_MS);
        return false;
      }
    }
    return this.hasGrant(peerId, wait.scope);
  }

  /** Archive leftover governance that blocks pairing again with `peerId` (see `rejoinState`). False when it cannot be. */
  private prepareRejoin(self: string, peerId: string): boolean {
    const state = this.group.rejoinState(peerId, true);
    if (state.kind === 'blocked') { this.logOnce(`rejoin:${peerId}`, `pairing again is blocked: ${state.reason}`); return false; }
    if (state.kind === 'detach') {
      this.group.detachForRejoin(self, peerId, true);
      this.following.delete(peerId);
      this.logOnce(`rejoin-detach:${peerId}`, 'archived the sync group left over from an earlier removal to pair again');
    }
    return true;
  }

  /**
   * A setup with a former member, kept beside the group left over from an earlier removal, can never finish, and the other
   * computer waits for this one to set that group aside. This side owns that state, so it archives it on its own tick
   * rather than waiting for an owner action or the peer; the next automatic enable then pairs again from a fresh replica.
   */
  private setAsideStaleSetup(): void {
    const consent = this.group.consent(), self = this.group.localPeerId();
    if (!consent || !self || this.enabling || this.revoking || this.group.rejoinState(consent.peerId, true).kind !== 'detach') return;
    this.prepareRejoin(self, consent.peerId);
  }

  /**
   * A setup with a computer that has no connection can never finish: enabling needs core's mutual
   * enrollment, which only a connection provides. Left alone it shows "Setup pending" forever with nothing to press, and blocks a
   * fresh pairing with another computer ("another database setup is pending"). Dropped here after a grace period (looked at
   * on two consecutive reads and for `orphanGraceMs`) so a link about to come up is never raced. Never touches a frozen join,
   * a live sync group, or documents. An unreadable connection list means "unknown", never "none" (the read is skipped).
   */
  private discardOrphanSetup(connections: PeerConnection[]): void {
    const consent = this.group.consent();
    const orphaned = !!consent && !this.enabling && !this.revoking && consent.state === 'pending' && !consent.request && !consent.capacity &&
      !this.group.liveRoster() &&
      !connections.some((connection) => connection.computerId === consent.peerId);
    if (!orphaned) { this.orphan = null; return; }
    const now = Date.now();
    if (this.orphan?.peerId !== consent.peerId) this.orphan = { peerId: consent.peerId, since: now, ticks: 0 };
    this.orphan.ticks++;
    if (this.orphan.ticks < 2 || now - this.orphan.since < (this.hooks.orphanGraceMs ?? ORPHAN_SETUP_GRACE_MS)) return;
    const peerId = consent.peerId;
    this.orphan = null;
    if (!this.group.discardUnfrozenSetup(peerId)) return;
    // Its undelivered work is moot too, unless a sync group's history still owes the other computer a delivery.
    const jobs = this.group.roster() ? 0 : this.group.resetPeer(peerId);
    this.logOnce(`orphan:${peerId}`, `discarded the unfinished database setup with ${peerId}: no connection to it and no pairing under way (${jobs} stuck job(s) cleared)`);
  }

  private async hasGrant(peerId: string, scope: string): Promise<boolean> {
    return this.grant(peerId, scope).then(() => true, () => false);
  }

  /**
   * Owner action on one computer whose link is live but which is not in the sync group. Re-tries enabling sync; if that
   * fails, re-links only this connection and tries once more. Authorized here (the renderer is untrusted): the peer must
   * have a live linked pairing. Idempotent, and it only runs the same enable path an invitation does, so it grants no
   * execution authority and never touches other computers or the key storage.
   */
  async repair(peerId: string): Promise<RepairResult> {
    id.parse(peerId);
    if (this.connectionsApi() && !(await this.listConnections()).some((connection) => connection.computerId === peerId)) {
      throw new PeerProtocolError('invalid', 'no connection to that computer; connect it in Settings first');
    }
    const status = await this.status();
    if (status.lifecycleChecking) return { outcome: 'pending', detail: 'Checking sync status. Setup will retry automatically; no action needed.', reason: null };
    if (syncedWith(status, peerId)) return { outcome: 'already-synced', detail: null, reason: null };
    if (!status.lifecycleAvailable) {
      // Re-linking cannot help while the key is unusable; say why instead of churning the connection.
      return { outcome: 'unavailable', detail: null, reason: status.lifecycleReason ?? 'unknown' };
    }
    // Core enrollment is the precondition of every enable; re-linking cannot create it, so say so instead of failing opaquely.
    const enrolled = (await this.peers.enrolled({ signal: this.abort.signal })).find((peer) => peer.id === peerId);
    if (!enrolled) {
      return { outcome: 'unavailable', reason: null,
        detail: 'The connection exists but this computer was never fully enrolled (the pairing was cancelled part-way). Remove it in Settings → Peers and connect again.' };
    }
    if (!enrolled.connected) return { outcome: 'unavailable', reason: null, detail: 'That computer is offline. Open Zana there, then press Repair again.' };
    const rejoin = this.group.rejoinState(peerId, true);
    if (rejoin.kind === 'blocked') return { outcome: 'unavailable', reason: null, detail: rejoin.reason };
    if (rejoin.kind === 'detach') this.prepareRejoin(id.parse((await this.peers.localIdentity()).id), peerId);
    const attempt = async (): Promise<unknown> => { this.disabledPeers.delete(peerId); await this.enableNow(peerId); return null; };
    // `negotiate` records a half-finished setup as a pending consent instead of throwing, so success means the peer joined the roster.
    const settled = async (outcome: 'sync-enabled' | 'relinked'): Promise<RepairResult> => {
      this.enableError = null;
      const joined = this.group.liveRoster(), consent = this.group.consent();
      if (joined?.members.some((entry) => entry.machineId === peerId && !isRetiring(joined, entry.replicaId))) return { outcome, detail: null, reason: null };
      const error = consent?.peerId === peerId ? ownerText(consent.error) : null;
      return { outcome: 'pending', reason: null, detail: error ? SETUP_GUIDANCE[error] ?? `Sync setup started but has not finished: ${error}`
        : 'Sync setup started on this computer and is waiting for the other computer to join. If it does not finish in a minute, open Design Docs settings on the other computer and press Repair on this computer\'s card.' };
    };
    try { await attempt(); return await settled('sync-enabled'); }
    catch (first) {
      this.abort.signal.throwIfAborted();
      // A sync-group conflict is governance, not transport: re-linking would only revoke the link's grants on both sides.
      if (first instanceof PeerProtocolError && first.code === 'conflict') {
        this.logOnce(`repair-enable:${peerId}`, `repair: enable failed: ${first.message}`);
        return { outcome: 'unavailable', detail: first.message, reason: null };
      }
      this.logOnce(`repair-enable:${peerId}`, `repair: enable failed: ${this.message(first)}`);
      return { outcome: 'unavailable', reason: null,
        detail: this.message(first) === ENROLLMENT_UNAVAILABLE ? RELINK_NOT_BACK : `Sync setup failed: ${this.message(first)}. Reconnect the computer from Settings → Peers, then retry sync.` };
    }
  }

  /**
   * Owner action "Reset sync with this computer" (confirmed in the UI): discard undelivered sync work for that computer only
   * which already failed (see `DesignDocPeerGroup.resetPeer`), then let setup run again. Never deletes documents or history
   * and never touches other computers' work or the link itself.
   */
  async resetPeer(peerId: string): Promise<{ discarded: number; status: GroupStatus }> {
    if (!id.safeParse(peerId).success) throw new PeerProtocolError('invalid', 'peerId is not a valid computer id');
    if (this.enabling || this.revoking) throw new PeerProtocolError('conflict', 'database lifecycle action already running');
    await this.running?.catch(() => {});
    // A setup that can no longer finish (no connection, or stuck) is dropped too; a frozen join is left for its original sponsor.
    const discarded = this.group.resetPeer(peerId) + (this.group.discardUnfrozenSetup(peerId) ? 1 : 0);
    this.orphan = null;
    this.logOnce(`reset:${peerId}:${discarded}`, `reset sync with ${peerId}: discarded ${discarded} undelivered job(s)`);
    this.disabledPeers.delete(peerId);
    await this.retry(true);
    return { discarded, status: await this.status() };
  }

  /** Bounded wait (abortable) until core lists `peerId` as enrolled and connected again. */
  private async enrolledAgain(peerId: string): Promise<boolean> {
    const { timeoutMs, intervalMs } = this.hooks.relinkWait ?? RELINK_WAIT, deadline = Date.now() + timeoutMs;
    for (;;) {
      this.abort.signal.throwIfAborted();
      const enrolled = await this.peers.enrolled({ signal: this.abort.signal }).catch(() => []);
      if (enrolled.some((peer) => peer.id === peerId && peer.connected)) return true;
      if (Date.now() + intervalMs > deadline) return false;
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); this.abort.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, intervalMs);
        this.abort.signal.addEventListener('abort', done, { once: true });
      });
    }
  }

  /** Log a failure once per distinct message (the poll tick would otherwise repeat it forever). */
  private logOnce(key: string, text: string): void {
    const entry = `${key}|${text}`;
    if (this.logged.has(entry)) return;
    if (this.logged.size >= 64) this.logged.clear();
    this.logged.add(entry);
    console.warn(`[design-docs] ${text}`);
  }

  /**
   * True only when a connected member's database state differs from this one. Compares opaque digests, so neither a
   * document name, count nor any content crosses the wire or reaches the UI. Unreachable or older peers read as in sync.
   */
  async outOfSync(): Promise<boolean> {
    const digest = this.hooks.stateDigest?.(), local = this.group.sync.localRepository();
    if (!digest || !local) return false;
    for (const machineId of await this.connectedMembers()) {
      try {
        const reply = z.object({ digest: z.string().nullable() }).strict().parse(await this.peers.call(machineId, 'state-digest', {}, this.options(local.repoId)));
        if (reply.digest !== null && reply.digest !== digest) return true;
      } catch { /* unknown is not drift */ }
    }
    return false;
  }

  /** Tell connected members this database just changed (after a Sync Now) so they re-check. Content-free and best effort. */
  async notifyStateChanged(): Promise<void> {
    const local = this.group.sync.localRepository();
    if (!local) return;
    await Promise.all((await this.connectedMembers()).map((machineId) =>
      this.peers.call(machineId, 'state-changed', {}, this.options(local.repoId)).catch(() => undefined)));
  }

  /** Other, non-retiring group members with exactly one connected grant for this group's scope. */
  async connectedMembers(): Promise<string[]> {
    const roster = this.group.liveRoster(), local = this.group.sync.localRepository();
    if (!roster || !local) return [];
    let grants: Awaited<ReturnType<PluginSdkPeers['list']>>;
    try { grants = await this.peers.list({ signal: this.abort.signal }); } catch { return []; }
    return roster.members
      .filter((member) => member.replicaId !== local.replicaId && !isRetiring(roster, member.replicaId))
      .filter((member) => grants.filter((grant) => grant.id === member.machineId && grant.scope === local.repoId && grant.connected).length === 1)
      .map((member) => member.machineId);
  }

  async status(): Promise<GroupStatus> {
    const features = await this.peers.features();
    let peers: Awaited<ReturnType<PluginSdkPeers['list']>> = [], enrolled: Awaited<ReturnType<PluginSdkPeers['enrolled']>> = [];
    let available = features.lifecycle;
    let checking = false;
    let reason: PeerLifecycleReason | null = available ? null : 'core-unsupported';
    try {
      [peers, enrolled] = await Promise.all([this.peers.list({ signal: this.abort.signal }), this.peers.enrolled({ signal: this.abort.signal })]);
    } catch (error) {
      this.abort.signal.throwIfAborted();
      const text = error instanceof Error ? error.message : String(error);
      reason = lifecycleReasonOf(error);
      // Only an enrollment transition is a temporary status check; a definitive (even untagged) key failure fails closed.
      checking = features.lifecycle && isTransient(error);
      if (!isTransient(error)) {
        if (text !== this.lifecycleWarning) console.warn(`[design-docs] peer lifecycle unavailable (${reason}): ${text}`);
        this.lifecycleWarning = text;
      }
      available = false;
    }
    if (available) this.lifecycleWarning = null;
    this.lifecycleReason = available ? null : reason;
    const local = this.group.sync.localRepository()!, roster = this.group.roster(), consent = this.group.consent();
    return { configured: !!this.group.liveRoster(), repoId: local.repoId, replicaId: local.replicaId, roster,
      members: (roster?.members ?? []).map((member) => {
        const grants = peers.filter((peer) => peer.id === member.machineId && peer.scope === local.repoId);
        const grant = grants.length === 1 ? grants[0] : undefined, self = member.replicaId === local.replicaId;
        const retiring = isRetiring(roster!, member.replicaId);
        return { ...member, retiring, authorized: !retiring && (self || !!grant), connected: self || !!grant?.connected, grantEpoch: grant?.grantEpoch ?? null };
      }), jobs: this.group.jobs().map(({ payload: _payload, ...job }) => job), peers,
      enrolled: enrolled.map(({ id, name, connected }) => ({ id, name, connected })),
      setup: consent ? { peerId: consent.peerId, repoId: consent.repoId, state: consent.state, error: consent.error } : null,
      lifecycleAvailable: available, lifecycleChecking: checking, lifecycleReason: this.lifecycleReason, introductionsAvailable: available && features.introductions, installerAvailable: false };
  }

  /** Explicit owner action: also lifts a local Disable Link. */
  async enable(peerId: string): Promise<GroupStatus> {
    id.parse(peerId);
    this.disabledPeers.delete(peerId);
    return this.enableNow(peerId);
  }

  private async enableNow(peerId: string): Promise<GroupStatus> {
    id.parse(peerId);
    if (this.enabling || this.revoking) return Promise.reject(new PeerProtocolError('conflict', 'database lifecycle action already running'));
    this.enablingPeer = peerId;
    this.enabling = this.negotiate(peerId).finally(() => { this.enabling = null; this.enablingPeer = null; });
    return this.enabling;
  }

  private async negotiate(peerId: string): Promise<GroupStatus> {
    if (!(await this.peers.features()).lifecycle) throw new PeerProtocolError('invalid', 'core peer lifecycle unavailable');
    const consent = this.group.consent();
    if (consent && consent.peerId !== peerId) throw new PeerProtocolError('conflict', 'another database setup is pending');
    if (consent?.request) { await this.retry(true); return this.status(); }
    const self = id.parse((await this.peers.localIdentity()).id), scope = bootstrapScope(self, peerId);
    const enrolled = await this.peers.enrolled({ signal: this.abort.signal });
    if (!enrolled.some((peer) => peer.id === peerId && peer.connected)) throw new PeerProtocolError('invalid', ENROLLMENT_UNAVAILABLE);
    const rejoin = this.group.rejoinState(peerId);
    if (rejoin.kind === 'blocked') throw new PeerProtocolError('conflict', rejoin.reason);
    if (rejoin.kind === 'detach') this.prepareRejoin(self, peerId);
    await this.peers.enable(peerId, { scope, signal: this.abort.signal });
    const before = await this.grant(peerId, scope);
    const hello = helloSchema.parse(await this.peers.call(peerId, 'group-hello', {}, this.options(scope)));
    if (hello.peerId !== peerId || hello.scope !== scope) throw new PeerProtocolError('invalid', 'setup peer identity or scope changed');
    // A roster the other side has left is its history, not a group to combine with or join.
    const remote = liveRemote(hello), local = this.group.sync.localRepository()!, roster = this.group.roster();
    if (remote && remote.repoId !== hello.repoId) throw new PeerProtocolError('invalid', 'peer database scope mismatch');
    if (remote && roster && remote.groupId !== roster.groupId) throw new PeerProtocolError('conflict', 'cannot combine existing groups');
    const chosen = roster?.repoId ?? remote?.repoId ?? (self < peerId ? local.repoId : hello.repoId);
    await this.sameGrant(peerId, scope, before.grantEpoch);
    this.group.enable(self, peerId, chosen, hello.replicaId);
    try {
      await this.peers.enable(peerId, { scope: chosen, signal: this.abort.signal });
      await this.retry();
    } catch (error) { this.group.setupState('pending', this.message(error)); }
    return this.status();
  }

  async remove(replicaId: string): Promise<GroupStatus> {
    id.parse(replicaId);
    if (!(await this.peers.features()).lifecycle) throw new PeerProtocolError('invalid', 'core peer lifecycle unavailable');
    // Barrier commits first; offline targets stay pending until their committed frontier is sealed.
    this.group.remove(this.dissolvesTo(replicaId) ?? replicaId);
    await this.retry();
    return this.status();
  }

  /**
   * In a two-member group, removing the only other computer ends the pairing: core refuses to shrink a group below two by
   * removing another member, so this computer leaves instead (its own retirement seals locally, the other side receives the
   * roster, drops the link and keeps a one-member roster). Returns this computer's replica id for that case, else undefined.
   */
  private dissolvesTo(replicaId: string): string | undefined {
    const roster = this.group.roster(), local = this.group.sync.localRepository()!;
    if (!roster || replicaId === local.replicaId || roster.members.length !== 2 ||
      !roster.members.some((member) => member.replicaId === local.replicaId) ||
      !roster.members.some((member) => member.replicaId === replicaId) || isRetiring(roster, replicaId)) return undefined;
    return local.replicaId;
  }

  async revoke(peerId: string): Promise<GroupStatus> {
    id.parse(peerId);
    if (this.revoking) throw new PeerProtocolError('conflict', 'database revocation already running');
    this.revoking = this.disable(peerId).finally(() => { this.revoking = null; });
    return this.revoking;
  }

  private async disable(peerId: string): Promise<GroupStatus> {
    const self = id.parse((await this.peers.localIdentity()).id);
    bootstrapScope(self, peerId);
    this.disabledPeers.add(peerId);
    await this.enabling?.catch(() => {});
    await this.running?.catch(() => {});
    const local = this.group.sync.localRepository()!;
    this.group.cancelSetup(peerId);
    this.group.queueJob(self, 'local-revoke', local.rosterEpoch, { peerId, scope: local.repoId, localOnly: true });
    await this.retry(true);
    // Release this plugin's use too; core keeps the connection itself.
    const connections = this.peers.connections;
    if (typeof connections?.stopUsing === 'function') {
      await connections.stopUsing(peerId, { signal: this.abort.signal }).catch((error) => {
        this.abort.signal.throwIfAborted();
        this.logOnce(`stop-using:${peerId}`, `releasing the connection use failed: ${this.message(error)}`);
      });
      this.lastUse.delete(peerId);
    }
    return this.status();
  }

  retry(force = false): Promise<void> {
    if (force) this.group.retryJobs();
    if (this.running) return this.running;
    this.running = this.work().finally(() => { this.running = null; });
    return this.running;
  }

  private async work(): Promise<void> {
    if (this.abort.signal.aborted) return;
    this.setAsideStaleSetup();
    const consent = this.group.consent();
    if (consent && !this.group.roster() && !this.revoking) {
      try {
        if (!consent.request) {
          // A link re-key (the inviter's first rotation, Reconnect) revokes every grant on it. Only the initiator (lower id)
          // re-creates bindings, the bootstrap one too: the follower answers only once that binding exists, so without it
          // setup never completes. A follower re-creating the database binding at the same time as the initiator (or a
          // sponsor's `restoreSponsorBindings`) would leave two bindings and fail every later enable as ambiguous.
          const self = this.group.localPeerId();
          if (self && self < consent.peerId) {
            await this.peers.enable(consent.peerId, { scope: bootstrapScope(self, consent.peerId), signal: this.abort.signal });
            await this.peers.enable(consent.peerId, { scope: consent.repoId, signal: this.abort.signal });
          }
        }
        const before = await this.grant(consent.peerId, consent.repoId);
        const hello = helloSchema.parse(await this.peers.call(consent.peerId, 'group-hello', {}, this.options(consent.repoId)));
        const roster = hello.roster === null ? null : parseRoster(hello.roster), local = this.group.sync.localRepository()!;
        if (hello.repoId !== consent.repoId || hello.peerId !== consent.peerId) throw new PeerProtocolError('invalid', 'waiting for remote database enablement');
        // Never freeze a join into a group the other side left, or one that removed this computer: no admission can come
        // of it and a frozen request never moves. The other side archives that history once it pairs again.
        if (roster && !consent.request && (!liveRemote(hello) || historicalMembers(roster).some((member) => member.machineId === this.group.localPeerId() && member.replicaId !== local.replicaId))) {
          throw new PeerProtocolError('invalid', 'waiting for the other computer to set aside the sync group from an earlier removal');
        }
        // The other side detached to pair again: an unfrozen consent follows its new replica.
        if (hello.replicaId !== consent.replicaId && !(roster === null && this.group.repinConsent(consent.peerId, consent.repoId, hello.replicaId))) {
          throw new PeerProtocolError('invalid', 'waiting for remote database enablement');
        }
        if (!roster && this.group.localPeerId()! < consent.peerId) return;
        const request = this.group.freezeJoin({ requestId: consent.requestId, repoId: consent.repoId, groupId: roster?.groupId ?? null,
          sponsorReplicaId: hello.replicaId, member: { replicaId: local.replicaId, machineId: this.group.localPeerId()!,
            joinedAt: 0, sponsorReplicaId: hello.replicaId } });
        let installed: GroupRoster;
        if (roster && (this.group.containsAdmission(roster, request) || isRetiring(roster, request.sponsorReplicaId))) {
          const result = z.object({ receipt: z.unknown(), roster: z.unknown() }).strict().parse(
            await this.peers.call(consent.peerId, 'group-join-receipt', request, this.options(consent.repoId)));
          const immutable = this.receipt(result.receipt, request);
          installed = parseRoster(result.roster);
          if (!rosterCovers(installed, immutable.roster)) throw new PeerProtocolError('invalid', 'recovery roster does not cover immutable receipt');
        } else {
          const immutable = this.receipt(await this.peers.call(consent.peerId, 'group-join', request, this.options(consent.repoId)), request);
          const result = z.object({ receipt: z.unknown(), roster: z.unknown() }).strict().parse(
            await this.peers.call(consent.peerId, 'group-join-receipt', request, this.options(consent.repoId)));
          const recovered = this.receipt(result.receipt, request);
          installed = parseRoster(result.roster);
          if (recovered.roster.digest !== immutable.roster.digest || !rosterCovers(installed, immutable.roster)) {
            throw new PeerProtocolError('invalid', 'recovery roster does not cover immutable receipt');
          }
        }
        await this.sameGrant(consent.peerId, consent.repoId, before.grantEpoch);
        this.group.apply(installed, consent.peerId);
        this.group.setupState('joining', null);
      } catch (error) { this.group.setupState('pending', this.message(error)); }
    } else if (consent && !consent.request && !this.revoking) await this.restoreSponsorBindings(consent);
    for (const job of this.group.jobs(true)) {
      if (this.abort.signal.aborted) return;
      try {
        const local = this.group.sync.localRepository()!, roster = this.group.roster();
        // Work for a computer that is no longer a member and whose link is gone can never be delivered; ending it keeps a
        // removed computer from showing as blocked forever.
        if ((job.kind === 'retire' || job.kind === 'roster') && !roster?.members.some((member) => member.machineId === job.peerId) &&
          !(await this.peers.list({ signal: this.abort.signal })).some((grant) => grant.id === job.peerId)) {
          this.group.supersedeJob(job.id, 'the link to that computer was removed');
          continue;
        }
        if (job.kind === 'retire') {
          const input = retirementJobSchema.parse(job.payload);
          if (!roster || input.scope !== roster.repoId) throw new PeerProtocolError('invalid', 'retirement job scope mismatch');
          if (!roster.removals.some((event) => event.replicaId === input.replicaId)) {
            if (roster.closures.some((closure) => closure.replicaId === input.replicaId)) this.group.apply(roster, this.group.localPeerId()!);
            else {
              const before = await this.grant(job.peerId, roster.repoId);
              let delivered = roster;
              if (roster.closures.some((closure) => closure.replicaId === local.replicaId)) {
                const hello = helloSchema.parse(await this.peers.call(job.peerId, 'group-hello', {}, this.options(roster.repoId)));
                if (hello.peerId !== job.peerId || hello.scope !== roster.repoId || hello.repoId !== roster.repoId || hello.replicaId !== input.replicaId) {
                  throw new PeerProtocolError('invalid', 'retirement target identity mismatch');
                }
                if (hello.roster === null) throw new PeerProtocolError('invalid', NO_GROUP_ANYMORE);
                delivered = retirementEvidence(roster, parseRoster(hello.roster), local.replicaId);
              }
              const result = z.object({ roster: z.unknown() }).strict().parse(
                await this.peers.call(job.peerId, 'group-retire', delivered, this.options(roster.repoId)));
              const sealed = parseRoster(result.roster);
              if (!rosterCovers(sealed, delivered) || !sealed.closures.some((closure) => closure.replicaId === input.replicaId && closure.admission === input.admission)) {
                throw new PeerProtocolError('invalid', 'retirement ACK missing committed frontier');
              }
              await this.sameGrant(job.peerId, roster.repoId, before.grantEpoch);
              const sender = historicalMembers(roster).find((member) => member.machineId === job.peerId)!;
              const terminal = !roster.members.some((member) => member.replicaId === sender.replicaId) || roster.closures.some((closure) => closure.replicaId === sender.replicaId);
              const evidence = terminal ? retirementEvidence(sealed, roster, sender.replicaId) : sealed;
              this.group.apply(evidence, job.peerId);
            }
          }
          if (!this.group.roster()!.removals.some((event) => event.replicaId === input.replicaId)) throw new PeerProtocolError('invalid', 'waiting for retirement completion');
        } else if (job.kind === 'local-revoke') {
          const input = localRevokeSchema.parse(job.payload);
          if (!input.localOnly && local.groupId && roster?.members.some((member) => member.machineId === input.peerId)) throw new PeerProtocolError('invalid', 'member still in roster');
          // Dropping our own link never waits on another computer: it may be offline forever or may already have dropped
          // its side, which makes delivery impossible. Delivery is best effort and ends with the link.
          await this.peers.revoke(input.peerId, { scope: input.scope });
          await this.peers.revoke(input.peerId, { scope: bootstrapScope(job.peerId, input.peerId) });
        } else if (job.kind === 'revoke') {
          await this.peers.call(job.peerId, 'group-revoke', job.payload, this.options(local.repoId));
        } else if (job.kind === 'introduce') {
          const input = introductionSchema.parse(job.payload);
          if (!roster || local.groupId !== roster.groupId || local.repoId !== roster.repoId || input.scope !== local.repoId ||
            job.peerId !== this.group.localPeerId() ||
            !roster.members.some((member) => member.replicaId === local.replicaId && member.machineId === job.peerId && !isRetiring(roster, member.replicaId)) ||
            !roster.members.some((member) => member.machineId === input.peerId && !isRetiring(roster, member.replicaId)) ||
            !roster.members.some((member) => member.machineId === input.sponsorPeerId && !isRetiring(roster, member.replicaId))) throw new PeerProtocolError('invalid', 'introduction roster changed');
          const result = await this.peers.introduce(input.peerId, { sponsorPeerId: input.sponsorPeerId, scope: input.scope, signal: this.abort.signal });
          if (result.status !== 'complete') throw new PeerProtocolError('invalid', `automatic introduction ${result.status}; Machines installer unavailable`);
        } else {
          const next = parseRoster(job.payload);
          if (!roster || !rosterCovers(roster, next)) throw new PeerProtocolError('invalid', 'roster job not covered locally');
          const before = await this.grant(job.peerId, next.repoId);
          let delivered = next;
          const self = local.replicaId;
          if (roster.closures.some((closure) => closure.replicaId === self)) {
            const hello = helloSchema.parse(await this.peers.call(job.peerId, 'group-hello', {}, this.options(next.repoId)));
            if (hello.peerId !== job.peerId || hello.scope !== next.repoId || hello.repoId !== next.repoId) {
              throw new PeerProtocolError('invalid', 'retirement delivery peer identity mismatch');
            }
            // The other computer already set this group aside: setting aside always starts a fresh replica, so it answers
            // with a replica this group never admitted (or a roster of another group). Nobody is left to tell about this
            // removal; waiting would block this computer's link revocation and pairing again forever. A member replica
            // with no roster yet is a joiner whose admission reply was lost: it still gets the roster.
            const known = hello.roster === null ? null : parseRoster(hello.roster);
            if ((known && known.groupId !== roster.groupId) ||
              !historicalMembers(roster).some((member) => member.machineId === job.peerId && member.replicaId === hello.replicaId)) {
              this.logOnce(`superseded:${job.id}`, `removal delivery to ${job.peerId} superseded: it already set the sync group aside`);
              this.group.supersedeJob(job.id, 'the other computer already set this sync group aside');
              continue;
            }
            delivered = retirementEvidence(next, known ?? { ...next, closures: [] }, self);
          }
          const result = z.object({ roster: z.unknown() }).strict()
            .parse(await this.peers.call(job.peerId, 'group-roster', delivered, this.options(next.repoId)));
          const acknowledged = parseRoster(result.roster);
          if (!rosterCovers(acknowledged, next)) throw new PeerProtocolError('invalid', 'roster ACK does not cover delivered governance');
          await this.sameGrant(job.peerId, next.repoId, before.grantEpoch);
          if (!this.group.coveredHistoricalAck(acknowledged, job.peerId)) this.group.apply(acknowledged, job.peerId);
        }
        this.group.finishJob(job.id);
      } catch (error) {
        const text = this.message(error), permanent = isPermanent(error);
        if (permanent) this.logOnce(`job:${job.kind}:${job.peerId}`, `${job.kind} job for ${job.peerId} failed: ${technical(error)}`);
        this.group.finishJob(job.id, text, permanent);
      }
    }
  }

  /**
   * Sponsor side of a pending admission. A link re-key (the inviter's first rotation, Reconnect) can revoke the bindings
   * the sponsor created in `negotiate` before the newcomer answered. The newcomer joins only once both bindings exist, and
   * when the sponsor is the initiator (lower id) nobody else may re-create them, so without this the admission never
   * starts. Only missing bindings are re-enabled, so a settled setup costs one grant listing per tick.
   */
  private async restoreSponsorBindings(consent: { peerId: string; repoId: string; state: 'pending' | 'joining'; error: string | null }): Promise<void> {
    const roster = this.group.roster(), self = this.group.localPeerId();
    if (!roster || !self || self >= consent.peerId || consent.repoId !== roster.repoId ||
      roster.members.some((member) => member.machineId === consent.peerId)) return;
    try {
      const grants = await this.peers.list({ signal: this.abort.signal });
      for (const scope of [bootstrapScope(self, consent.peerId), consent.repoId]) {
        if (!grants.some((grant) => grant.id === consent.peerId && grant.scope === scope)) {
          await this.peers.enable(consent.peerId, { scope, signal: this.abort.signal });
        }
      }
      if (consent.error) this.group.setupState(consent.state, null);
    } catch (error) { this.group.setupState('pending', this.message(error)); }
  }

  private receipt(raw: unknown, request: Admission) {
    const receipt = receiptSchema.parse(raw), roster = parseRoster(receipt.roster);
    if (receipt.requestId !== request.requestId || roster.repoId !== request.repoId ||
      (request.groupId && roster.groupId !== request.groupId) ||
      !this.group.containsAdmission(roster, request) || !roster.members.some((member) => member.replicaId === request.member.replicaId)) {
      throw new PeerProtocolError('invalid', 'join receipt identity mismatch');
    }
    return { ...receipt, roster };
  }

  private async grant(peerId: string, scope: string) {
    const grants = (await this.peers.list({ signal: this.abort.signal })).filter((peer) => peer.id === peerId && peer.scope === scope);
    if (grants.length !== 1 || !grants[0]!.connected || !Number.isSafeInteger(grants[0]!.grantEpoch) || grants[0]!.grantEpoch < 1) {
      throw new PeerProtocolError('invalid', 'the other computer has not finished setting up the connection yet');
    }
    return grants[0]!;
  }
  private async acquireCapacity(input: Admission, request: PluginPeerRequest): Promise<void> {
    const roster = this.group.roster()!, local = this.group.sync.localRepository()!;
    if (currentMemberCount(roster) >= 8) throw new PeerProtocolError('limit', 'group full (8)');
    const prior = this.group.consent()?.capacity;
    const grants = await this.peers.list({ signal: this.abort.signal });
    const donor = prior ? roster.members.find((member) => member.replicaId === prior.donorReplicaId) :
      [...roster.members].sort((a, b) => a.machineId < b.machineId ? -1 : 1).find((member) =>
        member.replicaId !== local.replicaId && ownedSeats(roster, member.replicaId).length &&
        grants.some((grant) => grant.id === member.machineId && grant.scope === roster.repoId && grant.connected));
    if (!donor) throw new PeerProtocolError('limit', CAPACITY_WAIT);
    const capacity = await request.commitSync(() => {
      this.fence(request); this.group.authorizeSponsor(input, request.peerId);
      return this.group.freezeCapacity({ requestId: capacityRequestId(input.requestId, donor.replicaId), admissionRequestId: input.requestId,
        repoId: roster.repoId, groupId: roster.groupId, donorReplicaId: donor.replicaId, recipientReplicaId: local.replicaId });
    });
    const before = await this.grant(donor.machineId, roster.repoId);
    const result = z.object({ requestId: id, roster: z.unknown(), unavailable: z.literal(true).optional() }).strict().parse(
      await this.peers.call(donor.machineId, 'group-capacity', capacity, this.options(roster.repoId)));
    const transferred = parseRoster(result.roster);
    if (result.requestId !== capacity.requestId || (!result.unavailable && !transferred.seats.some((seat) => seat.events.some((event) =>
      event.kind === 'transfer' && event.requestId === capacity.requestId && event.ownerReplicaId === donor.replicaId && event.recipientReplicaId === local.replicaId)))) {
      throw new PeerProtocolError('invalid', 'capacity receipt mismatch');
    }
    await this.sameGrant(donor.machineId, roster.repoId, before.grantEpoch);
    await request.commitSync(() => {
      this.fence(request); this.group.authorizeSponsor(input, request.peerId);
      this.group.apply(transferred, donor.machineId); this.group.clearCapacity();
    });
    if (result.unavailable) throw new PeerProtocolError('limit', CAPACITY_WAIT);
  }
  private async sameGrant(peerId: string, scope: string, epoch: number): Promise<void> {
    if ((await this.grant(peerId, scope)).grantEpoch !== epoch || this.abort.signal.aborted) throw new PeerProtocolError('invalid', 'authorization changed before control ACK');
  }
  private fence(request: PluginPeerRequest): void {
    if (!request.commitSync || !request.signal || request.signal.aborted || this.abort.signal.aborted ||
      !Number.isSafeInteger(request.grantEpoch) || request.grantEpoch < 1 || !id.safeParse(request.scope).success || !id.safeParse(request.peerId).success) {
      throw new PeerProtocolError('invalid', 'matching core peer commit fence required');
    }
  }
  private options(scope: string) { return { scope, signal: this.abort.signal, timeoutMs: PEER_CALL_TIMEOUT_MS }; }
  private message(error: unknown): string {
    if (error instanceof z.ZodError) this.logOnce('unreadable-reply', `peer reply failed validation: ${technical(error)}`);
    return readableError(error);
  }
}
