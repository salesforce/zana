/**
 * The shared Agent Script document, server half. One live state per project + `.agent` path that the Studio
 * editor (the only writer, via an edit lease), the Studio tools and the Zana thread views all read. A Zana
 * agent's edits arrive as proposals any surface can accept. Everything is bounded: a capped LRU of open
 * documents, capped text/proposals, and dirty buffers persisted to kv under per-project caps.
 */
import { randomUUID } from 'node:crypto';
import {
  AGENT_DOC_BUFFERS_BYTES, AGENT_DOC_CHANNEL, AGENT_DOC_LEASE_TTL_MS, AGENT_DOC_MAX_BUFFERS, AGENT_DOC_MAX_OPEN,
  AGENT_DOC_MAX_PROPOSALS, AGENT_DOC_RPC, AGENT_DOC_TEXT_MAX,
  type AgentDocChange, type AgentDocChangeKind, type AgentDocLease, type AgentDocProposal, type AgentDocProposalResult,
  type AgentDocResult, type AgentDocSnapshot
} from './agent-doc-contract.js';
import { applyProposalText, proposalEditsError } from './agent-doc-apply.js';
import { AgentFilesError, readAgentFile, sha256Hex, writeAgentFile } from './agent-files.js';
import { isAgentScriptFile } from './agent-script-model.js';
import { isProposeEditInput, isStudioDiagnostics, STUDIO_CHANGED_CHANNEL, type ProposeEditInput, type StudioDiagnostic } from './studio-contract.js';
import { rpcFailure, type StudioServerContext } from './studio-server-context.js';
import { isSafeStudioPath } from './studio-threads.js';

export const AGENT_DOC_BUFFERS_KEY_PREFIX = 'agentdoc:buffers:';
const bufferKey = (projectId: string) => `${AGENT_DOC_BUFFERS_KEY_PREFIX}${projectId}`;
const MAX_CLIENT_ID = 200;
const MAX_LABEL = 120;
const MAX_UPDATE_LABEL = 80;
const DEFAULT_EDITOR_LABEL = 'Agentforce Studio';
const DISK_CHECK_MS = 2000;
const MAX_ID = 100;
const SHA = /^[a-f0-9]{64}$/;

interface KvLike { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> }
type Failure = { ok: false; code: string; error: string };
/** Disk access for the store: the plugin's own agent-file read/write path, project-scoped by the caller. */
export interface AgentDocIo {
  read(projectId: string, path: string): Promise<{ ok: true; content: string; sha256: string } | Failure>;
  write(projectId: string, path: string, content: string, expectedSha256: string): Promise<{ ok: true; sha256: string } | Failure>;
}
export interface AgentDocLimits { maxOpen: number; textMax: number; maxBuffers: number; buffersBytes: number; maxProposals: number; leaseTtlMs: number; diskCheckMs: number }
export interface AgentDocStoreDeps {
  kv: KvLike;
  io: AgentDocIo;
  publish?: (change: AgentDocChange) => void;
  now?: () => number;
  newId?: () => string;
  limits?: Partial<AgentDocLimits>;
}

interface Doc {
  projectId: string; path: string; rev: number;
  /** null when over the text cap. */
  text: string | null; tooLarge: boolean;
  /** sha256 of the disk version the live text was edited from; differs from `diskSha256` when disk moved under a dirty doc. */
  baseSha256: string;
  /** sha256 of the file on disk when last read. */
  diskSha256: string;
  /** The current disk text; null when over the text cap. */
  diskText: string | null;
  /** When disk was last compared with this doc (open skips a re-read inside the diskCheckMs window). */
  checkedAt: number;
  dirty: boolean; diagnostics: StudioDiagnostic[]; lease: AgentDocLease | null; proposals: AgentDocProposal[]; updatedAt: number;
  /** clientId of the update that last changed the text. */
  lastWriter: string | null;
}
interface StoredBuffer { path: string; text: string; baseSha256: string; updatedAt: number }

/** What a resolved proposal keeps: enough to list it, none of its bulky body. */
const slim = (input: ProposeEditInput): ProposeEditInput => ({ path: input.path, expectedSha256: input.expectedSha256, summary: input.summary });
const hasBody = (input: ProposeEditInput) => input.content !== undefined || input.edits !== undefined;
const proposalSize = (input: ProposeEditInput) => typeof input.content === 'string' ? input.content.length : (input.edits ?? []).reduce((sum, edit) => sum + edit.text.length, 0);
const pendingWork = (doc: Doc) => doc.proposals.some(row => row.status === 'pending' || row.status === 'accept-requested');

const fail = (code: string, error: string, doc?: AgentDocSnapshot): Failure & { doc?: AgentDocSnapshot } => ({ ok: false, code, error, ...(doc ? { doc } : {}) });
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class AgentScriptDocumentStore {
  private readonly docs = new Map<string, Doc>();
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly busy = new Map<string, number>();
  private readonly bufferTails = new Map<string, Promise<unknown>>();
  private lastRev = 0;
  private readonly limits: AgentDocLimits;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: AgentDocStoreDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
    this.limits = {
      maxOpen: AGENT_DOC_MAX_OPEN, textMax: AGENT_DOC_TEXT_MAX, maxBuffers: AGENT_DOC_MAX_BUFFERS, buffersBytes: AGENT_DOC_BUFFERS_BYTES,
      maxProposals: AGENT_DOC_MAX_PROPOSALS, leaseTtlMs: AGENT_DOC_LEASE_TTL_MS, diskCheckMs: DISK_CHECK_MS, ...deps.limits
    };
  }

  /** Documents currently held in memory (tests and diagnostics). */
  get size(): number { return this.docs.size; }

  // --- plumbing ---------------------------------------------------------------------------------------------

  private chain<T>(tails: Map<string, Promise<unknown>>, key: string, work: () => Promise<T>): Promise<T> {
    const run = (tails.get(key) ?? Promise.resolve()).then(work, work);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return run;
  }

  /** Serializes work per document and keeps the document from being evicted while it runs. */
  private run<T>(key: string, work: () => Promise<T>): Promise<T> {
    this.busy.set(key, (this.busy.get(key) ?? 0) + 1);
    return this.chain(this.tails, key, work).finally(() => {
      const left = (this.busy.get(key) ?? 1) - 1;
      if (left > 0) this.busy.set(key, left); else this.busy.delete(key);
    });
  }

  private keyOf(projectId: string, path: string) { return `${projectId}\0${path}`; }

  /** A revision above every one this process issued, so a re-created document always looks newer to clients. */
  private nextRev(floor = 0): number {
    this.lastRev = Math.max(this.lastRev + 1, floor + 1);
    return this.lastRev;
  }

  private publish(doc: Doc, kind: AgentDocChangeKind) {
    try { this.deps.publish?.({ projectId: doc.projectId, path: doc.path, rev: doc.rev, kind }); } catch { /* realtime is best effort */ }
  }

  private bump(doc: Doc, kind: AgentDocChangeKind) {
    doc.rev = this.nextRev(doc.rev);
    doc.updatedAt = this.now();
    this.publish(doc, kind);
  }

  /**
   * The live lease. An expired one is dropped here, lazily, and that is a change: the rev moves (so this snapshot and any later one are
   * newer than what viewers hold) and it is announced, after the current call, so a viewer waiting on the gone editor re-opens.
   * The announcement is deferred rather than sent from inside a snapshot or a request in progress.
   */
  private live(doc: Doc): AgentDocLease | null {
    if (doc.lease && this.now() - doc.lease.renewedAt >= this.limits.leaseTtlMs) {
      this.dropLease(doc);
      doc.rev = this.nextRev(doc.rev);
      doc.updatedAt = this.now();
      queueMicrotask(() => this.publish(doc, 'lease'));
    }
    return doc.lease;
  }

  /** Ends the lease. An accept addressed to that editor (accept-requested) goes back to pending, so no one waits on a gone editor. */
  private dropLease(doc: Doc) {
    doc.lease = null;
    doc.proposals = doc.proposals.map(row => row.status === 'accept-requested' ? { ...row, status: 'pending' } : row);
  }

  private grant(doc: Doc, clientId: string, label: string, now: number): AgentDocLease {
    doc.lease = { id: this.newId(), clientId, label, since: now, renewedAt: now };
    return doc.lease;
  }

  /** The caller holds this lease: same client, and the same grant when it names one (an older session of that client does not). */
  private holds(lease: AgentDocLease, clientId: string, leaseId?: string) {
    return lease.clientId === clientId && (leaseId === undefined || leaseId === lease.id);
  }

  private snapshot(doc: Doc): AgentDocSnapshot {
    const lease = this.live(doc);
    return {
      projectId: doc.projectId, path: doc.path, rev: doc.rev, text: doc.text, ...(doc.tooLarge ? { tooLarge: true } : {}),
      baseSha256: doc.baseSha256, savedText: doc.dirty ? doc.diskText : null, dirty: doc.dirty,
      diagnostics: doc.diagnostics.map(row => ({ ...row })), lease: lease ? { ...lease } : null, lastWriter: doc.lastWriter,
      proposals: doc.proposals.map(row => ({ ...row })), updatedAt: doc.updatedAt
    };
  }

  private checkTarget(projectId: unknown, path: unknown): Failure | null {
    if (typeof projectId !== 'string' || !projectId) return fail('project_required', 'Choose a registered project to open an agent file.');
    if (!isSafeStudioPath(path)) return fail('invalid_input', 'Choose an agent file inside this project.');
    if (!isAgentScriptFile(path)) return fail('invalid_input', 'The file must end in .agent or .afscript.');
    return null;
  }

  private checkClient(clientId: unknown): Failure | null {
    return typeof clientId === 'string' && clientId.length > 0 && clientId.length <= MAX_CLIENT_ID ? null : fail('invalid_input', 'clientId is required.');
  }

  private room(): boolean {
    while (this.docs.size >= this.limits.maxOpen) {
      let victim: string | undefined;
      for (const [key, doc] of this.docs) {
        if (this.busy.has(key) || (doc.dirty && this.live(doc)) || pendingWork(doc)) continue;
        victim = key; break;
      }
      if (victim === undefined) return false;
      this.docs.delete(victim);
    }
    return true;
  }

  private touch(key: string, doc: Doc) { this.docs.delete(key); this.docs.set(key, doc); }

  private fits(text: string) { return text.length <= this.limits.textMax; }

  /** The live document, loading it from disk (and restoring its unsaved buffer) when it is not in memory. */
  private async ensure(projectId: string, path: string): Promise<Doc | Failure> {
    const key = this.keyOf(projectId, path);
    const existing = this.docs.get(key);
    if (existing) { this.touch(key, existing); return existing; }
    const disk = await this.deps.io.read(projectId, path);
    if (!disk.ok) return fail(disk.code, disk.error);
    if (!this.room()) return fail('too_many_open', 'Too many agent files have unsaved changes. Save or close one first.');
    const small = this.fits(disk.content);
    const doc: Doc = {
      projectId, path, rev: this.nextRev(this.now()), text: small ? disk.content : null, tooLarge: !small, baseSha256: disk.sha256,
      diskSha256: disk.sha256, diskText: small ? disk.content : null, checkedAt: this.now(), dirty: false, diagnostics: [], lease: null, proposals: [], updatedAt: this.now(), lastWriter: null
    };
    const buffer = await this.getBuffer(projectId, path);
    if (buffer) {
      // A buffer based on an older disk version stays dirty against its true base, so saving it hits a sha conflict.
      if (buffer.text !== disk.content && this.fits(buffer.text)) { doc.text = buffer.text; doc.dirty = true; doc.baseSha256 = buffer.baseSha256; }
      else void this.setBuffer(projectId, path, null);
    }
    this.docs.set(key, doc);
    return doc;
  }

  // --- unsaved-buffer persistence ---------------------------------------------------------------------------

  private async readBuffers(projectId: string): Promise<StoredBuffer[]> {
    try {
      const stored = await this.deps.kv.get<{ buffers?: unknown }>(bufferKey(projectId));
      return Array.isArray(stored?.buffers)
        ? stored!.buffers.filter((row): row is StoredBuffer => isRecord(row) && typeof row.path === 'string' && typeof row.text === 'string' && typeof row.baseSha256 === 'string' && typeof row.updatedAt === 'number')
        : [];
    } catch { return []; }
  }

  private getBuffer(projectId: string, path: string): Promise<StoredBuffer | undefined> {
    return this.chain(this.bufferTails, projectId, async () => (await this.readBuffers(projectId)).find(row => row.path === path));
  }

  /** Stores (or with null removes) one file's unsaved text, keeping the newest buffers inside the count and byte caps. */
  private setBuffer(projectId: string, path: string, buffer: Omit<StoredBuffer, 'path'> | null): Promise<void> {
    return this.chain(this.bufferTails, projectId, async () => {
      try {
        const current = await this.readBuffers(projectId);
        const others = current.filter(row => row.path !== path);
        if (!buffer && others.length === current.length) return;
        const next = (buffer ? [{ path, ...buffer }, ...others] : others).sort((a, b) => b.updatedAt - a.updatedAt);
        const kept: StoredBuffer[] = [];
        let bytes = 0;
        for (const row of next) {
          const size = Buffer.byteLength(row.text);
          if (kept.length >= this.limits.maxBuffers || bytes + size > this.limits.buffersBytes) continue;
          kept.push(row); bytes += size;
        }
        await this.deps.kv.set(bufferKey(projectId), { buffers: kept });
      } catch { /* a persistence failure never fails an edit */ }
    });
  }

  // --- operations -------------------------------------------------------------------------------------------

  /** Syncs a clean doc (or the disk base of a dirty one) with the file on disk; true when anything changed. */
  private resync(doc: Doc, disk: { content: string; sha256: string }): boolean {
    doc.checkedAt = this.now();
    if (disk.sha256 === doc.diskSha256) return false;
    const small = this.fits(disk.content);
    const wasClean = !doc.dirty;
    doc.diskSha256 = disk.sha256;
    doc.diskText = small ? disk.content : null;
    if (wasClean) { doc.baseSha256 = disk.sha256; doc.text = small ? disk.content : null; doc.tooLarge = !small; }
    else {
      // Keep the original base: the editor's save then conflicts instead of silently reverting the external edit.
      doc.dirty = doc.text !== null && doc.diskText !== null ? doc.text !== doc.diskText : true;
      if (!doc.dirty) doc.baseSha256 = disk.sha256;
    }
    return true;
  }

  open(projectId: string, path: string): Promise<AgentDocResult> {
    const bad = this.checkTarget(projectId, path);
    if (bad) return Promise.resolve(bad);
    return this.run(this.keyOf(projectId, path), async () => {
      const key = this.keyOf(projectId, path);
      const known = this.docs.get(key);
      const doc = await this.ensure(projectId, path);
      if ('ok' in doc) return doc;
      if (known && this.now() - doc.checkedAt >= this.limits.diskCheckMs) {
        // An agent or the CLI may have written the file since; keep the doc in step with disk.
        const disk = await this.deps.io.read(projectId, path);
        if (disk.ok && this.resync(doc, disk)) {
          this.bump(doc, 'text');
          if (doc.dirty && doc.text !== null) void this.setBuffer(projectId, path, { text: doc.text, baseSha256: doc.baseSha256, updatedAt: this.now() });
          else void this.setBuffer(projectId, path, null);
        }
      }
      return { ok: true, doc: this.snapshot(doc) } as AgentDocResult;
    });
  }

  /** `baseSha256` is the disk version the editor's text is based on; a dirty document adopts it (the editor kept its edits over a newer disk version). */
  update(projectId: string, args: { path: string; clientId: string; rev: number; text: string; diagnostics?: unknown; label?: string; leaseId?: string; baseSha256?: unknown }): Promise<AgentDocResult> {
    const bad = this.checkTarget(projectId, args?.path) ?? this.checkClient(args.clientId);
    if (bad) return Promise.resolve(bad);
    if (typeof args.text !== 'string' || !Number.isInteger(args.rev)) return Promise.resolve(fail('invalid_input', 'update requires rev and string text.'));
    if (args.diagnostics !== undefined && !isStudioDiagnostics(args.diagnostics)) return Promise.resolve(fail('invalid_input', 'diagnostics are malformed.'));
    return this.run(this.keyOf(projectId, args.path), async () => {
      const doc = await this.ensure(projectId, args.path);
      if ('ok' in doc) return doc;
      // A lapse found just now moves the rev, but not the text: an edit made on the rev before it is not stale.
      const textRev = doc.rev;
      const holder = this.live(doc);
      if (holder && !this.holds(holder, args.clientId, args.leaseId)) return fail('leased', `${holder.label} is editing this file.`, this.snapshot(doc));
      if (args.rev !== textRev && args.rev !== doc.rev) return fail('stale', 'The document changed. Reload it and try again.', this.snapshot(doc));
      const small = this.fits(args.text);
      const dirty = doc.diskText !== null ? args.text !== doc.diskText : sha256Hex(args.text) !== doc.diskSha256;
      const text = small ? args.text : null;
      const diagnostics = (args.diagnostics as StudioDiagnostic[] | undefined) ?? doc.diagnostics;
      const textChanged = text !== doc.text || dirty !== doc.dirty || !small !== doc.tooLarge;
      const diagnosticsChanged = JSON.stringify(diagnostics) !== JSON.stringify(doc.diagnostics);
      const base = !dirty ? doc.diskSha256 : typeof args.baseSha256 === 'string' && SHA.test(args.baseSha256) ? args.baseSha256 : doc.baseSha256;
      const baseChanged = base !== doc.baseSha256;
      const now = this.now();
      const granted = !holder;
      if (holder) holder.renewedAt = now;
      else this.grant(doc, args.clientId, typeof args.label === 'string' && args.label.trim() ? args.label.trim().slice(0, MAX_UPDATE_LABEL) : DEFAULT_EDITOR_LABEL, now);
      if (textChanged || diagnosticsChanged || granted || baseChanged) {
        if (text !== doc.text) doc.lastWriter = args.clientId;
        doc.text = text; doc.tooLarge = !small; doc.dirty = dirty; doc.baseSha256 = base; doc.diagnostics = diagnostics.map(row => ({ ...row }));
        this.bump(doc, 'text');
        if (textChanged || baseChanged) await this.setBuffer(projectId, args.path, dirty && text !== null ? { text, baseSha256: doc.baseSha256, updatedAt: now } : null);
      }
      return { ok: true, doc: this.snapshot(doc) } as AgentDocResult;
    });
  }

  saved(projectId: string, args: { path: string; clientId: string; sha256: string; text: string }): Promise<AgentDocResult> {
    const bad = this.checkTarget(projectId, args?.path) ?? this.checkClient(args.clientId);
    if (bad) return Promise.resolve(bad);
    if (typeof args.text !== 'string' || typeof args.sha256 !== 'string' || !SHA.test(args.sha256)) return Promise.resolve(fail('invalid_input', 'saved requires the sha256 and text that were written.'));
    return this.run(this.keyOf(projectId, args.path), async () => {
      const doc = await this.ensure(projectId, args.path);
      if ('ok' in doc) return doc;
      const holder = this.live(doc);
      if (holder && holder.clientId !== args.clientId) return fail('leased', `${holder.label} is editing this file.`, this.snapshot(doc));
      if (holder) holder.renewedAt = this.now();
      const small = this.fits(args.text);
      doc.baseSha256 = args.sha256; doc.diskSha256 = args.sha256;
      doc.diskText = small ? args.text : null;
      doc.checkedAt = this.now();
      // A newer live text (a debounced update that landed before this save) is kept, dirty against the saved base.
      if (doc.dirty && doc.text !== null && doc.text !== args.text && doc.diskText !== null) doc.dirty = true;
      else { doc.text = doc.diskText; doc.tooLarge = !small; doc.dirty = false; }
      this.bump(doc, 'saved');
      await this.setBuffer(projectId, args.path, doc.dirty && doc.text !== null ? { text: doc.text, baseSha256: doc.baseSha256, updatedAt: this.now() } : null);
      return { ok: true, doc: this.snapshot(doc) } as AgentDocResult;
    });
  }

  /**
   * Grants or renews. A renewal names its grant (`leaseId`); the same client without one (a reload, a remount) gets a fresh
   * grant, while a different grant id of the same client (a duplicated window) is refused like any other holder unless `take`.
   */
  lease(projectId: string, args: { path: string; clientId: string; label?: string; take?: boolean; leaseId?: string }): Promise<AgentDocResult> {
    const bad = this.checkTarget(projectId, args?.path) ?? this.checkClient(args.clientId);
    if (bad) return Promise.resolve(bad);
    return this.run(this.keyOf(projectId, args.path), async () => {
      const doc = await this.ensure(projectId, args.path);
      if ('ok' in doc) return doc;
      const holder = this.live(doc);
      const label = (typeof args.label === 'string' && args.label.trim() ? args.label.trim() : args.clientId).slice(0, MAX_LABEL);
      const now = this.now();
      if (holder && holder.clientId === args.clientId && args.leaseId === holder.id) {
        holder.renewedAt = now; holder.label = label;
        return { ok: true, doc: this.snapshot(doc) } as AgentDocResult;
      }
      const sameClientFresh = holder?.clientId === args.clientId && args.leaseId === undefined;
      if (holder && !sameClientFresh && args.take !== true) return fail('leased', `${holder.label} is editing this file.`, this.snapshot(doc));
      this.grant(doc, args.clientId, label, now);
      this.bump(doc, 'lease');
      return { ok: true, doc: this.snapshot(doc) } as AgentDocResult;
    });
  }

  /** Releases the caller's lease; with `leaseId` only that grant (a newer grant of the same client stays). */
  release(projectId: string, args: { path: string; clientId: string; leaseId?: string }): Promise<{ ok: true } | Failure> {
    const bad = this.checkTarget(projectId, args?.path) ?? this.checkClient(args.clientId);
    if (bad) return Promise.resolve(bad);
    return this.run(this.keyOf(projectId, args.path), async () => {
      const doc = this.docs.get(this.keyOf(projectId, args.path));
      const lease = doc && this.live(doc);
      if (doc && lease && this.holds(lease, args.clientId, args.leaseId)) { this.dropLease(doc); this.bump(doc, 'lease'); }
      return { ok: true } as const;
    });
  }

  /** Releases the caller's lease and drops the doc from memory when it is clean, unleased and has nothing pending. */
  close(projectId: string, args: { path: string; clientId: string; leaseId?: string }): Promise<{ ok: true } | Failure> {
    const bad = this.checkTarget(projectId, args?.path) ?? this.checkClient(args.clientId);
    if (bad) return Promise.resolve(bad);
    return this.run(this.keyOf(projectId, args.path), async () => {
      const key = this.keyOf(projectId, args.path);
      const doc = this.docs.get(key);
      if (!doc) return { ok: true } as const;
      const lease = this.live(doc);
      if (lease && this.holds(lease, args.clientId, args.leaseId)) { this.dropLease(doc); this.bump(doc, 'lease'); }
      if (!doc.dirty && !this.live(doc) && !pendingWork(doc)) {
        this.docs.delete(key);
        doc.rev = this.nextRev(doc.rev);
        this.publish(doc, 'closed');
      }
      return { ok: true } as const;
    });
  }

  propose(projectId: string, args: { path: string; input: unknown; id?: unknown; threadId?: unknown }): Promise<AgentDocProposalResult> {
    const bad = this.checkTarget(projectId, args?.path);
    if (bad) return Promise.resolve(bad);
    if (!isProposeEditInput(args.input) || args.input.path !== args.path) return Promise.resolve(fail('invalid_input', 'The proposal must target this file with content or edits.'));
    const id = args.id === undefined ? this.newId() : args.id;
    if (typeof id !== 'string' || !id || id.length > MAX_ID) return Promise.resolve(fail('invalid_input', 'Proposal id is invalid.'));
    const input: ProposeEditInput = args.input;
    const threadId = typeof args.threadId === 'string' && args.threadId && args.threadId.length <= MAX_CLIENT_ID ? args.threadId : undefined;
    return this.run(this.keyOf(projectId, args.path), async () => {
      const doc = await this.ensure(projectId, args.path);
      if ('ok' in doc) return doc;
      const known = doc.proposals.find(row => row.id === id);
      if (known) return { ok: true, proposal: { ...known }, doc: this.snapshot(doc) } as AgentDocProposalResult;
      if (proposalSize(input) > this.limits.textMax) return fail('invalid_input', 'The proposal is too large.', this.snapshot(doc));
      const editError = typeof input.content === 'string' || doc.text === null ? null : proposalEditsError(doc.text, input.edits);
      if (editError) return fail('invalid_input', editError, this.snapshot(doc));
      if (doc.proposals.length >= this.limits.maxProposals) {
        const oldest = doc.proposals.findIndex(row => row.status === 'accepted' || row.status === 'rejected');
        if (oldest < 0) return fail('proposals_full', 'Too many proposals are waiting. Accept or reject some first.', this.snapshot(doc));
        doc.proposals.splice(oldest, 1);
      }
      const proposal: AgentDocProposal = { id, input, status: 'pending', ...(threadId ? { threadId } : {}), createdAt: this.now() };
      doc.proposals.push(proposal);
      this.bump(doc, 'proposals');
      return { ok: true, proposal: { ...proposal }, doc: this.snapshot(doc) } as AgentDocProposalResult;
    });
  }

  resolve(projectId: string, args: { path: string; id: string; decision: string; clientId?: string; sha256?: string }): Promise<AgentDocProposalResult> {
    const bad = this.checkTarget(projectId, args?.path);
    if (bad) return Promise.resolve(bad);
    if (typeof args.id !== 'string' || !args.id) return Promise.resolve(fail('invalid_input', 'resolve requires a proposal id.'));
    if (args.decision !== 'accept' && args.decision !== 'reject' && args.decision !== 'applied') return Promise.resolve(fail('invalid_input', 'decision must be accept, reject or applied.'));
    return this.run(this.keyOf(projectId, args.path), async () => {
      const doc = this.docs.get(this.keyOf(projectId, args.path));
      // First: a lapsed lease turns accept-requested back into pending.
      const holder = doc ? this.live(doc) : null;
      const index = doc ? doc.proposals.findIndex(row => row.id === args.id) : -1;
      if (!doc || index < 0) return fail('not_found', 'That proposal is no longer available.', doc ? this.snapshot(doc) : undefined);
      const proposal = doc.proposals[index]!;
      const done = (status: AgentDocProposal['status'], kind: AgentDocChangeKind = 'proposals', keepBody = false) => {
        const next: AgentDocProposal = { ...proposal, status, ...(!keepBody && (status === 'accepted' || status === 'rejected') ? { input: slim(proposal.input) } : {}), ...(status === 'accepted' || status === 'rejected' ? { resolvedAt: this.now() } : {}) };
        doc.proposals[index] = next;
        this.bump(doc, kind);
        return { ok: true, proposal: { ...next }, doc: this.snapshot(doc) } as AgentDocProposalResult;
      };
      const resolved = proposal.status === 'accepted' || proposal.status === 'rejected';
      const target = args.decision === 'reject' ? 'rejected' : args.decision === 'applied' ? 'accepted' : null;
      if (resolved) {
        // The editor resolves 'applied' after a holder's accept; repeating the same outcome is a no-op.
        const same = target === proposal.status || (args.decision === 'accept' && proposal.status === 'accepted');
        // The editor's 'applied' confirmation is the point the held body is no longer needed.
        if (same && args.decision === 'applied' && hasBody(proposal.input)) return done(proposal.status);
        return same ? { ok: true, proposal: { ...proposal }, doc: this.snapshot(doc) } as AgentDocProposalResult : fail('already_resolved', `This proposal was already ${proposal.status}.`, this.snapshot(doc));
      }
      // While an editor holds the lease only it reports an applied edit, and only it settles an accept it was asked to apply.
      const byHolder = Boolean(holder && args.clientId === holder.clientId);
      if (holder && !byHolder && args.decision === 'applied') return fail('leased', `${holder.label} is editing this file.`, this.snapshot(doc));
      if (holder && !byHolder && args.decision === 'reject' && proposal.status === 'accept-requested') return fail('leased', `${holder.label} is applying this proposal.`, this.snapshot(doc));
      if (args.decision === 'reject') return done('rejected');
      if (args.decision === 'applied') return done('accepted');
      if (args.sha256 && args.sha256 !== doc.baseSha256) return fail('conflict', 'The file changed since you reviewed this proposal.', this.snapshot(doc));
      if (holder) {
        if (byHolder) return done('accepted', 'proposals', true);
        if (proposal.input.expectedSha256 !== doc.baseSha256) return fail('conflict', 'The file changed since this proposal was made.', this.snapshot(doc));
        return proposal.status === 'accept-requested' ? { ok: true, proposal: { ...proposal }, doc: this.snapshot(doc) } as AgentDocProposalResult : done('accept-requested');
      }
      if (doc.dirty) return fail('dirty', 'This file has unsaved edits. Open it in the Studio to accept the proposal there.', this.snapshot(doc));
      const disk = await this.deps.io.read(projectId, args.path);
      if (!disk.ok) return fail(disk.code, disk.error, this.snapshot(doc));
      const expected = proposal.input.expectedSha256;
      if (disk.sha256 !== expected) {
        if (this.resync(doc, disk)) this.bump(doc, 'text');
        return fail('conflict', 'The file changed since this proposal was made.', this.snapshot(doc));
      }
      const next = applyProposalText(disk.content, proposal.input);
      const wrote = await this.deps.io.write(projectId, args.path, next, expected);
      if (!wrote.ok) return fail(wrote.code === 'sha_mismatch' ? 'conflict' : wrote.code, wrote.error, this.snapshot(doc));
      const small = this.fits(next);
      doc.baseSha256 = wrote.sha256; doc.diskSha256 = wrote.sha256; doc.checkedAt = this.now();
      doc.diskText = small ? next : null;
      doc.text = doc.diskText; doc.tooLarge = !small; doc.dirty = false;
      return done('accepted', 'saved');
    });
  }
}

/** Reads and writes through the plugin's agent-file path (the project root always comes from the request context). */
function contextIo(studio: StudioServerContext): AgentDocIo {
  const root = () => studio.contexts.current()?.settings.projectRoot ?? '';
  const failure = (error: unknown): Failure => error instanceof AgentFilesError
    ? fail(error.code, error.message)
    : fail('failed', error instanceof Error ? error.message : String(error));
  return {
    async read(_projectId, path) {
      try { const file = readAgentFile(root(), path, studio.deps, { allowNonDx: true }); return { ok: true, content: file.content, sha256: file.sha256 }; }
      catch (error) { return failure(error); }
    },
    async write(projectId, path, content, expectedSha256) {
      try {
        const file = writeAgentFile(root(), path, content, studio.deps, expectedSha256, { allowNonDx: true });
        // An open Studio reloads the file and the explorer refreshes, like an agentFiles.write.
        try { studio.zcc.realtime.publish(STUDIO_CHANGED_CHANNEL, { projectId, path: file.path, kind: 'files' }); } catch { /* best effort */ }
        return { ok: true, sha256: file.sha256 };
      } catch (error) { return failure(error); }
    }
  };
}

/** Registers the agentDoc.* RPCs. */
export function registerAgentScriptDocuments(studio: StudioServerContext): AgentScriptDocumentStore {
  const store = new AgentScriptDocumentStore({
    kv: studio.zcc.storage.kv,
    io: contextIo(studio),
    publish: change => studio.zcc.realtime.publish(AGENT_DOC_CHANNEL, change)
  });
  const scoped = (handler: (projectId: string, args: Record<string, any>) => Promise<unknown>) => async (args: unknown) => {
    const projectId = studio.contexts.current()?.projectId ?? '';
    if (!projectId) return rpcFailure('project_required', 'Choose a registered project to open an agent file.');
    return handler(projectId, isRecord(args) ? args : {});
  };
  const str = (value: unknown) => typeof value === 'string' ? value : '';
  // A string (even empty: "I hold no grant") is checked; anything else means none was named.
  const grantId = (value: unknown) => typeof value === 'string' ? value.slice(0, MAX_ID) : undefined;
  studio.registerRpc(AGENT_DOC_RPC.open, scoped((projectId, a) => store.open(projectId, str(a.path))));
  studio.registerRpc(AGENT_DOC_RPC.update, scoped((projectId, a) => store.update(projectId, { path: str(a.path), clientId: str(a.clientId), rev: a.rev, text: a.text, diagnostics: a.diagnostics, label: str(a.label), leaseId: grantId(a.leaseId), baseSha256: a.baseSha256 })));
  studio.registerRpc(AGENT_DOC_RPC.saved, scoped((projectId, a) => store.saved(projectId, { path: str(a.path), clientId: str(a.clientId), sha256: a.sha256, text: a.text })));
  studio.registerRpc(AGENT_DOC_RPC.lease, scoped((projectId, a) => store.lease(projectId, { path: str(a.path), clientId: str(a.clientId), label: str(a.label), take: a.take === true, leaseId: grantId(a.leaseId) })));
  studio.registerRpc(AGENT_DOC_RPC.release, scoped((projectId, a) => store.release(projectId, { path: str(a.path), clientId: str(a.clientId), leaseId: grantId(a.leaseId) })));
  studio.registerRpc(AGENT_DOC_RPC.propose, scoped((projectId, a) => store.propose(projectId, { path: str(a.path), input: a.input, id: a.id, threadId: a.threadId })));
  studio.registerRpc(AGENT_DOC_RPC.resolve, scoped((projectId, a) => store.resolve(projectId, { path: str(a.path), id: str(a.id), decision: str(a.decision), clientId: str(a.clientId) || undefined, sha256: str(a.sha256) || undefined })));
  studio.registerRpc(AGENT_DOC_RPC.close, scoped((projectId, a) => store.close(projectId, { path: str(a.path), clientId: str(a.clientId), leaseId: grantId(a.leaseId) })));
  return store;
}
