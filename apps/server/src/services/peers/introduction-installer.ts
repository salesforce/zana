import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { addHostLinkUse, destroyHost, getHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { enrollDaemonHost } from '@zana-ai/zcc-host-daemon/enroll';
import { startEnrolledHostConnection } from '@zana-ai/zcc-host-daemon/server-connection';
import { connectHostFetch } from '@zana-ai/zcc-host-daemon/connect-access';
import { createCommandRuntime } from '@zana-ai/zcc-host-daemon/command-dispatch';
import { createStoredLocalPeerAppResolver } from '@zana-ai/zcc-host-daemon/peer-forward';
import type { HostHub } from '../../http/host-hub.js';
import type { JoinCodeStore } from '../hosts/join-codes.js';
import type { ConnectFetch } from '../../mobile/connect-account.js';
import {
  connection as connectConnection, connectAttemptSecret, issueConnectPeerLinkCode, listConnectPeerLinkNames, peerLinkHostName,
  redeemConnectPeerLinkCode, revokeConnectPeerLink, sameAccountInstance
} from '../hosts/connect-enrollment.js';
import type { EnrolledPeerChannels } from './enrolled-peer-channels.js';
import { PEER_ID, PEER_TOKEN, PrivatePeerStorage, validScope, type PeerKeyProvider } from './peer-auth.js';
import type { EnrollmentOffer } from './peer-control-protocol.js';
import { validatePeerRoute } from './peer-route.js';
import type { ReceivedIntroduction, ScopedLinkAuthority } from './scoped-link-authority.js';

const id = z.string().regex(PEER_ID), uuid = z.string().uuid();
const linkSchema = z.object({
  /** The introduction this link's enrollment exchange runs under (the initiator's received introduction). */
  introductionId: id, role: z.enum(['requester', 'responder']), sponsorInstanceId: id, peerInstanceId: id,
  pluginId: z.string().regex(PEER_TOKEN), scope: z.string().refine(validScope),
  /** `awaiting`: this owner consented, the pair waits for the other owner. Nothing is minted while awaiting. */
  status: z.enum(['awaiting', 'pending', 'enrolled', 'failed']), createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
  /** Host in this app's DB that the peer's daemon enrolls as (minted forward-only here). */
  inboundHostId: uuid.optional(),
  /** This app's forward-only daemon credentials on the peer's server. */
  /** `route` is the peer's server URL; with `credential` it is the Connect-attested `serverUrl` (Connect form). */
  outbound: z.object({ hostId: uuid, hostKey: z.string().min(32).max(512), route: z.string().max(2048),
    credential: z.string().regex(/^[\w-]{43}$/).optional() }).strict().optional(),
  /** Responder only: the single-use code minted for the requester, reused while unredeemed and unexpired. */
  offer: z.object({ joinCode: z.string().regex(/^zcde_[A-Za-z0-9_-]{24}$/).optional(), hostId: uuid, expiresAt: z.number().int(),
    connect: z.object({ code: z.string().regex(/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/), accountUrl: z.string().max(2048), serverId: uuid }).strict().optional()
  }).strict().optional(),
  /** The inbound host was minted at this app's Connect server and is revoked there on teardown. */
  connectInbound: z.boolean().optional(),
  peerCodeHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** Awaiting responder only: the consent notice reached the initiator. */
  notified: z.boolean().optional()
}).strict();
type Link = z.infer<typeof linkSchema>;
/** Initiator only: the other owner's consent, relayed by an actively linked sponsor. It only unblocks; the responder re-checks its own consent. */
const consentSchema = z.object({ introductionId: id, sponsorInstanceId: id, peerInstanceId: id, pluginId: z.string().regex(PEER_TOKEN),
  scope: z.string().refine(validScope), receivedAt: z.number().int().nonnegative() }).strict();
type Consent = z.infer<typeof consentSchema>;
const stateSchema = z.object({ version: z.literal(1), links: z.array(linkSchema).max(32), consents: z.array(consentSchema).max(64).default([]) }).strict();
type State = z.infer<typeof stateSchema>;
type PairFields = { pluginId: string; scope: string; peerInstanceId: string };

export const INSTALLER_MAX_LINKS = 32;
export const INSTALLER_MAX_CONSENTS = 64;
export const INTRODUCTION_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const ENROLL_BUDGET_MS = 45_000, MUTUAL_WAIT_MS = 30_000, NOTIFY_BUDGET_MS = 20_000, RENOTIFY_PER_SWEEP = 8;

export interface PeerInstallation {
  introductionId: string; role: 'requester' | 'responder'; peerInstanceId: string; sponsorInstanceId: string;
  pluginId: string; scope: string; status: 'awaiting' | 'pending' | 'enrolled' | 'failed'; capability: 'peer.forward'; expiresAt: number; connected: boolean;
}
export interface InstallerConnection { ready: Promise<void>; close(): Promise<void> }
/** Seam for tests; production uses the real daemon enrollment and connection. */
export interface InstallerConnector {
  /** `connectCredential`: the minted Connect peer-transport credential when the peer is reached through Zana Connect. */
  /** `instanceId`: this app's product instance id, recorded as the enrolled daemon's instance (the peer's hub session claim). */
  enroll(input: { serverUrl: string; joinCode: string; hostName: string; signal: AbortSignal; connectCredential?: string; instanceId?: string }): Promise<{ hostId: string; hostKey: string }>;
  connect(input: { serverUrl: string; hostId: string; hostKey: string; expectedRemoteInstanceId: string; daemonDir: string; connectCredential?: string;
    localAppDataDir: string; instanceId?: string; onConnectionChange(connected: boolean): void }): InstallerConnection;
}

export const defaultInstallerConnector: InstallerConnector = {
  async enroll({ serverUrl, joinCode, hostName, signal, connectCredential, instanceId }) {
    // Fixed destination: no redirects, bounded by the caller's signal on top of the enroll timeout.
    const baseFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: 'error', credentials: 'omit',
      signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
    const fetchFn = connectHostFetch(serverUrl, connectCredential, baseFetch);
    const enrolled = await enrollDaemonHost({ serverUrl, token: joinCode, hostName, instanceId: instanceId ?? randomUUID(), homeDir: '/', fetchFn });
    return { hostId: enrolled.hostId, hostKey: enrolled.hostKey };
  },
  connect({ serverUrl, hostId, hostKey, expectedRemoteInstanceId, daemonDir, localAppDataDir, onConnectionChange, connectCredential, instanceId }) {
    const runtime = createCommandRuntime({ dataDir: daemonDir, emit() {},
      resolveLocalPeerApp: createStoredLocalPeerAppResolver(localAppDataDir) });
    return startEnrolledHostConnection({ serverUrl, hostId, hostKey, connectCredential, enrollmentCapability: 'peer.forward', expectedRemoteInstanceId,
      dataDir: daemonDir, localPeerAppDataDir: localAppDataDir, runtime, keepRetryingStartup: true, onConnectionChange, ...(instanceId ? { instanceId } : {}) });
  }
};

/**
 * Turns owner-approved introductions into one mutual `peer.forward` enrollment per unordered app pair and
 * (plugin, scope). Direction is deterministic: the lexicographically lower instance id initiates (requester);
 * the other side's approval only records consent, notifies the initiator through the sponsor and later answers
 * as responder. Nothing is minted until both owners consented, and the responder re-checks its own consent.
 * One-time codes travel only inside sealed peer.control packets (through the sponsor) and are never logged.
 * Every step is bounded; any failure tears down what this attempt created. Never creates an execution-tier
 * host: codes are minted forward-only and the daemon forces the forward tier.
 */
export class PeerIntroductionInstaller {
  private readonly storage: PrivatePeerStorage<State>;
  private readonly connections = new Map<string, { connection: InstallerConnection; connected: boolean }>();
  private readonly inFlight = new Map<string, Promise<PeerInstallation>>();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly controllers = new Set<AbortController>();
  private readonly responding = new Set<string>();
  private disposed = false;
  private lane: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: {
    directory: string; instanceId: string; keyProvider: PeerKeyProvider; localAppDataDir: string;
    db: ZccDatabase; hostHub: Pick<HostHub, 'getSession' | 'detach'>; joinCodes: JoinCodeStore; channels: EnrolledPeerChannels;
    authority: Pick<ScopedLinkAuthority, 'receivedIntroductions' | 'requestIntroductionEnrollment' | 'notifyIntroductionConsent' |
      'authorizeIntroducedInstall' | 'resolveHost'>;
    localRoute(): string | null;
    /** Explicit owner-registered SSH route; takes precedence over an advertised route. */
    routeFor?(peerInstanceId: string, signal: AbortSignal): Promise<string | null>;
    /** Owner-allowlisted non-loopback https origins; read on every use so changes apply without a restart. */
    allowedOrigins?(): readonly string[] | Promise<readonly string[]>;
    connector?: InstallerConnector;
    /** Holds `mobile/connection.json`; when Connect is on, introductions use the Connect offer form. */
    dataDir?: string;
    connectFetch?: ConnectFetch;
    /** Registry display name for a plugin's link use. */
    pluginLabel?(pluginId: string): string | undefined;
    onChanged?(): void;
    now?(): number;
  }) {
    this.storage = new PrivatePeerStorage(options.directory, 'installer-v1', options.keyProvider, options.instanceId,
      () => ({ version: 1, links: [], consents: [] }), value => {
        const state = stateSchema.parse(value);
        if (new Set(state.links.map(link => link.introductionId)).size !== state.links.length ||
          new Set(state.links.map(link => this.pairKey(link))).size !== state.links.length ||
          new Set(state.consents.map(consent => this.pairKey(consent))).size !== state.consents.length) throw new Error('invalid installer state');
        return state;
      });
  }

  private get connector(): InstallerConnector { return this.options.connector ?? defaultInstallerConnector; }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  private assertLive(): void { if (this.disposed) throw new Error('peer installer disposed'); }

  /** One key per unordered app pair and (plugin, scope): both sides derive the same pair. */
  private pairKey(entry: PairFields): string {
    return createHash('sha256').update(JSON.stringify(['peer-install-pair-v1', entry.pluginId, entry.scope,
      ...[this.options.instanceId, entry.peerInstanceId].sort()])).digest('hex');
  }

  /** The lexicographically lower instance id is the only side that ever initiates an enrollment. */
  private initiates(peerInstanceId: string): boolean { return this.options.instanceId < peerInstanceId; }

  private find(state: State, key: string): Link | undefined { return state.links.find(entry => this.pairKey(entry) === key); }

  private liveConsent(state: State, key: string, now: number): Consent | undefined {
    return state.consents.find(consent => this.pairKey(consent) === key && consent.receivedAt + INTRODUCTION_APPROVAL_TTL_MS > now);
  }

  /** Serializes state-changing steps; long network work runs outside the lane. */
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.lane.then(run, run);
    this.lane = next.catch(() => undefined);
    return next;
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.tasks.add(work);
    void work.then(() => this.tasks.delete(work), () => this.tasks.delete(work));
    return work;
  }

  private budget(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; done(): void } {
    const controller = new AbortController(); this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(new Error('peer enrollment timed out')), ms);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    return { signal: controller.signal, done: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.controllers.delete(controller); } };
  }

  /** Bounds a connector step by the attempt's signal even if the connector ignores it. */
  private abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error('peer enrollment cancelled or timed out'));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  private publicLink(link: Link): PeerInstallation {
    return { introductionId: link.introductionId, role: link.role, peerInstanceId: link.peerInstanceId, sponsorInstanceId: link.sponsorInstanceId,
      pluginId: link.pluginId, scope: link.scope, status: link.status, capability: 'peer.forward', expiresAt: link.expiresAt,
      connected: this.connections.get(this.pairKey(link))?.connected ?? false };
  }

  private async update(key: string, change: (link: Link, state: State) => void): Promise<Link | null> {
    return this.storage.transaction(async (state, save) => {
      const link = this.find(state, key);
      if (!link) return null;
      change(link, state); linkSchema.parse(link); await save();
      return structuredClone(link);
    });
  }

  private async route(peerInstanceId: string, advertised: string, signal: AbortSignal): Promise<string> {
    const pinned = await this.options.routeFor?.(peerInstanceId, signal);
    signal.throwIfAborted();
    if (pinned) return pinned;
    const allowed = await this.options.allowedOrigins?.() ?? [];
    signal.throwIfAborted();
    return validatePeerRoute(advertised, allowed);
  }

  private localRoute(): string {
    const route = this.options.localRoute();
    if (!route) throw new Error('local peer route unavailable');
    return validatePeerRoute(route);
  }

  /** Removes a forward-only host this installer minted. An execution host is never touched. */
  private removeInbound(hostId: string | undefined): void {
    if (!hostId) return;
    this.options.joinCodes.invalidateHost(hostId);
    const host = getHost(this.options.db, hostId);
    if (!host || host.destroyedAt || host.enrollmentCapability !== 'peer.forward') return;
    this.options.hostHub.getSession(hostId)?.socket.close(4003, 'host-removed');
    this.options.hostHub.detach(hostId, 'removed');
    destroyHost(this.options.db, hostId);
  }

  /** Diagnostic trail for deliberately swallowed failures. Never logs codes, credentials or record contents. */
  private warn(operation: string, error: unknown, subject?: string): void {
    console.warn(`[peer-installer] ${operation} failed${subject ? ` (${subject})` : ''}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  private async closeConnection(key: string): Promise<void> {
    const current = this.connections.get(key);
    this.connections.delete(key);
    await current?.connection.close().catch(error => this.warn('close connection', error, key.slice(0, 8)));
  }

  /** Tears down links removed from state inside a transaction; runs after the transaction and lane so slow network work never blocks them. */
  private async teardownAll(doomed: readonly Link[]): Promise<void> {
    for (const link of doomed) await this.teardown(link).catch(error => this.warn('teardown', error, this.pairKey(link).slice(0, 8)));
  }

  private daemonDir(key: string): string {
    // Sibling of the storage directory: PrivatePeerStorage refuses foreign entries in its own directory.
    return join(`${this.options.directory}-daemons`, key.slice(0, 32));
  }

  private async teardown(link: Link): Promise<void> {
    const key = this.pairKey(link);
    await this.closeConnection(key);
    if (link.outbound) await this.options.channels.unregister(link.peerInstanceId, link.outbound.hostId)
      .catch(error => { this.warn('unregister channel', error, link.outbound!.hostId); return false; });
    this.removeInbound(link.inboundHostId);
    if (link.offer && link.offer.hostId !== link.inboundHostId) this.removeInbound(link.offer.hostId);
    if (link.connectInbound) {
      for (const hostId of new Set([link.inboundHostId, link.offer?.hostId].filter((value): value is string => !!value))) await this.revoke(hostId);
    }
    await rm(this.daemonDir(key), { recursive: true, force: true });
  }

  private connectCtx() {
    return { dataDir: this.options.dataDir!, productInstanceId: this.options.instanceId, joinCodes: this.options.joinCodes };
  }

  /** True when this app is enrolled with Zana Connect: introductions then use the Connect offer form. */
  private connectMode(): boolean {
    if (!this.options.dataDir) return false;
    try { return connectConnection({ dataDir: this.options.dataDir }).mode === 'connect'; } catch { return false; }
  }

  /** Best effort `/hosts/revoke` for a Connect-minted inbound host; Connect also expires an unredeemed code. */
  private async revoke(hostId: string): Promise<void> {
    if (!this.options.dataDir) return;
    await revokeConnectPeerLink({ dataDir: this.options.dataDir }, hostId, this.options.connectFetch)
      .catch(error => { this.warn('Connect revoke', error, hostId); return false; });
  }

  /** Mints this app's forward-only Connect code for the peer (a `peer.forward` host at this app's Connect server). */
  private async mintConnect(peerInstanceId: string): Promise<{ hostId: string; expiresAt: number; connect: { code: string; accountUrl: string; serverId: string } }> {
    const taken = await listConnectPeerLinkNames({ dataDir: this.options.dataDir! }, this.options.connectFetch).catch(() => new Set<string>());
    let issued;
    try { issued = await issueConnectPeerLinkCode(this.connectCtx(), { name: peerLinkHostName('', peerInstanceId, taken) }, this.options.connectFetch); }
    catch { throw new Error('peer enrollment unavailable: Zana Connect code could not be minted'); }
    return { hostId: issued.hostId, expiresAt: issued.expiresAt, connect: { code: issued.code, accountUrl: issued.accountUrl, serverId: issued.serverId } };
  }

  /**
   * Enrolls forward-only into the peer from its offer. Connect form: the code is redeemed at this app's own Connect
   * account (a different account is refused), the redeemed destination must be the expected peer on a same-account
   * server, and the daemon enrolls with the Connect credential. Route form: the advertised route is validated.
   */
  private async enrollOffer(peerInstanceId: string, offer: EnrollmentOffer, signal: AbortSignal):
    Promise<{ hostId: string; hostKey: string; route: string; credential?: string }> {
    const hostName = `Peer ${this.options.instanceId.slice(0, 8)}`;
    if (!('connect' in offer)) {
      const serverUrl = await this.route(peerInstanceId, offer.route, signal);
      const credentials = await this.abortable(this.connector.enroll({ serverUrl, joinCode: offer.joinCode, hostName, signal }), signal);
      return { ...credentials, route: offer.route };
    }
    if (!this.connectMode()) throw new Error('peer enrollment requires Zana Connect');
    const own = connectConnection({ dataDir: this.options.dataDir! });
    if (own.accountUrl !== offer.connect.accountUrl) throw new Error('peer is on another Zana Connect account');
    let redeemed;
    try { redeemed = await redeemConnectPeerLinkCode(offer.connect.accountUrl, offer.connect.code, this.options.connectFetch, { attemptSecret: connectAttemptSecret() }); }
    catch { throw new Error('peer enrollment failed: Zana Connect code could not be redeemed'); }
    if (redeemed.instanceId !== peerInstanceId || redeemed.serverId !== offer.connect.serverId) throw new Error('peer identity mismatch');
    let same = false;
    try { same = await sameAccountInstance(this.connectCtx(), redeemed.instanceId, redeemed.serverId, this.options.connectFetch); }
    catch { throw new Error('peer enrollment failed: Zana Connect unavailable'); }
    if (!same) throw new Error('peer is on another Zana Connect account');
    signal.throwIfAborted();
    const credentials = await this.abortable(this.connector.enroll({ serverUrl: redeemed.serverUrl, joinCode: redeemed.enrollToken,
      connectCredential: redeemed.credential, hostName, signal, instanceId: this.options.instanceId }), signal);
    if (credentials.hostId !== redeemed.hostId) throw new Error('peer identity mismatch');
    return { ...credentials, route: redeemed.serverUrl, credential: redeemed.credential };
  }

  /** Records the plugin's use on the inbound host so the Peers hub can describe and release it. Best effort. */
  private recordUse(link: Link): void {
    if (!link.inboundHostId) return;
    const label = (this.options.pluginLabel?.(link.pluginId) || link.pluginId).slice(0, 80);
    try { addHostLinkUse(this.options.db, link.inboundHostId, { pluginId: link.pluginId, scope: link.scope, label }); } catch { /* host gone */ }
  }

  private async stored(key: string): Promise<Link | undefined> {
    return this.storage.transaction(async state => structuredClone(this.find(state, key)));
  }

  private async fail(link: Link): Promise<void> {
    const key = this.pairKey(link);
    // Tear down what is persisted now (a superset of the caller's snapshot), so late-written credentials are not leaked.
    // A teardown failure must not block the `failed` transition, or the link stays stuck `pending`.
    try { await this.teardown((await this.stored(key).catch(() => undefined)) ?? link); }
    catch (error) { this.warn('teardown', error, key.slice(0, 8)); }
    await this.update(key, current => {
      current.status = 'failed'; delete current.outbound; delete current.offer; delete current.inboundHostId; delete current.peerCodeHash; delete current.notified;
    }).catch(error => this.warn('mark failed', error, key.slice(0, 8)));
    this.options.onChanged?.();
  }

  private async connect(link: Link, signal?: AbortSignal): Promise<void> {
    if (!link.outbound) throw new Error('peer enrollment incomplete');
    const key = this.pairKey(link);
    await this.closeConnection(key);
    signal?.throwIfAborted(); this.assertLive();
    const daemonDir = this.daemonDir(key);
    await mkdir(daemonDir, { recursive: true, mode: 0o700 });
    // A Connect-form outbound targets the Connect-attested server URL; a route-form outbound is re-validated on every use.
    const credential = link.outbound.credential;
    const serverUrl = credential ? link.outbound.route : await this.route(link.peerInstanceId, link.outbound.route, signal ?? new AbortController().signal);
    const entry = { connected: false } as { connection: InstallerConnection; connected: boolean };
    entry.connection = this.connector.connect({ serverUrl, hostId: link.outbound.hostId, hostKey: link.outbound.hostKey,
      expectedRemoteInstanceId: link.peerInstanceId, daemonDir, localAppDataDir: this.options.localAppDataDir,
      ...(credential ? { connectCredential: credential, instanceId: this.options.instanceId } : {}),
      onConnectionChange: connected => { entry.connected = connected; } });
    this.connections.set(key, entry);
    void entry.connection.ready.catch(() => undefined);
    if (signal) {
      let abort: (() => void) | undefined;
      try {
        await Promise.race([entry.connection.ready, new Promise<never>((_resolve, reject) => {
          abort = () => reject(new Error('peer enrollment cancelled or timed out'));
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        })]);
      } finally { if (abort) signal.removeEventListener('abort', abort); }
    }
  }

  /** Both directions present and forward-only: our daemon's channel to the peer and the peer's daemon session here. */
  private async mutual(link: Link): Promise<boolean> {
    if (!link.inboundHostId || !link.outbound) return false;
    const host = getHost(this.options.db, link.inboundHostId), channel = await this.options.channels.remote(link.peerInstanceId);
    return !!host && !host.destroyedAt && host.enrollmentCapability === 'peer.forward' && !!this.options.hostHub.getSession(host.id) &&
      !!channel && channel.hostId === link.outbound.hostId && channel.capability === 'peer.forward';
  }

  private async waitMutual(link: Link, signal: AbortSignal): Promise<void> {
    const deadline = this.now() + MUTUAL_WAIT_MS;
    while (!await this.mutual(link)) {
      signal.throwIfAborted(); this.assertLive();
      if (this.now() > deadline) throw new Error('peer enrollment did not complete');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 100);
        const abort = () => { clearTimeout(timer); reject(new Error('peer enrollment cancelled or timed out')); };
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  }

  /** A channel to this peer that the installer did not create belongs to another enrollment and is never replaced. */
  private async assertNoForeignChannel(peerInstanceId: string, existing: Link | undefined): Promise<void> {
    const channel = await this.options.channels.remote(peerInstanceId);
    if (channel && (!existing?.outbound || channel.hostId !== existing.outbound.hostId)) throw new Error('peer is already enrolled');
  }

  /** Evicts one link when full; the evicted link is appended to `doomed` for {@link teardownAll} after the transaction. */
  private reserve(state: State, doomed: Link[]): void {
    if (state.links.length < INSTALLER_MAX_LINKS) return;
    const now = this.now();
    const evictable = state.links.findIndex(entry => entry.status === 'failed' ||
      ((entry.status === 'pending' || entry.status === 'awaiting') && entry.expiresAt <= now));
    if (evictable < 0) throw new Error('peer installer capacity exceeded');
    const [evicted] = state.links.splice(evictable, 1);
    doomed.push(structuredClone(evicted!));
  }

  private async approved(introductionId: string): Promise<ReceivedIntroduction> {
    const intro = (await this.options.authority.receivedIntroductions()).find(entry => entry.introductionId === introductionId);
    if (!intro || intro.status !== 'approved') throw new Error('introduction is not approved');
    if (intro.receivedAt + INTRODUCTION_APPROVAL_TTL_MS <= this.now()) throw new Error('introduction expired');
    return intro;
  }

  /** This app's own unexpired owner approval for the pair, under any sponsor. */
  private async approvedFor(pair: PairFields): Promise<ReceivedIntroduction | undefined> {
    const now = this.now();
    return (await this.options.authority.receivedIntroductions()).find(entry => entry.status === 'approved' &&
      entry.peerInstanceId === pair.peerInstanceId && entry.pluginId === pair.pluginId && entry.scope === pair.scope &&
      entry.receivedAt + INTRODUCTION_APPROVAL_TTL_MS > now);
  }

  /**
   * The local owner approved this introduction. The initiator (lower id) enrolls once the peer's consent is known;
   * the other side records consent and notifies the initiator. Idempotent per pair; concurrent calls share one attempt.
   */
  enroll(introductionId: string, signal?: AbortSignal): Promise<PeerInstallation> {
    this.assertLive();
    id.parse(introductionId);
    return this.track(this.approved(introductionId).then(intro => {
      this.assertLive();
      const key = this.pairKey(intro);
      const pending = this.inFlight.get(key);
      if (pending) return pending;
      const work: Promise<PeerInstallation> = (this.initiates(intro.peerInstanceId) ? this.requestOnce(intro, key, signal) : this.consentOnce(intro, key, signal))
        .finally(() => { if (this.inFlight.get(key) === work) this.inFlight.delete(key); });
      this.inFlight.set(key, work);
      return work;
    }));
  }

  /** Non-initiator: record consent as an awaiting responder link and tell the initiator through the sponsor. */
  private async consentOnce(intro: ReceivedIntroduction, key: string, outer?: AbortSignal): Promise<PeerInstallation> {
    const doomed: Link[] = [];
    const link = await this.serial(() => this.storage.transaction(async (state, save) => {
      this.assertLive();
      const existing = this.find(state, key);
      if (existing && existing.role !== 'responder') throw new Error('peer installation conflicts');
      if (existing && existing.status === 'awaiting' && !existing.notified && existing.introductionId !== intro.introductionId) {
        // The pair is still blocked on the older introduction's sponsor, which may be unavailable: notify through the newly approved one.
        existing.introductionId = intro.introductionId; existing.sponsorInstanceId = intro.sponsorInstanceId;
        existing.expiresAt = intro.receivedAt + INTRODUCTION_APPROVAL_TTL_MS;
        linkSchema.parse(existing); await save();
        this.options.onChanged?.();
        return structuredClone(existing);
      }
      if (existing && existing.status !== 'failed') return structuredClone(existing);
      await this.assertNoForeignChannel(intro.peerInstanceId, undefined);
      if (existing) { doomed.push(structuredClone(existing)); state.links.splice(state.links.indexOf(existing), 1); }
      this.reserve(state, doomed);
      const fresh: Link = { introductionId: intro.introductionId, role: 'responder', sponsorInstanceId: intro.sponsorInstanceId,
        peerInstanceId: intro.peerInstanceId, pluginId: intro.pluginId, scope: intro.scope, status: 'awaiting', createdAt: this.now(),
        expiresAt: intro.receivedAt + INTRODUCTION_APPROVAL_TTL_MS, notified: false };
      state.links.push(linkSchema.parse(fresh)); await save();
      this.options.onChanged?.();
      return structuredClone(fresh);
    }));
    await this.teardownAll(doomed);
    if (link.status !== 'awaiting' || link.notified) return this.publicLink(link);
    await this.notify(link, outer);
    return this.publicLink((await this.stored(key)) ?? link);
  }

  /** Best effort: an undelivered notice stays `notified: false` and the sweep retries it. */
  private async notify(link: Link, outer?: AbortSignal): Promise<boolean> {
    if (this.disposed) return false;
    const { signal, done } = this.budget(outer, NOTIFY_BUDGET_MS);
    try {
      const { recorded } = await this.options.authority.notifyIntroductionConsent(link.introductionId, signal);
      if (!recorded) return false;
      await this.update(this.pairKey(link), entry => {
        if (entry.status === 'awaiting' && entry.introductionId === link.introductionId) entry.notified = true;
      });
      return true;
    } catch (error) {
      this.warn('consent notification', error, `introduction ${link.introductionId}, peer ${link.peerInstanceId}`);
      return false;
    } finally { done(); }
  }

  /** Initiator: enroll only when both owners consented; otherwise wait without minting anything. */
  private async requestOnce(intro: ReceivedIntroduction, key: string, outer?: AbortSignal): Promise<PeerInstallation> {
    const introductionId = intro.introductionId;
    const { signal, done } = this.budget(outer, ENROLL_BUDGET_MS);
    let link: Link | undefined;
    const doomed: Link[] = [];
    try {
      link = await this.serial(async () => {
        this.assertLive();
        return this.storage.transaction(async (state, save) => {
          const existing = this.find(state, key);
          if (existing && existing.role !== 'requester') throw new Error('peer installation conflicts');
          // Already enrolled: reconnect if needed, never re-enroll a working link.
          if (existing?.status === 'enrolled') return structuredClone(existing);
          const now = this.now();
          if (!this.liveConsent(state, key, now)) {
            if (existing?.status === 'awaiting') return structuredClone(existing);
            await this.assertNoForeignChannel(intro.peerInstanceId, undefined);
            if (existing) { doomed.push(structuredClone(existing)); state.links.splice(state.links.indexOf(existing), 1); }
            this.reserve(state, doomed);
            const awaiting: Link = { introductionId, role: 'requester', sponsorInstanceId: intro.sponsorInstanceId, peerInstanceId: intro.peerInstanceId,
              pluginId: intro.pluginId, scope: intro.scope, status: 'awaiting', createdAt: now, expiresAt: intro.receivedAt + INTRODUCTION_APPROVAL_TTL_MS };
            state.links.push(linkSchema.parse(awaiting)); await save();
            this.options.onChanged?.();
            return structuredClone(awaiting);
          }
          const viaConnect = this.connectMode();
          const local = viaConnect ? '' : this.localRoute();
          await this.assertNoForeignChannel(intro.peerInstanceId, existing);
          if (existing) { doomed.push(structuredClone(existing)); state.links.splice(state.links.indexOf(existing), 1); }
          const fresh: Link = { introductionId, role: 'requester', sponsorInstanceId: intro.sponsorInstanceId, peerInstanceId: intro.peerInstanceId,
            pluginId: intro.pluginId, scope: intro.scope, status: 'pending', createdAt: now, expiresAt: 0 };
          this.reserve(state, doomed);
          if (viaConnect) {
            // Minted inside the pair's transaction so concurrent attempts never mint twice; the Connect request is time-bounded.
            const minted = await this.mintConnect(intro.peerInstanceId);
            fresh.inboundHostId = minted.hostId; fresh.expiresAt = minted.expiresAt; fresh.connectInbound = true;
            state.links.push(linkSchema.parse(fresh)); await save();
            return { ...structuredClone(fresh), request: { connect: minted.connect } } as Link & { request: EnrollmentOffer };
          }
          const issued = this.options.joinCodes.mintForwardOnly(now);
          fresh.inboundHostId = issued.hostId; fresh.expiresAt = issued.expiresAt;
          state.links.push(linkSchema.parse(fresh)); await save();
          return { ...structuredClone(fresh), request: { route: local, joinCode: issued.joinCode } } as Link & { request: EnrollmentOffer };
        });
      });
      await this.teardownAll(doomed);
      if (link.status === 'awaiting') return this.publicLink(link);
      if (link.status === 'enrolled') {
        if (!this.connections.has(key)) await this.connect(link).catch(error => this.warn('reconnect', error, key.slice(0, 8)));
        return this.publicLink(link);
      }
      const { request, ...stored } = link as Link & { request: EnrollmentOffer };
      link = stored;
      const offer = await this.options.authority.requestIntroductionEnrollment(introductionId, request, signal);
      if (('connect' in offer) !== ('connect' in request)) throw new Error('peer enrollment offer form mismatch');
      const enrolled = await this.enrollOffer(link.peerInstanceId, offer, signal);
      this.assertLive(); signal.throwIfAborted();
      link = (await this.update(key, current => { current.outbound = enrolled; }))!;
      await this.connect(link, signal);
      await this.waitMutual(link, signal);
      if (await this.options.authority.resolveHost(link.peerInstanceId, [link.inboundHostId!], signal) !== link.inboundHostId) {
        throw new Error('peer identity mismatch');
      }
      link = (await this.update(key, (current, state) => {
        current.status = 'enrolled';
        state.consents = state.consents.filter(consent => this.pairKey(consent) !== key);
      }))!;
      this.recordUse(link);
      this.options.onChanged?.();
      return this.publicLink(link);
    } catch (error) {
      if (link?.status === 'pending') await this.fail(link);
      throw new Error(error instanceof Error && /^(introduction|peer|local peer)/.test(error.message) ? error.message : 'peer enrollment failed');
    } finally { done(); }
  }

  /**
   * Initiator side of a relayed consent notice from an actively linked sponsor: the other owner approved. Records
   * it (idempotently) and, when this owner approved too, starts the single enrollment. Never mints by itself.
   */
  async peerConsented(sponsorInstanceId: string, input: { introductionId: string } & PairFields): Promise<{ recorded: boolean }> {
    this.assertLive();
    const entry = consentSchema.omit({ sponsorInstanceId: true, receivedAt: true }).parse(input);
    await this.options.authority.authorizeIntroducedInstall(sponsorInstanceId, entry);
    // Only the lower id initiates; a notice towards the other side is ignored.
    if (!this.initiates(entry.peerInstanceId)) return { recorded: false };
    const key = this.pairKey(entry);
    await this.serial(() => this.storage.transaction(async (state, save) => {
      this.assertLive();
      const now = this.now();
      if (this.liveConsent(state, key, now)) return;
      state.consents = state.consents.filter(consent => this.pairKey(consent) !== key && consent.receivedAt + INTRODUCTION_APPROVAL_TTL_MS > now);
      if (state.consents.length >= INSTALLER_MAX_CONSENTS) state.consents.shift();
      state.consents.push({ ...entry, sponsorInstanceId, receivedAt: now }); await save();
    }));
    const own = await this.approvedFor(entry);
    if (own) {
      const previous = this.inFlight.get(key);
      // A concurrent attempt may have read state before this consent landed; start after it settles.
      void this.track((async () => {
        await previous?.catch(() => undefined);
        if (!this.disposed) await this.enroll(own.introductionId);
      })().catch(() => undefined));
    }
    return { recorded: true };
  }

  /**
   * Responder: relayed by an actively linked sponsor. Accepted only from the initiator (lower id) and only after this
   * app's own owner approved the pair. Returns this app's offer quickly; enrollment towards the requester runs
   * bounded in the background.
   */
  async install(sponsorInstanceId: string, input: { introductionId: string } & PairFields & EnrollmentOffer,
    signal?: AbortSignal): Promise<EnrollmentOffer> {
    this.assertLive();
    await this.options.authority.authorizeIntroducedInstall(sponsorInstanceId, input);
    if (this.initiates(input.peerInstanceId)) throw new Error('peer installation conflicts');
    if (!await this.approvedFor(input)) throw new Error('introduction is not approved');
    const offerIn: EnrollmentOffer = 'connect' in input ? { connect: input.connect } : { route: input.route, joinCode: input.joinCode };
    const viaConnect = 'connect' in offerIn;
    if (viaConnect) {
      if (!this.connectMode()) throw new Error('peer enrollment requires Zana Connect');
      if (connectConnection({ dataDir: this.options.dataDir! }).accountUrl !== offerIn.connect.accountUrl) throw new Error('peer is on another Zana Connect account');
    } else {
      // Validate the advertised route before minting anything.
      const probe = new AbortController();
      const abort = () => probe.abort(); signal?.addEventListener('abort', abort, { once: true });
      try { await this.route(input.peerInstanceId, offerIn.route, probe.signal); }
      finally { signal?.removeEventListener('abort', abort); }
    }
    const local = viaConnect ? '' : this.localRoute();
    const key = this.pairKey(input);
    const codeHash = createHash('sha256').update(viaConnect ? offerIn.connect.code : offerIn.joinCode).digest('hex');
    const doomed: Link[] = [];
    const { link, restart } = await this.serial(() => this.storage.transaction(async (state, save) => {
      this.assertLive(); signal?.throwIfAborted();
      let existing = this.find(state, key);
      if (existing && existing.role !== 'responder') throw new Error('peer installation conflicts');
      await this.assertNoForeignChannel(input.peerInstanceId, existing);
      const now = this.now();
      if (!existing) {
        existing = { introductionId: input.introductionId, role: 'responder', sponsorInstanceId, peerInstanceId: input.peerInstanceId,
          pluginId: input.pluginId, scope: input.scope, status: 'pending', createdAt: now, expiresAt: 0 };
        this.reserve(state, doomed);
        state.links.push(existing);
      }
      // Same relayed code: an enrolled link is left intact (start() owns reconnects) and a live attempt is not duplicated.
      const restart = existing.peerCodeHash !== codeHash || (existing.status !== 'enrolled' && !this.responding.has(key));
      if (restart) {
        const offer = existing.offer;
        const usable = !!offer && offer.expiresAt > now + 60_000 && (viaConnect
          ? !!offer.connect
          : !!offer.joinCode && this.options.joinCodes.peek(offer.joinCode, now) !== null);
        if (!usable) {
          if (offer) {
            this.removeInbound(offer.hostId);
            if (existing.connectInbound) await this.revoke(offer.hostId);
          }
          if (viaConnect) {
            const minted = await this.mintConnect(input.peerInstanceId);
            existing.offer = { hostId: minted.hostId, expiresAt: minted.expiresAt, connect: minted.connect };
            existing.connectInbound = true;
          } else {
            const issued = this.options.joinCodes.mintForwardOnly(now);
            existing.offer = { joinCode: issued.joinCode, hostId: issued.hostId, expiresAt: issued.expiresAt };
            delete existing.connectInbound;
          }
        }
        // The exchange now runs under the initiator's introduction.
        existing.introductionId = input.introductionId; existing.sponsorInstanceId = sponsorInstanceId;
        existing.inboundHostId = existing.offer!.hostId;
        existing.status = 'pending'; existing.peerCodeHash = codeHash; delete existing.outbound; delete existing.notified;
        existing.expiresAt = existing.offer!.expiresAt;
        linkSchema.parse(existing); await save();
        this.responding.add(key);
      }
      return { link: structuredClone(existing), restart };
    }));
    await this.teardownAll(doomed);
    if (restart) void this.track(this.respond(link, offerIn, codeHash));
    return link.offer!.connect ? { connect: link.offer!.connect } : { route: local, joinCode: link.offer!.joinCode! };
  }

  private async respond(link: Link, offerIn: EnrollmentOffer, codeHash: string): Promise<void> {
    const key = this.pairKey(link);
    const { signal, done } = this.budget(undefined, ENROLL_BUDGET_MS);
    // A newer relayed code supersedes this attempt; it then neither writes state nor tears anything down.
    const current = (change: (entry: Link) => void) => this.update(key, entry => {
      if (entry.peerCodeHash !== codeHash) throw new Error('peer installation superseded');
      change(entry);
    });
    let superseded = false;
    try {
      await this.closeConnection(key);
      const enrolled = await this.enrollOffer(link.peerInstanceId, offerIn, signal);
      this.assertLive(); signal.throwIfAborted();
      const stored = await current(entry => { entry.outbound = enrolled; });
      if (!stored) throw new Error('peer installation removed');
      await this.connect(stored, signal);
      await this.waitMutual(stored, signal);
      const linked = await current(entry => { entry.status = 'enrolled'; });
      if (linked) this.recordUse(linked);
      this.options.onChanged?.();
    } catch {
      if (!this.disposed) {
        const latest = await this.stored(key).catch(() => undefined);
        superseded = !!latest && latest.peerCodeHash !== codeHash;
        if (!superseded) await this.fail(link);
      }
    } finally {
      done();
      if (!superseded) this.responding.delete(key);
    }
  }

  /** Startup: reconnect enrolled links and resume consented initiators; pending attempts did not survive the restart and are torn down. */
  start(): Promise<void> {
    this.assertLive();
    return this.track(this.startOnce());
  }

  private async startOnce(): Promise<void> {
    await this.sweep(true);
    const now = this.now();
    const { enrolled, ready } = await this.storage.transaction(async state => structuredClone({
      enrolled: state.links.filter(link => link.status === 'enrolled'),
      ready: state.links.filter(link => link.status === 'awaiting' && link.role === 'requester' && !!this.liveConsent(state, this.pairKey(link), now))
    }));
    for (const link of enrolled) {
      if (this.disposed) return;
      try { await this.connect(link); } catch (error) { this.warn('reconnect (next start retries)', error, link.peerInstanceId); }
    }
    for (const link of ready) {
      if (this.disposed) return;
      await this.enroll(link.introductionId).catch(error => this.warn('resume enrollment', error, `introduction ${link.introductionId}`));
    }
  }

  /**
   * Fails abandoned pending links, drops expired awaiting links and consents (nothing was minted for them) and
   * retries undelivered consent notices. Bounded: at most every stored link once.
   */
  async sweep(restart = false): Promise<number> {
    this.assertLive();
    const now = this.now();
    const { stale, expired, renotify } = await this.storage.transaction(async (state, save) => {
      const idle = (link: Link) => !this.inFlight.has(this.pairKey(link));
      const stale = state.links.filter(link => link.status === 'pending' && (restart || link.expiresAt <= now) && idle(link));
      const expired = state.links.filter(link => link.status === 'awaiting' && link.expiresAt <= now && idle(link));
      const consents = state.consents.filter(consent => consent.receivedAt + INTRODUCTION_APPROVAL_TTL_MS > now);
      if (expired.length || consents.length !== state.consents.length) {
        state.links = state.links.filter(link => !expired.includes(link));
        state.consents = consents;
        await save();
      }
      const renotify = state.links.filter(link => link.status === 'awaiting' && link.role === 'responder' && !link.notified && idle(link))
        .slice(0, RENOTIFY_PER_SWEEP);
      return structuredClone({ stale, expired, renotify });
    });
    for (const link of stale) await this.fail(link);
    await this.teardownAll(expired);
    if (expired.length) this.options.onChanged?.();
    for (const link of renotify) await this.notify(link);
    return stale.length + expired.length;
  }

  async list(): Promise<PeerInstallation[]> {
    this.assertLive();
    return this.storage.transaction(async state => state.links.map(link => this.publicLink(link)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.controllers) controller.abort(new Error('peer installer disposed'));
    void this.track(Promise.allSettled([...this.connections.keys()].map(key => this.closeConnection(key))));
    this.storage.dispose();
  }

  async whenIdle(): Promise<void> {
    while (this.tasks.size) await Promise.allSettled([...this.tasks]);
    // Live links stay connected unless the installer is shutting down.
    if (this.disposed) await Promise.allSettled([...this.connections.keys()].map(key => this.closeConnection(key)));
    await this.storage.whenIdle();
  }
}
