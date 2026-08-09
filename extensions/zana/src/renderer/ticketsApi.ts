/**
 * The zana extension's data seam — the SINGLE place that routes ticket / sprint
 * / artifact / profile data from the renderer bundle to the extension's OWN main
 * capability provider (`../main/zana-main.ts`).
 *
 * WHY `host.call` (not the raw `window.cc.modules.call('zana', …)` bus): after
 * the plugins→extensions migration, zana is a full DISK EXTENSION — main +
 * renderer in one bundle. Its data no longer lives in a core built-in reached
 * cross-module; it lives in this extension's own out-of-process main child,
 * which maps each capability onto zana's MCP server (host-managed stdio pool).
 * `ModuleHost.call(cap, arg)` forwards over the same multiplexed IPC channel but
 * also surfaces the host's crash-relaunch error ("Extension zana crashed —
 * relaunch to retry"), which now matters because the provider is a killable
 * child rather than an in-process built-in.
 *
 * The host bridge lives OUTSIDE the React tree (the `useTickets` store is a
 * module singleton), so we read it lazily via the SDK's `getModuleHost()`
 * accessor (W1-7), primed by `activate({ host })` — never from a prop. This
 * replaced the per-extension `host-holder.ts` hack. `host.call(cap, arg)` maps
 * to `window.cc.modules.call('<this-ext-id>', cap, [arg])` internally, so main
 * still receives its options object as a one-element array and re-authorizes
 * every source path: `projectPath`/`useGlobal` below are ADVISORY hints only
 * (Rule 1). Do NOT add renderer-side path trust.
 *
 * Statelessness: this wrapper caches nothing and accumulates nothing — read
 * bounds (`MAX_TICKETS`, …) and snapshot ownership live in main / the store.
 *
 * Scope: the extension's Tickets view is PER-PROJECT — it scopes to ONE project
 * via `{ kind: 'project' }`. `{ kind: 'global' }` is retained ONLY for the
 * Profiles sub-tab / `~/.zana` fallback.
 */

import type {
  ZanaSnapshot,
  ZanaTicketDetail,
  ZanaArtifact,
  ZanaProfile,
  ZanaProfileDetail,
  ZanaVersionInfo
} from '@shared/zana-types';
import { getModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';

/**
 * Resolve the live host bridge. `getModuleHost()` returns `null` until
 * `activate({ host })` has primed it — reaching the data seam before that is a
 * loader ordering bug (the store never fires a read before the panel mounts), so
 * we throw with a diagnostic rather than silently no-op a capability call.
 */
function hostOrThrow() {
  const host = getModuleHost();
  if (!host) {
    throw new Error(
      'zana extension: host bridge unavailable — the host must call activate({ host }) before any capability call.'
    );
  }
  return host;
}

/** Call a capability on this extension's own main provider via the host bridge. */
function callZana<T>(capability: string, arg?: unknown): Promise<T> {
  return arg === undefined
    ? hostOrThrow().call<T>(capability)
    : hostOrThrow().call<T>(capability, arg);
}

/**
 * Which `.zana` root a call targets. The view is per-project; `global` is the
 * `~/.zana` fallback used by the Profiles sub-tab only.
 */
export type TicketSource =
  | { kind: 'global' }
  | { kind: 'project'; projectPath: string };

/**
 * Shape a {@link TicketSource} into the `{ projectPath?, useGlobal? }` hint pair
 * every source-scoped capability expects.
 */
function srcArgs(s: TicketSource): { projectPath?: string; useGlobal?: boolean } {
  return s.kind === 'global'
    ? { useGlobal: true }
    : { projectPath: s.projectPath, useGlobal: false };
}

/** Read a full snapshot from one `.zana` root. */
export function getSnapshot(src: TicketSource): Promise<ZanaSnapshot> {
  return callZana<ZanaSnapshot>('getSnapshot', srcArgs(src));
}

/** Read one ticket's FULL detail (incl. audit). Null when not found. */
export function getTicket(src: TicketSource, id: string): Promise<ZanaTicketDetail | null> {
  return callZana<ZanaTicketDetail | null>('getTicket', { ...srcArgs(src), id });
}

/** Read one artifact (large `content` fetched on demand). Null when not found. */
export function getArtifact(src: TicketSource, id: string): Promise<ZanaArtifact | null> {
  return callZana<ZanaArtifact | null>('getArtifact', { ...srcArgs(src), id });
}

/** List all agent profiles (built-in + workspace). Global-only — no source. */
export function listProfiles(): Promise<ZanaProfile[]> {
  return callZana<ZanaProfile[]>('listProfiles');
}

/** Read one profile's full detail (incl. system prompt). Payload is `{ id }`. */
export function getProfile(id: string): Promise<ZanaProfileDetail | null> {
  return callZana<ZanaProfileDetail | null>('getProfile', { id });
}

/** Patch applied by {@link assignTicket}; `actor` is caller-supplied (main defaults it). */
export type AssignPatch = { profileId?: string | null; assigneeName?: string; actor?: string };

/** Set/clear a ticket's assignee; returns the re-read detail (throws on not-found). */
export function assignTicket(
  src: TicketSource,
  id: string,
  patch: AssignPatch
): Promise<ZanaTicketDetail> {
  return callZana<ZanaTicketDetail>('assignTicket', { ...srcArgs(src), id, ...patch });
}

/** Installed vs. latest `@zana-ai/mcp` version. No args. */
export function getVersionInfo(): Promise<ZanaVersionInfo> {
  return callZana<ZanaVersionInfo>('getVersionInfo');
}

/**
 * Explicit, user-initiated init: create `.zana/` for this source's root if it
 * doesn't already exist (the "Init Zana" empty-state button). Idempotent —
 * `{created:false}` when the workspace was already initialized. Throws on
 * failure (unlike the read capabilities above).
 */
export function initProject(src: TicketSource): Promise<{ created: boolean }> {
  return callZana<{ created: boolean }>('initProject', srcArgs(src));
}

/**
 * Aggregate namespace so consumers (the store, views, version check) import ONE
 * symbol instead of reaching for the host bridge themselves.
 */
export const ticketsApi = {
  getSnapshot,
  getTicket,
  getArtifact,
  listProfiles,
  getProfile,
  assignTicket,
  getVersionInfo,
  initProject
} as const;
