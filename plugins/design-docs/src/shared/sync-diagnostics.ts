/** Shapes of the sync diagnostics shared by the CLI, the RPC layer and the Peers screen (R8, R10). */
import type { PeerFault } from './sync-classify.js';

/** One queued, not yet delivered send of a doc version to one computer. */
export interface SyncQueueEntry {
  docId: string;
  /** The other computer's app id (what `peers` lists) and its replica id in the sync group. */
  peerId: string;
  replicaId: string;
  direction: 'outgoing';
  /** `failed` only for a real error; offline, stage receipts and no error read `waiting`. */
  state: 'waiting' | 'failed';
  /** Bounded, redacted text; null when the delivery has not failed yet. */
  lastError: string | null;
  lastErrorAt: number | null;
  attempts: number;
  /** When the send was queued. A first-failure time is not stored, so this is the oldest honest anchor. */
  queuedAt: number;
  /** The queue row is parked after too many attempts; `Sync Now` revives it when the error is retryable. */
  parked: boolean;
}

/** Manual-consent bookkeeping for one other computer: why a private draft is or is not accepted here. Counts only. */
export interface PeerConsentState {
  /** Heads this computer already holds from that computer (0 = first contact, so private drafts stay fully gated). */
  knownHeads: number;
  /** Sessions this computer opened toward it (Sync now here) and sessions it opened toward this computer. */
  outbound: { waiting: number; accepted: number };
  inbound: { waiting: number; accepted: number };
  /** Draft transfers this computer refused from it since startup, with the newest doc and time. */
  refused: { count: number; lastDocId: string | null; lastAt: number | null };
  /** Queued sends to it, and how many of their heads are named by an outbound session (the other side can only accept a head it was told about). */
  queued: { total: number; namedByOutbound: number };
  /** When the oldest still-waiting outbound session was opened. */
  oldestWaitingOutAt: number | null;
  /** Its newest answer to our consent request since startup: accepted, not-accepted (it has not chosen Sync now), or error. */
  lastAnswer: { at: number; outcome: 'accepted' | 'not-accepted' | 'error' } | null;
}

export interface PeerDiagnostics {
  replicaId: string;
  peerId: string;
  queueDepth: number;
  queuedDocs: number;
  failed: number;
  waiting: number;
  oldestQueuedAt: number | null;
  /** Newest first, at most 20. */
  recentErrors: Array<{ docId: string; error: string; at: number; attempts: number }>;
  /** Likely cause of the newest error, with advice; null when there is no error or it is not recognised. Optional for older servers. */
  fault?: PeerFault | null;
  /** Optional for older servers. */
  consent?: PeerConsentState;
}

export interface DocCounts {
  total: number;
  byStatus: Record<string, number>;
  /** Docs in a registered project, by project id; the rest are global or unmapped. */
  byProject: Record<string, number>;
  unmapped: number;
}

export interface CompareEntry { docId: string; hash: string | null; files: number }
export interface CompareResult { total: number; offset: number; limit: number; docs: CompareEntry[] }
