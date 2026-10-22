/**
 * Typed wrapper over the plugin's RPC methods (see `src/server/rpc.ts`).
 * Every call goes through the host's `useRpc()` client, so the server still
 * validates and attributes every mutation.
 */
import { useMemo } from 'react';
import { useRpc } from '@zana-ai/zcc-plugin-sdk/app';
import type {
  CommentStatus,
  DesignDocComment,
  DesignDocDetail,
  DesignDocFile,
  DesignDocFileMeta,
  DesignDocRevision,
  DesignDocSummary,
  DocStatus,
  PeerConflictPage, PeerConflictReview, PeerConflictFile, PeerResolutionChoice,
  TextEdit
} from '../shared/contract.js';
import type { PageFile } from '../shared/frame-protocol.js';
import type { PublishFolder } from '../shared/publish.js';
import type { PageRenderReport, RenderedPage, SiteFile } from '../shared/page.js';
import type { GroupStatus, RepairResult } from '../shared/peer-group.js';

/** One computer connected to this one (owned by core), with this plugin's use of it and its sync state. */
export interface ConnectionView {
  computerId: string;
  hostname: string;
  state: 'connected' | 'reconnecting' | 'disconnected';
  usedByThisPlugin: boolean;
  use: 'pending' | 'approved' | 'denied' | null;
  syncing: boolean;
  retiring: boolean;
  /** Sync setup work with this computer is running right now. */
  settingUp?: boolean;
}

export interface TemplateInfo {
  id: string;
  label: string;
  description: string;
  files: string[];
}

export interface ProjectInfo {
  id: string;
  name: string;
  /** The built-in Default Project, where agents for project-less docs run. */
  quickAgent?: boolean;
}

/** The project an agent for a project-less doc runs in: the Default Project, else the first one. */
export function defaultAgentProject(projects: readonly ProjectInfo[]): string | undefined {
  return (projects.find((project) => project.quickAgent) ?? projects[0])?.id;
}

export interface WriteResult extends DesignDocFileMeta {
  docId: string;
  created: boolean;
}

export type RevisionContent = DesignDocRevision & { content: string; encoding: 'utf8' | 'base64' };

export interface ListArgs {
  projectId?: string;
  query?: string;
  status?: DocStatus | 'active' | 'all';
}

export interface CreateArgs {
  title: string;
  summary?: string;
  template?: string;
  tags?: string[];
  projectId?: string | null;
}

export interface UpdateArgs {
  expectedHead?: string | null;
  title?: string;
  summary?: string;
  status?: DocStatus;
  tags?: string[];
  entryPath?: string;
  projectId?: string | null;
  /** Doc id this doc is an alternative to; null detaches it. */
  alternativeTo?: string | null;
}

export interface DesignDocsApi {
  templates(): Promise<TemplateInfo[]>;
  projects(): Promise<ProjectInfo[]>;
  peerStatus(): Promise<PeerStatus>;
  groupStatus(): Promise<GroupStatus>;
  enablePeer(peerId: string): Promise<GroupStatus>;
  retryIntroductions(): Promise<GroupStatus>;
  /** Computers connected to this one (core owns the link). `[]` on a host without core connections. */
  connections(): Promise<ConnectionView[]>;
  /** Ask the owner to let this plugin use a connection; `pending` until both owners decided. Core error codes pass through. */
  useConnection(computerId: string): Promise<{ status: 'pending' | 'approved' | 'denied' }>;
  /** Leave the sync group with that computer, then stop using the connection. The connection itself stays. */
  stopUsingConnection(computerId: string): Promise<GroupStatus>;
  /** Re-try sync setup for one linked computer; re-links only that connection if needed. */
  repairPeer(peerId: string): Promise<RepairResult>;
  /** Discard this computer's stuck sync work for one linked computer; documents and history are kept. */
  resetPeerSync(peerId: string): Promise<{ discarded: number; status: GroupStatus }>;
  /** Only whether a connected peer's database differs; never names or counts. */
  peersOutOfSync(): Promise<{ outOfSync: boolean }>;
  removePeer(replicaId: string): Promise<GroupStatus>;
  syncNow(): Promise<{ attempted: number; synced: number; blocked: number }>;
  peerConflicts(doc: string, cursor?: string): Promise<PeerConflictPage>;
  peerConflictReview(doc: string, remoteHead: string): Promise<PeerConflictReview>;
  peerConflictFile(doc: string, remoteHead: string, path: string): Promise<PeerConflictFile>;
  resolvePeerConflict(doc: string, args: { expectedHead: string; remoteHead: string; choice: PeerResolutionChoice }): Promise<{ head: string }>;
  list(args?: ListArgs): Promise<DesignDocSummary[]>;
  get(doc: string): Promise<DesignDocDetail>;
  create(args: CreateArgs): Promise<DesignDocDetail>;
  update(doc: string, patch: UpdateArgs): Promise<DesignDocSummary>;
  pin(doc: string, pinned: boolean): Promise<DesignDocSummary>;
  remove(doc: string): Promise<void>;
  readFile(doc: string, path: string): Promise<DesignDocFile>;
  /** An HTML page bundled for the preview frame; `draft` renders unsaved HTML in place of the file. */
  renderPage(doc: string, args: { path: string; draft?: string }): Promise<RenderedPage>;
  /** A file a rendered page fetches, or null when the doc has none at that path. */
  readPageFile(doc: string, path: string): Promise<PageFile | null>;
  /** The page served standalone, for the system browser. */
  pageLink(doc: string, path: string): Promise<{ url: string }>;
  /** The doc as a static site: its files, the kit its pages load, and `.nojekyll`. */
  siteFiles(doc: string): Promise<{ slug: string; files: SiteFile[] }>;
  reportRender(doc: string, report: PageRenderReport): Promise<void>;
  writeFile(doc: string, args: { path: string; content: string; encoding?: 'base64'; baseRevision?: number; baseFileId?: string | null; note?: string }): Promise<WriteResult>;
  editFile(doc: string, args: { path: string; edits: TextEdit[]; baseRevision?: number; baseFileId?: string | null }): Promise<WriteResult>;
  deleteFile(doc: string, path: string, baseRevision?: number, baseFileId?: string | null): Promise<void>;
  renameFile(doc: string, from: string, to: string, baseRevision?: number, baseFileId?: string | null): Promise<WriteResult>;
  history(doc: string, args?: { path?: string; limit?: number }): Promise<DesignDocRevision[]>;
  revision(doc: string, id: number): Promise<RevisionContent>;
  /** `baseRevision` is the file's current revision as shown, 0 when it is gone. */
  restore(doc: string, id: number, baseRevision?: number, baseFileId?: string | null): Promise<WriteResult>;
  addComment(doc: string, args: { body: string; path?: string; quote?: string }): Promise<DesignDocComment>;
  replyToComment(doc: string, id: string, body: string): Promise<DesignDocComment>;
  setCommentStatus(doc: string, id: string, status: CommentStatus): Promise<DesignDocComment>;
  deleteComment(doc: string, id: string): Promise<void>;
  unlinkThread(doc: string, threadId: string): Promise<void>;
  askAgent(doc: string, args: { action?: string; prompt?: string; path?: string | null; projectId?: string }): Promise<{ threadId: string; projectId: string }>;
  /** Start an agent thread that exports the doc as a site and pushes it to GitHub Pages. */
  publish(doc: string, args: { repo?: string; branch: string; folder: PublishFolder; projectId?: string }): Promise<{ threadId: string; projectId: string }>;
}

export interface PeerStatus {
  configured: boolean;
  repoId?: string;
  replicaId?: string;
  groupId?: string;
  rosterEpoch?: number;
  members: Array<{ replicaId: string; machineId: string; joinedAt: number; sponsorReplicaId: string | null; /** This computer, or a member with a live link; absent on older servers. */ connected?: boolean }>;
}

type Call = (method: string, args?: unknown) => Promise<unknown>;

/** Drop `undefined` keys: RPC arguments must be plain JSON. */
function json<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function createApi(call: Call): DesignDocsApi {
  const typed = <T>(method: string, args?: object) => call(method, args === undefined ? undefined : json(args)) as Promise<T>;
  const done = async (promise: Promise<unknown>) => {
    await promise;
  };
  return {
    templates: () => typed('templates'),
    projects: () => typed('projects'),
    peerStatus: () => typed('peerStatus'),
    groupStatus: () => typed('groupStatus'),
    enablePeer: (peerId) => typed('enablePeer', { peerId }),
    retryIntroductions: () => typed('retryIntroductions'),
    connections: () => typed('connections'),
    useConnection: (computerId) => typed('useConnection', { computerId }),
    stopUsingConnection: (computerId) => typed('stopUsingConnection', { computerId }),
    repairPeer: (peerId) => typed('repairPeer', { peerId }),
    resetPeerSync: (peerId) => typed('resetPeerSync', { peerId }),
    peersOutOfSync: () => typed('peersOutOfSync'),
    removePeer: (replicaId) => typed('removePeer', { replicaId }),
    syncNow: () => typed('syncNow'),
    peerConflicts: (doc, cursor) => typed('peerConflicts', { doc, cursor }),
    peerConflictReview: (doc, remoteHead) => typed('peerConflictReview', { doc, remoteHead }),
    peerConflictFile: (doc, remoteHead, path) => typed('peerConflictFile', { doc, remoteHead, path }),
    resolvePeerConflict: (doc, args) => typed('resolvePeerConflict', { doc, ...args }),
    list: (args = {}) => typed('list', args),
    get: (doc) => typed('get', { doc }),
    create: (args) => typed('create', args),
    update: (doc, patch) => typed('update', { doc, ...patch }),
    pin: (doc, pinned) => typed('pin', { doc, pinned }),
    remove: (doc) => done(typed('remove', { doc })),
    readFile: (doc, path) => typed('readFile', { doc, path }),
    renderPage: (doc, args) => typed('renderPage', { doc, ...args }),
    readPageFile: (doc, path) => typed('readPageFile', { doc, path }),
    pageLink: (doc, path) => typed('pageLink', { doc, path }),
    siteFiles: (doc) => typed('siteFiles', { doc }),
    reportRender: (doc, report) => done(typed('reportRender', { doc, ...report })),
    writeFile: (doc, args) => typed('writeFile', { doc, ...args }),
    editFile: (doc, args) => typed('editFile', { doc, ...args }),
    deleteFile: (doc, path, baseRevision, baseFileId) => done(typed('deleteFile', { doc, path, baseRevision, baseFileId })),
    renameFile: (doc, from, to, baseRevision, baseFileId) => typed('renameFile', { doc, from, to, baseRevision, baseFileId }),
    history: (doc, args = {}) => typed('history', { doc, ...args }),
    revision: (doc, id) => typed('revision', { doc, id }),
    restore: (doc, id, baseRevision, baseFileId) => typed('restore', { doc, id, baseRevision, baseFileId }),
    addComment: (doc, args) => typed('addComment', { doc, ...args }),
    replyToComment: (doc, id, body) => typed('replyToComment', { doc, id, body }),
    setCommentStatus: (doc, id, status) => typed('setCommentStatus', { doc, id, status }),
    deleteComment: (doc, id) => done(typed('deleteComment', { doc, id })),
    unlinkThread: (doc, threadId) => done(typed('unlinkThread', { doc, threadId })),
    askAgent: (doc, args) => typed('askAgent', { doc, ...args, path: args.path ?? undefined }),
    publish: (doc, args) => typed('publish', { doc, ...args })
  };
}

export function useApi(): DesignDocsApi {
  const rpc = useRpc();
  return useMemo(() => createApi((method, args) => rpc.call(method, args)), [rpc]);
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // The rpc bridge prefixes transport details; keep the human sentence.
  return message.replace(/^(Error invoking remote method '[^']+': )?(Error: )?/, '');
}

export function isConflict(error: unknown): boolean {
  return /changed since revision/i.test(errorMessage(error));
}

/** The doc itself is gone (deleted), as opposed to a failed request. */
export function isMissingDoc(message: string): boolean {
  return /^design doc .* not found/i.test(message);
}

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: { toast?: (message: string, kind?: 'info' | 'error') => void } })
    .__ZCC_PLUGIN_RUNTIME__;
  runtime?.toast?.(message, kind);
}
