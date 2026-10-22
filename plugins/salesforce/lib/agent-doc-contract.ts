/**
 * The shared Agent Script document: one live state per project + `.agent` path that
 * every surface (Studio editor, Studio tools, Zana thread views) reads. The Studio
 * editor is the only writer (an edit lease); a Zana agent's edits become proposals
 * any surface can accept. Isomorphic: the server store and the renderer hook share it.
 */
import type { ProposeEditInput, StudioDiagnostic } from './studio-contract.js';

export const AGENT_DOC_RPC = {
  open: 'agentDoc.open',
  update: 'agentDoc.update',
  saved: 'agentDoc.saved',
  lease: 'agentDoc.lease',
  release: 'agentDoc.release',
  propose: 'agentDoc.propose',
  resolve: 'agentDoc.resolve',
  close: 'agentDoc.close'
} as const;

/** Realtime: `{ projectId, path, rev, kind }` after any change; clients re-open on a newer rev. */
export const AGENT_DOC_CHANNEL = 'sf.agentDoc.changed';
export type AgentDocChangeKind = 'text' | 'saved' | 'lease' | 'proposals' | 'closed';
export interface AgentDocChange { projectId: string; path: string; rev: number; kind: AgentDocChangeKind }

/** Largest unsaved buffer the server keeps; bigger files stay editor-only (text: null, tooLarge). */
export const AGENT_DOC_TEXT_MAX = 1024 * 1024;
/** Open documents kept in memory per plugin process (least recently used goes first, never a leased dirty one). */
export const AGENT_DOC_MAX_OPEN = 32;
/** Unsaved buffers persisted to kv per project, and their total size. */
export const AGENT_DOC_MAX_BUFFERS = 12;
export const AGENT_DOC_BUFFERS_BYTES = 2 * 1024 * 1024;
export const AGENT_DOC_MAX_PROPOSALS = 20;
/** An editor lease lapses without a renewal (`agentDoc.lease` again) within this window. */
export const AGENT_DOC_LEASE_TTL_MS = 45_000;

/**
 * `id` names one grant: a renewal must present it, and a release or close carrying another grant's id is ignored, so an old
 * session of the same window (same clientId) can never end a newer one's lease. It tells sessions apart; it is not a secret.
 */
export interface AgentDocLease { id: string; clientId: string; label: string; since: number; renewedAt: number }

/**
 * pending → the user has not decided. accept-requested → a view without the editor accepted
 * while an editor holds the lease; only that editor settles it (applies, then resolves). It exists only under a live
 * lease: when the lease lapses or is released it falls back to pending. accepted / rejected → done.
 */
export type AgentDocProposalStatus = 'pending' | 'accept-requested' | 'accepted' | 'rejected';
export interface AgentDocProposal {
  id: string;
  input: ProposeEditInput;
  status: AgentDocProposalStatus;
  /** The thread that proposed it, when known. */
  threadId?: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface AgentDocSnapshot {
  projectId: string;
  path: string;
  /** Bumped on every change; a client applies a snapshot only when its rev is newer. */
  rev: number;
  /** The live text (unsaved edits included); null when the file is over AGENT_DOC_TEXT_MAX. */
  text: string | null;
  tooLarge?: boolean;
  /** sha256 of the file on disk the text is based on. */
  baseSha256: string;
  /** The disk text when dirty, so read-only views can show a diff; null when clean or too large. */
  savedText: string | null;
  dirty: boolean;
  diagnostics: StudioDiagnostic[];
  lease: AgentDocLease | null;
  /** clientId of the editor whose update last changed the text (null until one did), so a (re)gaining editor knows whose text it is. */
  lastWriter: string | null;
  proposals: AgentDocProposal[];
  updatedAt: number;
}

/** A failure may carry the current document (`stale`, `leased`, `conflict`, `dirty`) so a client can refresh without a re-open. */
export type AgentDocResult = { ok: true; doc: AgentDocSnapshot } | { ok: false; code: string; error: string; doc?: AgentDocSnapshot };
/** `agentDoc.propose` / `agentDoc.resolve` success: the proposal plus the document after the change. */
export type AgentDocProposalResult = { ok: true; proposal: AgentDocProposal; doc: AgentDocSnapshot } | { ok: false; code: string; error: string; doc?: AgentDocSnapshot };
/** Error codes the agentDoc RPCs return. */
export type AgentDocErrorCode =
  | 'project_required' | 'invalid_input' | 'not_found' | 'path_refused' | 'not_configured'
  | 'stale' | 'leased' | 'conflict' | 'dirty' | 'too_many_open' | 'proposals_full' | 'already_resolved' | 'failed';
