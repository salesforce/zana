import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginDatabase } from '@zana-ai/zcc-plugin-sdk/server';
import { canonicalJson, canonicalPeerHash, PeerProtocolError } from '../shared/peer-contract.js';
import { MAX_PERMANENT_JOB_ATTEMPTS, ownerText, type GroupJob, type GroupReceipt, type GroupRoster } from '../shared/peer-group.js';
import { DesignDocSyncStore } from './sync-store.js';
import { admissionReference, appendSeat, closeRetirement, completeRetirements, controlId as id, createRoster, currentMemberCount, finalizeRoster, genesisHash, historicalMembers, isRetiring, memberSchema,
  mergeRosters, ownedSeats, parseRoster, permitsRetirementCompletion, removeMember, requestRetirement, rosterCovers, transferSeat } from './peer-slots.js';
export { isRetiring, memberSchema, parseRoster, rosterCovers } from './peer-slots.js';

export const admissionSchema = z.object({ requestId: id, repoId: id, groupId: id.nullable(),
  sponsorReplicaId: id, member: memberSchema, delegateCount: z.number().int().min(0).max(5).optional() }).strict();
export type Admission = z.infer<typeof admissionSchema>;
export const capacitySchema = z.object({ requestId: id, admissionRequestId: id, repoId: id, groupId: id,
  donorReplicaId: id, recipientReplicaId: id }).strict();
export type CapacityRequest = z.infer<typeof capacitySchema>;
export function capacityRequestId(admissionRequestId: string, donorReplicaId: string): string {
  return `capacity-${canonicalPeerHash({ admissionRequestId, donorReplicaId })}`;
}
const MAX_CONTROL_ROWS = 1024;
export { MAX_PERMANENT_JOB_ATTEMPTS };
/** Job states that still owe work; `done` and `failed` are terminal. */
const OPEN = "state NOT IN ('done', 'failed')";
/** Page size of `jobs()`; anything that decides on "is any work outstanding" must use `openJobs()` instead. */
const JOBS_PAGE_LIMIT = 64;
const RESERVED_LIFECYCLE_ROWS = 176;
export const retirementJobSchema = z.object({ replicaId: id, admission: z.string().regex(/^[a-f0-9]{64}$/), scope: id }).strict();
const introductionSchema = z.object({ peerId: id, sponsorPeerId: id, scope: id }).strict();
const revocationSchema = z.object({ peerId: id, scope: id, localOnly: z.boolean().optional() }).strict();

/** Current members attest complete hash-linked history; hashes are not author signatures. */
export class DesignDocPeerGroup {
  readonly sync: DesignDocSyncStore;
  constructor(private readonly db: PluginDatabase, private readonly now = Date.now) {
    this.sync = new DesignDocSyncStore(db);
    this.sync.initializeLocal();
  }

  roster(): GroupRoster | null {
    const row = this.control();
    return row.roster_json ? parseRoster(JSON.parse(row.roster_json)) : null;
  }

  localPeerId(): string | null { return this.control().local_peer_id; }

  /**
   * A database copied to another app instance carries a writer identity that may still be live elsewhere.
   * Never continue that writer: archive its governance, fence every copied transient authority, and start a
   * fresh detached replica. Immutable history, comments, forks and local documents are untouched; rejoining
   * is a new member admission under the new app identity.
   */
  quarantineRestoredWriter(currentPeerId: string, options: { force?: boolean } = {}): { restored: boolean; previousReplicaId?: string; replicaId?: string } {
    id.parse(currentPeerId);
    return this.db.transaction(() => {
      const control = this.control(), previous = control.local_peer_id;
      // `force`: the database is a restored backup or rolled-back copy on this same app; its writer state is stale.
      if (!options.force && (!previous || previous === currentPeerId)) return { restored: false };
      this.detach(previous, currentPeerId);
      return { restored: true };
    });
  }

  /**
   * The roster only while this computer is a current member of it. After this computer leaves (or is removed) the roster
   * it keeps is terminal history: it must not count as membership of anyone, for the badge, Repair or automatic setup.
   */
  liveRoster(): GroupRoster | null {
    const roster = this.roster(), local = this.sync.localRepository()!;
    return roster && local.groupId === roster.groupId && roster.members.some((member) => member.replicaId === local.replicaId) ? roster : null;
  }

  /**
   * Whether governance left over from an earlier removal blocks pairing again with `peerId`. Admission is per computer, so
   * a group never re-admits a computer it removed. A dissolved two-member pairing leaves exactly two such states: this
   * computer left (it keeps a roster it is no longer in), or it is the only member left and `peerId` is a former member.
   * Both are history once their teardown is delivered, so a new pairing starts from a fresh replica (`detachForRejoin`).
   * Pending teardown of `peerId` itself is superseded by the new pairing; any other pending work must finish first.
   * So is a not yet frozen setup with `peerId` kept beside that history: it can never finish (a group never re-admits a
   * computer it removed, and a computer that left never joins through its old roster), and counting it as "setup in
   * progress" left both sides waiting on each other. A frozen join (unknown outcome) or a setup with another computer stays.
   */
  rejoinState(peerId: string, supersedePeerWork = false): { kind: 'clear' } | { kind: 'detach' } | { kind: 'blocked'; reason: string } {
    id.parse(peerId);
    const roster = this.roster(), consent = this.consent();
    if (!roster || (consent && (consent.peerId !== peerId || consent.request || consent.capacity))) return { kind: 'clear' };
    const live = this.liveRoster();
    const former = historicalMembers(roster).some((member) => member.machineId === peerId) && !roster.members.some((member) => member.machineId === peerId);
    if (live && !former) return { kind: 'clear' };
    if (live && roster.members.length > 1) {
      return { kind: 'blocked', reason: 'That computer was removed from this sync group earlier, and a group cannot take a removed computer back. Remove the other computers from this group (or leave it), then pair again.' };
    }
    // Work addressed to the computer being paired again is superseded by the new connection. Work for another computer
    // still has to finish first because it can carry governance that this pairing does not replace.
    const pending = this.openJobs().filter((job) => (!supersedePeerWork || job.peerId !== peerId) &&
      !(job.kind === 'local-revoke' && (job.payload as { peerId?: string }).peerId === peerId));
    if (pending.length) {
      const job = pending[0]!;
      const cause = ownerText(job.error);
      return { kind: 'blocked', reason: `An earlier removal is still being delivered${job.peerId === this.localPeerId() ? '' : ` to ${job.peerId}`}${cause ? ` (${cause})` : ''}. ` +
        'Keep both computers open and online, then press Repair again. If it stays stuck, use the Reset sync button for that computer.' };
    }
    return { kind: 'detach' };
  }

  /** Archive leftover governance (see `rejoinState`) and continue as a fresh standalone replica; documents and history stay. */
  detachForRejoin(currentPeerId: string, peerId: string, supersedePeerWork = false): void {
    id.parse(currentPeerId);
    this.db.transaction(() => {
      if (this.rejoinState(peerId, supersedePeerWork).kind !== 'detach') throw new PeerProtocolError('conflict', 'leftover sync group changed');
      this.detach(this.localPeerId(), currentPeerId);
    });
  }

  /** A not yet frozen consent follows the same peer's new replica (it detached to pair again); a frozen join never moves. */
  repinConsent(peerId: string, repoId: string, replicaId: string): boolean {
    id.parse(replicaId);
    const consent = this.consent();
    if (!consent || consent.peerId !== peerId || consent.repoId !== repoId || consent.request || consent.capacity || this.roster()) return false;
    if (consent.replicaId === replicaId) return true;
    this.db.prepare('UPDATE sync_group_control SET consent_json = ? WHERE singleton = 1').run(canonicalJson({ ...consent, replicaId }));
    return true;
  }

  private detach(previous: string | null, currentPeerId: string): void {
    this.db.transaction(() => {
      const control = this.control();
      const local = this.sync.localRepository()!, replicaId = randomUUID(), at = this.now();
      this.db.prepare(`INSERT INTO sync_restore_events (at, previous_peer_id, current_peer_id, repo_id, previous_replica_id, new_replica_id, roster_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(at, previous ?? '', currentPeerId, local.repoId, local.replicaId, replicaId, control.roster_json);
      this.db.prepare('UPDATE sync_repositories SET replica_id = ?, group_id = NULL, roster_epoch = 0 WHERE repo_id = ?').run(replicaId, local.repoId);
      this.db.prepare('UPDATE sync_group_members SET removed_at = COALESCE(removed_at, ?) WHERE repo_id = ?').run(at, local.repoId);
      this.db.prepare('UPDATE sync_group_control SET local_peer_id = NULL, roster_json = NULL, consent_json = NULL WHERE singleton = 1').run();
      // Copied intents, sessions, receipts and relationships authorise nothing for the new writer.
      this.db.prepare("UPDATE sync_intents SET state = 'blocked', updated_at = ? WHERE state = 'pending'").run(at);
      for (const table of ['sync_group_jobs', 'sync_group_admissions', 'sync_retry', 'sync_outgoing_sessions', 'sync_transfer_chunks',
        'sync_transfers', 'sync_manual_sessions', 'sync_peer_known', 'sync_peer_protocols', 'sync_receipts']) this.db.prepare(`DELETE FROM ${table}`).run();
    });
  }

  coveredHistoricalAck(input: GroupRoster, peerId: string): GroupRoster | null {
    const current = this.roster();
    const sender = current?.members.find((member) => member.machineId === peerId);
    if (!current || (sender && !current.closures.some((closure) => closure.replicaId === sender.replicaId))) return null;
    const historical = historicalMembers(current).find((member) => member.machineId === peerId);
    if (!historical) {
      throw new PeerProtocolError('invalid', 'historical roster sender or uncovered governance');
    }
    if (rosterCovers(current, input)) return current;
    if (permitsRetirementCompletion(current, input, historical.replicaId)) return null;
    throw new PeerProtocolError('invalid', 'historical roster sender or uncovered governance');
  }

  consent(): { peerId: string; repoId: string; replicaId: string; requestId: string; state: 'pending' | 'joining'; error: string | null; request?: Admission; capacity?: CapacityRequest } | null {
    const value = this.control().consent_json;
    return value ? JSON.parse(value) : null;
  }

  enable(localPeerId: string, peerId: string, repoId: string, replicaId: string): void {
    for (const value of [localPeerId, peerId, repoId, replicaId]) id.parse(value);
    if (localPeerId === peerId) throw new PeerProtocolError('invalid', 'cannot pair with local app');
    this.db.transaction(() => {
      const local = this.sync.localRepository()!;
      const roster = this.roster();
      if (this.localPeerId() && this.localPeerId() !== localPeerId) throw new PeerProtocolError('conflict', 'local app identity changed');
      if (roster && roster.repoId !== repoId) throw new PeerProtocolError('conflict', 'database already belongs to another group');
      const member = roster?.members.find((member) => member.machineId === peerId || member.replicaId === replicaId);
      if (member) {
        if (member.machineId !== peerId || member.replicaId !== replicaId) throw new PeerProtocolError('conflict', 'member app identity mismatch');
        return;
      }
      // The same peer detached to pair again: an unfrozen consent follows its new replica.
      if (this.consent()?.replicaId !== replicaId) this.repinConsent(peerId, repoId, replicaId);
      const prior = this.consent();
      if (prior && (prior.peerId !== peerId || prior.repoId !== repoId || prior.replicaId !== replicaId)) {
        throw new PeerProtocolError('conflict', 'another database setup is pending');
      }
      // Standalone has no journal. Never relabel an existing shared history.
      if (local.repoId !== repoId) {
        if (local.groupId || this.sync.operations(local.repoId, 1).length) throw new PeerProtocolError('conflict', 'cannot replace shared repository identity');
        this.db.prepare('UPDATE sync_repositories SET repo_id = ? WHERE repo_id = ?').run(repoId, local.repoId);
      }
      const consent = prior ?? { peerId, repoId, replicaId, requestId: randomUUID(), state: 'pending', error: null };
      this.db.prepare('UPDATE sync_group_control SET local_peer_id = ?, consent_json = ? WHERE singleton = 1').run(localPeerId, canonicalJson(consent));
    });
  }

  setupState(state: 'pending' | 'joining', error: string | null): void {
    const consent = this.consent();
    if (consent) this.db.prepare('UPDATE sync_group_control SET consent_json = ? WHERE singleton = 1')
      .run(canonicalJson({ ...consent, state, error: error?.slice(0, 240) ?? null }));
  }

  freezeJoin(request: Admission): Admission {
    const consent = this.consent();
    if (!consent) throw new PeerProtocolError('invalid', 'database consent missing');
    if (consent.request) return consent.request;
    admissionSchema.parse(request);
    const local = this.sync.localRepository()!;
    if (request.requestId !== consent.requestId || request.repoId !== consent.repoId || request.sponsorReplicaId !== consent.replicaId ||
      request.member.replicaId !== local.replicaId || request.member.machineId !== this.localPeerId() ||
      request.member.sponsorReplicaId !== consent.replicaId) throw new PeerProtocolError('invalid', 'local admission consent mismatch');
    this.db.prepare('UPDATE sync_group_control SET consent_json = ? WHERE singleton = 1').run(canonicalJson({ ...consent, request }));
    return request;
  }

  /** Caller must hold core's synchronous pair fence around this transaction. */
  existingReceipt(input: Admission, peerId: string): GroupReceipt | null {
    const request = admissionSchema.parse(input), local = this.sync.localRepository()!, current = this.roster();
    if (!this.localPeerId() || request.repoId !== local.repoId || request.member.machineId !== peerId || request.member.replicaId === local.replicaId ||
      request.sponsorReplicaId !== local.replicaId || request.member.sponsorReplicaId !== local.replicaId) throw new PeerProtocolError('invalid', 'join identity or database mismatch');
    const previous = this.db.prepare('SELECT request_json, receipt_json FROM sync_group_admissions WHERE request_id = ?')
      .get(request.requestId) as { request_json: string; receipt_json: string } | undefined;
    if (!previous) return null;
    if (previous.request_json !== canonicalJson(request)) throw new PeerProtocolError('conflict', 'join request id reused with different payload');
    if (!current?.members.some((member) => member.replicaId === request.member.replicaId) || !this.containsAdmission(current, request)) {
      throw new PeerProtocolError('invalid', 'member was removed');
    }
    return JSON.parse(previous.receipt_json) as GroupReceipt;
  }

  admit(input: Admission, peerId: string): GroupReceipt {
    const request = admissionSchema.parse(input);
    return this.db.transaction(() => {
      const local = this.sync.localRepository()!, current = this.roster();
      const localPeerId = this.localPeerId();
      if (!localPeerId || request.repoId !== local.repoId ||
        request.member.machineId !== peerId || request.member.replicaId === local.replicaId ||
        request.sponsorReplicaId !== local.replicaId || request.member.sponsorReplicaId !== local.replicaId) {
        throw new PeerProtocolError('invalid', 'join identity or database mismatch');
      }
      const previous = this.existingReceipt(request, peerId);
      if (previous) return previous;
      if (current && !current.members.some((member) => member.replicaId === local.replicaId)) throw new PeerProtocolError('invalid', 'join sponsor was removed');
      if (current && isRetiring(current, local.replicaId)) throw new PeerProtocolError('invalid', 'join sponsor is retiring');
      if (current && request.groupId !== current.groupId) throw new PeerProtocolError('invalid', 'join group identity mismatch');
      if (!current) {
        const consent = this.consent();
        if (!consent || consent.peerId !== peerId || consent.replicaId !== request.member.replicaId || request.sponsorReplicaId !== local.replicaId || request.groupId !== null) {
          throw new PeerProtocolError('invalid', 'bilateral database enablement required');
        }
      } else if (!current.members.some((member) => member.replicaId === request.sponsorReplicaId)) {
        throw new PeerProtocolError('invalid', 'join sponsor is not a member');
      } else {
        const consent = this.consent();
        if (!consent || consent.peerId !== peerId || consent.replicaId !== request.member.replicaId || request.sponsorReplicaId !== local.replicaId) {
          throw new PeerProtocolError('invalid', 'manual sponsor database enablement required');
        }
      }
      const members = current ? historicalMembers(current) : [{ replicaId: local.replicaId, machineId: localPeerId, joinedAt: this.now(), sponsorReplicaId: null }];
      if (members.some((member) => member.replicaId === request.member.replicaId || member.machineId === request.member.machineId)) {
        throw new PeerProtocolError('conflict', 'member already admitted with another request');
      }
      if ((current ? currentMemberCount(current) : members.length) >= 8) throw new PeerProtocolError('limit', 'group full (8)');
      this.capacity('sync_group_admissions');
      let roster: GroupRoster;
      if (!current) roster = createRoster(local.repoId, randomUUID(), [...members, request.member], request.requestId, local.replicaId);
      else {
        const seats = ownedSeats(current, local.replicaId);
        const seat = ownedSeats(current, local.replicaId, (seat) => ({ kind: 'admit', seat, requestId: request.requestId,
          ownerReplicaId: local.replicaId, member: request.member }))[0];
        if (!seat) throw new PeerProtocolError('limit', 'waiting for reserved capacity');
        roster = appendSeat(current, { kind: 'admit', seat, requestId: request.requestId, ownerReplicaId: local.replicaId, member: request.member });
        for (let index = 0; index < Math.min(request.delegateCount ?? 1, seats.length - 1); index++) {
          const requestId = `delegate-${canonicalPeerHash({ requestId: request.requestId, index })}`;
          if (!ownedSeats(roster, local.replicaId, (seat) => ({ kind: 'transfer', seat, requestId, ownerReplicaId: local.replicaId,
            recipientReplicaId: request.member.replicaId, recipientAdmission: admissionReference(roster, request.member.replicaId) })).length) break;
          roster = transferSeat(roster, local.replicaId, request.member.replicaId, requestId);
        }
      }
      const receipt: GroupReceipt = { requestId: request.requestId, stage: 'joining', roster };
      this.persistRoster(roster);
      this.enqueue(roster, 'roster');
      this.db.prepare('INSERT INTO sync_group_admissions (request_id, request_json, receipt_json) VALUES (?, ?, ?)')
        .run(request.requestId, canonicalJson(request), canonicalJson(receipt));
      return receipt;
    });
  }

  apply(input: unknown, peerId: string): void {
    const next = parseRoster(input);
    this.db.transaction(() => {
      const current = this.roster(), local = this.sync.localRepository()!, consent = this.consent();
      const sender = current && historicalMembers(current).find((member) => member.machineId === peerId);
      if ((current && !sender) || next.repoId !== local.repoId || !this.localPeerId()) throw new PeerProtocolError('invalid', 'roster sender or database mismatch');
      if (!current && (!consent || consent.peerId !== peerId ||
        !historicalMembers(next).some((member) => member.replicaId === consent.replicaId && member.machineId === consent.peerId) ||
        !consent.request || !this.containsAdmission(next, consent.request) ||
        ((!next.members.some((member) => member.replicaId === consent.replicaId) ||
          next.closures.some((closure) => closure.replicaId === consent.replicaId)) && !this.closedAdmission(next, consent.request)))) {
        throw new PeerProtocolError('invalid', 'roster requires local database consent');
      }
      if (sender && (!current!.members.some((member) => member.replicaId === sender.replicaId) || current!.closures.some((closure) => closure.replicaId === sender.replicaId)) &&
        !permitsRetirementCompletion(current!, next, sender.replicaId)) {
        throw new PeerProtocolError('invalid', 'closed sender cannot supply new governance');
      }
      const merged = completeRetirements(current ? mergeRosters(current, next) : next);
      if (current?.digest === merged.digest) return;
      const self = merged.members.find((member) => member.replicaId === local.replicaId && member.machineId === this.localPeerId());
      if (!current && !self) {
        throw new PeerProtocolError('invalid', 'roster does not contain local app');
      }
      this.persistRoster(merged);
      this.enqueue(merged, 'roster');
      for (const member of current?.members.some((member) => member.replicaId === local.replicaId) ? current.members : []) {
        if (member.machineId !== this.localPeerId() && (!self || !merged.members.some((item) => item.replicaId === member.replicaId))) {
          this.queueRoster(merged, member.machineId);
          this.queueJob(this.localPeerId()!, 'local-revoke', merged.rosterEpoch, { peerId: member.machineId, scope: merged.repoId });
        }
      }
      if (!self) this.db.prepare('UPDATE sync_repositories SET group_id = NULL WHERE repo_id = ?').run(local.repoId);
    });
  }

  remove(replicaId: string): GroupReceipt {
    return this.db.transaction(() => {
      const current = this.roster(), local = this.sync.localRepository()!;
      if (!current || !current.members.some((member) => member.replicaId === local.replicaId)) throw new PeerProtocolError('invalid', 'removal requires current membership');
      const removed = current.members.find((member) => member.replicaId === replicaId);
      const previous = current.removals.find((event) => event.replicaId === replicaId);
      if (!removed && previous) return { requestId: previous.requestId, stage: 'removed', roster: current };
      if (!removed) throw new PeerProtocolError('invalid', 'member not found');
      if (isRetiring(current, local.replicaId) && !current.retirements.some((event) => event.actorReplicaId === local.replicaId && event.replicaId === replicaId)) {
        throw new PeerProtocolError('invalid', 'retiring member cannot initiate retirement');
      }
      // A group never loses another member below 2 (the survivor could not seal it). The one exception is this computer
      // leaving: it seals its own retirement locally at once, and the survivor merely holds a one-member roster. Groups of
      // 3+ are unaffected: any removal that leaves two or more members stays allowed, nothing else is relaxed.
      if (!isRetiring(current, replicaId) && current.members.length <= 2 && replicaId !== local.replicaId) {
        throw new PeerProtocolError('invalid', 'two-member group cannot shrink below 2; disable link instead');
      }
      let roster = requestRetirement(current, local.replicaId, replicaId);
      const requestId = roster.retirements.find((event) => event.actorReplicaId === local.replicaId && event.replicaId === replicaId)!.requestId;
      if (replicaId === local.replicaId) roster = closeRetirement(roster, replicaId);
      const closed = roster.closures.some((closure) => closure.replicaId === replicaId);
      if (closed) roster = removeMember(roster, local.replicaId, replicaId);
      this.persistRoster(roster);
      this.enqueue(roster, 'roster');
      if (!closed) {
        this.queueJob(removed.machineId, 'retire', roster.rosterEpoch, { replicaId, admission: admissionReference(roster, replicaId), scope: roster.repoId });
        return { requestId, stage: 'retiring', roster };
      }
      if (removed.machineId !== this.localPeerId()) this.queueRoster(roster, removed.machineId);
      if (replicaId !== local.replicaId) this.enqueue(roster, 'revoke', removed.machineId);
      if (replicaId === local.replicaId) {
        for (const member of roster.members) this.queueJob(this.localPeerId()!, 'local-revoke', roster.rosterEpoch, { peerId: member.machineId, scope: roster.repoId });
        this.db.prepare('UPDATE sync_repositories SET group_id = NULL WHERE repo_id = ?').run(local.repoId);
      }
      return { requestId, stage: 'removed', roster };
    });
  }

  retire(input: unknown, peerId: string): GroupRoster {
    const incoming = parseRoster(input);
    return this.db.transaction(() => {
      const current = this.roster(), local = this.sync.localRepository()!;
      if (!current || !historicalMembers(current).some((member) => member.machineId === peerId) ||
        !incoming.retirements.some((event) => event.replicaId === local.replicaId)) throw new PeerProtocolError('invalid', 'retirement sender or target mismatch');
      this.apply(incoming, peerId);
      const merged = this.roster()!, sealed = closeRetirement(merged, local.replicaId);
      if (sealed.digest === merged.digest) return sealed;
      this.persistRoster(sealed); this.enqueue(sealed, 'roster');
      return sealed;
    });
  }

  authorizeSponsor(input: Admission, peerId: string): void {
    const request = admissionSchema.parse(input), consent = this.consent(), local = this.sync.localRepository()!;
    const previous = this.db.prepare('SELECT request_json FROM sync_group_admissions WHERE request_id = ?').get(request.requestId) as { request_json: string } | undefined;
    if (previous && previous.request_json === canonicalJson(request) && this.roster()?.members.some((member) => member.replicaId === request.member.replicaId)) return;
    if (this.roster() && isRetiring(this.roster()!, local.replicaId)) throw new PeerProtocolError('invalid', 'join sponsor is retiring');
    if (!consent || consent.peerId !== peerId || consent.replicaId !== request.member.replicaId ||
      request.member.machineId !== peerId || request.member.sponsorReplicaId !== local.replicaId || request.sponsorReplicaId !== local.replicaId || request.repoId !== local.repoId ||
      request.groupId !== this.roster()?.groupId) throw new PeerProtocolError('invalid', 'manual sponsor database enablement required');
  }

  queueRoster(roster: GroupRoster, peerId: string): void {
    parseRoster(roster);
    this.db.transaction(() => {
      const current = this.roster(), local = this.sync.localRepository()!;
      const closure = current?.closures.find((item) => item.replicaId === local.replicaId);
      if (closure) {
        const member = historicalMembers(current!).find((item) => item.machineId === peerId);
        if (!member) return;
        const admission = admissionReference(current!, member.replicaId);
        if (admission !== genesisHash(current!) && !current!.seats.some((seat, index) => {
          const position = seat.events.findIndex((event) => event.hash === admission);
          return position >= 0 && position <= seat.events.findIndex((event) => event.hash === closure.heads[index]);
        })) return;
      }
      const jobs = this.db.prepare("SELECT id, payload_json FROM sync_group_jobs WHERE peer_id = ? AND kind = 'roster'").all(peerId) as Array<{ id: string; payload_json: string }>;
      for (const job of jobs) {
        const prior = parseRoster(JSON.parse(job.payload_json));
        if (closure && prior.closures.some((item) => item.replicaId === local.replicaId)) {
          // Terminal deliveries can advance known retirement completion, never widen their attested history.
          const closures = roster.closures.filter((item) => prior.retirements.some((request) => request.replicaId === item.replicaId && request.admission === item.admission) &&
            item.heads.every((head, index) => head === genesisHash(prior) || prior.seats[index]!.events.some((event) => event.hash === head)));
          const removals = roster.removals.filter((item) => closures.some((seal) => seal.hash === item.closure) &&
            prior.retirements.some((request) => request.actorReplicaId === item.actorReplicaId && request.replicaId === item.replicaId));
          roster = completeRetirements(mergeRosters(prior, finalizeRoster({ ...prior, closures, removals })));
        }
        if (rosterCovers(prior, roster)) return;
        if (rosterCovers(roster, prior)) this.db.prepare('DELETE FROM sync_group_jobs WHERE id = ?').run(job.id);
      }
      this.queueJob(peerId, 'roster', roster.rosterEpoch, roster);
    });
  }

  queueJob(peerId: string, kind: GroupJob['kind'], rosterEpoch: number, payload: unknown): void {
    this.db.transaction(() => {
      this.pruneIntroductions();
      if (kind === 'introduce') {
        const input = introductionSchema.parse(payload), roster = this.roster();
        if (!roster || input.scope !== roster.repoId || peerId !== this.localPeerId() || input.peerId === input.sponsorPeerId ||
          ![peerId, input.peerId, input.sponsorPeerId].every((machineId) => roster.members.some((member) => member.machineId === machineId))) {
          throw new PeerProtocolError('invalid', 'introduction outside current roster');
        }
      } else if (kind === 'retire') retirementJobSchema.parse(payload);
      else if (kind === 'roster') parseRoster(payload);
      else revocationSchema.parse(payload);
      const json = canonicalJson(payload);
      const previous = this.db.prepare('SELECT id FROM sync_group_jobs WHERE peer_id = ? AND kind = ? AND payload_json = ?')
        .get(peerId, kind, json) as { id: string } | undefined;
      if (previous) {
        this.db.prepare('UPDATE sync_group_jobs SET roster_epoch = MAX(roster_epoch, ?) WHERE id = ?').run(rosterEpoch, previous.id);
        return;
      }
      this.db.prepare("DELETE FROM sync_group_jobs WHERE state = 'done' AND kind NOT IN ('introduce', 'roster')").run();
      this.db.prepare(`DELETE FROM sync_group_jobs WHERE state = 'done' AND kind = 'roster' AND peer_id NOT IN
        (SELECT machine_id FROM sync_group_members WHERE removed_at IS NULL)`).run();
      if (kind === 'retire' || kind === 'introduce' || kind === 'roster' || kind === 'revoke' || (kind === 'local-revoke' && !revocationSchema.parse(payload).localOnly)) {
        // Eight identities bound teardown work independently of the general queue.
        const row = this.db.prepare(`SELECT COUNT(*) AS n FROM sync_group_jobs WHERE kind = ?
          ${kind === 'local-revoke' ? "AND COALESCE(json_extract(payload_json, '$.localOnly'), 0) = 0" : ''}`)
          .get(kind) as { n: number };
        if (row.n >= (kind === 'retire' ? 8 : kind === 'introduce' ? 42 : kind === 'revoke' ? 64 : 16)) throw new PeerProtocolError('limit', 'group lifecycle queue capacity reached');
      } else this.capacity('sync_group_jobs', MAX_CONTROL_ROWS - RESERVED_LIFECYCLE_ROWS);
      this.db.prepare('INSERT INTO sync_group_jobs (id, peer_id, kind, roster_epoch, payload_json) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), peerId, kind, rosterEpoch, json);
    });
  }

  cancelSetup(peerId: string): void {
    if (this.consent()?.peerId === peerId && (this.consent()?.request || this.consent()?.capacity)) throw new PeerProtocolError('conflict', 'join outcome unknown; retry original sponsor before cancelling');
    if (this.consent()?.peerId === peerId) this.db.prepare('UPDATE sync_group_control SET consent_json = NULL WHERE singleton = 1').run();
  }

  /**
   * Drop a setup with `peerId` that never froze a join (no admission request, no capacity transfer): nothing was sent that
   * could still be admitted, so it can be abandoned safely. A frozen one is left alone. True when a setup was dropped.
   */
  discardUnfrozenSetup(peerId: string): boolean {
    id.parse(peerId);
    return this.db.transaction(() => {
      const consent = this.consent();
      if (!consent || consent.peerId !== peerId || consent.request || consent.capacity) return false;
      this.db.prepare('UPDATE sync_group_control SET consent_json = NULL WHERE singleton = 1').run();
      return true;
    });
  }

  retryJobs(): void { this.db.prepare(`UPDATE sync_group_jobs SET next_at = 0 WHERE ${OPEN}`).run(); }

  /**
   * Owner action "Reset sync with this computer": discard this computer's undelivered work for `peerId` that already failed
   * at least once (blocked or failed). Only local control rows are deleted; documents, history and the link are untouched.
   * While this computer is a current member, a removed peer's link revocation is kept: dropping it would leave a removed
   * computer authorized. Once this computer has left, that revocation is superseded by pairing again (as `detachForRejoin`).
   */
  resetPeer(peerId: string): number {
    id.parse(peerId);
    return this.db.transaction(() => {
      const live = !!this.liveRoster();
      const rows = this.db.prepare(`SELECT id, kind, peer_id, payload_json FROM sync_group_jobs WHERE state IN ('blocked', 'failed')`)
        .all() as Array<{ id: string; kind: GroupJob['kind']; peer_id: string; payload_json: string }>;
      const doomed: string[] = [];
      for (const row of rows) {
        const target = (JSON.parse(row.payload_json) as { peerId?: unknown } | null)?.peerId;
        const owed = row.kind === 'local-revoke' ? target === peerId && !live
          : row.kind === 'introduce' ? false : row.peer_id === peerId;
        if (!owed) continue;
        doomed.push(row.id);
      }
      for (let i = 0; i < doomed.length; i += 500) {
        const chunk = doomed.slice(i, i + 500);
        this.db.prepare(`DELETE FROM sync_group_jobs WHERE id IN (${chunk.map(() => '?').join(',')})`).run(...chunk);
      }
      return doomed.length;
    });
  }

  /** Every unfinished job, unbounded (the queue is capped per kind on enqueue): checks that gate destructive steps must not see a page. */
  private openJobs(): Array<GroupJob & { payload: unknown }> {
    return this.queryJobs(`WHERE ${OPEN}`, [], '');
  }

  jobs(readyOnly = false): Array<GroupJob & { payload: unknown }> {
    return this.queryJobs(readyOnly ? `WHERE ${OPEN} AND next_at <= ?` : '', readyOnly ? [this.now()] : [], `LIMIT ${JOBS_PAGE_LIMIT}`);
  }

  private queryJobs(where: string, params: unknown[], limit: string): Array<GroupJob & { payload: unknown }> {
    const rows = this.db.prepare(`SELECT * FROM sync_group_jobs ${where}
      ORDER BY CASE kind WHEN 'retire' THEN 0 WHEN 'roster' THEN 1 WHEN 'revoke' THEN 2 WHEN 'local-revoke' THEN 3 ELSE 4 END, roster_epoch, id ${limit}`)
      .all(...params) as Array<{ id: string; peer_id: string; kind: GroupJob['kind']; roster_epoch: number;
        state: GroupJob['state']; attempts: number; error: string | null; payload_json: string }>;
    return rows.map((row) => ({ id: row.id, peerId: row.peer_id, kind: row.kind, rosterEpoch: row.roster_epoch,
      state: row.state, attempts: row.attempts, error: row.error, payload: JSON.parse(row.payload_json) }));
  }

  /**
   * `error` blocks the job for a retry. A `permanent` error (malformed reply, identity that can never match) is retried
   * only up to `MAX_PERMANENT_JOB_ATTEMPTS`, then the job is `failed`: it keeps its reason for the owner but no longer
   * blocks link revocation or pairing again.
   */
  finishJob(id: string, error?: string, permanent = false): void {
    this.db.prepare(`UPDATE sync_group_jobs SET state = CASE WHEN ? IS NULL THEN 'done' WHEN ? AND attempts + 1 >= ? THEN 'failed' ELSE 'blocked' END,
      attempts = attempts + 1, error = ?, next_at = ? WHERE id = ? AND ${OPEN}`)
      .run(error ?? null, permanent ? 1 : 0, MAX_PERMANENT_JOB_ATTEMPTS, error?.slice(0, 240) ?? null, error ? this.now() + 30_000 : 0, id);
  }

  /** The job's purpose no longer exists (its target set the group aside): it completes, with `note` kept as the reason. */
  supersedeJob(id: string, note: string): void {
    this.db.prepare(`UPDATE sync_group_jobs SET state = 'done', attempts = attempts + 1, error = ?, next_at = 0 WHERE id = ? AND ${OPEN}`)
      .run(note.slice(0, 240), id);
  }

  private persistRoster(roster: GroupRoster): void {
    parseRoster(roster);
    const local = this.sync.localRepository()!;
    const terminal = this.roster()?.closures.some((closure) => closure.replicaId === local.replicaId);
    this.db.prepare('UPDATE sync_repositories SET group_id = ?, roster_epoch = ? WHERE repo_id = ?')
      .run(roster.members.some((member) => member.replicaId === local.replicaId) ? roster.groupId : null, roster.rosterEpoch, local.repoId);
    this.db.prepare('UPDATE sync_group_members SET removed_at = ? WHERE repo_id = ? AND removed_at IS NULL').run(this.now(), local.repoId);
    for (const member of historicalMembers(roster)) this.db.prepare(`INSERT INTO sync_group_members (repo_id, replica_id, machine_id, sponsor_replica_id, joined_at, removed_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (repo_id, replica_id) DO UPDATE SET machine_id = excluded.machine_id,
      sponsor_replica_id = excluded.sponsor_replica_id, joined_at = excluded.joined_at, removed_at = excluded.removed_at`)
      .run(local.repoId, member.replicaId, member.machineId, member.sponsorReplicaId, member.joinedAt,
        roster.members.some((active) => active.replicaId === member.replicaId) ? null : this.now());
    this.db.prepare(`UPDATE sync_intents SET state = 'blocked' WHERE repo_id = ? AND member_replica_id NOT IN
      (SELECT replica_id FROM sync_group_members WHERE repo_id = ? AND removed_at IS NULL)`).run(local.repoId, local.repoId);
    const consent = this.consent();
    const keepConsent = consent && !roster.members.some((member) => member.machineId === consent.peerId) &&
      !(consent.request && this.containsAdmission(roster, consent.request) && roster.members.some((member) => member.replicaId === local.replicaId));
    this.db.prepare('UPDATE sync_group_control SET roster_json = ?, consent_json = ? WHERE singleton = 1')
      .run(canonicalJson(roster), keepConsent ? canonicalJson(consent) : null);
    if (keepConsent && consent.capacity && isRetiring(roster, consent.capacity.donorReplicaId) &&
      historicalMembers(roster).some((member) => member.replicaId === consent.capacity!.donorReplicaId)) this.clearCapacity();
    this.pruneIntroductions();
    const self = this.localPeerId()!;
    if (!terminal && historicalMembers(roster).some((member) => member.machineId === self)) {
      for (const target of roster.members.filter((member) => isRetiring(roster, member.replicaId) &&
        member.machineId !== self)) {
        this.queueJob(target.machineId, 'retire', roster.rosterEpoch, { replicaId: target.replicaId,
          admission: admissionReference(roster, target.replicaId), scope: roster.repoId });
      }
    }
    if (roster.members.some((member) => member.machineId === self && !isRetiring(roster, member.replicaId))) {
      for (const target of roster.members.filter((member) => member.machineId !== self && !isRetiring(roster, member.replicaId))) {
        for (const sponsor of roster.members.filter((member) => member.machineId !== self && member.machineId !== target.machineId && !isRetiring(roster, member.replicaId))) {
          this.queueJob(self, 'introduce', roster.rosterEpoch, { peerId: target.machineId, sponsorPeerId: sponsor.machineId, scope: roster.repoId });
        }
      }
    }
  }

  private enqueue(roster: GroupRoster, kind: GroupJob['kind'], removedPeerId?: string): void {
    this.db.prepare("DELETE FROM sync_group_jobs WHERE state = 'done' AND kind NOT IN ('introduce', 'roster')").run();
    const recipients = kind === 'roster' ? historicalMembers(roster).filter((member) =>
      roster.members.some((active) => active.replicaId === member.replicaId) || this.removalDeliveryPending(member.machineId)) : roster.members;
    for (const member of recipients.filter((member) => member.machineId !== this.localPeerId())) {
      if (kind === 'roster') { this.queueRoster(roster, member.machineId); continue; }
      this.queueJob(member.machineId, kind, roster.rosterEpoch, { peerId: removedPeerId!, scope: roster.repoId });
    }
    if (kind === 'revoke') {
      this.queueJob(this.localPeerId()!, 'local-revoke', roster.rosterEpoch, { peerId: removedPeerId!, scope: roster.repoId });
    }
  }

  private pruneIntroductions(): void {
    const roster = this.roster(), identities = new Set(roster?.members.filter((member) => !isRetiring(roster, member.replicaId)).map((member) => member.machineId));
    const rows = this.db.prepare("SELECT id, peer_id, payload_json FROM sync_group_jobs WHERE kind = 'introduce' ORDER BY roster_epoch DESC, id LIMIT ?")
      .all(MAX_CONTROL_ROWS + RESERVED_LIFECYCLE_ROWS) as Array<{ id: string; peer_id: string; payload_json: string }>;
    const seen = new Set<string>();
    for (const row of rows) {
      let input: z.infer<typeof introductionSchema> | null = null;
      try { input = introductionSchema.parse(JSON.parse(row.payload_json)); } catch { /* Stale malformed jobs have no executable authority. */ }
      const key = input ? canonicalJson(input) : '';
      if (!input || !roster || input.scope !== roster.repoId || row.peer_id !== this.localPeerId() || input.peerId === input.sponsorPeerId ||
        ![row.peer_id, input.peerId, input.sponsorPeerId].every((machineId) => identities.has(machineId)) || seen.has(key)) {
        this.db.prepare('DELETE FROM sync_group_jobs WHERE id = ?').run(row.id);
      } else seen.add(key);
    }
  }

  private capacity(table: 'sync_group_admissions' | 'sync_group_jobs', limit = MAX_CONTROL_ROWS): void {
    if (table === 'sync_group_admissions') this.db.prepare(`DELETE FROM sync_group_admissions WHERE json_valid(request_json)
      AND json_extract(request_json, '$.member.replicaId') IN
        (SELECT replica_id FROM sync_group_members WHERE removed_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM sync_group_jobs WHERE peer_id = json_extract(request_json, '$.member.machineId') AND ${OPEN})`).run();
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    if (row.n >= limit) throw new PeerProtocolError('limit', 'group control capacity reached');
  }

  private control(): { local_peer_id: string | null; roster_json: string | null; consent_json: string | null } {
    return this.db.prepare('SELECT local_peer_id, roster_json, consent_json FROM sync_group_control WHERE singleton = 1')
      .get() as { local_peer_id: string | null; roster_json: string | null; consent_json: string | null };
  }

  containsAdmission(roster: GroupRoster, request: Admission): boolean {
    if (request.repoId !== roster.repoId || (request.groupId !== null && request.groupId !== roster.groupId)) return false;
    if (request.groupId === null) return roster.genesis.requestId === request.requestId && roster.genesis.sponsorReplicaId === request.sponsorReplicaId &&
      roster.genesis.founders.some((member) => canonicalJson(member) === canonicalJson(request.member));
    return roster.seats.some((seat) => seat.events.some((event) => event.kind === 'admit' && event.requestId === request.requestId &&
      event.ownerReplicaId === request.sponsorReplicaId && canonicalJson(event.member) === canonicalJson(request.member)));
  }

  private closedAdmission(roster: GroupRoster, request: Admission): boolean {
    const closure = roster.closures.find((item) => item.replicaId === request.sponsorReplicaId);
    if (!closure || !roster.members.some((member) => member.replicaId === request.member.replicaId && member.machineId === request.member.machineId)) return false;
    if (!roster.seats.every((seat, index) => (seat.events.at(-1)?.hash ?? genesisHash(roster)) === closure.heads[index])) return false;
    if (request.groupId === null) return this.containsAdmission(roster, request);
    return roster.seats.some((seat, index) => {
      const admission = seat.events.findIndex((event) => event.kind === 'admit' && event.requestId === request.requestId &&
        event.ownerReplicaId === request.sponsorReplicaId && canonicalJson(event.member) === canonicalJson(request.member));
      return admission >= 0 && seat.events.findIndex((event) => event.hash === closure.heads[index]) >= admission;
    });
  }

  hasCapacity(): boolean {
    const roster = this.roster();
    return !roster || ownedSeats(roster, this.sync.localRepository()!.replicaId).length > 0;
  }

  removalDeliveryPending(peerId: string): boolean {
    return !!this.db.prepare(`SELECT id FROM sync_group_jobs WHERE kind = 'roster' AND peer_id = ? AND ${OPEN} LIMIT 1`).get(peerId);
  }

  acknowledgeRoster(input: GroupRoster, peerId: string): void {
    const current = this.roster();
    if (!current || !historicalMembers(current).some((member) => member.machineId === peerId) || !rosterCovers(current, input)) {
      throw new PeerProtocolError('invalid', 'roster delivery proof not covered locally');
    }
    const jobs = this.db.prepare("SELECT id, payload_json FROM sync_group_jobs WHERE peer_id = ? AND kind = 'roster' AND state <> 'done' LIMIT 16")
      .all(peerId) as Array<{ id: string; payload_json: string }>;
    // A later proof of delivery also completes a delivery that had failed.
    for (const job of jobs) if (rosterCovers(input, parseRoster(JSON.parse(job.payload_json)))) {
      this.db.prepare("UPDATE sync_group_jobs SET state = 'done', attempts = attempts + 1, error = NULL, next_at = 0 WHERE id = ?").run(job.id);
    }
  }

  freezeCapacity(request: CapacityRequest): CapacityRequest {
    const consent = this.consent();
    if (!consent) throw new PeerProtocolError('invalid', 'sponsor consent missing');
    if (consent.capacity) {
      if (canonicalJson(consent.capacity) !== canonicalJson(request)) throw new PeerProtocolError('conflict', 'capacity request payload changed');
      return consent.capacity;
    }
    capacitySchema.parse(request);
    this.db.prepare('UPDATE sync_group_control SET consent_json = ? WHERE singleton = 1').run(canonicalJson({ ...consent, capacity: request }));
    return request;
  }

  clearCapacity(): void {
    const consent = this.consent();
    if (!consent) return;
    const { capacity: _capacity, ...rest } = consent;
    this.db.prepare('UPDATE sync_group_control SET consent_json = ? WHERE singleton = 1').run(canonicalJson(rest));
  }

  transfer(input: CapacityRequest, peerId: string): { requestId: string; roster: GroupRoster } {
    const request = capacitySchema.parse(input);
    return this.db.transaction(() => {
      const roster = this.roster(), local = this.sync.localRepository()!;
      if (!roster || request.repoId !== roster.repoId || request.groupId !== roster.groupId || request.donorReplicaId !== local.replicaId ||
        request.requestId !== capacityRequestId(request.admissionRequestId, local.replicaId) ||
        !roster.members.some((member) => member.replicaId === request.recipientReplicaId && member.machineId === peerId) ||
        !roster.members.some((member) => member.replicaId === local.replicaId)) throw new PeerProtocolError('invalid', 'capacity sender, request or group mismatch');
      const previous = this.db.prepare('SELECT request_json, receipt_json FROM sync_group_admissions WHERE request_id = ?')
        .get(request.requestId) as { request_json: string; receipt_json: string } | undefined;
      if (previous) {
        if (previous.request_json !== canonicalJson(request)) throw new PeerProtocolError('conflict', 'capacity request id reused with different payload');
        return JSON.parse(previous.receipt_json);
      }
      if (isRetiring(roster, local.replicaId) || isRetiring(roster, request.recipientReplicaId)) throw new PeerProtocolError('invalid', 'capacity member is retiring');
      const next = transferSeat(roster, local.replicaId, request.recipientReplicaId, request.requestId);
      const receipt = { requestId: request.requestId, roster: next };
      this.capacity('sync_group_admissions'); this.persistRoster(next); this.enqueue(next, 'roster');
      this.db.prepare('INSERT INTO sync_group_admissions (request_id, request_json, receipt_json) VALUES (?, ?, ?)')
        .run(request.requestId, canonicalJson(request), canonicalJson(receipt));
      return receipt;
    });
  }
}
