/**
 * AgentRegistryStore — the main-process registry of live agent sessions, so an
 * agent in one tab can DISCOVER its peers (and, in a later phase, message them).
 *
 * This is Phase 0 of the inter-agent mesh (`docs/tmux-agent-mesh-implementation-plan.md`):
 * discovery only, no messaging. It answers "what other agents are running, and
 * how do I reference one?" The atomic record is keyed by `sessionId` — the same
 * un-forgeable id the pty mints at spawn and bakes into `ZCC_MCP_URL`
 * (`pty.ts`). Identity-bearing fields (`sessionId`, `projectId`, `cwd`) are ALWAYS
 * filled server-side from that URL route + `PtyManager.getSession()`; the agent
 * only ever supplies the soft fields (`handle`, `role`, `capabilities`). That
 * mirrors the `inbox_push` trust model: the agent cannot forge whose record it is.
 *
 * Live agent STATE (working / idle / blocked) is deliberately NOT stored on the
 * record — it lives in {@link AgentStatusTracker} and is fused in at read time
 * (see the MCP tools), so the registry never holds a stale status.
 *
 * ## Why in-memory only (no JSONL persistence)
 *
 * Unlike {@link InboxStore}, this store is purely in-memory. A registry record
 * is strictly session-lifetime-scoped: it is seeded when a pty spawns and
 * dropped the instant it exits. PTYs do not survive an app restart in Phase 0
 * (restore re-spawns them, which re-seeds fresh records), so a persisted
 * `agents.json` could only ever hold tombstones of dead sessions — dead weight
 * that would need reconciling against the live pty map on every boot. Persisting
 * the registry only becomes meaningful once sessions themselves persist (the
 * tmux work in Phase 2); the seam to add it is documented there. Keeping it
 * in-memory now is the honest, drift-free choice. The store still mirrors the
 * inbox-store shape (factory + EventEmitter + dispose-returning subscriptions)
 * so the renderer/IPC wiring is identical to the inbox.
 */

import { EventEmitter } from 'node:events';
import type { AgentRecord } from '@zana-ai/zcc-domain/product';

export type { AgentRecord } from '@zana-ai/zcc-domain/product';

/**
 * The best human-facing name for a record: the authoritative `handle` if the
 * agent registered one, else the live tab title (`displayName`), else the raw
 * session id as a last resort. Use this everywhere a non-optional label is
 * needed (message envelopes, logs) so an unregistered peer is still named.
 */
export function agentLabel(rec: {
  handle?: string;
  displayName?: string;
  sessionId: string;
}): string {
  return rec.handle ?? rec.displayName ?? rec.sessionId;
}

/**
 * The fields a caller provides to {@link IAgentRegistryStore.upsert}.
 *
 * `handle` and `displayName` are deliberately distinct (see {@link AgentRecord}):
 *  - `handle` is the agent's AUTHORITATIVE, addressable name. Supply it ONLY when
 *    the agent explicitly chose one (the `register_agent` path). It is deduped
 *    per project and, once set, is never wiped by a later display-only refresh.
 *  - `displayName` is the live tab title. The auto-seed path supplies this (and
 *    no handle), refreshing it on every `sessionUpdated` without ever touching a
 *    handle the agent may have registered.
 */
export interface AgentUpsertInput {
  sessionId: string;
  projectId: string;
  cwd: string;
  /** Authoritative handle — provide only on an explicit register. */
  handle?: string;
  /** Live tab title — the auto-seed refreshes this. */
  displayName?: string;
  role?: string;
  capabilities?: string[];
  /** Team launch id — scopes handle dedup + discovery to one squad. */
  teamLaunchId?: string;
}

export interface AgentFindQuery {
  /**
   * Match a name within the resolved project scope. Matches the authoritative
   * `handle` first; falls back to `displayName` so an unregistered (auto-seeded)
   * agent is still addressable by its tab title.
   */
  handle?: string;
  /** Exact role match. */
  role?: string;
  /** Match records that declare this capability tag. */
  capability?: string;
  /** Restrict to one project. Omit to search across all projects. */
  projectId?: string;
  /** Restrict to one team launch. When set, only agents from the same squad are returned. */
  teamLaunchId?: string;
}

export interface IAgentRegistryStore {
  /**
   * Insert or update the record for a session. `registeredAt` is preserved
   * across updates (set once, on first seed/register).
   *
   * Handle vs. displayName (the fix for cross-agent identity drift):
   *  - When `handle` is supplied (the explicit `register_agent` path) it is
   *    deduped within the record's project — if another live session there
   *    already holds it, this record's handle is suffixed (`reviewer` →
   *    `reviewer-2`) — and stored as the authoritative name. A registered
   *    handle is NEVER overwritten by a later handle-less (display-only) upsert.
   *  - When only `displayName` is supplied (the auto-seed path) it refreshes the
   *    live tab title without touching any handle the agent registered. `role`
   *    and `capabilities` are likewise preserved when omitted, so the repeated
   *    `sessionUpdated` re-seed can't wipe an agent's registered identity.
   * Returns the stored record (with the possibly-suffixed handle).
   */
  upsert(input: AgentUpsertInput): AgentRecord;
  /** Drop a session's record. Returns true if one was removed. */
  drop(sessionId: string): boolean;
  /** The record for a session, or null. */
  get(sessionId: string): AgentRecord | null;
  /** All records, optionally scoped to one project. */
  list(projectId?: string): AgentRecord[];
  /** Records matching a query (handle/role/capability/project). */
  find(query: AgentFindQuery): AgentRecord[];
  /** Subscribe to any mutation (upsert/drop). Returns a dispose function. */
  onChanged(listener: () => void): () => void;
}

export function createAgentRegistryStore(): IAgentRegistryStore {
  const records = new Map<string, AgentRecord>();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  /**
   * Pick a handle unique among OTHER live sessions in the same scope. When a
   * `teamLaunchId` is present the scope narrows to that squad; otherwise it
   * spans the whole project — so two independent squads using the same personas
   * each get their own unsuffixed handle. The record being upserted is excluded
   * so re-registering keeps its own name. Suffix scheme: `base`, `base-2`,
   * `base-3`, … — first free wins. Dedup keys off authoritative handles only.
   */
  function dedupeHandle(
    desired: string,
    projectId: string,
    ownSessionId: string,
    teamLaunchId: string | undefined
  ): string {
    const taken = new Set<string>();
    for (const rec of records.values()) {
      if (rec.sessionId === ownSessionId) continue;
      if (rec.projectId !== projectId) continue;
      if (teamLaunchId !== undefined && rec.teamLaunchId !== teamLaunchId) continue;
      if (rec.handle) taken.add(rec.handle);
    }
    if (!taken.has(desired)) return desired;
    for (let n = 2; ; n += 1) {
      const candidate = `${desired}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  function upsert(input: AgentUpsertInput): AgentRecord {
    const existing = records.get(input.sessionId);
    // teamLaunchId is set once (on the first seed from a team launch) and never
    // overwritten by a later handle-less auto-seed, same pattern as `handle`.
    const teamLaunchId = input.teamLaunchId ?? existing?.teamLaunchId;
    // An explicit handle (register_agent) is deduped and becomes authoritative;
    // a handle-less upsert (auto-seed) must NEVER clear a previously-registered
    // handle — it only refreshes the display-only fields.
    const handle =
      input.handle !== undefined
        ? dedupeHandle(input.handle, input.projectId, input.sessionId, teamLaunchId)
        : existing?.handle;
    const record: AgentRecord = {
      sessionId: input.sessionId,
      projectId: input.projectId,
      cwd: input.cwd,
      handle,
      // displayName refreshes when provided; otherwise keep the last one.
      displayName: input.displayName ?? existing?.displayName,
      // Soft fields are preserved across a re-seed that omits them, so the
      // auto-seed's bare upsert can't wipe an agent's registered role/caps.
      role: input.role ?? existing?.role,
      capabilities: input.capabilities ?? existing?.capabilities,
      // Preserve the original registration time across updates.
      registeredAt: existing?.registeredAt ?? Date.now(),
      teamLaunchId
    };
    records.set(input.sessionId, record);
    emitter.emit('changed');
    return record;
  }

  function drop(sessionId: string): boolean {
    const removed = records.delete(sessionId);
    if (removed) emitter.emit('changed');
    return removed;
  }

  function get(sessionId: string): AgentRecord | null {
    return records.get(sessionId) ?? null;
  }

  function list(projectId?: string): AgentRecord[] {
    const all = [...records.values()];
    return projectId ? all.filter((r) => r.projectId === projectId) : all;
  }

  function find(query: AgentFindQuery): AgentRecord[] {
    const matches = list(query.projectId).filter((r) => {
      // Squad scoping: when the query carries a teamLaunchId, only return agents
      // from the same launch. This keeps two squads in the same project isolated.
      if (query.teamLaunchId !== undefined && r.teamLaunchId !== query.teamLaunchId) {
        return false;
      }
      // A name query matches the authoritative handle first, then falls back to
      // the displayName so an auto-seeded (unregistered) peer is still findable
      // by its tab title.
      if (query.handle !== undefined && r.handle !== query.handle && r.displayName !== query.handle) {
        return false;
      }
      if (query.role !== undefined && r.role !== query.role) return false;
      if (query.capability !== undefined && !(r.capabilities ?? []).includes(query.capability)) {
        return false;
      }
      return true;
    });
    // Precedence: an authoritative `handle` match always ranks ahead of a
    // displayName-only match, so callers taking `[0]` resolve to the registered
    // peer rather than an unregistered one whose drifting tab title happens to
    // collide with that handle. displayName is never deduped, so without this a
    // colliding title could silently steal `agent_send` delivery. Stable within
    // each rank (insertion order preserved), and a no-op when no handle query.
    if (query.handle !== undefined) {
      const rank = (r: AgentRecord) => (r.handle === query.handle ? 0 : 1);
      return matches
        .map((r, i) => ({ r, i }))
        .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
        .map(({ r }) => r);
    }
    return matches;
  }

  function onChanged(listener: () => void): () => void {
    emitter.on('changed', listener);
    return () => {
      emitter.off('changed', listener);
    };
  }

  return { upsert, drop, get, list, find, onChanged };
}
