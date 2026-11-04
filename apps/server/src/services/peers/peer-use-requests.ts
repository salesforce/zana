import { randomUUID } from 'node:crypto';
import { addHostLinkUse, getHost, removeHostLinkUse, type ZccDatabase } from '@zana-ai/zcc-db';
import type { PluginApprovalRequest } from '../../http/plugin-approval-proof.js';
import { CORE_APPROVAL_PRINCIPAL, InvitationError } from './peer-invitation.js';
import type { PeerConnectionUses } from './peer-connections.js';

export const USE_APPROVE_ACTION = 'peer.use.approve';
export const USE_STOP_ACTION = 'peer.use.stop';
/** Scope recorded on a core-approved use: the row is per plugin per connection, not per plugin scope. */
export const USE_SCOPE = 'connection';
/** A denied use is not asked again for this long, so a plugin cannot spam the owner. */
export const USE_DENY_COOLDOWN_MS = 60_000;
/** An unanswered request is forgotten after this long. */
export const USE_REQUEST_TTL_MS = 30 * 60_000;
const NAME_MAX = 80;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export type UseStatus = 'pending' | 'approved' | 'denied';

/** What core asks the owner. The text is core's own: the plugin id is only a lookup key into the registry. */
export interface UsePrompt {
  id: string;
  pluginId: string;
  request: PluginApprovalRequest;
}

/** Link facts the use layer needs; `PeerLinks` supplies them. Only a live, unpaused, linked connection routes. */
export interface UseRoute { pairingId: string; hostId: string; peerName: string }

export interface UseLinks {
  useRoute(computerId: string): UseRoute | undefined;
  /** Local stop must work on a paused connection, which cannot carry new traffic. */
  useRouteForStop?(computerId: string): UseRoute | undefined;
  /** Incoming message: the route only if sender, the receiving inbound host and the pairing all match one linked connection. */
  useRouteFor(senderId: string, hostId: string, pairingId: string): UseRoute | undefined;
}

/** Peer messages; absent means the transport cannot carry them and the use stays pending-free (`use_unavailable`). */
export interface UseBridge {
  useRequest?(hostId: string, input: { recipientInstanceId: string; pairingId: string; pluginId: string }, signal: AbortSignal): Promise<{ accepted: boolean }>;
  useDecision?(hostId: string, input: { recipientInstanceId: string; pairingId: string; pluginId: string; approved: boolean; revoke?: true }, signal: AbortSignal): Promise<{ accepted: boolean }>;
}

export interface PeerUseRequestsOptions {
  db: ZccDatabase;
  links: UseLinks;
  bridge: UseBridge;
  /** Registry display name (never plugin input); `undefined` for an id that is not installed. */
  label(pluginId: string): string | undefined;
  /** Single-use owner proof check (`ctx.verifyPluginApproval`). */
  verify(token: unknown, principal: string, binding: unknown): boolean;
  /** Revokes the plugin's grants toward a peer and delivers the revoke. */
  revoke(pluginId: string, computerId: string): Promise<unknown>;
  /** Core-observed transfer state; plugins cannot set this flag. */
  isActive?(pluginId: string, computerId: string): boolean;
  onChange?(): void;
  now?(): number;
  sendTimeoutMs?: number;
}

interface Entry {
  id: string;
  pluginId: string;
  computerId: string;
  pairingId: string;
  hostId: string;
  peerName: string;
  local: 'asking' | 'approved' | 'denied';
  remote: 'asking' | 'approved' | 'denied';
  createdAt: number;
  deniedAt?: number;
  /** Our decision has not reached the peer yet; resent the next time the plugin asks. */
  undelivered?: boolean;
  kind?: 'stop';
  settle?: { resolve(): void; reject(error: Error): void };
}

function clean(value: string): string {
  return value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

/**
 * Two-sided, core-rendered approval of a plugin's use of a connection. Each owner approves on their own computer, in
 * a sheet main draws from text built here, and each side records the use on its own inbound host, where the pair
 * guard enforces it. The plugin only asks; it never supplies text, the decision or the peer's answer.
 */
export class PeerUseRequests implements PeerConnectionUses {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(private readonly options: PeerUseRequestsOptions) {}

  private now(): number { return this.options.now?.() ?? Date.now(); }
  private key(pluginId: string, computerId: string): string { return `${pluginId}\u0000${computerId}`; }
  private stopKey(pluginId: string, computerId: string): string { return `${this.key(pluginId, computerId)}\u0000stop`; }

  private changed(): void {
    if (this.disposed) return;
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* observer only */ } }
    try { this.options.onChange?.(); } catch { /* observer only */ }
  }

  /** Core push signal: fires whenever the set of owner prompts or a use status changes. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      const denied = entry.local === 'denied' || entry.remote === 'denied';
      if (denied ? now - (entry.deniedAt ?? entry.createdAt) >= USE_DENY_COOLDOWN_MS : now - entry.createdAt >= USE_REQUEST_TTL_MS) this.entries.delete(key);
    }
  }

  private statusOf(entry: Entry): UseStatus {
    if (entry.local === 'denied' || entry.remote === 'denied') return 'denied';
    return entry.local === 'approved' && entry.remote === 'approved' ? 'approved' : 'pending';
  }

  has(pluginId: string, computerId: string): boolean {
    const route = this.options.links.useRoute(computerId);
    return !!route && this.rowExists(route.hostId, pluginId);
  }

  private rowExists(hostId: string, pluginId: string): boolean {
    const host = getHost(this.options.db, hostId);
    return !!host && !host.destroyedAt && host.purpose.kind === 'plugin-link' && host.purpose.uses.some(use => use.pluginId === pluginId);
  }

  private approvalFor(entry: Entry, label: string): PluginApprovalRequest {
    const peer = clean(entry.peerName) || 'the other computer';
    return {
      binding: { action: USE_APPROVE_ACTION, target: entry.pairingId, targetLabel: peer, subject: `use:${entry.pluginId}`, revision: entry.id },
      title: 'Allow a plugin to use a connection',
      summary: `Allow ${label} to use this computer's connection with ${peer}. It can exchange its own data with that computer through the connection. ` +
        `This grants no access to projects, threads, terminals or files. ${peer} must also approve on its own computer.`,
      details: [`Plugin: ${label}`, `Computer: ${peer}`, `Plugin id: ${entry.pluginId}`],
      confirmLabel: 'Allow'
    };
  }

  private stopApprovalFor(entry: Entry, label: string): PluginApprovalRequest {
    const peer = clean(entry.peerName) || 'the other computer';
    return {
      binding: { action: USE_STOP_ACTION, target: entry.pairingId, targetLabel: peer, subject: `use:${entry.pluginId}`, revision: entry.id },
      title: 'Stop a plugin from using a connection',
      summary: `${label} is transferring with ${peer}. Stop its use anyway? This stops only this plugin's connection use. The computer connection stays available to other plugins.`,
      details: [`Plugin: ${label}`, `Computer: ${peer}`], confirmLabel: 'Stop anyway', tone: 'danger'
    };
  }

  /** Prompts still waiting for this computer's owner, with core-built text. */
  prompts(): UsePrompt[] {
    this.sweep();
    const out: UsePrompt[] = [];
    for (const entry of this.entries.values()) {
      if (entry.local !== 'asking' || entry.remote === 'denied') continue;
      const label = this.options.label(entry.pluginId);
      if (label === undefined) continue;
      out.push({ id: entry.id, pluginId: entry.pluginId, request: entry.kind === 'stop'
        ? this.stopApprovalFor(entry, clean(label) || entry.pluginId)
        : this.approvalFor(entry, clean(label) || entry.pluginId) });
    }
    return out;
  }

  private signal(): AbortSignal { return AbortSignal.timeout(this.options.sendTimeoutMs ?? 20_000); }

  private async sendDecision(entry: Entry, approved: boolean, revoke = false): Promise<boolean> {
    const send = this.options.bridge.useDecision;
    if (!send) return false;
    try {
      const reply = await send(entry.hostId, { recipientInstanceId: entry.computerId, pairingId: entry.pairingId, pluginId: entry.pluginId, approved,
        ...(revoke ? { revoke: true as const } : {}) }, this.signal());
      return reply.accepted === true;
    } catch (error) {
      console.warn(`[zcc] peer use decision not delivered: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async deliver(entry: Entry, approved: boolean): Promise<void> {
    const sent = await this.sendDecision(entry, approved);
    if (this.entries.get(this.key(entry.pluginId, entry.computerId)) === entry) entry.undelivered = !sent;
  }

  async request(pluginId: string, computerId: string, signal: AbortSignal): Promise<UseStatus> {
    this.sweep();
    const route = this.options.links.useRoute(computerId);
    if (!route) throw new InvitationError('unknown_connection');
    if (!this.options.bridge.useRequest || !this.options.bridge.useDecision) throw new InvitationError('use_unavailable');
    const label = this.options.label(pluginId);
    if (label === undefined) throw new InvitationError('unknown_connection');
    const key = this.key(pluginId, computerId);
    const existing = this.entries.get(key);
    if (existing && existing.pairingId === route.pairingId && existing.hostId === route.hostId) {
      if (existing.undelivered && existing.local !== 'asking') void this.deliver(existing, existing.local === 'approved');
      return this.statusOf(existing);
    }
    const entry: Entry = { id: randomUUID(), pluginId, computerId, pairingId: route.pairingId, hostId: route.hostId, peerName: route.peerName,
      local: this.rowExists(route.hostId, pluginId) ? 'approved' : 'asking', remote: 'asking', createdAt: this.now() };
    this.entries.set(key, entry);
    let reply: { accepted: boolean };
    try {
      reply = await this.options.bridge.useRequest(route.hostId, { recipientInstanceId: computerId, pairingId: route.pairingId, pluginId },
        AbortSignal.any([signal, this.signal()]));
    } catch {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      this.changed();
      throw new InvitationError('use_unavailable');
    }
    if (!reply.accepted) {
      // The other computer cannot take the request (plugin not installed there, link not ready): nothing to wait for.
      entry.remote = 'denied'; entry.deniedAt = this.now();
      this.changed();
      return 'denied';
    }
    this.changed();
    if (entry.local === 'approved') void this.deliver(entry, true);
    return this.statusOf(entry);
  }

  /** Peer message: the other computer's plugin asks to use the connection. The plugin must be installed here too. */
  async acceptRequest(senderId: string, hostId: string, ref: { pairingId: string; pluginId: string }): Promise<{ accepted: boolean }> {
    this.sweep();
    const route = this.options.links.useRouteFor(senderId, hostId, ref.pairingId);
    if (!route || this.options.label(ref.pluginId) === undefined) return { accepted: false };
    const key = this.key(ref.pluginId, senderId);
    const existing = this.entries.get(key);
    if (existing && existing.pairingId === route.pairingId && existing.hostId === route.hostId && existing.local !== 'denied' && existing.remote !== 'denied') {
      return { accepted: true };
    }
    const entry: Entry = { id: randomUUID(), pluginId: ref.pluginId, computerId: senderId, pairingId: route.pairingId, hostId: route.hostId, peerName: route.peerName,
      local: this.rowExists(route.hostId, ref.pluginId) ? 'approved' : 'asking', remote: 'asking', createdAt: this.now() };
    this.entries.set(key, entry);
    this.changed();
    // Already approved here: no second prompt, the answer goes straight back.
    if (entry.local === 'approved') void this.deliver(entry, true);
    return { accepted: true };
  }

  /** Peer message: the other computer's owner decided. Ignored unless this computer has a matching open request. */
  async acceptDecision(senderId: string, hostId: string, ref: { pairingId: string; pluginId: string; approved: boolean; revoke?: true }): Promise<{ accepted: boolean }> {
    this.sweep();
    const route = this.options.links.useRouteFor(senderId, hostId, ref.pairingId);
    const entry = route ? this.entries.get(this.key(ref.pluginId, senderId)) : undefined;
    if (!route || (entry && (entry.pairingId !== route.pairingId || entry.hostId !== route.hostId))) return { accepted: false };
    // A Stop using must work after a restart or request expiry: persisted use rows are authoritative.
    if (!entry && !ref.revoke) return { accepted: false };
    if (ref.approved) {
      entry!.remote = 'approved';
    } else {
      if (entry) { entry.remote = 'denied'; entry.deniedAt = this.now(); }
      if (ref.revoke) {
        // A remote Stop using must remove this side's authorization too.
        this.entries.delete(this.key(ref.pluginId, senderId));
        removeHostLinkUse(this.options.db, route.hostId, ref.pluginId);
        await this.options.revoke(ref.pluginId, senderId);
      }
    }
    this.changed();
    return { accepted: true };
  }

  /**
   * This computer's owner answered a prompt. Approval needs the single-use proof main signed over the binding core
   * built; the use row is written only here, after that check.
   */
  async decide(promptId: string, approved: boolean, token?: unknown): Promise<UseStatus> {
    this.sweep();
    const entry = [...this.entries.values()].find(candidate => candidate.id === promptId && candidate.local === 'asking');
    if (!entry) throw new InvitationError('not_found');
    const route = entry.kind === 'stop'
      ? this.options.links.useRouteForStop?.(entry.computerId) ?? this.options.links.useRoute(entry.computerId)
      : this.options.links.useRoute(entry.computerId);
    if (!route || route.pairingId !== entry.pairingId || route.hostId !== entry.hostId) throw new InvitationError('unknown_connection');
    if (entry.kind === 'stop') {
      const label = this.options.label(entry.pluginId);
      if (label === undefined) throw new InvitationError('unknown_connection');
      if (!approved) {
        this.entries.delete(this.stopKey(entry.pluginId, entry.computerId)); this.changed();
        entry.settle?.reject(new InvitationError('denied'));
        return 'denied';
      }
      if (!this.options.verify(token, CORE_APPROVAL_PRINCIPAL, this.stopApprovalFor(entry, clean(label) || entry.pluginId).binding)) throw new InvitationError('owner_proof_required');
      this.entries.delete(this.stopKey(entry.pluginId, entry.computerId)); this.changed();
      entry.settle?.resolve();
      return 'approved';
    }
    if (approved) {
      const label = this.options.label(entry.pluginId);
      if (label === undefined) throw new InvitationError('unknown_connection');
      if (!this.options.verify(token, CORE_APPROVAL_PRINCIPAL, this.approvalFor(entry, clean(label) || entry.pluginId).binding)) throw new InvitationError('owner_proof_required');
      addHostLinkUse(this.options.db, entry.hostId, { pluginId: entry.pluginId, scope: USE_SCOPE, label: (clean(label) || entry.pluginId).slice(0, NAME_MAX) });
      entry.local = 'approved';
    } else {
      entry.local = 'denied'; entry.deniedAt = this.now();
    }
    this.changed();
    void this.deliver(entry, approved);
    return this.statusOf(entry);
  }

  /** Gate a plugin-originated Stop using behind core-owned confirmation only when traffic is active. */
  async confirmStop(pluginId: string, computerId: string, signal: AbortSignal): Promise<void> {
    const route = this.options.links.useRouteForStop?.(computerId) ?? this.options.links.useRoute(computerId);
    if (!route || !this.rowExists(route.hostId, pluginId)) throw new InvitationError('unknown_connection');
    if (!this.options.isActive?.(pluginId, computerId)) return;
    const key = this.stopKey(pluginId, computerId);
    if (this.entries.has(key)) throw new InvitationError('use_unavailable');
    const label = this.options.label(pluginId);
    if (label === undefined) throw new InvitationError('unknown_connection');
    await new Promise<void>((resolve, reject) => {
      const entry: Entry = { id: randomUUID(), pluginId, computerId, pairingId: route.pairingId, hostId: route.hostId, peerName: route.peerName,
        local: 'asking', remote: 'asking', createdAt: this.now(), kind: 'stop', settle: { resolve, reject } };
      const abort = () => {
        if (this.entries.get(key) === entry) { this.entries.delete(key); this.changed(); }
        reject(new InvitationError('denied'));
      };
      signal.addEventListener('abort', abort, { once: true });
      const settle = entry.settle!;
      entry.settle = {
        resolve: () => { signal.removeEventListener('abort', abort); settle.resolve(); },
        reject: error => { signal.removeEventListener('abort', abort); settle.reject(error); }
      };
      this.entries.set(key, entry); this.changed();
    });
  }

  /** Stop using: the row goes first (the pair guard denies at once), then the peer's grants are revoked and delivered. */
  async stop(pluginId: string, computerId: string): Promise<void> {
    const route = this.options.links.useRouteForStop?.(computerId) ?? this.options.links.useRoute(computerId);
    const entry = this.entries.get(this.key(pluginId, computerId));
    this.entries.delete(this.key(pluginId, computerId));
    if (route) removeHostLinkUse(this.options.db, route.hostId, pluginId);
    this.changed();
    // Local authorization is gone now. Remote cleanup is best-effort and must not make Stop using wait on an offline peer.
    if (entry && route) void this.sendDecision(entry, false, true);
    void this.options.revoke(pluginId, computerId);
  }

  /** The connection is gone: forget its requests so no stale prompt outlives it. */
  forget(computerId: string): void {
    let any = false;
    for (const [key, entry] of this.entries) if (entry.computerId === computerId) { this.entries.delete(key); any = true; }
    if (any) this.changed();
  }

  dispose(): void {
    this.disposed = true;
    this.entries.clear();
    this.listeners.clear();
  }
}
