import type { FileKind } from './paths.js';

export const PLUGIN_ID = 'design-docs';
export const PLUGIN_NAME = 'Design Docs';

/** Realtime channel published after any mutation; payload `{ docId }`. */
export const CHANGED_CHANNEL = 'changed';

/** Content-free nudge (payload `{}`): a paired peer's database state moved, so re-check the out-of-sync notice. */
export const PEER_STATE_CHANNEL = 'peer-state';

export const DOC_STATUSES = ['draft', 'review', 'approved', 'implemented', 'archived'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const STATUS_LABELS: Record<DocStatus, string> = {
  draft: 'Draft',
  review: 'In review',
  approved: 'Approved',
  implemented: 'Implemented',
  archived: 'Archived'
};

export function isDocStatus(value: unknown): value is DocStatus {
  return typeof value === 'string' && (DOC_STATUSES as readonly string[]).includes(value);
}

export type ActorKind = 'user' | 'agent';

export interface DocActor {
  kind: ActorKind;
  label: string;
  threadId: string | null;
}

/** The newest message in a doc's open comment threads, trimmed for the doc list. */
export interface CommentExcerpt {
  body: string;
  author: DocActor;
  createdAt: number;
}

export interface DesignDocSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: DocStatus;
  projectId: string | null;
  tags: string[];
  entryPath: string;
  fileCount: number;
  openComments: number;
  /** Null when no comment thread is open. */
  lastComment: CommentExcerpt | null;
  /** When the user pinned it to the top of the doc list; null when not pinned. */
  pinnedAt: number | null;
  /** Id of the doc this one is an alternative proposal to; it nests under it in the list. */
  alternativeTo: string | null;
  revision: number;
  /** Immutable peer version observed by the reader; null before a head exists. */
  head: string | null;
  createdAt: number;
  updatedAt: number;
  createdBy: DocActor;
  updatedBy: DocActor;
}

export interface DesignDocFileMeta {
  /** Stable across rename; a replacement at the same path has a different id. */
  fileId: string;
  path: string;
  kind: FileKind;
  size: number;
  revision: number;
  updatedAt: number;
  updatedBy: DocActor;
}

export interface DesignDocFile extends DesignDocFileMeta {
  content: string;
  encoding: 'utf8' | 'base64';
}

export type CommentStatus = 'open' | 'resolved';

export interface DesignDocReply {
  id: string;
  body: string;
  author: DocActor;
  createdAt: number;
}

export interface DesignDocComment {
  id: string;
  docId: string;
  path: string | null;
  quote: string | null;
  body: string;
  author: DocActor;
  status: CommentStatus;
  createdAt: number;
  resolvedAt: number | null;
  /** Oldest first. Replies share the comment's anchor and status. */
  replies: DesignDocReply[];
}

export type RevisionOp = 'create' | 'write' | 'delete' | 'rename';

export interface DesignDocRevision {
  id: number;
  path: string;
  revision: number;
  op: RevisionOp;
  size: number;
  note: string | null;
  renamedFrom: string | null;
  actor: DocActor;
  createdAt: number;
}

export type ThreadRole = 'author' | 'editor' | 'reviewer' | 'assistant';

export interface DesignDocThreadLink {
  threadId: string;
  title: string;
  role: ThreadRole;
  lastActivityAt: number;
}

export interface DesignDocDetail extends DesignDocSummary {
  files: DesignDocFileMeta[];
  comments: DesignDocComment[];
  threads: DesignDocThreadLink[];
}

export interface TextEdit {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

export type PeerResolutionChoice = 'merge' | 'local' | 'remote';
export interface PeerConflictPage {
  remoteHeads: string[];
  nextCursor: string | null;
}
export interface PeerConflictReview {
  localHead: string;
  remoteHead: string;
  baseHead: string | null;
  conflicts: string[];
  mergeAvailable: boolean;
  local: { title: string; status: string; summary: string; paths: string[] };
  remote: { title: string; status: string; summary: string; paths: string[] };
}
export interface PeerConflictFile {
  localHead: string;
  remoteHead: string;
  local: { content: string; encoding: 'utf8' | 'base64' } | null;
  remote: { content: string; encoding: 'utf8' | 'base64' } | null;
  candidate: { content: string; encoding: 'utf8' | 'base64' } | null;
}

/** `::design-doc{id="…"}` — the chat card agents emit for a doc. */
export function designDocDirective(ref: string, path?: string | null): string {
  const safe = (value: string) => value.replace(/["\\\n\r]/g, '');
  return path
    ? `::design-doc{id="${safe(ref)}" path="${safe(path)}"}`
    : `::design-doc{id="${safe(ref)}"}`;
}
