import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isDocStatus } from './contract.js';
import { fileKindOf, isBinaryKind, normalizeDocPath } from './paths.js';
import { MAX_FILES_PER_DOC, MAX_COMMENTS_PER_DOC, MAX_THREAD_LINKS_PER_DOC, MAX_DOC_BYTES,
  MAX_TEXT_FILE_BYTES, MAX_BINARY_FILE_BYTES, MAX_TITLE_LENGTH, MAX_SUMMARY_LENGTH,
  MAX_TAGS, MAX_TAG_LENGTH, MAX_COMMENT_LENGTH, MAX_QUOTE_LENGTH, MAX_NOTE_LENGTH } from './limits.js';
import {
  MAX_PEER_GROUP_MEMBERS,
  MAX_PEER_PACKET_BYTES,
  MAX_PEER_HISTORY_ROWS,
  MAX_PEER_CLOSURE_BYTES,
  PEER_PROTOCOL_VERSION,
  PEER_MIN_PROTOCOL_VERSION
} from './peer-limits.js';

export type PeerReceiptStage = 'received' | 'merged' | 'synced' | 'conflict' | 'blocked';
export type PeerOperationOrigin = 'local-authoring' | 'inbound' | 'bootstrap' | 'import' | 'restore-undo' | 'maintenance';

export interface PeerGroupMember {
  replicaId: string;
  /** Owning app instance identity, matching sdk.peers.list().id and request.peerId. */
  machineId: string;
  joinedAt: number;
  sponsorReplicaId: string | null;
}

export interface PeerOperation {
  id: string;
  replicaId: string;
  sequence: number;
  docId: string;
  parents: string[];
  kind: string;
  payloadHash: string;
  origin: PeerOperationOrigin;
}

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const timestamp = z.number().int().nonnegative().safe();
const actor = z.string().max(1024).refine((raw) => {
  try {
    return z.object({ kind: z.enum(['user', 'agent']), label: z.string().max(MAX_TITLE_LENGTH),
      threadId: id.nullable() }).strict().safeParse(JSON.parse(raw)).success;
  } catch { return false; }
});
const path = z.string().refine((value) => {
  try { return normalizeDocPath(value) === value; } catch { return false; }
});
const file = z.object({ sync_id: id, path, content: z.string(), encoding: z.enum(['utf8', 'base64']),
  size: timestamp, updated_at: timestamp, updated_by: actor }).strict();
const history = z.object({ sync_id: id, path, content: z.string(), encoding: z.enum(['utf8', 'base64']),
  size: timestamp, revision: z.number().int().positive().safe(), op: z.enum(['create', 'write', 'delete', 'rename']),
  note: z.string().max(MAX_NOTE_LENGTH).nullable(), renamed_from: path.nullable(), actor,
  created_at: timestamp }).strict();
const closureSchema = z.object({
  doc: z.object({ id, slug: z.string().regex(/^[a-z0-9-]{1,128}$/), title: z.string().min(1).max(MAX_TITLE_LENGTH),
    summary: z.string().max(MAX_SUMMARY_LENGTH), status: z.string().refine(isDocStatus),
    project_id: id.nullable(), tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS), entry_path: path,
    created_at: timestamp, updated_at: timestamp, created_by: actor, updated_by: actor }).strict(),
  // A live doc needs its entry file (checked below); a deletion tombstone carries none.
  files: z.array(file).max(MAX_FILES_PER_DOC),
  history: z.array(history).max(MAX_PEER_HISTORY_ROWS),
  comments: z.array(z.object({ id, path: path.nullable(), quote: z.string().max(MAX_QUOTE_LENGTH).nullable(),
    body: z.string().min(1).max(MAX_COMMENT_LENGTH), author: actor, status: z.enum(['open', 'resolved']),
    created_at: timestamp, resolved_at: timestamp.nullable(), parent_id: id.nullable() }).strict()).max(MAX_COMMENTS_PER_DOC),
  // Foreign references remain provenance, never local execution identities.
  threads: z.array(z.object({ thread_id: id, title: z.string().max(MAX_TITLE_LENGTH),
    role: z.enum(['author', 'editor', 'reviewer', 'assistant']), last_activity_at: timestamp }).strict()).max(MAX_THREAD_LINKS_PER_DOC),
  // Whole-document deletion: a scrubbed doc row and no files, history, comments or threads.
  deleted: z.object({ at: timestamp, by: actor }).strict().optional()
}).strict();

export type PeerDocumentClosure = z.infer<typeof closureSchema>;

/** A tombstone travels as an ordinary immutable version; its operation kind says so without the payload. */
export const PEER_DELETE_KIND = 'delete';
export const PEER_DOCUMENT_KIND = 'document';

export function isDeletionClosure(closure: PeerDocumentClosure): boolean {
  return closure.deleted !== undefined;
}
export interface PeerVersion { operation: PeerOperation; closure: PeerDocumentClosure }
export interface PeerAppliedReceipt {
  sessionId: string; scopeHash: string; checkpointHash: string;
  stage: PeerReceiptStage; heads: Record<string, string>; appliedHeads: Record<string, string>;
}

export function validateDocumentClosure(input: unknown): PeerDocumentClosure {
  if (Buffer.byteLength(canonicalJson(input), 'utf8') > MAX_PEER_CLOSURE_BYTES) {
    throw new PeerProtocolError('limit', 'document closure exceeds durable capture limit');
  }
  const parsed = closureSchema.safeParse(input);
  if (!parsed.success) throw new PeerProtocolError('invalid', 'invalid document closure');
  const value = parsed.data;
  if (value.deleted) {
    if (value.files.length || value.history.length || value.comments.length || value.threads.length) {
      throw new PeerProtocolError('invalid', 'deletion tombstone must not carry document content');
    }
    return value;
  }
  for (const rows of [value.files, value.history]) {
    const identities = new Set<string>();
    for (const row of rows) {
      if (identities.has(row.sync_id)) throw new PeerProtocolError('invalid', 'duplicate closure identity');
      identities.add(row.sync_id);
      if ((row.encoding === 'base64') !== isBinaryKind(fileKindOf(row.path))) {
        throw new PeerProtocolError('invalid', 'file encoding does not match path');
      }
      const bytes = row.encoding === 'utf8' ? Buffer.byteLength(row.content, 'utf8') : Buffer.from(row.content, 'base64').length;
      if (row.encoding === 'base64' && Buffer.from(row.content, 'base64').toString('base64') !== row.content) {
        throw new PeerProtocolError('invalid', 'noncanonical base64 content');
      }
      if (bytes !== row.size) throw new PeerProtocolError('invalid', 'file size does not match content');
      if (bytes > (row.encoding === 'utf8' ? MAX_TEXT_FILE_BYTES : MAX_BINARY_FILE_BYTES)) {
        throw new PeerProtocolError('limit', 'file exceeds content limit');
      }
    }
  }
  const paths = new Set(value.files.map((row) => row.path.toLowerCase()));
  if (paths.size !== value.files.length || !value.files.some((row) => row.path === value.doc.entry_path)) {
    throw new PeerProtocolError('invalid', 'duplicate paths or missing entry path');
  }
  if (value.files.reduce((sum, row) => sum + row.size, 0) > MAX_DOC_BYTES) throw new PeerProtocolError('limit', 'document exceeds content limit');
  const comments = new Map(value.comments.map((row) => [row.id, row]));
  if (comments.size !== value.comments.length || new Set(value.threads.map((row) => row.thread_id)).size !== value.threads.length) {
    throw new PeerProtocolError('invalid', 'duplicate comment or thread identity');
  }
  for (const row of value.comments) {
    if (row.parent_id && (!comments.has(row.parent_id) || comments.get(row.parent_id)!.parent_id || row.parent_id === row.id)) {
      throw new PeerProtocolError('invalid', 'invalid comment parent');
    }
  }
  return value;
}

export class PeerProtocolError extends Error {
  constructor(readonly code: 'invalid' | 'limit' | 'conflict', message: string) {
    super(message);
    this.name = 'PeerProtocolError';
  }
}

/** Stable JSON bytes prevent equivalent objects from creating distinct hashes. */
export function canonicalPeerHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function canonicalJson(value: unknown): string {
  let nodes = 0;
  const encode = (value: unknown, depth: number): string => {
  if (++nodes > 300_000 || depth > 32) throw new PeerProtocolError('limit', 'peer JSON nesting or node limit exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new PeerProtocolError('invalid', 'peer number must be finite');
    if (typeof value === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
      throw new PeerProtocolError('invalid', 'peer string must be valid Unicode');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => encode(item, depth + 1)).join(',')}]`;
  if (!value || typeof value !== 'object') throw new PeerProtocolError('invalid', 'peer payload must be JSON data');
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new PeerProtocolError('invalid', 'peer payload must be plain JSON data');
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${encode(key, depth + 1)}:${encode(record[key], depth + 1)}`).join(',')}}`;
  };
  return encode(value, 0);
}

export function validatePeerGroupMembers(members: readonly PeerGroupMember[]): void {
  if (members.length < 2 || members.length > MAX_PEER_GROUP_MEMBERS) {
    throw new PeerProtocolError('limit', `peer group must contain 2-${MAX_PEER_GROUP_MEMBERS} members`);
  }
  const replicas = new Set<string>();
  for (const member of members) {
    if (!isPeerId(member.replicaId) || !isPeerId(member.machineId)) {
      throw new PeerProtocolError('invalid', 'peer member identity is invalid');
    }
    if (replicas.has(member.replicaId)) throw new PeerProtocolError('conflict', 'peer group contains a duplicate replica');
    replicas.add(member.replicaId);
  }
  if (new Set(members.map((member) => member.machineId)).size !== members.length) throw new PeerProtocolError('invalid', 'duplicate machine identity');
}

export function validatePeerPacket(input: unknown): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PeerProtocolError('invalid', 'peer packet must be an object');
  }
  const bytes = Buffer.byteLength(canonicalJson(input), 'utf8');
  if (bytes > MAX_PEER_PACKET_BYTES) {
    throw new PeerProtocolError('limit', `peer packet exceeds ${MAX_PEER_PACKET_BYTES} bytes`);
  }
  const version = (input as Record<string, unknown>).protocolVersion;
  if (!Number.isInteger(version) || (version as number) < PEER_MIN_PROTOCOL_VERSION || (version as number) > PEER_PROTOCOL_VERSION) {
    throw new PeerProtocolError('invalid', 'unsupported peer protocol version');
  }
}

function isPeerId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
}
