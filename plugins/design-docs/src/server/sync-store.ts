import { randomUUID } from 'node:crypto';
import type { PluginDatabase } from '@zana-ai/zcc-plugin-sdk/server';
import {
  MAX_PENDING_PEER_INTENTS,
  MAX_PEER_GROUP_MEMBERS,
  MAX_PEER_SESSION_OPERATIONS,
  MAX_PEER_PAGE_OPERATIONS,
  MAX_PEER_STORED_BYTES,
  MAX_PEER_STORED_VERSIONS,
  MAX_PEER_HISTORY_ROWS,
  MAX_PEER_STORED_HISTORY_IDENTITIES,
  MAX_PEER_SESSION_BYTES, MAX_PEER_CHUNK_BYTES, MAX_PEER_STAGED_SESSIONS, MAX_PEER_SESSION_BLOBS,
   MAX_PEER_CLOSURE_BYTES, MAX_PEER_TRANSFER_BYTES, PEER_RETRY_MAX_MS, PEER_STAGE_IDLE_MS,
  MAX_PEER_STORED_OPERATIONS, PEER_COMPACTION_BATCH, PEER_DELTA_PROTOCOL_VERSION, PEER_MIN_PROTOCOL_VERSION, PEER_PROTOCOL_VERSION,
  MAX_PEER_TOMBSTONES
} from '../shared/peer-limits.js';
import {
  type PeerGroupMember,
  type PeerOperation,
  type PeerOperationOrigin,
  type PeerReceiptStage,
  PeerProtocolError,
  validatePeerGroupMembers,
  canonicalJson, canonicalPeerHash, validateDocumentClosure, isDeletionClosure, PEER_DELETE_KIND, PEER_DOCUMENT_KIND,
  type PeerDocumentClosure, type PeerVersion, type PeerAppliedReceipt
} from '../shared/peer-contract.js';
import { createCheckpointHash, createScopeHash, validateAppliedReceipt, validateOperation, validateSessionOffer,
  createTransferHash, peerBlobHash, transferQuery, validateTransfer,
   type PeerSessionOffer, type PeerTransfer, type PeerChunk, type PeerReceiptQuery, type PeerHandshake, type PeerMissing,
   type PeerAncestryPage, type PeerAncestorStubs } from './peer-protocol.js';
import { MAX_FILES_PER_DOC, MAX_COMMENTS_PER_DOC, MAX_THREAD_LINKS_PER_DOC, MAX_TEXT_FILE_BYTES } from '../shared/limits.js';
import type { DocActor, PeerConflictPage, PeerConflictReview, PeerConflictFile, PeerResolutionChoice } from '../shared/contract.js';
import { normalizeDocPath } from '../shared/paths.js';
import { mergeDocument, mergeHistory, type DocumentMergeResult } from './peer-merge.js';
import { DOC_ONLY, TEMPLATE_ONLY } from './store.js';

export interface SyncStoreOptions {
  now?: () => number;
  randomId?: () => string;
  /** Tombstone head retention cap; tests lower it. */
  maxTombstones?: number;
}

/** Store mutation kind for a whole-document delete; the doc rows are already gone when it is recorded. */
export const DELETE_DOC_MUTATION = 'delete-doc';
const MAX_INTENT_ATTEMPTS = 10;

/**
 * Closures this module produced through validateDocumentClosure. A peer apply runs inside one worker commit fence
 * with a fixed CPU budget, so an already-validated (immutable, never mutated) closure is not validated again.
 */
const validatedClosures = new WeakSet<PeerDocumentClosure>();
function validatedClosure(input: unknown): PeerDocumentClosure {
  const closure = validateDocumentClosure(input);
  validatedClosures.add(closure);
  return closure;
}
/** canonicalPeerHash of a validated closure, computed once per (immutable) closure object. */
const closureHashes = new WeakMap<PeerDocumentClosure, string>();
function closurePayloadHash(closure: PeerDocumentClosure): string {
  let hash = closureHashes.get(closure);
  if (hash === undefined) { hash = canonicalPeerHash(closure); if (validatedClosures.has(closure)) closureHashes.set(closure, hash); }
  return hash;
}

/** Opaque result of DesignDocSyncStore.prepareTransfer; only store-minted preparations are honoured. */
export interface PreparedTransfer { readonly header: string; readonly versions: readonly PeerVersion[]; readonly used: number }
const preparedTransfers = new WeakSet<PreparedTransfer>();

/** Opaque resume point; `upper` is the frontier frozen by the first page. */
export interface OperationCursor {
  afterReplicaId: string;
  afterSequence: number;
  upper: Record<string, number>;
}

export interface OperationPage {
  operations: PeerOperation[];
  next: OperationCursor | null;
}

function validOperationCursor(cursor: OperationCursor): boolean {
  if (typeof cursor.afterReplicaId !== 'string' || !Number.isInteger(cursor.afterSequence) || cursor.afterSequence < 0) return false;
  if (!cursor.upper || typeof cursor.upper !== 'object') return false;
  const entries = Object.entries(cursor.upper);
  return entries.length <= MAX_PEER_STORED_VERSIONS && entries.every(([id, top]) => id.length > 0 && Number.isInteger(top) && top >= 0);
}

export interface FrozenSyncIntent {
  id: string;
  repoId: string;
  docId: string;
  frozenHead: string;
  memberReplicaId: string;
  scopeHash: string;
  state: 'pending' | 'blocked' | 'synced';
}

export interface CompactionResult {
  compacted: number;
  /** Why retention refused to compact; null when compaction was permitted. */
  blocked: string | null;
}

export class DesignDocSyncStore {
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly maxTombstones: number;
  /**
   * Hash-verified versions, scoped to one apply transaction (null outside one). A version is immutable per
   * operation id, so a peer apply re-reading the same head reuses the verification instead of re-hydrating and
   * re-hashing a multi-megabyte closure inside the fenced commit. Keyed entries also pin the stored manifest, so
   * a compaction or rewrite within the same transaction falls back to the full read.
   */
  private verifiedVersions: Map<string, { manifest: string; version: PeerVersion }> | null = null;

  constructor(private readonly db: PluginDatabase, options: SyncStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? randomUUID;
    this.maxTombstones = options.maxTombstones ?? MAX_PEER_TOMBSTONES;
  }

  initialize(repoId: string, replicaId: string): void {
    const at = this.now();
    this.db.prepare(
      `INSERT INTO sync_repositories (repo_id, replica_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT (repo_id) DO NOTHING`
    ).run(repoId, replicaId, at);
  }

  initializeLocal(): { repoId: string; replicaId: string } {
    const existing = this.localRepository();
    if (existing) return { repoId: existing.repoId, replicaId: existing.replicaId };
    const repoId = this.randomId(), replicaId = this.randomId();
    this.initialize(repoId, replicaId);
    return { repoId, replicaId };
  }

  localRepository(): { repoId: string; replicaId: string; groupId: string | null; rosterEpoch: number; rosterDigest: string | null } | null {
    const row = this.db.prepare(
      `SELECT repo_id, replica_id, group_id, roster_epoch,
       CASE WHEN json_extract(roster_json, '$.version') = 1 AND json_extract(roster_json, '$.repoId') = repo_id
         AND json_extract(roster_json, '$.groupId') = group_id THEN json_extract(roster_json, '$.digest') END AS roster_digest
       FROM sync_repositories LEFT JOIN sync_group_control ON singleton = 1 ORDER BY created_at LIMIT 1`
    ).get() as { repo_id: string; replica_id: string; group_id: string | null; roster_epoch: number; roster_digest: string | null } | undefined;
    return row ? { repoId: row.repo_id, replicaId: row.replica_id, groupId: row.group_id,
      rosterEpoch: row.roster_epoch, rosterDigest: row.roster_digest } : null;
  }

  operations(repoId: string, limit = MAX_PEER_SESSION_OPERATIONS): PeerOperation[] {
    return this.operationsPage(repoId, { limit }).operations;
  }

  /**
   * Keyset-paged catch-up. The first page freezes the per-replica sequence frontier; every follow-up page
   * carries it in the cursor, so operations authored after the snapshot never leak in and no page is
   * silently truncated. `next` is null once the frozen frontier is exhausted.
   */
  operationsPage(repoId: string, input: { limit?: number; cursor?: OperationCursor | null } = {}): OperationPage {
    const limit = Math.min(Math.max(1, Math.trunc(input.limit ?? MAX_PEER_PAGE_OPERATIONS)), MAX_PEER_PAGE_OPERATIONS);
    const cursor = input.cursor ?? null;
    if (cursor && !validOperationCursor(cursor)) throw new PeerProtocolError('invalid', 'operation cursor is invalid');
    const upper = cursor?.upper ?? Object.fromEntries((this.db.prepare(
      'SELECT replica_id, MAX(sequence) AS top FROM sync_operations WHERE repo_id = ? GROUP BY replica_id'
    ).all(repoId) as Array<{ replica_id: string; top: number }>).map((row) => [row.replica_id, row.top]));
    const rows: PeerOperation[] = [];
    let after = cursor ? { replicaId: cursor.afterReplicaId, sequence: cursor.afterSequence } : null;
    let exhausted = false;
    while (rows.length < limit && !exhausted) {
      const batch = this.db.prepare(
        `SELECT op_id, replica_id, sequence, doc_id, parents_json, kind, payload_hash, origin
         FROM sync_operations WHERE repo_id = ? AND (? IS NULL OR (replica_id, sequence) > (?, ?))
         ORDER BY replica_id, sequence LIMIT ?`
      ).all(repoId, after?.replicaId ?? null, after?.replicaId ?? '', after?.sequence ?? 0, limit - rows.length) as Array<{
        op_id: string; replica_id: string; sequence: number; doc_id: string; parents_json: string;
        kind: string; payload_hash: string; origin: PeerOperationOrigin;
      }>;
      if (batch.length < limit - rows.length) exhausted = true;
      for (const row of batch) {
        after = { replicaId: row.replica_id, sequence: row.sequence };
        if (row.sequence > (upper[row.replica_id] ?? 0)) continue;
        rows.push({ id: row.op_id, replicaId: row.replica_id, sequence: row.sequence, docId: row.doc_id,
          parents: JSON.parse(row.parents_json) as string[], kind: row.kind, payloadHash: row.payload_hash, origin: row.origin });
      }
    }
    const next = exhausted || !after ? null : { afterReplicaId: after.replicaId, afterSequence: after.sequence, upper };
    return { operations: rows, next };
  }

  setGroup(repoId: string, groupId: string, members: readonly PeerGroupMember[]): void {
    validatePeerGroupMembers(members);
    const current = this.repository(repoId);
    if (!current) throw new PeerProtocolError('invalid', 'sync repository is not initialized');
    if (!members.some((member) => member.replicaId === current.replica_id)) throw new PeerProtocolError('invalid', 'roster must contain local replica');
    const at = this.now();
    this.db.transaction(() => {
      this.db.prepare('UPDATE sync_repositories SET group_id = ?, roster_epoch = roster_epoch + 1 WHERE repo_id = ?').run(groupId, repoId);
      this.db.prepare('UPDATE sync_group_members SET removed_at = ? WHERE repo_id = ? AND removed_at IS NULL').run(at, repoId);
      for (const member of members) {
        this.db.prepare(
          `INSERT INTO sync_group_members (repo_id, replica_id, machine_id, sponsor_replica_id, joined_at, removed_at)
           VALUES (?, ?, ?, ?, ?, NULL)
           ON CONFLICT (repo_id, replica_id) DO UPDATE SET machine_id = excluded.machine_id,
             sponsor_replica_id = excluded.sponsor_replica_id, joined_at = excluded.joined_at, removed_at = NULL`
        ).run(repoId, member.replicaId, member.machineId, member.sponsorReplicaId, member.joinedAt);
      }
    });
  }

  recordOperation(repoId: string, operation: PeerOperation): void {
    this.db.transaction(() => this.recordOperationRow(repoId, operation));
  }

  private recordOperationRow(repoId: string, operation: PeerOperation): void {
    this.refuseTemplateId(operation.docId);
    if (!this.repository(repoId)) throw new PeerProtocolError('invalid', 'sync repository is not initialized');
    if (!operation.id || !operation.replicaId || !operation.docId || !operation.payloadHash || !operation.kind) {
      throw new PeerProtocolError('invalid', 'peer operation is incomplete');
    }
    if (!Number.isInteger(operation.sequence) || operation.sequence < 1) {
      throw new PeerProtocolError('invalid', 'peer operation sequence is invalid');
    }
    validateOperation(operation);
    const existing = this.operation(repoId, operation.id);
    if (existing) {
      if (canonicalPeerHash(existing) !== canonicalPeerHash(operation)) throw new PeerProtocolError('conflict', 'operation id payload mismatch');
      return;
    }
    const sequence = this.db.prepare('SELECT op_id FROM sync_operations WHERE repo_id = ? AND replica_id = ? AND sequence = ?')
      .get(repoId, operation.replicaId, operation.sequence);
    if (sequence) throw new PeerProtocolError('conflict', 'operation sequence identity mismatch');
    let count = this.db.prepare('SELECT COUNT(*) AS n FROM sync_operations').get() as { n: number };
    if (count.n >= MAX_PEER_STORED_OPERATIONS) {
      this.pruneOperations(repoId);
      count = this.db.prepare('SELECT COUNT(*) AS n FROM sync_operations').get() as { n: number };
    }
    if (count.n >= MAX_PEER_STORED_OPERATIONS) throw new PeerProtocolError('limit', 'operation capacity reached');
    this.db.prepare(
      `INSERT INTO sync_operations (repo_id, op_id, replica_id, sequence, doc_id, parents_json, kind, payload_hash, origin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(repoId, operation.id, operation.replicaId, operation.sequence, operation.docId,
      JSON.stringify([...operation.parents].sort()), operation.kind, operation.payloadHash, operation.origin, this.now());
  }

  /** Only delivered leaves with no retained payload or causal/reference consumers are disposable. */
  private pruneOperations(repoId: string): void {
    if (this.compactionBlocker()) return;
    const candidates = this.db.prepare(`SELECT o.op_id FROM sync_operations o WHERE o.repo_id = ? AND o.kind <> ?
      AND (o.replica_id, o.sequence) NOT IN (SELECT replica_id, MAX(sequence) FROM sync_operations WHERE repo_id = ? GROUP BY replica_id)
      AND NOT EXISTS (SELECT 1 FROM sync_versions v WHERE v.repo_id = o.repo_id AND v.head_id = o.op_id)
      AND NOT EXISTS (SELECT 1 FROM sync_intents i WHERE i.repo_id = o.repo_id AND i.frozen_head = o.op_id)
      AND NOT EXISTS (SELECT 1 FROM sync_doc_heads h WHERE h.repo_id = o.repo_id AND h.head_id = o.op_id)
      AND NOT EXISTS (SELECT 1 FROM sync_conflicts c WHERE c.repo_id = o.repo_id AND (c.local_head = o.op_id OR c.remote_head = o.op_id))
      AND NOT EXISTS (SELECT 1 FROM sync_manual_sessions s, json_each(s.heads_json) h WHERE s.repo_id = o.repo_id AND h.value = o.op_id)
      AND NOT EXISTS (SELECT 1 FROM sync_transfers t, json_each(t.header_json, '$.heads') h WHERE t.repo_id = o.repo_id AND h.value = o.op_id)
      AND NOT EXISTS (SELECT 1 FROM sync_outgoing_sessions s, json_each(s.offer_json, '$.heads') h WHERE h.value = o.op_id)
      AND o.op_id NOT IN (SELECT p.value FROM sync_operations child, json_each(child.parents_json) p WHERE child.repo_id = ?)
      AND NOT EXISTS (SELECT 1 FROM sync_group_members m WHERE m.repo_id = o.repo_id AND m.removed_at IS NULL
        AND m.replica_id <> (SELECT replica_id FROM sync_repositories WHERE repo_id = o.repo_id)
        AND NOT EXISTS (SELECT 1 FROM sync_peer_known k WHERE k.repo_id = o.repo_id AND k.member_replica_id = m.replica_id AND k.head_id = o.op_id))
      ORDER BY o.created_at, o.replica_id, o.sequence LIMIT ?`).all(repoId, PEER_DELETE_KIND, repoId, repoId, PEER_COMPACTION_BATCH) as Array<{ op_id: string }>;
    for (const { op_id: head } of candidates) {
      this.db.prepare('DELETE FROM sync_peer_known WHERE repo_id = ? AND head_id = ?').run(repoId, head);
      this.db.prepare('DELETE FROM sync_operations WHERE repo_id = ? AND op_id = ?').run(repoId, head);
    }
  }

  recordOperations(repoId: string, operations: readonly PeerOperation[]): void {
    this.db.transaction(() => operations.forEach((operation) => this.recordOperation(repoId, operation)));
  }

  recordLocalMutation(input: { docId: string; kind: string; payload: unknown; statusBefore?: string; statusAfter?: string; origin?: PeerOperationOrigin }): void {
    if (this.db.prepare(`SELECT 1 FROM docs WHERE ${TEMPLATE_ONLY} AND id = ?`).get(input.docId)) return;
    const local = this.localRepository();
    if (!local?.groupId || local.rosterEpoch < 1) return;
    if (input.kind === DELETE_DOC_MUTATION) {
      const by = (input.payload as { actor?: DocActor } | null)?.actor ?? { kind: 'user', label: 'You', threadId: null };
      this.recordLocalDeletion(input.docId, by);
      return;
    }
    this.db.transaction(() => {
      const origin = input.origin ?? 'local-authoring';
      const closure = this.capture(input.docId);
      const payloadHash = canonicalPeerHash(closure);
      const parent = this.head(local.repoId, input.docId);
      if (parent && this.version(local.repoId, parent)?.operation.payloadHash === payloadHash) return;
      const next = this.db.prepare(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM sync_operations WHERE repo_id = ? AND replica_id = ?'
      ).get(local.repoId, local.replicaId) as { sequence: number };
      const operation: PeerOperation = {
        id: this.randomId(), replicaId: local.replicaId, sequence: next.sequence, docId: input.docId, parents: parent ? [parent] : [],
        kind: PEER_DOCUMENT_KIND, payloadHash, origin
      };
      this.saveVersion(local.repoId, { operation, closure });
      this.setHead(local.repoId, input.docId, operation.id);
      const qualifies = origin === 'local-authoring' && input.statusBefore !== input.statusAfter &&
        ['approved', 'implemented', 'archived'].includes(input.statusAfter ?? '');
      if (qualifies && local.groupId && local.rosterEpoch > 0) {
        this.createFrozenIntents(local.repoId, input.docId, operation.id, payloadHash);
      }
    });
  }

  /**
   * Whole-document deletion while paired. The store has already removed the doc rows in the same transaction.
   * A tombstone version (scrubbed doc row, no content) becomes the head, its parents the current head plus every
   * unresolved fork, so it causally covers everything this replica has seen. It replicates as an ordinary frozen
   * change, but only to members that could hold the doc; a never-shared draft stays local.
   */
  recordLocalDeletion(docId: string, by: DocActor): string | null {
    const local = this.localRepository();
    if (!local?.groupId || local.rosterEpoch < 1) return null;
    return this.db.transaction(() => {
      this.refuseTemplateId(docId);
      if (this.db.prepare(`SELECT 1 FROM docs WHERE ${DOC_ONLY} AND id = ?`).get(docId)) throw new PeerProtocolError('invalid', 'document still exists');
      const head = this.head(local.repoId, docId);
      // Never journaled while paired, so no peer can hold it: deleting is purely local.
      if (!head) return null;
      if (this.isDeletionHead(local.repoId, head)) return head;
      const forks = this.db.prepare('SELECT DISTINCT remote_head FROM sync_conflicts WHERE repo_id = ? AND doc_id = ? LIMIT 9')
        .all(local.repoId, docId) as Array<{ remote_head: string }>;
      const parents = [...new Set([head, ...forks.map((fork) => fork.remote_head).filter((remote) => remote && this.operation(local.repoId, remote))])].sort();
      if (parents.length > 8) throw new PeerProtocolError('conflict', 'resolve this design doc\'s sync conflicts before deleting it');
      const shared = this.wasShared(local.repoId, local.replicaId, docId);
      const at = this.now(), actor = canonicalJson(by);
      const closure = validateDocumentClosure({
        doc: { id: docId, slug: 'deleted', title: 'Deleted design doc', summary: '', status: 'archived', project_id: null, tags: [],
          entry_path: 'README.md', created_at: at, updated_at: at, created_by: actor, updated_by: actor },
        files: [], history: [], comments: [], threads: [], deleted: { at, by: actor }
      });
      const payloadHash = canonicalPeerHash(closure);
      const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM sync_operations WHERE repo_id = ? AND replica_id = ?')
        .get(local.repoId, local.replicaId) as { sequence: number };
      const operation: PeerOperation = { id: this.randomId(), replicaId: local.replicaId, sequence: next.sequence, docId, parents,
        kind: PEER_DELETE_KIND, payloadHash, origin: 'local-authoring' };
      this.saveVersion(local.repoId, { operation, closure });
      this.setHead(local.repoId, docId, operation.id);
      this.retireDeletedDoc(local.repoId, docId, operation.id);
      if (shared) this.createFrozenIntents(local.repoId, docId, operation.id, payloadHash);
      this.pruneTombstones(local.repoId);
      return operation.id;
    });
  }

  /** A doc another member could hold: it was ever frozen for delivery here, or arrived from another replica. */
  private wasShared(repoId: string, replicaId: string, docId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM sync_intents WHERE repo_id = ? AND doc_id = ? UNION ALL
      SELECT 1 FROM sync_operations WHERE repo_id = ? AND doc_id = ? AND replica_id <> ? LIMIT 1`)
      .get(repoId, docId, repoId, docId, replicaId);
  }

  private isDeletionHead(repoId: string, head: string): boolean {
    return this.operation(repoId, head)?.kind === PEER_DELETE_KIND;
  }

  /**
   * A doc row-less, head-less doc whose deletion was pruned: any deletion operation that descends from the
   * incoming head proves the incoming version is a stale replay, not a concurrent edit.
   */
  private deletedAfter(repoId: string, docId: string, incoming: string): string | null {
    const deletions = this.db.prepare(`SELECT op_id FROM sync_operations WHERE repo_id = ? AND doc_id = ? AND kind = ?
      ORDER BY op_id LIMIT 16`).all(repoId, docId, PEER_DELETE_KIND) as Array<{ op_id: string }>;
    return deletions.find((row) => row.op_id !== incoming && this.isAncestor(repoId, incoming, row.op_id))?.op_id ?? null;
  }

  /** Remove every local projection of a doc: files, history, comments, thread links and sync-side references. */
  private dropProjection(docId: string): void {
    this.refuseTemplateId(docId);
    this.db.prepare(`UPDATE docs SET alternative_to = NULL WHERE ${DOC_ONLY} AND alternative_to = ?`).run(docId);
    // docs-kind: allow Peer deletion refuses template ids before deleting doc-owned projections.
    for (const table of ['doc_files', 'doc_revisions', 'doc_comments', 'doc_threads', 'sync_doc_references', 'sync_history_order']) {
      this.db.prepare(`DELETE FROM ${table} WHERE doc_id = ?`).run(docId);
    }
    this.db.prepare(`DELETE FROM docs WHERE ${DOC_ONLY} AND id = ?`).run(docId);
  }

  /**
   * After a delete becomes the head: older undelivered versions of the doc are superseded, forks are moot, and
   * (when every member speaks delta protocol) unpinned payloads are dropped so content does not linger or travel.
   */
  private retireDeletedDoc(repoId: string, docId: string, tombstone: string): void {
    const stale = this.db.prepare(`SELECT id FROM sync_intents WHERE repo_id = ? AND doc_id = ? AND frozen_head <> ? AND state = 'pending'
      LIMIT ?`).all(repoId, docId, tombstone, MAX_PENDING_PEER_INTENTS) as Array<{ id: string }>;
    for (const { id } of stale) {
      this.db.prepare("UPDATE sync_intents SET state = 'blocked', updated_at = ? WHERE id = ?").run(this.now(), id);
      this.db.prepare('DELETE FROM sync_outgoing_sessions WHERE intent_id = ?').run(id);
      const transfer = this.db.prepare("SELECT repo_id, sender_replica_id, session_id FROM sync_transfers WHERE direction = 'out' AND intent_id = ?")
        .get(id) as { repo_id: string; sender_replica_id: string; session_id: string } | undefined;
      if (transfer) this.db.prepare("DELETE FROM sync_transfer_chunks WHERE direction = 'out' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
        .run(transfer.repo_id, transfer.sender_replica_id, transfer.session_id);
      this.db.prepare("DELETE FROM sync_transfers WHERE direction = 'out' AND intent_id = ?").run(id);
      this.db.prepare('DELETE FROM sync_retry WHERE intent_id = ?').run(id);
    }
    this.db.prepare('DELETE FROM sync_conflicts WHERE repo_id = ? AND doc_id = ?').run(repoId, docId);
    if (this.compactionBlocker()) return;
    const pins = this.retentionPins(repoId);
    const versions = this.db.prepare('SELECT head_id FROM sync_versions WHERE repo_id = ? AND doc_id = ? AND compacted = 0 AND head_id <> ? LIMIT ?')
      .all(repoId, docId, tombstone, MAX_PEER_STORED_VERSIONS) as Array<{ head_id: string }>;
    let dropped = 0;
    for (const { head_id: head } of versions) {
      if (pins.has(head)) continue;
      this.db.prepare("UPDATE sync_versions SET closure_json = '{}', bytes = 0, compacted = 1 WHERE repo_id = ? AND head_id = ?").run(repoId, head);
      this.db.prepare('DELETE FROM sync_version_blobs WHERE repo_id = ? AND head_id = ?').run(repoId, head);
      dropped++;
    }
    if (dropped) this.collectTransportBlobs();
  }

  /**
   * Bounded tombstone retention: beyond the cap, the oldest deletions with nothing left to deliver lose their head
   * row (operation rows stay and keep fencing replays). Deletions still owed to a member are never pruned.
   */
  private pruneTombstones(repoId: string): number {
    const count = (this.db.prepare(`SELECT COUNT(*) AS n FROM sync_doc_heads h JOIN sync_operations o ON o.repo_id = h.repo_id
      AND o.op_id = h.head_id WHERE h.repo_id = ? AND o.kind = ?`).get(repoId, PEER_DELETE_KIND) as { n: number }).n;
    if (count <= this.maxTombstones) return 0;
    const candidates = this.db.prepare(`SELECT h.doc_id, h.head_id FROM sync_doc_heads h JOIN sync_operations o ON o.repo_id = h.repo_id
      AND o.op_id = h.head_id WHERE h.repo_id = ? AND o.kind = ? AND NOT EXISTS (SELECT 1 FROM sync_intents i
        WHERE i.repo_id = h.repo_id AND i.doc_id = h.doc_id AND i.state = 'pending')
      AND NOT EXISTS (SELECT 1 FROM sync_conflicts c WHERE c.repo_id = h.repo_id AND c.doc_id = h.doc_id)
      ORDER BY o.created_at, o.replica_id, o.sequence LIMIT ?`).all(repoId, PEER_DELETE_KIND, count - this.maxTombstones) as Array<{ doc_id: string; head_id: string }>;
    const compactable = !this.compactionBlocker();
    for (const row of candidates) {
      this.db.prepare('DELETE FROM sync_doc_heads WHERE repo_id = ? AND doc_id = ?').run(repoId, row.doc_id);
      if (compactable) {
        this.db.prepare("UPDATE sync_versions SET closure_json = '{}', bytes = 0, compacted = 1 WHERE repo_id = ? AND head_id = ?").run(repoId, row.head_id);
        this.db.prepare('DELETE FROM sync_version_blobs WHERE repo_id = ? AND head_id = ?').run(repoId, row.head_id);
      }
    }
    return candidates.length;
  }

  /** Manual consent only. Pairing and startup never bootstrap old documents. */
  freezeManual(afterDocId = ''): FrozenSyncIntent[] {
    const local = this.localRepository();
    if (!local?.groupId) throw new PeerProtocolError('invalid', 'sync group is not configured');
    this.requireDataMembers(local.repoId, local.replicaId);
    return this.db.transaction(() => {
      const docs = this.db.prepare(`SELECT id FROM docs WHERE ${DOC_ONLY} AND id > ? ORDER BY id LIMIT ?`)
        .all(afterDocId, MAX_PEER_PAGE_OPERATIONS) as Array<{ id: string }>;
      return docs.flatMap(({ id }) => {
        this.recordLocalMutation({ docId: id, kind: 'document', payload: null, origin: 'bootstrap' });
        const head = this.head(local.repoId, id)!;
        return this.createFrozenIntents(local.repoId, id, head, this.version(local.repoId, head)!.operation.payloadHash);
      });
    });
  }

  prepareManual(afterDocId = ''): string | null {
    const local = this.localRepository();
    if (!local?.groupId) throw new PeerProtocolError('invalid', 'manual consent requires group');
    this.requireDataMembers(local.repoId, local.replicaId);
    return this.db.transaction(() => {
      this.pruneManualSessions();
      const docs = this.db.prepare(`SELECT id FROM docs WHERE ${DOC_ONLY} AND id > ? ORDER BY id LIMIT ?`)
        .all(afterDocId, MAX_PEER_PAGE_OPERATIONS + 1) as Array<{ id: string }>;
      const intents = this.freezeManual(afterDocId);
      for (const member of this.members(local.repoId).filter((member) => member.replicaId !== local.replicaId)) {
        const heads = Object.fromEntries(intents.filter((intent) => intent.memberReplicaId === member.replicaId).map((intent) => [intent.docId, intent.frozenHead]));
        this.reserveBytes(Buffer.byteLength(canonicalJson(heads)));
        this.db.prepare(`INSERT INTO sync_manual_sessions VALUES (?, ?, ?, 'out', 'waiting', ?, ?)`)
          .run(this.randomId(), local.repoId, member.replicaId, canonicalJson(heads), this.now());
      }
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM sync_manual_sessions').get() as { n: number };
      if (count.n > MAX_PENDING_PEER_INTENTS) throw new PeerProtocolError('limit', 'manual consent capacity reached');
      return docs.length > MAX_PEER_PAGE_OPERATIONS ? docs[MAX_PEER_PAGE_OPERATIONS - 1]!.id : null;
    });
  }

  manualConsent(member: string): { manualId: string; heads: Record<string, string> } | null {
    const local = this.localRepository()!;
    const row = this.db.prepare(`SELECT session_id, heads_json FROM sync_manual_sessions WHERE repo_id = ? AND member_replica_id = ?
      AND direction = 'out' AND state = 'waiting' ORDER BY created_at, rowid LIMIT 1`).get(local.repoId, member) as { session_id: string; heads_json: string } | undefined;
    return row ? { manualId: row.session_id, heads: JSON.parse(row.heads_json) } : null;
  }


  manualConsents(): Array<{ memberReplicaId: string; manualId: string; heads: Record<string, string> }> {
    const local = this.localRepository()!;
    if (this.isRetiringReplica(local.repoId, local.replicaId)) return [];
    return this.members(local.repoId).flatMap((member) => {
      const consent = this.manualConsent(member.replicaId);
      return consent ? [{ memberReplicaId: member.replicaId, ...consent }] : [];
    });
  }

  acceptManual(member: string, manualId: string, heads: Record<string, string>): boolean {
    const local = this.localRepository()!;
    return this.db.transaction(() => {
      this.requireDataMembers(local.repoId, local.replicaId, member);
      this.pruneManualSessions();
      const prior = this.db.prepare('SELECT * FROM sync_manual_sessions WHERE session_id = ?').get(manualId) as
        { repo_id: string; member_replica_id: string; direction: string; state: string; heads_json: string } | undefined;
      if (prior && (prior.repo_id !== local.repoId || prior.member_replica_id !== member || prior.direction !== 'in' || prior.heads_json !== canonicalJson(heads))) {
        throw new PeerProtocolError('conflict', 'manual consent identity mismatch');
      }
      if (prior?.state === 'accepted') return true;
      const consent = this.manualConsent(member);
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM sync_manual_sessions').get() as { n: number };
      if (!prior && count.n >= MAX_PENDING_PEER_INTENTS) throw new PeerProtocolError('limit', 'manual consent capacity reached');
      if (!prior) this.reserveBytes(Buffer.byteLength(canonicalJson(heads)));
      this.db.prepare(`INSERT INTO sync_manual_sessions VALUES (?, ?, ?, 'in', ?, ?, ?)
        ON CONFLICT (session_id) DO UPDATE SET state = excluded.state`)
        .run(manualId, local.repoId, member, consent ? 'accepted' : 'waiting', canonicalJson(heads), this.now());
      if (consent) {
        this.db.prepare("UPDATE sync_manual_sessions SET state = 'accepted' WHERE session_id = ?").run(consent.manualId);
        // Bilateral consent just completed for this member. Clear any exponential-backoff retry on pending intents to them so
        // a frozen head that blocked before consent re-delivers on the next pass instead of waiting out the backoff.
        this.db.prepare(`DELETE FROM sync_retry WHERE intent_id IN (
          SELECT id FROM sync_intents WHERE repo_id = ? AND member_replica_id = ? AND state = 'pending')`)
          .run(local.repoId, member);
      }
      return !!consent;
    });
  }



  completeManual(manualId: string): void {
    this.db.transaction(() => {
      const local = this.localRepository()!;
      const session = this.db.prepare("SELECT member_replica_id FROM sync_manual_sessions WHERE session_id = ? AND direction = 'out'")
        .get(manualId) as { member_replica_id: string } | undefined;
      this.requireDataMembers(local.repoId, local.replicaId, ...(session ? [session.member_replica_id] : []));
      this.db.prepare("UPDATE sync_manual_sessions SET state = 'accepted' WHERE session_id = ? AND direction = 'out'").run(manualId);
      if (session) {
        this.db.prepare(`UPDATE sync_manual_sessions SET state = 'accepted' WHERE repo_id = ?
          AND member_replica_id = ? AND direction = 'in' AND state = 'waiting'`).run(local.repoId, session.member_replica_id);
        // Bilateral consent now holds for this member. Any pending intent to them that blocked before consent carries an
        // exponential-backoff retry row whose next_at is seconds out; without clearing it the just-authorized frozen head
        // would not re-deliver on the immediately-following sync. Drop the backoff so the next deliver pass ships it at once.
        this.db.prepare(`DELETE FROM sync_retry WHERE intent_id IN (
          SELECT id FROM sync_intents WHERE repo_id = ? AND member_replica_id = ? AND state = 'pending')`)
          .run(local.repoId, session.member_replica_id);
      }
      this.pruneManualSessions();
    });
  }

  /** Keep a small replay window, but never discard consent for undelivered frozen heads. */
  private pruneManualSessions(): void {
    this.db.prepare(`DELETE FROM sync_manual_sessions WHERE session_id IN (
      SELECT session_id FROM (SELECT s.session_id, ROW_NUMBER() OVER (
        PARTITION BY s.repo_id, s.member_replica_id, s.direction ORDER BY s.created_at DESC, s.rowid DESC) AS position
        FROM sync_manual_sessions s WHERE s.state = 'accepted' AND NOT EXISTS (
          SELECT 1 FROM json_each(s.heads_json) h WHERE
            (s.direction = 'out' AND EXISTS (SELECT 1 FROM sync_intents i WHERE i.repo_id = s.repo_id
              AND i.member_replica_id = s.member_replica_id AND i.doc_id = h.key AND i.frozen_head = h.value AND i.state <> 'synced'))
            OR (s.direction = 'in' AND NOT EXISTS (SELECT 1 FROM sync_peer_known k WHERE k.repo_id = s.repo_id
              AND k.member_replica_id = s.member_replica_id AND k.head_id = h.value)))) WHERE position > 128)`).run();
  }

  head(repoId: string, docId: string): string | null {
    return (this.db.prepare('SELECT head_id FROM sync_doc_heads WHERE repo_id = ? AND doc_id = ?')
      .get(repoId, docId) as { head_id: string } | undefined)?.head_id ?? null;
  }

  conflicts(docId: string, cursor = ''): PeerConflictPage {
    const local = this.localRepository();
    if (!local?.groupId) return { remoteHeads: [], nextCursor: null };
    const rows = this.db.prepare(`SELECT DISTINCT remote_head FROM sync_conflicts WHERE repo_id = ? AND doc_id = ? AND remote_head > ?
      ORDER BY remote_head LIMIT 21`).all(local.repoId, docId, cursor) as Array<{ remote_head: string }>;
    return { remoteHeads: rows.slice(0, 20).map((row) => row.remote_head), nextCursor: rows.length > 20 ? rows[19]!.remote_head : null };
  }

  conflictReview(docId: string, remoteHead: string): PeerConflictReview {
    const preview = this.conflictCandidate(docId, remoteHead), local = this.localRepository()!;
    const summary = (head: string) => {
      const closure = this.version(local.repoId, head)!.closure;
      return { title: closure.doc.title, status: closure.doc.status, summary: closure.doc.summary, paths: closure.files.map((file) => file.path) };
    };
    return { localHead: preview.localHead, remoteHead, baseHead: preview.baseHead, conflicts: preview.conflicts,
      mergeAvailable: preview.candidate !== null, local: summary(preview.localHead), remote: summary(remoteHead) };
  }

  conflictFile(docId: string, remoteHead: string, path: string): PeerConflictFile {
    path = normalizeDocPath(path);
    const preview = this.conflictCandidate(docId, remoteHead), local = this.localRepository()!;
    const file = (closure: PeerDocumentClosure | null) => {
      const row = closure?.files.find((file) => file.path === path);
      return row ? { content: row.content, encoding: row.encoding } : null;
    };
    return { localHead: preview.localHead, remoteHead, local: file(this.version(local.repoId, preview.localHead)!.closure),
      remote: file(this.version(local.repoId, remoteHead)!.closure), candidate: file(preview.candidate) };
  }

  conflictCandidate(docId: string, remoteHead: string): DocumentMergeResult & { localHead: string; remoteHead: string; baseHead: string | null } {
    const local = this.localRepository();
    if (!local?.groupId) throw new PeerProtocolError('invalid', 'sync group is not configured');
    const localHead = this.head(local.repoId, docId);
    const fork = this.db.prepare('SELECT local_head FROM sync_conflicts WHERE repo_id = ? AND doc_id = ? AND remote_head = ? LIMIT 1')
      .get(local.repoId, docId, remoteHead) as { local_head: string } | undefined;
    const left = localHead && this.version(local.repoId, localHead), right = this.version(local.repoId, remoteHead);
    if (!fork || !left || !right || right.operation.docId !== docId || !this.isAncestor(local.repoId, fork.local_head, localHead!)) {
      throw new PeerProtocolError('conflict', 'retained peer fork is unavailable');
    }
    if (isDeletionClosure(left.closure) || isDeletionClosure(right.closure)) {
      throw new PeerProtocolError('conflict', 'a deleted design doc cannot be merged');
    }
    const bases = this.mergeBases(local.repoId, docId, localHead!, remoteHead);
    const baseHead = bases.length === 1 ? bases[0]! : null;
    const base = baseHead && this.version(local.repoId, baseHead);
    const result = base ? mergeDocument(base.closure, left.closure, right.closure) :
      { candidate: null, conflicts: [bases.length > 1 ? 'common ancestor ambiguous' : 'common ancestor unavailable'] };
    return { ...result, localHead: localHead!, remoteHead, baseHead };
  }

  /** Lowest common ancestors over retained operation rows; closures are not needed to find a base. */
  private mergeBases(repoId: string, docId: string, left: string, right: string): string[] {
    const ancestors = (head: string): Map<string, PeerOperation> | null => {
      const result = new Map<string, PeerOperation>(), pending = [head];
      while (pending.length) {
        const current = pending.pop()!;
        if (result.has(current)) continue;
        if (result.size >= MAX_PEER_SESSION_OPERATIONS) throw new PeerProtocolError('limit', 'merge ancestry traversal limit reached');
        const operation = this.operation(repoId, current);
        if (!operation || operation.docId !== docId) return null;
        result.set(current, operation); pending.push(...operation.parents);
      }
      return result;
    };
    const leftAncestors = ancestors(left), rightAncestors = ancestors(right);
    if (!leftAncestors || !rightAncestors) return [];
    const common = [...leftAncestors.keys()].filter((head) => rightAncestors.has(head));
    const nonBases = new Set(common.flatMap((head) => leftAncestors.get(head)!.parents));
    return common.filter((head) => !nonBases.has(head));
  }

  /** A resolution journals both forks but does not grant permission to share private parents. */
  resolveConflict(input: { docId: string; expectedHead: string; remoteHead: string; choice: PeerResolutionChoice }, actor: DocActor): string {
    return this.db.transaction(() => {
      const local = this.localRepository();
      if (!local?.groupId) throw new PeerProtocolError('invalid', 'sync group is not configured');
      const current = this.head(local.repoId, input.docId);
      if (!input.expectedHead || current !== input.expectedHead) throw new PeerProtocolError('conflict', 'design doc head changed; review the fork again');
      const version = this.version(local.repoId, current);
      if (!version || canonicalPeerHash(this.capture(input.docId)) !== version.operation.payloadHash) {
        throw new PeerProtocolError('conflict', 'design doc projection changed; review the fork again');
      }
      const preview = this.conflictCandidate(input.docId, input.remoteHead);
      let closure: PeerDocumentClosure;
      if (input.choice === 'merge') {
        if (!preview.candidate) throw new PeerProtocolError('conflict', preview.conflicts.join('; '));
        closure = preview.candidate;
      } else if (input.choice === 'local' || input.choice === 'remote') {
        closure = this.version(local.repoId, input.choice === 'local' ? current : input.remoteHead)!.closure;
      } else throw new PeerProtocolError('invalid', 'invalid peer resolution choice');
      const base = preview.baseHead && this.version(local.repoId, preview.baseHead);
      const history = input.choice === 'merge' ? closure.history : mergeHistory([
        ...(base ? [base.closure.history] : []), version.closure.history, this.version(local.repoId, input.remoteHead)!.closure.history], closure.history);
      const resolved = validateDocumentClosure({ ...closure, history,
        doc: { ...closure.doc, updated_at: this.now(), updated_by: canonicalJson(actor) } });
      const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM sync_operations WHERE repo_id = ? AND replica_id = ?')
        .get(local.repoId, local.replicaId) as { sequence: number };
      const operation: PeerOperation = { id: this.randomId(), replicaId: local.replicaId, sequence: next.sequence, docId: input.docId,
        parents: [...new Set([current, input.remoteHead])].sort(), kind: 'document', payloadHash: canonicalPeerHash(resolved), origin: 'maintenance' };
      this.saveVersion(local.repoId, { operation, closure: resolved });
      this.project(resolved);
      if (canonicalPeerHash(this.capture(input.docId)) !== operation.payloadHash) throw new PeerProtocolError('conflict', 'resolution projection does not match candidate');
      this.setHead(local.repoId, input.docId, operation.id);
      const forks = this.db.prepare('SELECT local_head, remote_head FROM sync_conflicts WHERE repo_id = ? AND doc_id = ? LIMIT ?')
        .all(local.repoId, input.docId, MAX_PEER_STORED_VERSIONS + 1) as Array<{ local_head: string; remote_head: string }>;
      for (const fork of forks) if (this.isAncestor(local.repoId, fork.local_head, operation.id) && this.isAncestor(local.repoId, fork.remote_head, operation.id)) {
        this.db.prepare('DELETE FROM sync_conflicts WHERE repo_id = ? AND doc_id = ? AND local_head = ? AND remote_head = ?')
          .run(local.repoId, input.docId, fork.local_head, fork.remote_head);
      }
      return operation.id;
    });
  }

  version(repoId: string, head: string): PeerVersion | null {
    const row = this.db.prepare(`SELECT closure_json, v.compacted, COALESCE(f.format, 0) AS format FROM sync_versions v LEFT JOIN sync_version_formats f
      ON f.repo_id = v.repo_id AND f.head_id = v.head_id WHERE v.repo_id = ? AND v.head_id = ?`)
      .get(repoId, head) as { closure_json: string; compacted: number; format: number } | undefined;
    const operation = this.operation(repoId, head);
    // A compacted version keeps its operation row (ancestry) but no longer has a payload.
    if (!row || !operation || row.compacted) return null;
    const key = `${repoId}\u0000${head}`, stored = `${row.format}:${row.closure_json}`;
    const cached = this.verifiedVersions?.get(key);
    if (cached && cached.manifest === stored && canonicalPeerHash(cached.version.operation) === canonicalPeerHash(operation)) return cached.version;
    const manifest = JSON.parse(row.closure_json);
    const hydrate = (rows: Array<Record<string, unknown>>) => rows.map(({ blob_hash, ...metadata }) => {
      const blob = this.db.prepare('SELECT content FROM sync_blobs WHERE hash = ?').get(blob_hash) as { content: Buffer } | undefined;
      if (!blob) throw new PeerProtocolError('invalid', 'immutable blob missing');
      return { ...metadata, content: blob.content.toString(metadata.encoding === 'base64' ? 'base64' : 'utf8') };
    });
    const closure = validatedClosure(row.format === 1 ? { ...manifest, files: hydrate(manifest.files), history: hydrate(manifest.history) } : manifest);
    if (closure.doc.id !== operation.docId || closurePayloadHash(closure) !== operation.payloadHash) {
      throw new PeerProtocolError('conflict', 'immutable version payload hash mismatch');
    }
    const version = { operation, closure };
    this.verifiedVersions?.set(key, { manifest: stored, version });
    return version;
  }

  /** Runs one apply with a transaction-scoped verified-version cache; nested applies share the outer scope. */
  private withVerifiedVersions<T>(fn: () => T): T {
    if (this.verifiedVersions) return fn();
    this.verifiedVersions = new Map();
    try { return fn(); } finally { this.verifiedVersions = null; }
  }

  outgoing(intent: FrozenSyncIntent, handshake: Omit<PeerSessionOffer, 'sessionId' | 'versions' | 'heads' | 'scopeHash'>): PeerSessionOffer {
    return this.db.transaction(() => {
      const offer = this.outgoingOffer(intent, handshake);
      // Advisory marker only (outside scopeHash): flag private manual heads so the receiver gates before an inbound session exists.
      return this.isManualOutbound(intent.repoId, intent.memberReplicaId, intent.docId, intent.frozenHead) ? { ...offer, manual: true } : offer;
    });
  }

  private outgoingOffer(intent: FrozenSyncIntent, handshake: Omit<PeerSessionOffer, 'sessionId' | 'versions' | 'heads' | 'scopeHash'>): PeerSessionOffer {
    this.requireOutgoingIdentity(handshake);
    const previous = this.db.prepare('SELECT offer_json FROM sync_outgoing_sessions WHERE intent_id = ?').get(intent.id) as { offer_json: string } | undefined;
    const persisted = previous ? JSON.parse(previous.offer_json) as PeerSessionOffer : null;
    // A delta offer cannot be replayed to a peer that negotiated down; rebuild it (fails closed if compacted).
    if (persisted && persisted.protocolVersion > handshake.protocolVersion) {
      this.db.prepare('DELETE FROM sync_outgoing_sessions WHERE intent_id = ?').run(intent.id);
    } else if (persisted) {
      const offer = persisted;
      if (offer.rosterEpoch === handshake.rosterEpoch && offer.rosterDigest === handshake.rosterDigest &&
        offer.grantEpoch === handshake.grantEpoch && offer.groupId === handshake.groupId) return offer;
      const { rosterDigest: _digest, ...frozen } = offer;
      const body = { ...frozen, ...handshake, sessionId: this.randomId() };
      const rotated = { ...body, scopeHash: createScopeHash(body) };
      this.db.prepare('UPDATE sync_outgoing_sessions SET offer_json = ? WHERE intent_id = ?').run(canonicalJson(rotated), intent.id);
      return rotated;
    }
    const ancestry = this.frozenAncestry(intent, handshake.protocolVersion);
    const versions = ancestry.versions.map((operation) => {
      const version = this.version(intent.repoId, operation.id);
      if (!version) throw new PeerProtocolError('invalid', 'immutable payload unavailable; manual bootstrap required');
      return version;
    });
    const body = { ...handshake, sessionId: this.randomId(), versions, heads: { [intent.docId]: intent.frozenHead }, ...inlineStubs(ancestry.stubs) };
    const offer = { ...body, scopeHash: createScopeHash(body) };
    this.reserveBytes(Buffer.byteLength(canonicalJson(offer), 'utf8'));
    this.db.prepare('INSERT INTO sync_outgoing_sessions (intent_id, offer_json) VALUES (?, ?)').run(intent.id, canonicalJson(offer));
    return offer;
  }

  /**
   * Unsent frozen ancestry in post-order (parents first). At protocol 3 a held operation without a payload, and
   * every ancestor of one, travels as a payload-free stub, so stub sets stay ancestry-closed. Protocol 2 keeps
   * the full-closure refusal. The frozen head itself must always carry its payload.
   */
  private frozenAncestry(intent: FrozenSyncIntent, protocolVersion: number): { versions: PeerOperation[]; stubs: PeerOperation[] } {
    const known = this.knownTo(intent, protocolVersion);
    const order: PeerOperation[] = [], seen = new Set<string>();
    // Iterative post-order (parents before children): deep linear histories must hit the limit, not the call stack.
    const stack: Array<{ operation: PeerOperation; next: number }> = [];
    const enter = (head: string): void => {
      if (seen.has(head)) return;
      if (seen.size >= MAX_PEER_SESSION_OPERATIONS) throw new PeerProtocolError('limit', 'frozen ancestry exceeds session limit');
      seen.add(head);
      if (known(head)) return;
      const operation = this.operation(intent.repoId, head);
      if (!operation) throw new PeerProtocolError('invalid', 'immutable operation missing');
      stack.push({ operation, next: 0 });
    };
    enter(intent.frozenHead);
    while (stack.length) {
      const frame = stack.at(-1)!;
      if (frame.next < frame.operation.parents.length) enter(frame.operation.parents[frame.next++]!);
      else { stack.pop(); order.push(frame.operation); }
    }
    const held = this.db.prepare('SELECT 1 FROM sync_versions WHERE repo_id = ? AND head_id = ? AND compacted = 0');
    const payloadless = order.filter((operation) => !held.get(intent.repoId, operation.id)).map((operation) => operation.id);
    if (payloadless.includes(intent.frozenHead) || (payloadless.length && protocolVersion < PEER_DELTA_PROTOCOL_VERSION)) {
      throw new PeerProtocolError('invalid', 'immutable payload unavailable; manual bootstrap required');
    }
    const byId = new Map(order.map((operation) => [operation.id, operation])), stubbed = new Set<string>();
    while (payloadless.length) {
      const head = payloadless.pop()!;
      if (stubbed.has(head)) continue;
      stubbed.add(head);
      for (const parent of byId.get(head)!.parents) if (byId.has(parent)) payloadless.push(parent);
    }
    return { versions: order.filter((operation) => !stubbed.has(operation.id)), stubs: order.filter((operation) => stubbed.has(operation.id)) };
  }

  /**
   * Stub ancestry older than one inline page, recomputed and paged roots-first so each page is closed over earlier
   * pages and the receiver's own rows. Pages repeat the inline stubs when anything else is needed; replays are no-ops.
   */
  outgoingAncestry(intent: FrozenSyncIntent, carrier: PeerHandshake & PeerAncestorStubs): PeerAncestryPage[] {
    if (carrier.protocolVersion < PEER_DELTA_PROTOCOL_VERSION) return [];
    this.requireOutgoingIdentity(carrier);
    const { stubs } = this.frozenAncestry(intent, carrier.protocolVersion);
    const inline = new Set((carrier.stubs ?? []).map((stub) => stub.id));
    if (stubs.every((stub) => inline.has(stub.id))) return [];
    const handshake: PeerHandshake = { protocolVersion: carrier.protocolVersion, repoId: carrier.repoId, senderReplicaId: carrier.senderReplicaId,
      recipientReplicaId: carrier.recipientReplicaId, grantEpoch: carrier.grantEpoch, groupId: carrier.groupId, rosterEpoch: carrier.rosterEpoch,
      ...(carrier.rosterDigest !== undefined ? { rosterDigest: carrier.rosterDigest } : {}) };
    const pages: PeerAncestryPage[] = [];
    for (let start = 0; start < stubs.length; start += MAX_PEER_PAGE_OPERATIONS) {
      pages.push({ ...handshake, docId: intent.docId, stubs: stubs.slice(start, start + MAX_PEER_PAGE_OPERATIONS) });
    }
    return pages;
  }

  /** Receiver side of an ancestry page: payload-free operation rows only, under the same authorization as apply. */
  recordStubs(page: PeerAncestryPage): number {
    return this.db.transaction(() => {
      if (page.protocolVersion < PEER_DELTA_PROTOCOL_VERSION) throw new PeerProtocolError('invalid', 'ancestor stubs require delta protocol');
      this.requireTransferIdentity(page);
      const local = this.localRepository()!;
      for (const stub of page.stubs) {
        if (stub.docId !== page.docId) throw new PeerProtocolError('invalid', 'ancestor stub page spans documents');
        this.saveStub(local.repoId, local.replicaId, stub);
      }
      return page.stubs.length;
    });
  }

  /** Inbound operations need a roster-known origin, may not extend the local stream, and need held parents. */
  private authorizeInbound(repoId: string, localReplicaId: string, operation: PeerOperation): void {
    if (operation.replicaId === localReplicaId && !this.operation(repoId, operation.id)) {
      throw new PeerProtocolError('invalid', 'peer cannot append to local replica stream');
    }
    // Current authenticated member vouches for group-authorized history, including departed writers.
    // Departed writers cannot initiate a session (current sender membership is checked by callers).
    if (!this.db.prepare('SELECT 1 FROM sync_group_members WHERE repo_id = ? AND replica_id = ?').get(repoId, operation.replicaId)) {
      throw new PeerProtocolError('invalid', 'operation origin is not authorized by roster history');
    }
    // Authoritative delta fence inside the commit: every parent is offered earlier or already held here.
    for (const parent of operation.parents) if (this.operation(repoId, parent)?.docId !== operation.docId) {
      throw new PeerProtocolError('invalid', 'offer parent is neither offered nor held locally');
    }
  }

  /**
   * A stub is an operation row plus a compacted marker: version() never yields it, so it cannot be projected,
   * reviewed or used as a merge base. A later full payload with the identical operation rehydrates it.
   */
  private saveStub(repoId: string, localReplicaId: string, operation: PeerOperation): void {
    this.authorizeInbound(repoId, localReplicaId, operation);
    this.recordOperation(repoId, operation);
    this.db.prepare(`INSERT OR IGNORE INTO sync_versions (repo_id, head_id, doc_id, payload_hash, closure_json, bytes, compacted)
      VALUES (?, ?, ?, ?, '{}', 0, 1)`).run(repoId, operation.id, operation.docId, operation.payloadHash);
  }

  /** Assemble one immutable closure at a time; persist deduplicated blob chunks. */
  outgoingTransfer(intent: FrozenSyncIntent, handshake: PeerHandshake): PeerTransfer {
    return this.db.transaction(() => {
      this.requireOutgoingIdentity(handshake);
      const previous = this.db.prepare("SELECT header_json FROM sync_transfers WHERE direction = 'out' AND intent_id = ?")
        .get(intent.id) as { header_json: string } | undefined;
      const persisted = previous ? JSON.parse(previous.header_json) as PeerTransfer : null;
      if (persisted && persisted.protocolVersion > handshake.protocolVersion) {
        // Downgraded peer: discard the delta transfer and its receipt, then rebuild a full closure.
        this.db.prepare("DELETE FROM sync_transfer_chunks WHERE direction = 'out' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
          .run(persisted.repoId, persisted.senderReplicaId, persisted.sessionId);
        this.db.prepare("DELETE FROM sync_transfers WHERE direction = 'out' AND intent_id = ?").run(intent.id);
        this.db.prepare('DELETE FROM sync_receipts WHERE repo_id = ? AND member_replica_id = ? AND frozen_head = ?')
          .run(intent.repoId, intent.memberReplicaId, intent.frozenHead);
      } else if (persisted) {
        const header = persisted;
        if (header.grantEpoch === handshake.grantEpoch && header.rosterEpoch === handshake.rosterEpoch &&
          header.rosterDigest === handshake.rosterDigest && header.groupId === handshake.groupId) return header;
        const { rosterDigest: _digest, ...frozen } = header;
        const body = { ...frozen, ...handshake, sessionId: this.randomId() };
        const rotated = { ...body, scopeHash: createTransferHash(body) };
        this.db.prepare("UPDATE sync_transfer_chunks SET session_id = ? WHERE direction = 'out' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
          .run(rotated.sessionId, header.repoId, header.senderReplicaId, header.sessionId);
        this.db.prepare("UPDATE sync_transfers SET session_id = ?, header_json = ? WHERE direction = 'out' AND intent_id = ?")
          .run(rotated.sessionId, canonicalJson(rotated), intent.id);
        this.db.prepare('DELETE FROM sync_receipts WHERE repo_id = ? AND member_replica_id = ? AND frozen_head = ?')
          .run(intent.repoId, intent.memberReplicaId, intent.frozenHead);
        return rotated;
      }
      const body: Omit<PeerTransfer, 'scopeHash'> = { ...handshake, sessionId: this.randomId(),
        heads: { [intent.docId]: intent.frozenHead }, versions: [], blobs: [] };
      const blobSet = new Set<string>();
      const { versions: operations, stubs } = this.frozenAncestry(intent, handshake.protocolVersion);
      Object.assign(body, inlineStubs(stubs));
      let total = 0;
      const addBlob = (bytes: Buffer): string => {
        const hash = peerBlobHash(bytes);
        if (blobSet.has(hash)) return hash;
        total += bytes.length;
        if (total > MAX_PEER_TRANSFER_BYTES || blobSet.size >= MAX_PEER_SESSION_BLOBS) throw new PeerProtocolError('limit', 'transfer blob capacity exceeded');
        this.putBlob(bytes);
        blobSet.add(hash); body.blobs.push({ hash, bytes: bytes.length });
        return hash;
      };
      for (const operation of operations) {
        const version = this.version(intent.repoId, operation.id);
        if (!version) throw new PeerProtocolError('invalid', 'immutable payload unavailable; manual bootstrap required');
        this.compactLegacyVersion(intent.repoId, operation.id, version.closure);
        const { files, history, ...metadata } = version.closure;
        const manifest = { ...metadata,
          files: files.map(({ content, ...file }) => ({ ...file, blob_hash: addBlob(Buffer.from(content, file.encoding === 'base64' ? 'base64' : 'utf8')) })),
          history: history.map(({ content, ...row }) => ({ ...row, blob_hash: addBlob(Buffer.from(content, row.encoding === 'base64' ? 'base64' : 'utf8')) })) };
        body.versions.push({ operation, manifestHash: addBlob(Buffer.from(canonicalJson(manifest), 'utf8')) });
      }
      body.blobs.sort((a, b) => a.hash.localeCompare(b.hash));
      // Receiver-visible private-draft marker, folded into the body BEFORE hashing/persisting so the stored row and the
      // returned transfer are byte-identical: acceptTransferReceipt compares whole-object hashes, and createTransferHash
      // enumerates explicit fields (manual excluded), so scopeHash is unaffected while receipt matching stays consistent.
      if (this.isManualOutbound(intent.repoId, intent.memberReplicaId, intent.docId, intent.frozenHead)) body.manual = true;
      const transfer = { ...body, scopeHash: createTransferHash(body) };
      validateTransfer(transfer, { repoId: transfer.repoId, localReplicaId: transfer.recipientReplicaId,
        remoteReplicaId: transfer.senderReplicaId, groupId: transfer.groupId, rosterEpoch: transfer.rosterEpoch,
        ...(transfer.rosterDigest !== undefined ? { rosterDigest: transfer.rosterDigest } : {}), grantEpoch: transfer.grantEpoch },
        (operationId) => this.operationDoc(intent.repoId, operationId));
      this.reserveBytes(Buffer.byteLength(canonicalJson(transfer)));
      this.db.prepare(`INSERT INTO sync_transfers (direction, repo_id, sender_replica_id, session_id, intent_id, header_json)
        VALUES ('out', ?, ?, ?, ?, ?)`).run(body.repoId, body.senderReplicaId, body.sessionId, intent.id, canonicalJson(transfer));
      return transfer;
    });
  }

  outgoingChunk(transfer: PeerTransfer, blobHash: string, index: number): PeerChunk {
    this.requireOutgoingIdentity(transfer);
    const row = this.db.prepare(`SELECT content FROM sync_transfer_chunks WHERE direction = 'out' AND repo_id = ? AND sender_replica_id = ?
      AND session_id = ? AND blob_hash = ? AND chunk_index = ?`).get(transfer.repoId, transfer.senderReplicaId, transfer.sessionId, blobHash, index) as { content: Buffer } | undefined;
    const persisted = this.transfer('out', transfer);
    const blob = this.db.prepare('SELECT content FROM sync_blobs WHERE hash = ?').get(blobHash) as { content: Buffer } | undefined;
    const descriptor = persisted?.blobs.find((blob) => blob.hash === blobHash);
    if (!persisted || persisted.scopeHash !== transfer.scopeHash || !descriptor || !Number.isSafeInteger(index) || index < 0 ||
      index >= Math.ceil(descriptor.bytes / MAX_PEER_CHUNK_BYTES) || (!row && !blob)) throw new PeerProtocolError('invalid', 'outgoing chunk missing');
    const content = row?.content ?? blob!.content.subarray(index * MAX_PEER_CHUNK_BYTES, (index + 1) * MAX_PEER_CHUNK_BYTES);
    return { ...transferQuery(transfer), blobHash, index, chunkHash: peerBlobHash(content), content: content.toString('base64') };
  }

  stageTransfer(transfer: PeerTransfer): void {
    this.db.transaction(() => {
      this.requireTransferIdentity(transfer);
      for (const version of transfer.versions) if (Object.values(transfer.heads).includes(version.operation.id) &&
        (transfer.manual === true || (version.operation.kind !== 'delete' &&
          this.hasManualDoc(transfer.repoId, transfer.senderReplicaId, version.operation.docId)))) {
        this.requireManualHead(transfer.repoId, transfer.senderReplicaId, version.operation.docId, version.operation.id);
      }
      const digest = this.localRepository()!.rosterDigest;
      // Revoked/idle sessions remain quarantined for recovery, but do not consume active slots.
      this.db.prepare(`UPDATE sync_transfers SET state = 'quarantined' WHERE direction = 'in' AND state = 'active' AND
        (updated_at < ? OR (repo_id = ? AND (json_extract(header_json, '$.rosterEpoch') <> ? OR
        json_extract(header_json, '$.groupId') <> ? OR (? IS NOT NULL AND json_extract(header_json, '$.rosterDigest') IS NOT ?) OR
        sender_replica_id NOT IN (SELECT replica_id FROM sync_group_members WHERE repo_id = ? AND removed_at IS NULL))) OR
        (repo_id = ? AND sender_replica_id = ? AND json_extract(header_json, '$.grantEpoch') <> ?))`)
        .run(this.now() - PEER_STAGE_IDLE_MS, transfer.repoId, transfer.rosterEpoch, transfer.groupId, digest, digest,
          transfer.repoId, transfer.repoId, transfer.senderReplicaId, transfer.grantEpoch);
      const previous = this.transfer('in', transfer);
      if (previous) {
        if (canonicalPeerHash(previous) !== canonicalPeerHash(transfer)) throw new PeerProtocolError('conflict', 'session id transfer mismatch');
        const state = this.db.prepare("SELECT state FROM sync_transfers WHERE direction = 'in' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
          .get(transfer.repoId, transfer.senderReplicaId, transfer.sessionId) as { state: string };
        if (state.state !== 'active') this.reserveStaging(transfer);
        this.db.prepare("UPDATE sync_transfers SET state = 'active', updated_at = ? WHERE direction = 'in' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
          .run(this.now(), transfer.repoId, transfer.senderReplicaId, transfer.sessionId);
        return;
      }
      this.reserveStaging(transfer);
      const retained = this.db.prepare("SELECT COUNT(*) AS n FROM sync_transfers WHERE direction = 'in'").get() as { n: number };
      if (retained.n >= MAX_PEER_STAGED_SESSIONS * 4) throw new PeerProtocolError('limit', 'quarantine capacity reached; explicit cancellation required');
      this.reserveBytes(Buffer.byteLength(canonicalJson(transfer)));
      this.db.prepare(`INSERT INTO sync_transfers (direction, repo_id, sender_replica_id, session_id, header_json, updated_at)
        VALUES ('in', ?, ?, ?, ?, ?)`).run(transfer.repoId, transfer.senderReplicaId, transfer.sessionId, canonicalJson(transfer), this.now());
    });
  }

  private reserveStaging(transfer: PeerTransfer): void {
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM sync_transfers WHERE direction = 'in' AND state = 'active'").get() as { n: number };
    if (count.n >= MAX_PEER_STAGED_SESSIONS) throw new PeerProtocolError('limit', 'staged session capacity reached');
    const budget = this.db.prepare(`SELECT COALESCE(SUM(json_extract(blob.value, '$.bytes')), 0) AS n
      FROM sync_transfers, json_each(header_json, '$.blobs') blob WHERE direction = 'in' AND state = 'active'`).get() as { n: number };
    if (budget.n + transfer.blobs.reduce((sum, blob) => sum + blob.bytes, 0) > MAX_PEER_TRANSFER_BYTES) throw new PeerProtocolError('limit', 'staged aggregate capacity reached');
  }

  private requireActiveStage(query: PeerReceiptQuery): void {
    const state = this.db.prepare("SELECT state FROM sync_transfers WHERE direction = 'in' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
      .get(query.repoId, query.senderReplicaId, query.sessionId) as { state: string } | undefined;
    if (state?.state !== 'active') throw new PeerProtocolError('invalid', 'staged session quarantined; reauthorize transfer first');
  }

  stageChunk(packet: PeerChunk, bytes: Buffer): void {
    this.db.transaction(() => {
      const header = this.transfer('in', packet);
      if (!header) throw new PeerProtocolError('invalid', 'chunk has no authorized transfer');
      this.requireActiveStage(packet);
      this.requireTransferIdentity(header);
      this.requireTransferIdentity(packet);
      if (header.scopeHash !== packet.scopeHash || header.grantEpoch !== packet.grantEpoch || header.rosterEpoch !== packet.rosterEpoch ||
        header.rosterDigest !== packet.rosterDigest) {
        throw new PeerProtocolError('invalid', 'chunk authorization mismatch');
      }
      const blob = header.blobs.find((blob) => blob.hash === packet.blobHash);
      const required = blob ? Math.min(MAX_PEER_CHUNK_BYTES, blob.bytes - packet.index * MAX_PEER_CHUNK_BYTES) : -1;
      if (required <= 0 || bytes.length !== required || peerBlobHash(bytes) !== packet.chunkHash) throw new PeerProtocolError('invalid', 'chunk length or scope mismatch');
      const previous = this.db.prepare(`SELECT content FROM sync_transfer_chunks WHERE direction = 'in' AND repo_id = ? AND sender_replica_id = ?
        AND session_id = ? AND blob_hash = ? AND chunk_index = ?`).get(packet.repoId, packet.senderReplicaId, packet.sessionId, packet.blobHash, packet.index) as { content: Buffer } | undefined;
      if (previous) {
        if (!previous.content.equals(bytes)) throw new PeerProtocolError('conflict', 'chunk replay content mismatch');
        return;
      }
      this.reserveBytes(bytes.length);
      this.db.prepare(`INSERT INTO sync_transfer_chunks (direction, repo_id, sender_replica_id, session_id, blob_hash, chunk_index, content)
         VALUES ('in', ?, ?, ?, ?, ?, ?)`).run(packet.repoId, packet.senderReplicaId, packet.sessionId, packet.blobHash, packet.index, bytes);
      this.db.prepare("UPDATE sync_transfers SET updated_at = ? WHERE direction = 'in' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
        .run(this.now(), packet.repoId, packet.senderReplicaId, packet.sessionId);
    });
  }

  missingChunks(query: PeerReceiptQuery): PeerMissing {
    this.requireTransferIdentity(query);
    const header = this.transfer('in', query);
    if (!header || canonicalPeerHash(transferQuery(header)) !== canonicalPeerHash(query)) throw new PeerProtocolError('invalid', 'missing window has no authorized transfer');
    this.requireActiveStage(query);
    const chunks: PeerMissing['chunks'] = [];
    for (const blob of header.blobs) {
      const cached = this.db.prepare('SELECT bytes FROM sync_blobs WHERE hash = ?').get(blob.hash) as { bytes: number } | undefined;
      if (cached?.bytes === blob.bytes) continue;
      const present = new Set((this.db.prepare(`SELECT chunk_index FROM sync_transfer_chunks WHERE direction = 'in' AND repo_id = ? AND
        sender_replica_id = ? AND session_id = ? AND blob_hash = ?`).all(query.repoId, query.senderReplicaId, query.sessionId, blob.hash) as Array<{ chunk_index: number }>).map((row) => row.chunk_index));
      for (let index = 0; index < Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES); index++) {
        if (!present.has(index)) chunks.push({ blobHash: blob.hash, index });
        if (chunks.length === MAX_PEER_SESSION_BYTES / MAX_PEER_CHUNK_BYTES) return { chunks };
      }
    }
    return { chunks };
  }

  /** Explicit recovery only; never drops immutable versions, intents or unresolved forks. */
  cancelStaging(query: PeerReceiptQuery): void {
    this.requireTransferIdentity(query);
    const header = this.transfer('in', query);
    if (!header || header.scopeHash !== query.scopeHash ||
      (this.localRepository()!.rosterDigest !== null && header.rosterDigest !== query.rosterDigest)) throw new PeerProtocolError('invalid', 'cancel scope mismatch');
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM sync_transfer_chunks WHERE direction = 'in' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
        .run(query.repoId, query.senderReplicaId, query.sessionId);
      this.db.prepare("DELETE FROM sync_transfers WHERE direction = 'in' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
        .run(query.repoId, query.senderReplicaId, query.sessionId);
    });
  }

  /**
   * Read-only pre-verification of a staged transfer, run before the peer commit fence. Hydration is a pure function
   * of the immutable staged header and sha256-verified blob bytes, so the fenced applyTransfer only re-checks the
   * authorization and that the header is unchanged instead of re-assembling and re-validating every closure inside
   * the fixed worker execution budget. Returns null when nothing is staged or the session is already applied.
   */
  prepareTransfer(query: PeerReceiptQuery): PreparedTransfer | null {
    return this.db.transaction(() => {
      this.requireTransferIdentity(query);
      if (this.checkpoint(query.repoId, query.senderReplicaId, query.sessionId, query.scopeHash, query.rosterDigest)) return null;
      const transfer = this.stagedTransfer(query);
      const prepared: PreparedTransfer = { header: canonicalPeerHash(transfer), ...this.hydrateTransfer(transfer, query) };
      preparedTransfers.add(prepared);
      return prepared;
    });
  }

  applyTransfer(query: PeerReceiptQuery, prepared?: PreparedTransfer | null): PeerAppliedReceipt {
    return this.withVerifiedVersions(() => this.db.transaction(() => {
      this.requireTransferIdentity(query);
      const previous = this.checkpoint(query.repoId, query.senderReplicaId, query.sessionId, query.scopeHash, query.rosterDigest);
      if (previous) return previous;
      const transfer = this.stagedTransfer(query);
      // A preparation only counts for the byte-identical header it hydrated; anything else is re-hydrated here.
      const hydrated = prepared && preparedTransfers.has(prepared) && prepared.header === canonicalPeerHash(transfer)
        ? prepared : this.hydrateTransfer(transfer, query);
      const receipt = this.applyVerified(transfer, hydrated.versions);
      if (hydrated.used !== transfer.blobs.length) throw new PeerProtocolError('invalid', 'staged blobs outside frozen closure');
      this.db.prepare("DELETE FROM sync_transfer_chunks WHERE direction = 'in' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
        .run(query.repoId, query.senderReplicaId, query.sessionId);
      this.db.prepare("DELETE FROM sync_transfers WHERE direction = 'in' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
        .run(query.repoId, query.senderReplicaId, query.sessionId);
      return receipt;
    }));
  }

  private stagedTransfer(query: PeerReceiptQuery): PeerTransfer {
    const transfer = this.transfer('in', query);
    if (!transfer || transfer.scopeHash !== query.scopeHash || transfer.grantEpoch !== query.grantEpoch ||
      transfer.rosterEpoch !== query.rosterEpoch || transfer.rosterDigest !== query.rosterDigest) throw new PeerProtocolError('invalid', 'staged transfer missing or unauthorized');
    this.requireActiveStage(query);
    this.requireTransferIdentity(transfer);
    if (canonicalPeerHash(transferQuery(transfer)) !== canonicalPeerHash(query)) throw new PeerProtocolError('invalid', 'staged transfer fence mismatch');
    return transfer;
  }

  /** Assembles, hash-verifies and validates every staged closure; reads only. */
  private hydrateTransfer(transfer: PeerTransfer, query: PeerReceiptQuery): { versions: PeerVersion[]; used: number } {
    const used = new Set<string>(), verified = new Set<string>();
    // Files, history and ancestor versions often share a blob. Reuse only immutable decoded strings within this
    // hydration; each reference still passes its metadata checks and contributes to the closure byte limit below.
    const decoded = new Map<string, string>();
    const blob = (hash: string): Buffer => {
      const descriptor = transfer.blobs.find((blob) => blob.hash === hash);
      if (!descriptor) throw new PeerProtocolError('invalid', 'manifest references unoffered blob');
      used.add(hash);
      const cached = this.db.prepare('SELECT content FROM sync_blobs WHERE hash = ?').get(hash) as { content: Buffer } | undefined;
      if (cached && cached.content.length === descriptor.bytes && peerBlobHash(cached.content) === hash) return cached.content;
      const parts = this.db.prepare(`SELECT chunk_index, content FROM sync_transfer_chunks WHERE direction = 'in' AND repo_id = ? AND sender_replica_id = ?
        AND session_id = ? AND blob_hash = ? ORDER BY chunk_index LIMIT ?`).all(query.repoId, query.senderReplicaId, query.sessionId, hash,
           Math.ceil(MAX_PEER_CLOSURE_BYTES / MAX_PEER_CHUNK_BYTES) + 1) as Array<{ chunk_index: number; content: Buffer }>;
      if (parts.length !== Math.ceil(descriptor.bytes / MAX_PEER_CHUNK_BYTES) || parts.some((part, index) => part.chunk_index !== index) ||
        parts.reduce((sum, part) => sum + part.content.length, 0) !== descriptor.bytes) throw new PeerProtocolError('invalid', 'staged blob incomplete');
      const bytes = Buffer.concat(parts.map((part) => part.content), descriptor.bytes);
      if (!verified.has(hash) && peerBlobHash(bytes) !== hash) throw new PeerProtocolError('conflict', 'assembled blob hash mismatch');
      verified.add(hash);
      return bytes;
    };
    const versions = transfer.versions.map((version): PeerVersion => {
      const bytes = blob(version.manifestHash);
      const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<string, unknown>;
      if (canonicalJson(manifest) !== bytes.toString('utf8')) throw new PeerProtocolError('invalid', 'noncanonical staged manifest');
      let hydratedBytes = bytes.length;
      const hydrate = (rows: unknown): unknown[] => {
        if (!Array.isArray(rows) || rows.length > MAX_PEER_HISTORY_ROWS) throw new PeerProtocolError('invalid', 'invalid manifest rows');
        return rows.map((row) => {
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new PeerProtocolError('invalid', 'invalid manifest row');
          const { blob_hash: hash, ...metadata } = row as Record<string, unknown>;
          if (typeof hash !== 'string') throw new PeerProtocolError('invalid', 'missing manifest blob hash');
          const descriptor = transfer.blobs.find((blob) => blob.hash === hash);
          if (!descriptor || descriptor.bytes > MAX_TEXT_FILE_BYTES || metadata.size !== descriptor.bytes ||
            !['utf8', 'base64'].includes(String(metadata.encoding))) throw new PeerProtocolError('invalid', 'manifest file blob size or encoding mismatch');
          hydratedBytes += descriptor.bytes * (metadata.encoding === 'base64' ? 4 / 3 : 1);
          if (hydratedBytes > MAX_PEER_CLOSURE_BYTES) throw new PeerProtocolError('limit', 'hydrated closure exceeds frozen cap');
          const key = `${hash}:${metadata.encoding}`;
          let content = decoded.get(key);
          if (content === undefined) {
            const bytes = blob(hash);
            content = metadata.encoding === 'base64' ? bytes.toString('base64') : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            decoded.set(key, content);
          }
          return { ...metadata, content };
        });
      };
      const closure = validatedClosure({ ...manifest, files: hydrate(manifest.files), history: hydrate(manifest.history) });
      closurePayloadHash(closure); // Warm the payload hash outside the fence; saveVersion re-uses it.
      return { operation: version.operation, closure };
    });
    return { versions, used: used.size };
  }

  private transfer(direction: 'in' | 'out', query: PeerReceiptQuery): PeerTransfer | null {
    const row = this.db.prepare('SELECT header_json FROM sync_transfers WHERE direction = ? AND repo_id = ? AND sender_replica_id = ? AND session_id = ?')
      .get(direction, query.repoId, query.senderReplicaId, query.sessionId) as { header_json: string } | undefined;
    return row ? JSON.parse(row.header_json) as PeerTransfer : null;
  }

  private requireTransferIdentity(transfer: PeerHandshake): void {
    const local = this.localRepository();
    if (local) this.requireDataMembers(local.repoId, local.replicaId, transfer.senderReplicaId);
    if (!local || local.repoId !== transfer.repoId || local.replicaId !== transfer.recipientReplicaId || local.groupId !== transfer.groupId ||
      local.rosterEpoch !== transfer.rosterEpoch || (local.rosterDigest !== null && local.rosterDigest !== transfer.rosterDigest) ||
      !this.members(local.repoId).some((member) => member.replicaId === transfer.senderReplicaId)) {
      throw new PeerProtocolError('invalid', 'repository authorization changed before apply');
    }
  }

  private requireOutgoingIdentity(handshake: PeerHandshake): void {
    this.requireTransferIdentity({ ...handshake, senderReplicaId: handshake.recipientReplicaId, recipientReplicaId: handshake.senderReplicaId });
  }

  checkpoint(repoId: string, senderReplicaId: string, sessionId: string, scopeHash: string, rosterDigest?: string): PeerAppliedReceipt | null {
    const local = this.localRepository();
    if (local) this.requireDataMembers(repoId, local.replicaId, senderReplicaId);
    if (local?.rosterDigest !== null && local?.rosterDigest !== undefined && local.rosterDigest !== rosterDigest) {
      throw new PeerProtocolError('invalid', 'repository authorization changed before receipt');
    }
    const row = this.db.prepare('SELECT scope_hash, receipt_json FROM sync_checkpoints WHERE repo_id = ? AND sender_replica_id = ? AND session_id = ?')
      .get(repoId, senderReplicaId, sessionId) as { scope_hash: string; receipt_json: string } | undefined;
    if (row && row.scope_hash !== scopeHash) throw new PeerProtocolError('conflict', 'session id scope mismatch');
    if (!row) return null;
    const { rosterDigest: storedDigest, ...receipt } = JSON.parse(row.receipt_json) as PeerAppliedReceipt & { rosterDigest?: string };
    if (local?.rosterDigest && storedDigest !== local.rosterDigest) throw new PeerProtocolError('invalid', 'checkpoint roster digest mismatch');
    return receipt;
  }

  /** Domain projection, immutable journal and receipt share one SQLite commit. */
  apply(offer: PeerSessionOffer): PeerAppliedReceipt {
    const local = this.localRepository();
    if (!local) throw new PeerProtocolError('invalid', 'repository missing');
    validateSessionOffer(offer, { repoId: local.repoId, localReplicaId: local.replicaId,
      remoteReplicaId: offer.senderReplicaId, groupId: local.groupId!, rosterEpoch: local.rosterEpoch,
      ...(local.rosterDigest !== null ? { rosterDigest: local.rosterDigest } : {}), grantEpoch: offer.grantEpoch },
      (operationId) => this.operationDoc(local.repoId, operationId));
    return this.applyVerified(offer, offer.versions);
  }

  private applyVerified(offer: PeerReceiptQuery & PeerAncestorStubs & { heads: Record<string, string>; manual?: boolean }, versions: Iterable<PeerVersion>): PeerAppliedReceipt {
    return this.withVerifiedVersions(() => this.db.transaction(() => {
      const local = this.localRepository();
      if (local) this.requireDataMembers(local.repoId, local.replicaId, offer.senderReplicaId);
      if (!local || local.repoId !== offer.repoId || local.replicaId !== offer.recipientReplicaId ||
        local.groupId !== offer.groupId || local.rosterEpoch !== offer.rosterEpoch ||
        (local.rosterDigest !== null && local.rosterDigest !== offer.rosterDigest)) {
        throw new PeerProtocolError('invalid', 'repository authorization changed before apply');
      }
      if (!this.members(local.repoId).some((member) => member.replicaId === offer.senderReplicaId)) {
        throw new PeerProtocolError('invalid', 'sender is not a roster member');
      }
      const previous = this.checkpoint(offer.repoId, offer.senderReplicaId, offer.sessionId, offer.scopeHash, offer.rosterDigest);
      if (previous) return previous;
      if (offer.stubs !== undefined && offer.protocolVersion < PEER_DELTA_PROTOCOL_VERSION) {
        throw new PeerProtocolError('invalid', 'ancestor stubs require delta protocol');
      }
      for (const stub of offer.stubs ?? []) this.saveStub(local.repoId, local.replicaId, stub);
      for (const version of versions) {
        if (offer.heads[version.operation.docId] === version.operation.id &&
          (offer.manual === true || (!['approved', 'implemented', 'archived'].includes(version.closure.doc.status) &&
            this.hasManualDoc(offer.repoId, offer.senderReplicaId, version.operation.docId)))) {
          this.requireManualHead(offer.repoId, offer.senderReplicaId, version.operation.docId, version.operation.id);
        }
        this.authorizeInbound(local.repoId, local.replicaId, version.operation);
        this.saveVersion(offer.repoId, version);
      }
      const appliedHeads: Record<string, string> = {};
      let merged = false, deleted = false;
      for (const [docId, incoming] of Object.entries(offer.heads)) {
        const version = this.version(offer.repoId, incoming)!;
        this.refuseTemplateId(docId);
        const exists = this.db.prepare(`SELECT id FROM docs WHERE ${DOC_ONLY} AND id = ?`).get(docId);
        let current = this.head(offer.repoId, docId);
        // Untracked/preexisting local data is a fork, not permission to overwrite.
        if (exists && (!current || canonicalPeerHash(this.capture(docId)) !== this.version(offer.repoId, current)?.operation.payloadHash)) {
          this.recordLocalMutation({ docId, kind: 'document', payload: null, origin: 'maintenance' });
          current = this.head(offer.repoId, docId);
        }
        const conflicts = this.db.prepare('SELECT local_head, remote_head FROM sync_conflicts WHERE repo_id = ? AND doc_id = ? LIMIT ?')
          .all(offer.repoId, docId, MAX_PEER_STORED_VERSIONS + 1) as Array<{ local_head: string; remote_head: string }>;
        const unresolved = conflicts.some((fork) => !this.isAncestor(offer.repoId, fork.local_head, incoming) || !this.isAncestor(offer.repoId, fork.remote_head, incoming));
        if (current && current !== incoming && this.isAncestor(offer.repoId, incoming, current)) {
          // A replayed ancestor is already integrated, never a reason to reopen a resolved fork.
          appliedHeads[docId] = current;
          merged = true;
          continue;
        }
        // A pruned deletion keeps no head, but its operation row still proves an older replica's version stale.
        const pruned = !current && !exists ? this.deletedAfter(offer.repoId, docId, incoming) : null;
        if (pruned) {
          appliedHeads[docId] = pruned;
          merged = true;
          continue;
        }
        if (isDeletionClosure(version.closure)) {
          if (current === incoming) { appliedHeads[docId] = incoming; continue; }
          // Delete wins only when it causally covers everything held here; a concurrent edit always survives it.
          if (!current || (!unresolved && this.isAncestor(offer.repoId, current, incoming))) {
            this.dropProjection(docId);
            this.setHead(offer.repoId, docId, incoming);
            this.retireDeletedDoc(offer.repoId, docId, incoming);
            appliedHeads[docId] = incoming;
            deleted = true;
            continue;
          }
          if (current && this.isDeletionHead(offer.repoId, current) && !unresolved) {
            // Concurrent deletes: both stay deleted and every replica settles on the same (smallest) tombstone id.
            const winner = [current, incoming].sort()[0]!;
            this.setHead(offer.repoId, docId, winner);
            appliedHeads[docId] = winner;
            if (winner !== incoming) merged = true;
            continue;
          }
          // The surviving edit goes back out so the deleting replica (and everyone else) resurrects it too.
          appliedHeads[docId] = current!;
          merged = true;
          const survivor = this.version(offer.repoId, current!);
          if (survivor && !this.isDeletionHead(offer.repoId, current!)) {
            this.createFrozenIntents(offer.repoId, docId, current!, survivor.operation.payloadHash);
          }
          continue;
        }
        const safe = !unresolved && (!exists || current === incoming || (!!current && this.isAncestor(offer.repoId, current, incoming)));
        // docs-kind: allow Slug uniqueness spans both kinds; a collision must become a fork, never overwrite a template.
        const slugClash = this.db.prepare('SELECT id FROM docs WHERE slug = ? AND id <> ?').get(version.closure.doc.slug, docId);
        const commentClash = version.closure.comments.some((comment) => this.db.prepare('SELECT id FROM doc_comments WHERE id = ? AND doc_id <> ?').get(comment.id, docId));
        if (!safe || slugClash || commentClash) {
          const count = this.db.prepare('SELECT COUNT(*) AS n FROM sync_conflicts').get() as { n: number };
          if (count.n >= MAX_PEER_STORED_VERSIONS) throw new PeerProtocolError('limit', 'conflict capacity reached');
          this.db.prepare('INSERT OR IGNORE INTO sync_conflicts (repo_id, doc_id, local_head, remote_head) VALUES (?, ?, ?, ?)')
            .run(offer.repoId, docId, current ?? '', incoming);
          continue;
        }
        if (current !== incoming || !exists) this.project(version.closure);
        if (canonicalPeerHash(this.capture(docId)) !== version.operation.payloadHash) {
          throw new PeerProtocolError('conflict', 'durable projection does not match frozen payload');
        }
        this.setHead(offer.repoId, docId, incoming);
        this.db.prepare('DELETE FROM sync_conflicts WHERE repo_id = ? AND doc_id = ?').run(offer.repoId, docId);
        appliedHeads[docId] = incoming;
      }
      // Group-authorized frozen heads forward unchanged, even when local projection conflicts.
      for (const [docId, incoming] of Object.entries(offer.heads)) {
        const version = this.version(offer.repoId, incoming)!;
        this.markKnown(offer.repoId, offer.senderReplicaId, incoming);
        this.createFrozenIntents(offer.repoId, docId, incoming, version.operation.payloadHash, [offer.senderReplicaId, version.operation.replicaId]);
      }
      if (deleted) this.pruneTombstones(offer.repoId);
      const body: Omit<PeerAppliedReceipt, 'checkpointHash'> = { sessionId: offer.sessionId, scopeHash: offer.scopeHash,
        stage: Object.keys(appliedHeads).length === Object.keys(offer.heads).length ? merged ? 'merged' : 'synced' : 'conflict',
        heads: offer.heads, appliedHeads };
      const receipt = { ...body, checkpointHash: createCheckpointHash(body) };
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM sync_checkpoints').get() as { n: number };
      if (count.n >= MAX_PEER_STORED_VERSIONS) throw new PeerProtocolError('limit', 'checkpoint capacity reached');
      // Checkpoints outlive staging; retain governance binding outside the wire receipt.
      const stored = { ...receipt, ...(offer.rosterDigest !== undefined ? { rosterDigest: offer.rosterDigest } : {}) };
      this.reserveBytes(Buffer.byteLength(canonicalJson(stored), 'utf8'));
      this.db.prepare('INSERT INTO sync_checkpoints (repo_id, sender_replica_id, session_id, scope_hash, receipt_json) VALUES (?, ?, ?, ?, ?)')
        .run(offer.repoId, offer.senderReplicaId, offer.sessionId, offer.scopeHash, canonicalJson(stored));
      return receipt;
    }));
  }

  private hasManualDoc(repoId: string, member: string, docId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM sync_manual_sessions s, json_each(s.heads_json) h
      WHERE s.repo_id = ? AND s.member_replica_id = ? AND s.direction = 'in' AND s.state = 'accepted' AND h.key = ? LIMIT 1`)
      .get(repoId, member, docId);
  }

  /**
   * True when a frozen head is a private draft the sender is sharing manually: it belongs to an outbound manual
   * session for this document and member AND is not a milestone (approved/implemented/archived). Stamped onto
   * outgoing offers/transfers as the receiver-visible `manual` marker so a peer gates a private draft head even
   * before it has an accepted inbound session. Milestones carry no marker (syncNow/deliverPending prepare manual
   * sessions broadly, so the out-session alone cannot distinguish them) and ordinary pairing replay has no session,
   * so both stay open. Folding the status test in here keeps the receiver gates free of closure inspection — the
   * transfer path has no inline closure to read a status from.
   */
  private isManualOutbound(repoId: string, member: string, docId: string, frozenHead: string): boolean {
    const status = this.version(repoId, frozenHead)?.closure.doc.status;
    if (status !== undefined && ['approved', 'implemented', 'archived'].includes(status)) return false;
    return !!this.db.prepare(`SELECT 1 FROM sync_manual_sessions s, json_each(s.heads_json) h
      WHERE s.repo_id = ? AND s.member_replica_id = ? AND s.direction = 'out' AND h.key = ? LIMIT 1`)
      .get(repoId, member, docId);
  }

  private requireManualHead(repoId: string, member: string, docId: string, head: string): void {
    // 1. The exact head is already known from this sender — nothing to gate.
    if (this.db.prepare('SELECT 1 FROM sync_peer_known WHERE repo_id = ? AND member_replica_id = ? AND head_id = ?').get(repoId, member, head)) return;
    // 2. Full bilateral consent: an inbound session from this member, flipped to 'accepted', names this exact head. This is the
    //    two-sided handshake (both peers deliberately prepared the exchange).
    if (this.db.prepare(`SELECT 1 FROM sync_manual_sessions s, json_each(s.heads_json) h
      WHERE s.repo_id = ? AND s.member_replica_id = ? AND s.direction = 'in' AND s.state = 'accepted'
        AND h.key = ? AND h.value = ? LIMIT 1`).get(repoId, member, docId, head)) return;
    // 3. Established, trusted channel + explicit push: once this side already holds authorized content from the sender (any
    //    known head from them proves a completed, consented exchange), a later user-invoked `syncNow` may push further private
    //    heads to them without a fresh per-head reciprocal — provided the sender transmitted an inbound consent naming this
    //    exact head (so background `deliverPending`, which sends no consent, still cannot leak a private draft). A first-contact
    //    peer has no known head from the sender and stays fully gated (sync-store test 104; recovery bilateral test), so a
    //    private draft never reaches a peer that has not yet established a consented exchange.
    const established = this.db.prepare('SELECT 1 FROM sync_peer_known WHERE repo_id = ? AND member_replica_id = ? LIMIT 1').get(repoId, member);
    if (established && this.db.prepare(`SELECT 1 FROM sync_manual_sessions s, json_each(s.heads_json) h
      WHERE s.repo_id = ? AND s.member_replica_id = ? AND s.direction = 'in'
        AND h.key = ? AND h.value = ? LIMIT 1`).get(repoId, member, docId, head)) return;
    throw new PeerProtocolError('invalid', 'bilateral manual consent missing for frozen head');
  }

  private isAncestor(repoId: string, ancestor: string, descendant: string): boolean {
    const pending = [descendant], seen = new Set<string>();
    while (pending.length) {
      const head = pending.pop()!;
      if (head === ancestor) return true;
      if (seen.has(head)) continue;
      if (seen.size >= MAX_PEER_SESSION_OPERATIONS) throw new PeerProtocolError('limit', 'ancestry traversal limit reached');
      seen.add(head);
      pending.push(...(this.operation(repoId, head)?.parents ?? []));
    }
    return false;
  }

  private operation(repoId: string, head: string): PeerOperation | null {
    const row = this.db.prepare('SELECT * FROM sync_operations WHERE repo_id = ? AND op_id = ?').get(repoId, head) as {
      op_id: string; replica_id: string; sequence: number; doc_id: string; parents_json: string;
      kind: string; payload_hash: string; origin: PeerOperationOrigin;
    } | undefined;
    return row ? { id: row.op_id, replicaId: row.replica_id, sequence: row.sequence, docId: row.doc_id,
      parents: JSON.parse(row.parents_json) as string[], kind: row.kind, payloadHash: row.payload_hash, origin: row.origin } : null;
  }

  private setHead(repoId: string, docId: string, head: string): void {
    this.db.prepare('INSERT INTO sync_doc_heads (repo_id, doc_id, head_id) VALUES (?, ?, ?) ON CONFLICT (repo_id, doc_id) DO UPDATE SET head_id = excluded.head_id')
      .run(repoId, docId, head);
  }

  private reserveBytes(extra: number): void {
    if (this.storedBytes() + extra > MAX_PEER_STORED_BYTES) throw new PeerProtocolError('limit', 'durable sync storage capacity reached');
  }

  private storedBytes(): number {
    const row = this.db.prepare(`SELECT (SELECT COALESCE(SUM(bytes), 0) FROM sync_versions) +
      (SELECT COALESCE(SUM(length(CAST(offer_json AS BLOB))), 0) FROM sync_outgoing_sessions) +
      (SELECT COALESCE(SUM(length(CAST(receipt_json AS BLOB))), 0) FROM sync_checkpoints) +
      (SELECT COALESCE(SUM(length(CAST(header_json AS BLOB))), 0) FROM sync_transfers) +
      (SELECT COALESCE(SUM(length(content)), 0) FROM sync_transfer_chunks) +
      (SELECT COALESCE(SUM(bytes), 0) FROM sync_blobs) +
      (SELECT COALESCE(SUM(length(CAST(heads_json AS BLOB))), 0) FROM sync_manual_sessions) AS n`).get() as { n: number };
    return row.n;
  }

  private retainedVersions(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM sync_versions WHERE compacted = 0').get() as { n: number }).n;
  }

  private saveVersion(repoId: string, version: PeerVersion): void {
    const operation = validateOperation(version.operation);
    this.refuseTemplateId(operation.docId);
    const closure = validatedClosures.has(version.closure) ? version.closure : validatedClosure(version.closure);
    if (operation.docId !== closure.doc.id || operation.payloadHash !== closurePayloadHash(closure)) throw new PeerProtocolError('conflict', 'payload identity or hash mismatch');
    if ((operation.kind === PEER_DELETE_KIND) !== isDeletionClosure(closure)) throw new PeerProtocolError('conflict', 'operation kind does not match payload');
    const prior = this.version(repoId, operation.id);
    if (prior) {
      // Both closures are proven to hash to their operation's payloadHash, so equal operations mean equal versions.
      if (canonicalPeerHash(prior.operation) !== canonicalPeerHash(version.operation)) throw new PeerProtocolError('conflict', 'operation id payload mismatch');
      return;
    }
    const compacted = !!this.db.prepare('SELECT 1 FROM sync_versions WHERE repo_id = ? AND head_id = ? AND compacted = 1').get(repoId, operation.id);
    // Capacity relief runs before this version puts any blob, so collection never sees half-written payloads.
    const estimate = Buffer.byteLength(canonicalJson(closure), 'utf8');
    // A large vault needs one retained payload per current document, still bounded by journal capacity.
    const documents = (this.db.prepare(`SELECT COUNT(*) AS n FROM docs WHERE ${DOC_ONLY}`).get() as { n: number }).n;
    const versionLimit = Math.min(MAX_PEER_STORED_OPERATIONS, Math.max(MAX_PEER_STORED_VERSIONS, documents));
    const fits = () => this.retainedVersions() < versionLimit && this.storedBytes() + estimate <= MAX_PEER_STORED_BYTES;
    if (!fits()) this.relieve(fits);
    if (this.retainedVersions() >= versionLimit) throw new PeerProtocolError('limit', 'durable version capacity reached');
    const manifest = this.manifest(closure) as { files: Array<{ blob_hash: string }>; history: Array<{ blob_hash: string }> };
    const json = canonicalJson(manifest), bytes = Buffer.byteLength(json, 'utf8');
    this.reserveBytes(bytes);
    const historyCount = this.db.prepare('SELECT COUNT(*) AS n FROM sync_history_projections').get() as { n: number };
    let addedHistory = 0;
    for (const history of closure.history) {
      const previous = this.db.prepare('SELECT doc_id, payload_hash FROM sync_history_projections WHERE repo_id = ? AND history_id = ?')
        .get(repoId, history.sync_id) as { doc_id: string; payload_hash: string } | undefined;
      const historyHash = canonicalPeerHash(history);
      if (previous && (previous.doc_id !== closure.doc.id || previous.payload_hash !== historyHash)) {
        throw new PeerProtocolError('conflict', 'immutable history identity mismatch');
      }
      if (!previous && historyCount.n + ++addedHistory > MAX_PEER_STORED_HISTORY_IDENTITIES) {
        throw new PeerProtocolError('limit', 'history identity capacity reached');
      }
      this.db.prepare('INSERT OR IGNORE INTO sync_history_projections (repo_id, history_id, doc_id, payload_hash) VALUES (?, ?, ?, ?)')
        .run(repoId, history.sync_id, closure.doc.id, historyHash);
    }
    this.recordOperation(repoId, operation);
    // Rehydration restores a compacted payload whose hash still matches the retained operation row.
    if (compacted) this.db.prepare('UPDATE sync_versions SET closure_json = ?, bytes = ?, compacted = 0 WHERE repo_id = ? AND head_id = ?')
      .run(json, bytes, repoId, operation.id);
    else this.db.prepare('INSERT INTO sync_versions (repo_id, head_id, doc_id, payload_hash, closure_json, bytes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(repoId, operation.id, operation.docId, operation.payloadHash, json, bytes);
    this.db.prepare('INSERT OR REPLACE INTO sync_version_formats VALUES (?, ?, 1)').run(repoId, operation.id);
    // manifest() already hashed (and stored) every row's bytes; reuse those content addresses.
    for (const row of [...manifest.files, ...manifest.history]) {
      this.db.prepare('INSERT OR IGNORE INTO sync_version_blobs VALUES (?, ?, ?)').run(repoId, operation.id, row.blob_hash);
    }
    this.verifiedVersions?.set(`${repoId}\u0000${operation.id}`, { manifest: `1:${json}`, version: { operation: this.operation(repoId, operation.id)!, closure } });
  }

  private putBlob(content: Buffer): string {
    const hash = peerBlobHash(content);
    if (!this.db.prepare('SELECT 1 FROM sync_blobs WHERE hash = ?').get(hash)) {
      this.reserveBytes(content.length);
      this.db.prepare('INSERT INTO sync_blobs VALUES (?, ?, ?)').run(hash, content, content.length);
    }
    return hash;
  }

  /** Convert retained v2 inline bytes without changing canonical payload hash or ancestry. */
  private compactLegacyVersion(repoId: string, head: string, closure: PeerDocumentClosure): void {
    if (this.db.prepare('SELECT 1 FROM sync_version_formats WHERE repo_id = ? AND head_id = ?').get(repoId, head)) return;
    const manifest = canonicalJson(this.manifest(closure));
    this.db.prepare('UPDATE sync_versions SET closure_json = ?, bytes = ? WHERE repo_id = ? AND head_id = ?')
      .run(manifest, Buffer.byteLength(manifest), repoId, head);
    this.db.prepare('INSERT INTO sync_version_formats VALUES (?, ?, 1)').run(repoId, head);
    for (const row of [...closure.files, ...closure.history]) this.db.prepare('INSERT OR IGNORE INTO sync_version_blobs VALUES (?, ?, ?)')
      .run(repoId, head, peerBlobHash(Buffer.from(row.content, row.encoding === 'base64' ? 'base64' : 'utf8')));
  }

  private manifest(closure: PeerDocumentClosure): unknown {
    const encode = (rows: typeof closure.files | typeof closure.history) => rows.map(({ content, ...metadata }) => ({ ...metadata,
      blob_hash: this.putBlob(Buffer.from(content, metadata.encoding === 'base64' ? 'base64' : 'utf8')) }));
    return { ...closure, files: encode(closure.files), history: encode(closure.history) };
  }

  private capture(docId: string): PeerDocumentClosure {
    const doc = this.db.prepare(`SELECT id, slug, title, summary, status, project_id, tags, entry_path,
      created_at, updated_at, created_by, updated_by FROM docs WHERE ${DOC_ONLY} AND id = ?`).get(docId) as PeerDocumentClosure['doc'] & { tags: string } | undefined;
    if (!doc) throw new PeerProtocolError('invalid', 'document missing at capture');
    // docs-kind: allow Capture has resolved docId through the doc-only SELECT above.
    for (const table of ['doc_files', 'doc_revisions']) {
      const rows = this.db.prepare(`SELECT rowid AS row_id FROM ${table} WHERE doc_id = ? AND sync_id IS NULL LIMIT ?`)
        .all(docId, MAX_PEER_HISTORY_ROWS + 1) as Array<{ row_id: number }>;
      if (rows.length > MAX_PEER_HISTORY_ROWS) throw new PeerProtocolError('limit', 'history capture limit reached');
      for (const row of rows) this.db.prepare(`UPDATE ${table} SET sync_id = ? WHERE rowid = ?`).run(this.randomId(), row.row_id);
    }
    const refs = this.db.prepare('SELECT project_json, threads_json FROM sync_doc_references WHERE doc_id = ?').get(docId) as { project_json: string; threads_json: string } | undefined;
    // docs-kind: allow Capture has resolved docId through the doc-only SELECT above.
    const files = this.db.prepare(`SELECT sync_id, path, content, encoding, size, updated_at, updated_by FROM doc_files WHERE doc_id = ? ORDER BY path LIMIT ?`)
      .all(docId, MAX_FILES_PER_DOC + 1) as PeerDocumentClosure['files'];
    const unordered = this.db.prepare(`SELECT sync_id, path, revision, op, content, encoding, size, note, renamed_from, actor, created_at
      FROM doc_revisions WHERE doc_id = ? ORDER BY id LIMIT ?`).all(docId, MAX_PEER_HISTORY_ROWS + 1) as PeerDocumentClosure['history'];
    let position = (this.db.prepare('SELECT COALESCE(MAX(position), 0) AS n FROM sync_history_order WHERE doc_id = ?').get(docId) as { n: number }).n;
    const orderCount = this.db.prepare('SELECT COUNT(*) AS n FROM sync_history_order').get() as { n: number };
    const newRows = unordered.filter((row) => !this.db.prepare('SELECT 1 FROM sync_history_order WHERE doc_id = ? AND history_id = ?').get(docId, row.sync_id)).length;
    if (orderCount.n + newRows > MAX_PEER_STORED_HISTORY_IDENTITIES) throw new PeerProtocolError('limit', 'causal history order capacity reached');
    for (const row of unordered) this.db.prepare('INSERT OR IGNORE INTO sync_history_order VALUES (?, ?, ?)').run(docId, row.sync_id, ++position);
    const order = new Map((this.db.prepare(`SELECT o.history_id, o.position FROM sync_history_order o JOIN doc_revisions r ON
      r.doc_id = o.doc_id AND r.sync_id = o.history_id WHERE o.doc_id = ? LIMIT ?`).all(docId, MAX_PEER_HISTORY_ROWS + 1) as Array<{ history_id: string; position: number }>).map((row) => [row.history_id, row.position]));
    const history = unordered.sort((a, b) => order.get(a.sync_id)! - order.get(b.sync_id)!);
    const comments = this.db.prepare(`SELECT id, path, quote, body, author, status, created_at, resolved_at, parent_id FROM doc_comments
      WHERE doc_id = ? ORDER BY id LIMIT ?`).all(docId, MAX_COMMENTS_PER_DOC + 1) as PeerDocumentClosure['comments'];
    const threads = this.db.prepare(`SELECT thread_id, title, role, last_activity_at FROM doc_threads WHERE doc_id = ? ORDER BY thread_id LIMIT ?`)
      .all(docId, MAX_THREAD_LINKS_PER_DOC + 1) as PeerDocumentClosure['threads'];
    const foreign = refs ? JSON.parse(refs.threads_json) as PeerDocumentClosure['threads'] : [];
    const mergedThreads = new Map([...foreign, ...threads].map((thread) => [thread.thread_id, thread]));
    return validateDocumentClosure({ doc: { ...doc, tags: JSON.parse(doc.tags), project_id: refs ? JSON.parse(refs.project_json) : doc.project_id },
      files, history, comments, threads: [...mergedThreads.values()].sort((a, b) => a.thread_id.localeCompare(b.thread_id)) });
  }

  private project(closure: PeerDocumentClosure): void {
    const doc = closure.doc;
    this.refuseTemplateId(doc.id);
    // Do not bind foreign project/thread IDs to local execution surfaces.
    this.db.prepare(`INSERT INTO docs (id, slug, title, summary, status, project_id, tags, entry_path, revision,
      created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET title = excluded.title, summary = excluded.summary, status = excluded.status,
      tags = excluded.tags, entry_path = excluded.entry_path, revision = docs.revision + 1,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by WHERE docs.${DOC_ONLY}`)
      .run(doc.id, doc.slug, doc.title, doc.summary, doc.status, JSON.stringify(doc.tags), doc.entry_path,
        doc.created_at, doc.updated_at, doc.created_by, doc.updated_by);
    // Existing local binding may survive only when selected logical project is unchanged.
    this.db.prepare(`UPDATE docs SET project_id = NULL WHERE ${DOC_ONLY} AND id = ? AND (project_id <> ? OR ? IS NULL)`)
      .run(doc.id, doc.project_id, doc.project_id);
    this.db.prepare(`INSERT INTO sync_doc_references (doc_id, project_json, threads_json) VALUES (?, ?, ?)
      ON CONFLICT (doc_id) DO UPDATE SET project_json = excluded.project_json, threads_json = excluded.threads_json`)
      .run(doc.id, canonicalJson(doc.project_id), canonicalJson(closure.threads));
    const retainedThreads = new Map(closure.threads.map((thread) => [thread.thread_id, thread]));
    const localThreads = this.db.prepare('SELECT thread_id FROM doc_threads WHERE doc_id = ? LIMIT ?')
      .all(doc.id, MAX_THREAD_LINKS_PER_DOC + 1) as Array<{ thread_id: string }>;
    if (localThreads.length > MAX_THREAD_LINKS_PER_DOC) throw new PeerProtocolError('limit', 'thread projection limit reached');
    for (const local of localThreads) {
      const retained = retainedThreads.get(local.thread_id);
      if (!retained) this.db.prepare('DELETE FROM doc_threads WHERE doc_id = ? AND thread_id = ?').run(doc.id, local.thread_id);
      else this.db.prepare('UPDATE doc_threads SET title = ?, role = ?, last_activity_at = ? WHERE doc_id = ? AND thread_id = ?')
        .run(retained.title, retained.role, retained.last_activity_at, doc.id, local.thread_id);
    }
    // docs-kind: allow Projection refuses template ids and upserts only doc rows before touching files.
    for (const table of ['doc_files', 'doc_comments']) this.db.prepare(`DELETE FROM ${table} WHERE doc_id = ?`).run(doc.id);
    const history = this.db.prepare('SELECT id, sync_id FROM doc_revisions WHERE doc_id = ? LIMIT ?').all(doc.id, MAX_PEER_HISTORY_ROWS + 1) as Array<{ id: number; sync_id: string }>;
    if (history.length > MAX_PEER_HISTORY_ROWS) throw new PeerProtocolError('limit', 'history projection limit reached');
    const keep = new Set(closure.history.map((row) => row.sync_id));
    for (const row of history) if (!keep.has(row.sync_id)) this.db.prepare('DELETE FROM doc_revisions WHERE id = ?').run(row.id);
    for (const file of closure.files) {
      const pathGeneration = (this.db.prepare('SELECT generation FROM sync_file_generations WHERE doc_id = ? AND path = ?').get(doc.id, file.path) as { generation: number } | undefined)?.generation ?? 0;
      const identityGeneration = (this.db.prepare('SELECT generation FROM sync_file_identity_generations WHERE doc_id = ? AND file_id = ?').get(doc.id, file.sync_id) as { generation: number } | undefined)?.generation ?? 0;
      // docs-kind: allow Projection refuses template ids and upserts only doc rows before touching files.
      this.db.prepare(`INSERT INTO doc_files (doc_id, path, content, encoding, size, revision, updated_at, updated_by, sync_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(doc.id, file.path, file.content, file.encoding, file.size,
          Math.max(pathGeneration, identityGeneration) + 1, file.updated_at, file.updated_by, file.sync_id);
    }
    for (const [index, row] of closure.history.entries()) this.db.prepare(`INSERT INTO sync_history_order VALUES (?, ?, ?)
      ON CONFLICT (doc_id, history_id) DO UPDATE SET position = excluded.position`).run(doc.id, row.sync_id, index + 1);
    const projected = new Set(history.map((row) => row.sync_id));
    for (const row of closure.history) if (!projected.has(row.sync_id)) this.db.prepare(`INSERT INTO doc_revisions (doc_id, path, revision, op, content, encoding, size, note, renamed_from, actor, created_at, sync_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(doc.id, row.path, row.revision, row.op, row.content, row.encoding, row.size,
        row.note, row.renamed_from, row.actor, row.created_at, row.sync_id);
    for (const row of closure.comments) this.db.prepare(`INSERT INTO doc_comments (id, doc_id, path, quote, body, author, status, created_at, resolved_at, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(row.id, doc.id, row.path, row.quote, row.body, row.author, row.status, row.created_at, row.resolved_at, row.parent_id);
  }

  private refuseTemplateId(docId: string): void {
    if (this.db.prepare(`SELECT 1 FROM docs WHERE ${TEMPLATE_ONLY} AND id = ?`).get(docId)) {
      throw new PeerProtocolError('invalid', 'templates cannot be peer-synced');
    }
  }

  createFrozenIntents(repoId: string, docId: string, frozenHead: string, scopeHash: string, exclude: string[] = []): FrozenSyncIntent[] {
    this.refuseTemplateId(docId);
    const version = this.version(repoId, frozenHead);
    if (!version || version.operation.docId !== docId || version.operation.payloadHash !== scopeHash) {
      throw new PeerProtocolError('invalid', 'intent requires an immutable document payload');
    }
    const replicaId = this.repository(repoId)?.replica_id;
    // Retiring authoring remains journaled locally, without creating new share authority.
    if (replicaId && this.isRetiringReplica(repoId, replicaId)) return [];
    const members = this.members(repoId).filter((member) => member.replicaId !== replicaId && !exclude.includes(member.replicaId) &&
      !this.db.prepare('SELECT 1 FROM sync_peer_known WHERE repo_id = ? AND member_replica_id = ? AND head_id = ?').get(repoId, member.replicaId, frozenHead));
    if (members.length === 0) return [];
    const pending = this.db.prepare("SELECT COUNT(*) AS count FROM sync_intents WHERE repo_id = ? AND state <> 'synced'").get(repoId) as { count: number };
    const newMembers = members.filter((member) => !this.db.prepare('SELECT id FROM sync_intents WHERE repo_id = ? AND doc_id = ? AND frozen_head = ? AND member_replica_id = ?')
      .get(repoId, docId, frozenHead, member.replicaId));
    if (pending.count + newMembers.length > MAX_PENDING_PEER_INTENTS) {
      throw new PeerProtocolError('limit', 'sync intent capacity reached');
    }
    const at = this.now();
    return this.db.transaction(() => members.map((member) => {
      const id = this.randomId();
      this.db.prepare(
        `INSERT INTO sync_intents (id, repo_id, doc_id, frozen_head, member_replica_id, scope_hash, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT (repo_id, doc_id, frozen_head, member_replica_id) DO NOTHING`
      ).run(id, repoId, docId, frozenHead, member.replicaId, scopeHash, at, at);
      const row = this.db.prepare(
        `SELECT id, repo_id, doc_id, frozen_head, member_replica_id, scope_hash, state FROM sync_intents
         WHERE repo_id = ? AND doc_id = ? AND frozen_head = ? AND member_replica_id = ?`
      ).get(repoId, docId, frozenHead, member.replicaId) as IntentRow;
      return toIntent(row);
    }));
  }

  readyIntents(repoId: string, limit = 100, includeDeferred = false): FrozenSyncIntent[] {
    const replicaId = this.repository(repoId)?.replica_id;
    if (replicaId && this.isRetiringReplica(repoId, replicaId)) return [];
    return (this.db.prepare(
      `SELECT i.* FROM sync_intents i LEFT JOIN sync_retry r ON r.intent_id = i.id
       WHERE repo_id = ? AND state = 'pending' AND COALESCE(r.next_at, 0) <= ?
       ORDER BY ROW_NUMBER() OVER (PARTITION BY member_replica_id ORDER BY COALESCE(r.last_attempt, 0), created_at, id),
         COALESCE(r.last_attempt, 0), created_at, id LIMIT ?`
    ).all(repoId, includeDeferred ? Number.MAX_SAFE_INTEGER : this.now(), Math.min(Math.max(1, limit), 100)) as IntentRow[]).map(toIntent);
  }

  deferIntent(intent: FrozenSyncIntent, error: string): void {
    this.db.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM sync_intents WHERE id = ? AND repo_id = ? AND state = 'pending'").get(intent.id, intent.repoId)) return;
      const replicaId = this.repository(intent.repoId)?.replica_id;
      if (replicaId && this.isRetiringReplica(intent.repoId, replicaId)) return;
      if (this.isRetiringReplica(intent.repoId, intent.memberReplicaId)) {
        this.db.prepare("UPDATE sync_intents SET state = 'blocked', updated_at = ? WHERE id = ? AND state = 'pending'")
          .run(this.now(), intent.id);
        return;
      }
      const attempts = ((this.db.prepare('SELECT attempts FROM sync_retry WHERE intent_id = ?').get(intent.id) as { attempts: number } | undefined)?.attempts ?? 0) + 1;
      if (attempts >= MAX_INTENT_ATTEMPTS) {
        this.db.prepare("UPDATE sync_intents SET state = 'blocked', updated_at = ? WHERE id = ?").run(this.now(), intent.id);
      }
      const delay = Math.min(PEER_RETRY_MAX_MS, 1000 * 2 ** Math.min(attempts - 1, 10));
      this.db.prepare(`INSERT INTO sync_retry VALUES (?, ?, ?, ?, ?) ON CONFLICT (intent_id) DO UPDATE SET
        attempts = excluded.attempts, next_at = excluded.next_at, last_attempt = excluded.last_attempt, error = excluded.error`)
        .run(intent.id, attempts, this.now() + delay, this.now(), error.slice(0, 240));
    });
  }

  private markKnown(repoId: string, member: string, head: string): void {
    const pending = [head], seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      if (seen.size >= MAX_PEER_SESSION_OPERATIONS) throw new PeerProtocolError('limit', 'peer known ancestry capacity reached');
      seen.add(current);
      // Known sets are ancestry-closed, so an already-known head already covers all of its ancestors.
      if (this.db.prepare('INSERT OR IGNORE INTO sync_peer_known VALUES (?, ?, ?)').run(repoId, member, current).changes === 0) continue;
      pending.push(...(this.operation(repoId, current)?.parents ?? []));
    }
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM sync_peer_known').get() as { n: number };
    if (count.n > MAX_PEER_STORED_VERSIONS * MAX_PEER_GROUP_MEMBERS) throw new PeerProtocolError('limit', 'peer known head capacity reached');
  }

  acceptReceipt(intent: FrozenSyncIntent, offer: PeerSessionOffer, receipt: PeerAppliedReceipt): void {
    this.requireOutgoingIdentity(offer);
    validateAppliedReceipt(receipt, offer);
    const persisted = this.db.prepare('SELECT offer_json FROM sync_outgoing_sessions WHERE intent_id = ?').get(intent.id) as { offer_json: string } | undefined;
    if (!persisted || canonicalPeerHash(JSON.parse(persisted.offer_json)) !== canonicalPeerHash(offer) ||
      offer.heads[intent.docId] !== intent.frozenHead || offer.recipientReplicaId !== intent.memberReplicaId) {
      throw new PeerProtocolError('conflict', 'receipt has no matching durable outgoing scope');
    }
    this.db.transaction(() => {
      this.recordReceipt(intent.repoId, intent.memberReplicaId, intent.frozenHead, intent.scopeHash, receipt.stage);
      // A verified synced or merged receipt proves the recipient holds the frozen ancestry, as for transfers.
      if (delivered(receipt.stage)) this.markKnown(intent.repoId, intent.memberReplicaId, intent.frozenHead);
    });
  }

  /** Only redundant transport blobs are collectible; immutable ancestry remains pinned. */
  collectTransportBlobs(): void {
    this.db.prepare(`DELETE FROM sync_blobs WHERE hash NOT IN (SELECT blob_hash FROM sync_version_blobs) AND hash NOT IN
      (SELECT json_extract(b.value, '$.hash') FROM sync_transfers, json_each(header_json, '$.blobs') b)`).run();
  }

  /** Document id of an operation held locally (compacted or not); delta receivers accept only such parents. */
  operationDoc(repoId: string, operationId: string): string | null {
    return this.operation(repoId, operationId)?.docId ?? null;
  }

  /** Protocol-3 senders omit non-head ancestors the recipient is durably known to hold. */
  private knownTo(intent: FrozenSyncIntent, protocolVersion: number): (head: string) => boolean {
    if (protocolVersion < PEER_DELTA_PROTOCOL_VERSION) return () => false;
    const known = this.db.prepare('SELECT 1 FROM sync_peer_known WHERE repo_id = ? AND member_replica_id = ? AND head_id = ?');
    return (head) => head !== intent.frozenHead && !!known.get(intent.repoId, intent.memberReplicaId, head);
  }

  /** Last protocol negotiated with a member; the delta-only retention gate reads it. */
  recordPeerProtocol(memberReplicaId: string, protocolVersion: number): void {
    const local = this.localRepository();
    if (!local || !Number.isInteger(protocolVersion) || protocolVersion < PEER_MIN_PROTOCOL_VERSION || protocolVersion > PEER_PROTOCOL_VERSION) {
      throw new PeerProtocolError('invalid', 'negotiated peer protocol is invalid');
    }
    this.db.prepare(`INSERT INTO sync_peer_protocols VALUES (?, ?, ?, ?) ON CONFLICT (repo_id, member_replica_id)
      DO UPDATE SET protocol_version = excluded.protocol_version, updated_at = excluded.updated_at`)
      .run(local.repoId, memberReplicaId, protocolVersion, this.now());
  }

  peerProtocol(memberReplicaId: string): number | null {
    const local = this.localRepository();
    const row = local && this.db.prepare('SELECT protocol_version FROM sync_peer_protocols WHERE repo_id = ? AND member_replica_id = ?')
      .get(local.repoId, memberReplicaId) as { protocol_version: number } | undefined;
    return row ? row.protocol_version : null;
  }

  /**
   * Compaction drops payloads that only full-closure (protocol 2) sends would need, so it is permitted only while
   * every current data member has negotiated delta offers. Members admitted later cannot receive compacted bodies.
   */
  compactionBlocker(): string | null {
    const local = this.localRepository();
    if (!local?.groupId || local.rosterEpoch < 1) return 'sync group is not configured';
    if (this.isRetiringReplica(local.repoId, local.replicaId)) return 'retiring replica cannot compact retained history';
    for (const member of this.members(local.repoId)) {
      if (member.replicaId === local.replicaId) continue;
      if ((this.peerProtocol(member.replicaId) ?? 0) < PEER_DELTA_PROTOCOL_VERSION) return `member ${member.replicaId} has not negotiated delta protocol`;
    }
    return null;
  }

  /** Versions whose closures must survive compaction. Deterministic; reads only bounded durable tables. */
  retentionPins(repoId: string): Set<string> {
    const pins = new Set<string>();
    const pin = (head: unknown) => { if (typeof head === 'string' && head) pins.add(head); };
    const heads = (record: unknown) => Object.values((record ?? {}) as Record<string, unknown>).forEach(pin);
    for (const row of this.db.prepare('SELECT head_id FROM sync_doc_heads WHERE repo_id = ?').all(repoId) as Array<{ head_id: string }>) pin(row.head_id);
    // Unsent frozen heads plus the ancestry the recipient is not yet known to hold (what a delta send needs).
    const intents = this.db.prepare(`SELECT frozen_head, member_replica_id FROM sync_intents WHERE repo_id = ? AND state <> 'synced'
      ORDER BY member_replica_id, frozen_head LIMIT ?`).all(repoId, MAX_PENDING_PEER_INTENTS + 1) as Array<{ frozen_head: string; member_replica_id: string }>;
    const known = this.db.prepare('SELECT 1 FROM sync_peer_known WHERE repo_id = ? AND member_replica_id = ? AND head_id = ?');
    const visited = new Map<string, Set<string>>();
    for (const intent of intents) {
      const seen = visited.get(intent.member_replica_id) ?? new Set<string>();
      visited.set(intent.member_replica_id, seen);
      pin(intent.frozen_head);
      const pending = [...(this.operation(repoId, intent.frozen_head)?.parents ?? [])];
      while (pending.length) {
        const head = pending.pop()!;
        if (seen.has(head) || known.get(repoId, intent.member_replica_id, head)) continue;
        seen.add(head); pin(head);
        pending.push(...(this.operation(repoId, head)?.parents ?? []));
      }
    }
    // Each member's known frontier is the likeliest merge base for its next concurrent edit.
    for (const row of this.db.prepare(`SELECT k.head_id FROM sync_peer_known k WHERE k.repo_id = ? AND NOT EXISTS (
        SELECT 1 FROM sync_peer_known c JOIN sync_operations o ON o.repo_id = c.repo_id AND o.op_id = c.head_id, json_each(o.parents_json) p
        WHERE c.repo_id = k.repo_id AND c.member_replica_id = k.member_replica_id AND p.value = k.head_id)`).all(repoId) as Array<{ head_id: string }>) pin(row.head_id);
    // Unresolved forks keep both sides and every base a review or merge would need.
    const forks = this.db.prepare('SELECT doc_id, local_head, remote_head FROM sync_conflicts WHERE repo_id = ? ORDER BY doc_id, local_head, remote_head LIMIT ?')
      .all(repoId, MAX_PEER_STORED_VERSIONS + 1) as Array<{ doc_id: string; local_head: string; remote_head: string }>;
    for (const fork of forks) {
      pin(fork.local_head); pin(fork.remote_head);
      const current = this.head(repoId, fork.doc_id);
      for (const left of [fork.local_head, current]) if (left) this.mergeBases(repoId, fork.doc_id, left, fork.remote_head).forEach(pin);
    }
    for (const row of this.db.prepare('SELECT offer_json FROM sync_outgoing_sessions').all() as Array<{ offer_json: string }>) heads(JSON.parse(row.offer_json).heads);
    for (const row of this.db.prepare('SELECT header_json FROM sync_transfers WHERE repo_id = ?').all(repoId) as Array<{ header_json: string }>) heads(JSON.parse(row.header_json).heads);
    for (const row of this.db.prepare('SELECT heads_json FROM sync_manual_sessions WHERE repo_id = ?').all(repoId) as Array<{ heads_json: string }>) heads(JSON.parse(row.heads_json));
    return pins;
  }

  /**
   * Closure-only compaction: unpinned retained versions lose their payload and blob references, never their
   * operation row. Oldest first, so repeated calls are deterministic. Never evicts by age.
   */
  compact(limit = MAX_PEER_STORED_VERSIONS): CompactionResult {
    return this.db.transaction(() => {
      const blocked = this.compactionBlocker();
      if (blocked) return { compacted: 0, blocked };
      const local = this.localRepository()!;
      const pins = this.retentionPins(local.repoId);
      const candidates = (this.db.prepare(`SELECT v.head_id FROM sync_versions v JOIN sync_operations o ON o.repo_id = v.repo_id AND o.op_id = v.head_id
        WHERE v.repo_id = ? AND v.compacted = 0 ORDER BY o.created_at, o.replica_id, o.sequence LIMIT ?`)
        .all(local.repoId, MAX_PEER_STORED_VERSIONS) as Array<{ head_id: string }>).map((row) => row.head_id).filter((head) => !pins.has(head));
      const selected = candidates.slice(0, Math.max(0, Math.trunc(limit)));
      for (const head of selected) {
        this.db.prepare("UPDATE sync_versions SET closure_json = '{}', bytes = 0, compacted = 1 WHERE repo_id = ? AND head_id = ?").run(local.repoId, head);
        this.db.prepare('DELETE FROM sync_version_blobs WHERE repo_id = ? AND head_id = ?').run(local.repoId, head);
      }
      if (selected.length) this.collectTransportBlobs();
      return { compacted: selected.length, blocked: null };
    });
  }

  /** Capacity relief before a write; if pins leave nothing to compact the caller still rejects atomically. */
  private relieve(satisfied: () => boolean): void {
    while (!satisfied() && this.compact(PEER_COMPACTION_BATCH).compacted > 0) { /* next oldest batch */ }
  }

  acceptTransferReceipt(intent: FrozenSyncIntent, transfer: PeerTransfer, receipt: PeerAppliedReceipt): void {
    this.requireOutgoingIdentity(transfer);
    validateAppliedReceipt(receipt, transfer);
    const previous = this.transfer('out', transfer);
    if (!previous || canonicalPeerHash(previous) !== canonicalPeerHash(transfer) || transfer.heads[intent.docId] !== intent.frozenHead ||
      transfer.recipientReplicaId !== intent.memberReplicaId) throw new PeerProtocolError('conflict', 'receipt has no matching durable outgoing transfer');
    this.db.transaction(() => {
      this.recordReceipt(intent.repoId, intent.memberReplicaId, intent.frozenHead, intent.scopeHash, receipt.stage);
      if (delivered(receipt.stage)) {
        this.markKnown(intent.repoId, intent.memberReplicaId, intent.frozenHead);
        // A newer applied head covers immutable ancestors, but never claims those old projections are current.
        this.db.prepare(`UPDATE sync_intents SET state = 'blocked', updated_at = ? WHERE repo_id = ? AND member_replica_id = ?
          AND frozen_head <> ? AND state = 'pending' AND frozen_head IN
          (SELECT head_id FROM sync_peer_known WHERE repo_id = ? AND member_replica_id = ?)`)
          .run(this.now(), intent.repoId, intent.memberReplicaId, intent.frozenHead, intent.repoId, intent.memberReplicaId);
        this.db.prepare("DELETE FROM sync_transfer_chunks WHERE direction = 'out' AND repo_id = ? AND sender_replica_id = ? AND session_id = ?")
          .run(transfer.repoId, transfer.senderReplicaId, transfer.sessionId);
        this.db.prepare("DELETE FROM sync_transfers WHERE direction = 'out' AND intent_id = ?").run(intent.id);
        this.db.prepare('DELETE FROM sync_retry WHERE intent_id = ?').run(intent.id);
        this.collectTransportBlobs();
        this.pruneTombstones(intent.repoId);
      }
    });
  }

  private recordReceipt(repoId: string, memberReplicaId: string, frozenHead: string, scopeHash: string, stage: PeerReceiptStage): void {
    const at = this.now();
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO sync_receipts (repo_id, member_replica_id, frozen_head, scope_hash, stage, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (repo_id, member_replica_id, frozen_head) DO UPDATE SET
           scope_hash = excluded.scope_hash, stage = excluded.stage, updated_at = excluded.updated_at`
      ).run(repoId, memberReplicaId, frozenHead, scopeHash, stage, at);
      if (delivered(stage)) {
        this.db.prepare(
          `UPDATE sync_intents SET state = 'synced', updated_at = ?
           WHERE repo_id = ? AND member_replica_id = ? AND frozen_head = ? AND scope_hash = ?`
        ).run(at, repoId, memberReplicaId, frozenHead, scopeHash);
      }
    });
  }

  members(repoId: string): PeerGroupMember[] {
    const rows = this.db.prepare(
      `SELECT replica_id, machine_id, sponsor_replica_id, joined_at FROM sync_group_members
       WHERE repo_id = ? AND removed_at IS NULL ORDER BY joined_at, replica_id LIMIT ?`
    ).all(repoId, MAX_PEER_GROUP_MEMBERS) as MemberRow[];
    return rows.filter((row) => !this.isRetiringReplica(repoId, row.replica_id)).map((row) => ({
      replicaId: row.replica_id,
      machineId: row.machine_id,
      sponsorReplicaId: row.sponsor_replica_id,
      joinedAt: row.joined_at
    }));
  }

  isRetiringReplica(repoId: string, replicaId: string): boolean {
    // Self-removal detaches group_id but retains terminal governance and transport state.
    return !!this.db.prepare(`SELECT 1 FROM sync_repositories r JOIN sync_group_control c ON c.singleton = 1
      WHERE r.repo_id = ? AND json_extract(c.roster_json, '$.version') = 1
        AND json_extract(c.roster_json, '$.repoId') = r.repo_id
        AND (json_extract(c.roster_json, '$.groupId') = r.group_id OR (r.group_id IS NULL
          AND EXISTS (SELECT 1 FROM sync_group_members m WHERE m.repo_id = r.repo_id
            AND m.replica_id = r.replica_id AND m.machine_id = c.local_peer_id AND m.removed_at IS NOT NULL)
          AND EXISTS (SELECT 1 FROM (SELECT value FROM json_each(c.roster_json, '$.removals') LIMIT 64) removal
            WHERE json_extract(removal.value, '$.replicaId') = r.replica_id)))
        AND EXISTS (SELECT 1 FROM (SELECT value FROM json_each(c.roster_json, '$.retirements') LIMIT 64) retirement
          WHERE json_extract(retirement.value, '$.replicaId') = ?) LIMIT 1`).get(repoId, replicaId);
  }

  private requireDataMembers(repoId: string, ...replicaIds: string[]): void {
    if (replicaIds.some((replicaId) => this.isRetiringReplica(repoId, replicaId))) {
      throw new PeerProtocolError('invalid', 'retiring replica cannot exchange document data');
    }
  }

  private repository(repoId: string): { replica_id: string } | null {
    return (this.db.prepare('SELECT replica_id FROM sync_repositories WHERE repo_id = ?').get(repoId) as { replica_id: string } | undefined) ?? null;
  }
}

interface IntentRow {
  id: string;
  repo_id: string;
  doc_id: string;
  frozen_head: string;
  member_replica_id: string;
  scope_hash: string;
  state: FrozenSyncIntent['state'];
}

interface MemberRow {
  replica_id: string;
  machine_id: string;
  sponsor_replica_id: string | null;
  joined_at: number;
}

function toIntent(row: IntentRow): FrozenSyncIntent {
  return {
    id: row.id,
    repoId: row.repo_id,
    docId: row.doc_id,
    frozenHead: row.frozen_head,
    memberReplicaId: row.member_replica_id,
    scopeHash: row.scope_hash,
    state: row.state
  };
}

/**
 * Terminal delivery. `merged` means the recipient durably holds the frozen head but kept a causally newer (or
 * winning concurrent) head, e.g. a replayed ancestor or a delete that lost to a concurrent edit; retrying cannot
 * change that outcome.
 */
export function delivered(stage: PeerReceiptStage): boolean {
  return stage === 'synced' || stage === 'merged';
}

/** The newest stubs ride inline (one page at most); older ones go first as separate ancestry pages. */
function inlineStubs(stubs: PeerOperation[]): PeerAncestorStubs {
  return stubs.length ? { stubs: stubs.slice(-MAX_PEER_PAGE_OPERATIONS) } : {};
}
