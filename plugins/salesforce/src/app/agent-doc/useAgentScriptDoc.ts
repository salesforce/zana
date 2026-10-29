import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { callPluginRpc, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import {
  AGENT_DOC_CHANNEL, AGENT_DOC_LEASE_TTL_MS, AGENT_DOC_RPC,
  type AgentDocLease, type AgentDocProposal, type AgentDocSnapshot
} from '../../../lib/agent-doc-contract.js';
import type { ProposeEditInput, StudioDiagnostic } from '../../../lib/studio-contract.js';

/**
 * `standby`: the editor is not ready to edit yet (its frame has not loaded this agent). The document is opened as a viewer that knows
 * its client id (so this window's own lease is not shown as someone else's); no lease is requested until it is ready.
 */
export interface AgentDocEditor { clientId: string; label: string; standby?: boolean }
export interface AgentScriptDocApi {
  doc: AgentDocSnapshot | null; loading: boolean; error: string | null;
  /** Editor only: this client holds the lease. */
  leased: boolean;
  /** Bumps on each new grant to this session (not on renewals), so the editor can reconcile its text with the document's. */
  leaseGen: number;
  /** Someone else's live lease (another Studio window), for a read-only banner with Take over. */
  heldBy: AgentDocLease | null;
  /**
   * Editor only; debounced (~300 ms), coalesces, retries once on 'stale' after re-open. No-op without the lease.
   * `baseSha256` is the disk version the text is based on (the editor kept its edits over a newer disk version).
   */
  update(text: string, diagnostics?: StudioDiagnostic[], baseSha256?: string): void;
  saved(sha256: string, text: string): Promise<void>;
  takeOver(): Promise<boolean>;
  propose(input: ProposeEditInput, options?: { id?: string; threadId?: string }): Promise<AgentDocProposal | null>;
  resolve(id: string, decision: 'accept' | 'reject' | 'applied', sha256?: string): Promise<{ ok: boolean; error?: string; code?: string }>;
  reload(): void;
}

export const AGENT_DOC_UPDATE_DEBOUNCE_MS = 300;
export const AGENT_DOC_LEASE_RENEW_MS = 15_000;
/** A lease someone else holds is looked at again this long after the last snapshot showing it: a holder that vanished (crash) lapses. */
export const AGENT_DOC_LAPSE_CHECK_MS = AGENT_DOC_LEASE_TTL_MS + 1_000;
/** A failed update is retried with backoff, this many times, before the edit waits for the next one. */
export const AGENT_DOC_UPDATE_RETRIES = 4;

type Failure = { ok: false; code: string; error: string; doc?: AgentDocSnapshot };
type Result = { ok: true; doc: AgentDocSnapshot; proposal?: AgentDocProposal } | Failure;

export function newAgentDocClientId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return `studio-${c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

/**
 * The client id of this window for one scope, kept in sessionStorage so a reload renews its own lease
 * instead of waiting out the old one. Falls back to a fresh id when storage is unavailable.
 */
export function stableAgentDocClientId(scope: string): string {
  const key = `salesforce:agentdoc-client:${scope}`;
  try {
    const stored = globalThis.sessionStorage?.getItem(key);
    if (stored && /^studio-[\w-]{4,80}$/.test(stored)) return stored;
    const next = newAgentDocClientId();
    globalThis.sessionStorage?.setItem(key, next);
    return next;
  } catch { return newAgentDocClientId(); }
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** One RPC; failures come back as `{ok:false}` rather than throwing. */
async function rpc(pluginId: string, method: string, input: Record<string, unknown>): Promise<Result> {
  try {
    const result = (await callPluginRpc(pluginId, method, input)) as Result | undefined;
    if (result && result.ok === true && result.doc) return result;
    if (result && result.ok === false) return { ok: false, code: String(result.code ?? 'error'), error: String(result.error ?? 'Request failed.'), ...(result.doc ? { doc: result.doc } : {}) };
    return { ok: false, code: 'error', error: 'Unexpected response.' };
  } catch (error) {
    return { ok: false, code: 'error', error: message(error) };
  }
}

interface Session {
  alive: boolean;
  open(): Promise<void>;
  update(text: string, diagnostics?: StudioDiagnostic[], baseSha256?: string): void;
  saved(sha256: string, text: string): Promise<void>;
  takeOver(): Promise<boolean>;
  propose(input: ProposeEditInput, options?: { id?: string; threadId?: string }): Promise<AgentDocProposal | null>;
  resolve(id: string, decision: 'accept' | 'reject' | 'applied', sha256?: string): Promise<{ ok: boolean; error?: string; code?: string }>;
  /** A realtime change at `rev`. */
  changed(rev: number): void;
}

/**
 * The shared Agent Script document for one project + `.agent` path. Viewers just read it;
 * the editor (options.editor) also holds an edit lease and is the only writer.
 */
export function useAgentScriptDoc(pluginId: string, projectId: string | null, path: string | null, options?: { editor?: AgentDocEditor }): AgentScriptDocApi {
  const [doc, setDoc] = useState<AgentDocSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leased, setLeased] = useState(false);
  const [leaseGen, setLeaseGen] = useState(0);
  const [heldBy, setHeldBy] = useState<AgentDocLease | null>(null);
  const docRef = useRef<AgentDocSnapshot | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const clientId = options?.editor?.clientId;
  const standby = options?.editor?.standby === true;
  const label = options?.editor?.label ?? '';
  const target = useRef({ projectId, path });
  target.current = { projectId, path };

  const sessionTarget = useRef<string | null>(null);
  useEffect(() => {
    // The same document in another role (standby -> editing) keeps what is shown; another document starts empty.
    const targetKey = projectId && path ? `${projectId}\0${path}` : null;
    if (sessionTarget.current !== targetKey) { docRef.current = null; setDoc(null); setHeldBy(null); }
    sessionTarget.current = targetKey;
    setError(null); setLeased(false);
    if (!projectId || !path) { setLoading(false); sessionRef.current = null; return; }
    const activePath = path;
    const session: Session = {} as Session;
    session.alive = true;
    /** This session edits: it requests, renews and closes the lease. */
    const editing = Boolean(clientId) && !standby;
    let isLeased = false;
    /** The grant this session last held. Renewals present it; it is kept after a loss so a duplicate of this window (same clientId) is not taken back. */
    let leaseId: string | undefined;
    /** The first lease request ran: from then on a document without a lease is re-acquired. */
    let started = false;
    let acquiring = false;
    /** This session's own calls in flight, and the newest change announced meanwhile (their results usually carry it). */
    let busy = 0;
    let announced = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let renew: ReturnType<typeof setInterval> | undefined;
    let lapseCheck: ReturnType<typeof setTimeout> | undefined;
    /** Consecutive failed updates (not 'leased'); the edit is re-queued with backoff while it stays under the bound. */
    let failures = 0;
    let pending: { text: string; diagnostics?: StudioDiagnostic[]; baseSha256?: string } | null = null;
    let sending = false;
    let inFlight: Promise<Result> | null = null;
    let finishing = false;
    const live = () => session.alive;
    const setLease = (value: boolean) => { isLeased = value; setLeased(value); };
    const call = (method: string, extra: Record<string, unknown> = {}) => rpc(pluginId, method, { projectId, path: activePath, ...extra });
    const mutate = async (method: string, extra: Record<string, unknown> = {}) => {
      busy++;
      let carried = -1;
      try {
        const result = await call(method, extra);
        carried = result.doc?.rev ?? -1;
        return result;
      } finally {
        busy--;
        // The caller adopts the result after this; a change it does not carry is fetched.
        if (!busy && live() && announced > Math.max(carried, docRef.current?.rev ?? -1)) { announced = -1; void session.open(); }
        else if (!busy) announced = -1;
      }
    };
    const ours = (lease: AgentDocLease | null) => Boolean(lease && clientId && lease.clientId === clientId && lease.id === leaseId);
    /**
     * Adopts a snapshot unless an older one. `own` marks the success of this session's lease or update call: a lease in this
     * client's name there is this session's grant (a new one bumps leaseGen). A lease that is not ours flips leased off; none at all
     * is re-acquired (it lapsed, the plugin restarted, or the window that took over closed).
     */
    const apply = (next: AgentDocSnapshot, own = false) => {
      if (!live()) return;
      if (own && clientId && next.lease?.clientId === clientId && next.lease.id !== leaseId) {
        leaseId = next.lease.id; setLease(true); setLeaseGen(gen => gen + 1);
      }
      const cur = docRef.current;
      const shown = cur && next.rev < cur.rev ? cur : next;
      if (shown === next) { docRef.current = next; setDoc(next); }
      const mine = ours(shown.lease);
      // Nothing is announced when a holder vanishes until someone reads the document: read it once that lease would have lapsed.
      if (shown === next) {
        if (lapseCheck) clearTimeout(lapseCheck);
        lapseCheck = next.lease && !mine ? setTimeout(() => { lapseCheck = undefined; if (live()) void session.open(); }, AGENT_DOC_LAPSE_CHECK_MS) : undefined;
      }
      if (isLeased && !mine) setLease(false);
      // Before the first request a lease in this client's name is this window's previous session (a reload): not someone else.
      const held = !mine && shown.lease && (shown.lease.clientId !== clientId || started) ? shown.lease : null;
      setHeldBy(prev => prev?.id === held?.id && prev?.label === held?.label && prev?.clientId === held?.clientId ? prev : held);
      if (editing && started && !shown.lease && !acquiring) void acquire();
    };
    const fail = (result: Failure) => { if (live()) setError(result.error); };

    /** Requests (or renews: it names the grant this session holds) the lease. A lost one stays lost unless `take`. */
    const acquire = async (take = false): Promise<Result> => {
      acquiring = true;
      try {
        const result = await mutate(AGENT_DOC_RPC.lease, { clientId, label, ...(leaseId ? { leaseId } : {}), ...(take ? { take: true } : {}) });
        if (!live()) return result;
        if (result.ok) { apply(result.doc, true); setError(null); }
        else if (result.code === 'leased') {
          if (result.doc) apply(result.doc);
          else { const fresh = await call(AGENT_DOC_RPC.open); if (live() && fresh.ok) apply(fresh.doc); else if (live()) setLease(false); }
        } else if (!isLeased) fail(result); // a held lease survives a failed renewal (offline, restarting); the next tick retries
        return result;
      } finally { acquiring = false; }
    };

    session.open = async () => {
      const result = await call(AGENT_DOC_RPC.open);
      if (!live()) return;
      if (result.ok) { apply(result.doc); setError(null); } else fail(result);
    };
    session.changed = rev => {
      if (rev <= (docRef.current?.rev ?? -1)) return;
      if (busy) { announced = Math.max(announced, rev); return; }
      void session.open();
    };

    const flush = async () => {
      timer = undefined;
      if (sending || !pending || !isLeased) return;
      const job = pending; pending = null; sending = true;
      try {
        for (let attempt = 0; attempt < 2 && live() && isLeased; attempt++) {
          const cur = docRef.current;
          if (!cur) return;
          const diagChanged = job.diagnostics !== undefined && JSON.stringify(job.diagnostics) !== JSON.stringify(cur.diagnostics);
          const baseChanged = cur.dirty && job.baseSha256 !== undefined && job.baseSha256 !== cur.baseSha256;
          if (job.text === cur.text && !diagChanged && !baseChanged) return;
          inFlight = mutate(AGENT_DOC_RPC.update, {
            clientId, label, leaseId, rev: cur.rev, text: job.text,
            ...(job.diagnostics ? { diagnostics: job.diagnostics } : {}), ...(job.baseSha256 ? { baseSha256: job.baseSha256 } : {})
          });
          const result = await inFlight;
          if (!live()) return;
          if (result.ok) { failures = 0; apply(result.doc, true); setError(null); return; }
          if (result.code === 'stale' && attempt === 0) { await session.open(); continue; }
          if (result.code === 'leased') { if (result.doc) apply(result.doc); else setLease(false); }
          else if (failures < AGENT_DOC_UPDATE_RETRIES) { failures++; pending ??= job; } // offline, restarting, stale twice: try again later
          fail(result);
          return;
        }
      } finally {
        sending = false;
        inFlight = null;
        if (live() && pending) timer = setTimeout(() => void flush(), AGENT_DOC_UPDATE_DEBOUNCE_MS * 2 ** failures);
      }
    };

    session.update = (text, diagnostics, baseSha256) => {
      if (!isLeased || !live()) return;
      pending = { text, diagnostics: diagnostics ?? pending?.diagnostics, baseSha256: baseSha256 ?? pending?.baseSha256 };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), AGENT_DOC_UPDATE_DEBOUNCE_MS);
    };
    session.saved = async (sha256, text) => {
      const result = await mutate(AGENT_DOC_RPC.saved, { clientId: clientId ?? '', sha256, text });
      if (!live()) return;
      if (result.ok) { apply(result.doc); setError(null); } else fail(result);
    };
    session.takeOver = async () => {
      if (!editing) return false;
      const result = await acquire(true);
      return result.ok;
    };
    session.propose = async (input, opts) => {
      const result = await mutate(AGENT_DOC_RPC.propose, { input, ...(opts?.id ? { id: opts.id } : {}), ...(opts?.threadId ? { threadId: opts.threadId } : {}) });
      if (!result.ok) { fail(result); return null; }
      apply(result.doc);
      return result.proposal ?? result.doc.proposals.find(p => p.id === opts?.id) ?? null;
    };
    session.resolve = async (id, decision, sha256) => {
      const result = await mutate(AGENT_DOC_RPC.resolve, { id, decision, ...(clientId ? { clientId } : {}), ...(sha256 ? { sha256 } : {}) });
      if (!result.ok) { fail(result); if (result.doc) apply(result.doc); return { ok: false, error: result.error, code: result.code }; }
      apply(result.doc);
      return { ok: true };
    };

    sessionRef.current = session;
    setLoading(true);
    void (async () => {
      await session.open();
      if (!live()) return;
      setLoading(false);
      if (!editing) return;
      if (docRef.current) await acquire();
      started = true;
      // A lease seen before the first request (this window's previous session) and refused since is someone else's now.
      if (live() && docRef.current) apply(docRef.current);
    })();
    if (editing) renew = setInterval(() => { if (started && !acquiring) void acquire(); }, AGENT_DOC_LEASE_RENEW_MS);
    /** Sends an edit still waiting for its debounce, then closes with this session's grant (an older session's close never ends a newer grant). */
    const finish = () => {
      if (!editing || finishing) return;
      finishing = true;
      const unsent = pending; const cur = docRef.current;
      pending = null;
      if (timer) { clearTimeout(timer); timer = undefined; }
      const closeDoc = () => void call(AGENT_DOC_RPC.close, { clientId, leaseId: leaseId ?? '' });
      const flushFinal = (latest: AgentDocSnapshot | null) => {
        if (isLeased && unsent && latest && unsent.text !== latest.text) {
          void call(AGENT_DOC_RPC.update, {
            clientId, label, leaseId, rev: latest.rev, text: unsent.text,
            ...(unsent.diagnostics ? { diagnostics: unsent.diagnostics } : {}), ...(unsent.baseSha256 ? { baseSha256: unsent.baseSha256 } : {})
          }).then(closeDoc);
        } else closeDoc();
      };
      // A previous update owns the next revision. Flushing against the snapshot
      // from before it (or closing first) would discard the last keystrokes.
      if (inFlight) void inFlight.then(result => flushFinal(result.doc ?? cur));
      else flushFinal(cur);
    };
    // Best effort on a reload or window close: the update and the close may not both make it, then the lease lapses.
    if (editing) window.addEventListener('pagehide', finish);
    return () => {
      if (editing) window.removeEventListener('pagehide', finish);
      finish();
      session.alive = false;
      if (sessionRef.current === session) sessionRef.current = null;
      if (renew) clearInterval(renew);
      if (lapseCheck) clearTimeout(lapseCheck);
    };
  }, [pluginId, projectId, path, clientId, label, standby]);

  useRealtime(AGENT_DOC_CHANNEL, payload => {
    const p = payload as { projectId?: unknown; path?: unknown; rev?: unknown } | null;
    const now = target.current;
    if (!p || typeof p !== 'object' || !now.path || p.projectId !== now.projectId || p.path !== now.path || typeof p.rev !== 'number') return;
    sessionRef.current?.changed(p.rev);
  });

  const update = useCallback((text: string, diagnostics?: StudioDiagnostic[], baseSha256?: string) => { sessionRef.current?.update(text, diagnostics, baseSha256); }, []);
  const saved = useCallback(async (sha256: string, text: string) => { await sessionRef.current?.saved(sha256, text); }, []);
  const takeOver = useCallback(async () => (await sessionRef.current?.takeOver()) ?? false, []);
  const propose = useCallback(async (input: ProposeEditInput, opts?: { id?: string; threadId?: string }) => (await sessionRef.current?.propose(input, opts)) ?? null, []);
  const resolve = useCallback(async (id: string, decision: 'accept' | 'reject' | 'applied', sha256?: string) =>
    (await sessionRef.current?.resolve(id, decision, sha256)) ?? { ok: false, error: 'No document is open.' }, []);
  const reload = useCallback(() => { void sessionRef.current?.open(); }, []);

  const held = leased ? null : heldBy;
  return useMemo(() => ({ doc, loading, error, leased, leaseGen, heldBy: held, update, saved, takeOver, propose, resolve, reload }),
    [doc, loading, error, leased, leaseGen, held, update, saved, takeOver, propose, resolve, reload]);
}
