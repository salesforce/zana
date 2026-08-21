/**
 * Zana disk-extension — main-process capability provider.
 *
 * This is the successor to the former `zana` BUILT-IN main module. The old
 * module read Zana's work-tracking data straight off disk (native
 * `better-sqlite3` + a JSON fallback under `.zana/`). That native dependency is
 * built against Electron's ABI and cannot cross the disk-extension
 * `utilityProcess` boundary, so the whole read/write path now goes through
 * ZANA'S OWN MCP SERVER (`zana-mcp-server`) instead:
 *
 *   capability → ctx.mcp('zana', <tool>, <args>, { projectPath | useGlobal })
 *
 * The host owns a persistent, per-workspace `zana-mcp-server` stdio child pool
 * (`src/main/zana/mcp-pool.ts`); `ctx.mcp` forwards a brokered call to it (gated
 * by the `mcp` permission + `mcpAllowlist: ["zana"]`). The pool realpath-confines
 * the supplied `projectPath` against a registered project (Rules 1 & 2) BEFORE
 * routing, and boots zana core in-process with `ZANA_WORKSPACE` set — so an
 * unregistered/escaping path never spawns a child, and there is no native SQLite
 * in THIS process at all.
 *
 * Capabilities (unchanged renderer contract — same 7 the built-in exposed):
 *   - getSnapshot(opts?)  → ZanaSnapshot   (tickets + sprints + artifacts + KPIs,
 *                           composed from zana_ticket_list / zana_sprint_list /
 *                           zana_artifact_list; KPIs computed here as before)
 *   - getTicket(opts)     → ZanaTicketDetail | null   (zana_ticket_get)
 *   - getArtifact(opts)   → ZanaArtifact | null        (zana_artifact_read)
 *   - listProfiles()      → ZanaProfile[]               (zana_list_profiles, global)
 *   - getProfile(opts)    → ZanaProfileDetail | null    (zana_get_profile)
 *   - assignTicket(opts)  → ZanaTicketDetail            (zana_ticket_assign; the
 *                           server appends the audit entry + bumps updatedAt, so
 *                           the legacy JS read-modify-write + per-file mutex are
 *                           GONE. We re-read via zana_ticket_get for the detail.)
 *   - initProject(opts)   → { created: boolean }         (ctx.mcpInitWorkspace;
 *                           the explicit "Init Zana" button — creates `.zana/`
 *                           for a project that has none. `ZANA_AUTO_INIT` stays
 *                           disabled globally so opening the board never
 *                           silently inits a project — only this button does.)
 *   - getVersionInfo()    → ZanaVersionInfo   (brokered ctx.exec('npm') +
 *                           ctx.fetch(registry.npmjs.org) — unchanged in spirit)
 *
 * Trust: `projectPath`/`useGlobal` are ADVISORY hints forwarded verbatim to the
 * host pool, which authorizes them (Rule 1/2). This module makes NO path trust
 * decision and joins no paths — it never touches the filesystem for ticket data.
 * `getVersionInfo` is the only fs-adjacent path and it only shells `npm` + hits
 * the public npm registry, both brokered + scope-gated.
 *
 * Degradation: `zana-mcp-server` may be absent (not installed / not on PATH). A
 * brokered `ctx.mcp` call then REJECTS with a typed "unavailable" error; each
 * read capability maps that to an honest empty state (empty snapshot / null),
 * never a crash. Only `assignTicket` surfaces the failure (a write the user
 * initiated must not silently no-op).
 */

import type { MainModule, MainModuleContext } from '@zana-ai/zcc-extension-sdk/main';
import {
  type ZanaArtifact,
  type ZanaAuditEntry,
  type ZanaKpis,
  type ZanaProfile,
  type ZanaProfileDetail,
  type ZanaSnapshot,
  type ZanaSource,
  type ZanaSprint,
  type ZanaTicket,
  type ZanaTicketDetail,
  type ZanaVersionInfo,
  isClosedZanaStatus
} from '@shared/zana-types';

/** Window for the `throughput7d` KPI. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Bounded, safe shape for a renderer-supplied `actor` recorded in a ticket's
 * persisted audit log: letters/digits/space plus `_.@-`, 1–64 chars. Rejects
 * control chars, newlines, and oversized blobs that could pollute the log.
 * (Retained from the built-in; the actor is still renderer-supplied.)
 */
const SAFE_ACTOR_RE = /^[\w .@-]{1,64}$/;
/**
 * A ticket/artifact id flows into an MCP `arguments` field the server uses to
 * key a lookup; keep it a bare uuid with no path semantics (anchored, so any
 * `/`, `\`, `..`, or absolute prefix fails). Mirrors the built-in's guard —
 * defence-in-depth even though the server also validates.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Log = MainModuleContext['log'];

/** The source-scope hints every source-scoped capability accepts. */
interface SourceOpts {
  projectPath?: string;
  useGlobal?: boolean;
}

/** Reject a missing or non-bare-uuid id before it reaches the server. */
function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Translate {@link SourceOpts} into the `ctx.mcp` opts. A `useGlobal` (or a
 * missing projectPath) selects the fixed HOME (`~`) workspace child; a
 * projectPath selects the confined project child.
 */
function mcpOpts(opts: SourceOpts): { projectPath?: string; useGlobal?: boolean } {
  if (opts.useGlobal || !opts.projectPath) return { useGlobal: true };
  return { projectPath: opts.projectPath };
}

/**
 * Synthesize the `ZanaSource` descriptor the snapshot carries. The RENDERER
 * never reads `snapshot.source` (verified), but the type requires it and it's
 * cheap + honest to fill: the resolved `.zana` PATH is host-side (we don't get
 * it back from the pool), so `path` is left empty and `label`/`kind` reflect the
 * requested scope. If a future UI needs the concrete path, add a pool call.
 */
function describeSource(opts: SourceOpts): ZanaSource {
  const useGlobal = opts.useGlobal || !opts.projectPath;
  return {
    kind: useGlobal ? 'global' : 'project',
    label: useGlobal ? 'Global (~/.zana)' : 'Project',
    path: ''
  };
}

/**
 * The raw ticket shape `zana_ticket_list` / `zana_ticket_get` return (a subset
 * of the on-disk ticket). Every field is optional/untrusted — the server owns
 * the schema, and we normalise defensively into the shared `ZanaTicket`.
 */
function mapTicket(raw: any): ZanaTicket | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '(untitled)',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    priority: typeof raw.priority === 'string' ? raw.priority : undefined,
    assigneeName: typeof raw.assigneeName === 'string' ? raw.assigneeName : undefined,
    assigneeId: typeof raw.assigneeId === 'string' ? raw.assigneeId : undefined,
    assigneeProfileId: typeof raw.assigneeProfileId === 'string' ? raw.assigneeProfileId : undefined,
    sprintId: typeof raw.sprintId === 'string' ? raw.sprintId : undefined,
    labels: Array.isArray(raw.labels) ? raw.labels.filter((l: unknown) => typeof l === 'string') : [],
    blockedBy: Array.isArray(raw.blockedBy) ? raw.blockedBy.filter((b: unknown) => typeof b === 'string') : [],
    type: typeof raw.type === 'string' ? raw.type : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    closedAt: typeof raw.closedAt === 'string' ? raw.closedAt : undefined,
    resultSummary: typeof raw.resultSummary === 'string' ? raw.resultSummary : undefined,
    comments: Array.isArray(raw.comments)
      ? raw.comments
          .filter((c: any) => c && typeof c.body === 'string')
          .map((c: any) => ({
            author: typeof c.author === 'string' ? c.author : undefined,
            body: c.body,
            createdAt: typeof c.createdAt === 'string' ? c.createdAt : undefined
          }))
      : undefined
  };
}

/** Normalise one raw `audit[]` entry, coercing fields and tolerating garbage. */
function mapAuditEntry(raw: any): ZanaAuditEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry: ZanaAuditEntry = {
    action: typeof raw.action === 'string' ? raw.action : String(raw.action ?? '')
  };
  if (typeof raw.id === 'string') entry.id = raw.id;
  if (typeof raw.actor === 'string') entry.actor = raw.actor;
  if (typeof raw.timestamp === 'string') entry.timestamp = raw.timestamp;
  if (raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details)) {
    entry.details = raw.details as Record<string, unknown>;
  }
  return entry;
}

/** Normalise a raw ticket into a ZanaTicketDetail (base + audit + heavier fields). */
function mapTicketDetail(raw: any): ZanaTicketDetail | null {
  const base = mapTicket(raw);
  if (!base) return null;
  const audit = Array.isArray(raw.audit)
    ? raw.audit.map(mapAuditEntry).filter((e: ZanaAuditEntry | null): e is ZanaAuditEntry => e !== null)
    : [];
  return {
    ...base,
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : undefined,
    reworkCount: typeof raw.reworkCount === 'number' ? raw.reworkCount : undefined,
    reviewPhase: typeof raw.reviewPhase === 'string' ? raw.reviewPhase : undefined,
    audit
  };
}

/** Normalise a raw artifact object into a ZanaArtifact (content may be absent). */
function mapArtifact(raw: any): ZanaArtifact | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '(untitled)',
    type: typeof raw.type === 'string' ? raw.type : undefined,
    content: typeof raw.content === 'string' ? raw.content : '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: unknown) => typeof t === 'string') : [],
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : undefined,
    linkedTickets: Array.isArray(raw.linkedTickets)
      ? raw.linkedTickets.filter((t: unknown) => typeof t === 'string')
      : [],
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined
  };
}

/** Normalise a raw sprint into a ZanaSprint, deriving ticket counts from `tickets`. */
function mapSprint(raw: any, tickets: ZanaTicket[]): ZanaSprint | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const matching = tickets.filter((t) => t.sprintId === raw.id);
  const openCount = matching.filter((t) => !isClosedZanaStatus(t.status, t.closedAt)).length;
  return {
    id: raw.id,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    name: typeof raw.name === 'string' && raw.name ? raw.name : `Sprint ${raw.id.slice(0, 8)}`,
    ticketCount: matching.length,
    openCount
  };
}

/**
 * Normalise a raw profile (from `zana_list_profiles`) into a ZanaProfile. The
 * server's list shape carries `displayName` + `origin` (enriched upstream); we
 * tolerate the older `name`-only shape as a fallback so a stale server still
 * renders (origin then defaults to 'builtin').
 */
function mapProfile(raw: any): ZanaProfile | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const toolList = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((t: unknown): t is string => typeof t === 'string') : undefined;
  const displayName =
    (typeof raw.displayName === 'string' && raw.displayName) ||
    (typeof raw.name === 'string' && raw.name) ||
    raw.id;
  return {
    id: raw.id,
    displayName,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    icon: typeof raw.icon === 'string' ? raw.icon : undefined,
    category: typeof raw.category === 'string' ? raw.category : undefined,
    origin: raw.origin === 'workspace' ? 'workspace' : 'builtin',
    model: typeof raw.model === 'string' ? raw.model : undefined,
    allowedTools: toolList(raw.allowedTools),
    disallowedTools: toolList(raw.disallowedTools)
  };
}

/** Normalise a raw profile into full detail (base + prompt + heavier fields). */
function mapProfileDetail(raw: any): ZanaProfileDetail | null {
  const base = mapProfile(raw);
  if (!base) return null;
  return {
    ...base,
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : undefined,
    permissionMode: typeof raw.permissionMode === 'string' ? raw.permissionMode : undefined,
    effortLevel: typeof raw.effortLevel === 'string' ? raw.effortLevel : undefined
  };
}

/** Compute aggregate KPIs over the loaded data (unchanged from the built-in). */
function computeKpis(
  tickets: ZanaTicket[],
  sprints: ZanaSprint[],
  artifacts: ZanaArtifact[]
): ZanaKpis {
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let openTickets = 0;
  let closedTickets = 0;
  let blockedTickets = 0;
  let throughput7d = 0;
  const cutoff = Date.now() - SEVEN_DAYS_MS;

  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    if (t.priority) byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    const closed = isClosedZanaStatus(t.status, t.closedAt);
    if (closed) {
      closedTickets += 1;
      if (t.closedAt) {
        const ts = Date.parse(t.closedAt);
        if (!Number.isNaN(ts) && ts >= cutoff) throughput7d += 1;
      }
    } else {
      openTickets += 1;
      if (t.blockedBy.length > 0) blockedTickets += 1;
    }
  }

  return {
    totalTickets: tickets.length,
    openTickets,
    closedTickets,
    blockedTickets,
    byStatus,
    byPriority,
    sprintCount: sprints.length,
    artifactCount: artifacts.length,
    throughput7d
  };
}

/** Descending string compare on optional ISO timestamps (missing sorts last). */
function byDateDesc(a?: string, b?: string): number {
  return (b ?? '').localeCompare(a ?? '');
}

/** The npm package whose version the version-check reports on. */
const ZANA_PACKAGE = '@zana-ai/mcp';
const ZANA_UPGRADE_COMMAND = `npm install -g ${ZANA_PACKAGE}@latest`;

export const zanaMainModule: MainModule = {
  id: 'zana',
  setup(ctx) {
    const { log } = ctx;

    // The brokered MCP capability is the ONLY data path. Without it (a
    // `{storage, log}`-only host, or the `mcp` permission unmet) the module
    // can't read anything — fail closed at setup, mirroring the built-in's
    // resolveProjectRoot guard, so a misconfigured host registers zero caps
    // rather than silently returning empty boards.
    const mcp = ctx.mcp;
    if (!mcp) {
      throw new Error(
        'zana: ctx.mcp is required (host MCP pool backs the zana data path); refusing to run without it'
      );
    }

    /** Call a zana MCP tool for the given source scope, returning parsed JSON. */
    const call = <T = unknown>(tool: string, args: Record<string, unknown>, opts: SourceOpts) =>
      mcp('zana', tool, args, mcpOpts(opts)) as Promise<T>;

    return {
      /**
       * THE main capability: compose a full snapshot from one `.zana` root by
       * fanning three MCP list calls in parallel, then computing KPIs here (as
       * the built-in did). A `zana-mcp-server` failure degrades to an EMPTY
       * snapshot (never throws) so the board renders an honest empty state.
       */
      async getSnapshot(opts?: SourceOpts): Promise<ZanaSnapshot> {
        const src = opts ?? {};
        const source = describeSource(src);
        // Separate from the list calls below: a workspace with no `.zana/` yet
        // makes every `zana_*_list` call fail identically to one that's
        // initialized-but-empty (both degrade to `[]` in the catch below), so
        // the panel needs this independent signal to tell the two apart rather
        // than showing the "Init Zana" CTA forever even after a successful init.
        // Tolerant: `mcpIsWorkspaceInitialized` is optional and never throws
        // (mirrors `mcpInitWorkspace`'s own tolerant contract) — defaults to
        // `false` (never-initialized) so a host without it fails toward showing
        // the CTA rather than silently hiding it.
        const isInitialized = ctx.mcpIsWorkspaceInitialized
          ? await ctx.mcpIsWorkspaceInitialized(mcpOpts(src)).catch(() => false)
          : false;
        try {
          const [rawTickets, rawArtifacts, rawSprints] = await Promise.all([
            call<any[]>('zana_ticket_list', {}, src),
            call<any[]>('zana_artifact_list', {}, src),
            call<any[]>('zana_sprint_list', {}, src)
          ]);
          const tickets = (Array.isArray(rawTickets) ? rawTickets : [])
            .map(mapTicket)
            .filter((t): t is ZanaTicket => t !== null);
          const artifacts = (Array.isArray(rawArtifacts) ? rawArtifacts : [])
            .map(mapArtifact)
            .filter((a): a is ZanaArtifact => a !== null);
          const sprints = (Array.isArray(rawSprints) ? rawSprints : [])
            .map((s) => mapSprint(s, tickets))
            .filter((s): s is ZanaSprint => s !== null);
          tickets.sort((a, b) => byDateDesc(a.updatedAt, b.updatedAt));
          artifacts.sort((a, b) => byDateDesc(a.createdAt, b.createdAt));
          const kpis = computeKpis(tickets, sprints, artifacts);
          return { source, kpis, tickets, sprints, artifacts, isInitialized };
        } catch (err) {
          // zana-mcp-server unavailable / tool error → honest empty snapshot.
          log('getSnapshot failed (zana MCP unavailable?)', err);
          return {
            source,
            kpis: computeKpis([], [], []),
            tickets: [],
            sprints: [],
            artifacts: [],
            isInitialized
          };
        }
      },

      /** Read one ticket's FULL detail (incl. audit). Null when not found / unavailable. */
      async getTicket(opts: SourceOpts & { id: string }): Promise<ZanaTicketDetail | null> {
        if (!opts || !isSafeId(opts.id)) return null;
        try {
          const raw = await call<any>('zana_ticket_get', { ticketId: opts.id }, opts);
          // A not-found is a `{ error }` envelope, not a ticket object.
          if (!raw || typeof raw !== 'object' || 'error' in raw) return null;
          return mapTicketDetail(raw);
        } catch (err) {
          log(`getTicket failed (${opts.id})`, err);
          return null;
        }
      },

      /** Read one artifact (content fetched on demand). Null when not found / unavailable. */
      async getArtifact(opts: SourceOpts & { id: string }): Promise<ZanaArtifact | null> {
        if (!opts || !isSafeId(opts.id)) return null;
        try {
          const raw = await call<any>('zana_artifact_read', { artifactId: opts.id }, opts);
          if (!raw || typeof raw !== 'object' || 'error' in raw) return null;
          return mapArtifact(raw);
        } catch (err) {
          log(`getArtifact failed (${opts.id})`, err);
          return null;
        }
      },

      /**
       * List ALL agent profiles (built-in + workspace). Profiles are GLOBAL in
       * zana (not project-scoped), so this always targets the global child.
       * Sorted by category then displayName. Degrades to [] on failure.
       */
      async listProfiles(): Promise<ZanaProfile[]> {
        try {
          const raw = await call<any[]>('zana_list_profiles', {}, { useGlobal: true });
          const profiles = (Array.isArray(raw) ? raw : [])
            .map(mapProfile)
            .filter((p): p is ZanaProfile => p !== null);
          profiles.sort((a, b) => {
            const cat = (a.category ?? '').localeCompare(b.category ?? '');
            return cat !== 0 ? cat : a.displayName.localeCompare(b.displayName);
          });
          return profiles;
        } catch (err) {
          log('listProfiles failed', err);
          return [];
        }
      },

      /** Read one profile's FULL detail (incl. system prompt). Null when not found. */
      async getProfile(opts: { id: string }): Promise<ZanaProfileDetail | null> {
        if (!opts || typeof opts.id !== 'string' || !opts.id) return null;
        try {
          const raw = await call<any>('zana_get_profile', { profileId: opts.id }, { useGlobal: true });
          if (!raw || typeof raw !== 'object' || 'error' in raw) return null;
          return mapProfileDetail(raw);
        } catch (err) {
          log(`getProfile failed (${opts.id})`, err);
          return null;
        }
      },

      /**
       * WRITE capability: set or clear a ticket's assignee via the server's
       * `zana_ticket_assign` tool (added upstream), then re-read the full detail.
       *
       * The server owns the audit-entry append + `updatedAt` bump + persistence,
       * so the legacy JS read-modify-write, atomic tmp+rename, and per-file mutex
       * are GONE — the cross-process race the built-in only bounded is now the
       * server's single-writer concern.
       *
       * Assignment rules (mapped onto the tool's `{ profileId, assigneeName }`):
       *   - profileId non-empty → assign to that profile.
       *   - assigneeName only   → free-text assign (profileId omitted).
       *   - neither             → unassign (both omitted).
       * `actor` is sanitised before it's forwarded (the server stamps it into the
       * audit entry). Unlike reads, a failure THROWS: a user-initiated write must
       * surface, not silently no-op.
       */
      async assignTicket(
        opts: SourceOpts & {
          id: string;
          profileId?: string | null;
          assigneeName?: string;
          actor?: string;
        }
      ): Promise<ZanaTicketDetail> {
        if (!opts || !isSafeId(opts.id)) {
          throw new Error('A ticket id is required');
        }
        const profileId =
          typeof opts.profileId === 'string' && opts.profileId ? opts.profileId : undefined;
        const assigneeName =
          typeof opts.assigneeName === 'string' && opts.assigneeName ? opts.assigneeName : undefined;
        const actor =
          typeof opts.actor === 'string' && SAFE_ACTOR_RE.test(opts.actor) ? opts.actor : undefined;

        try {
          // The server appends the audit entry + persists; we don't inspect its
          // return beyond an error envelope, then re-read the canonical detail.
          const res = await call<any>(
            'zana_ticket_assign',
            {
              ticketId: opts.id,
              // Only include the fields the mode uses so the server's
              // three-way (assign / free-text / unassign) branch reads cleanly.
              ...(profileId !== undefined ? { profileId } : {}),
              ...(assigneeName !== undefined ? { assigneeName } : {}),
              ...(actor !== undefined ? { assignedBy: actor } : {})
            },
            opts
          );
          if (res && typeof res === 'object' && 'error' in res && res.error) {
            throw new Error(String(res.error));
          }
          const detail = await call<any>('zana_ticket_get', { ticketId: opts.id }, opts);
          const mapped =
            detail && typeof detail === 'object' && !('error' in detail)
              ? mapTicketDetail(detail)
              : null;
          if (!mapped) throw new Error('Failed to read Zana ticket back after assignment');
          return mapped;
        } catch (err) {
          if (err instanceof Error) throw err;
          log(`assignTicket failed (${opts.id})`, err);
          throw new Error('Failed to assign Zana ticket');
        }
      },

      /**
       * WRITE capability backing the explicit "Init Zana" button: create the
       * `.zana/` skeleton (tickets/sprints/artifacts/plans/audit/sessions/runs/
       * events/scheduler/tmp + a config.json) for the current project via
       * `ctx.mcpInitWorkspace`. Idempotent (a no-op if already initialized).
       * Unlike reads, a failure THROWS — a user-initiated write must surface.
       */
      async initProject(opts: SourceOpts): Promise<{ created: boolean }> {
        if (!ctx.mcpInitWorkspace) {
          throw new Error('zana: init is unavailable (host has no MCP pool)');
        }
        try {
          return await ctx.mcpInitWorkspace(mcpOpts(opts ?? {}));
        } catch (err) {
          if (err instanceof Error) throw err;
          log('initProject failed', err);
          throw new Error('Failed to initialize the Zana workspace');
        }
      },

      /**
       * Report the installed vs. latest `@zana-ai/mcp` version. Uses the BROKERED
       * `ctx.exec('npm', …)` (scope `execAllowlist: ["npm"]`) + `ctx.fetch`
       * against the npm registry (scope `egressAllowlist: ["registry.npmjs.org"]`)
       * — no raw Node here (this is the untrusted disk-ext tier). Both reads are
       * tolerant; the capability never throws, so the settings panel always gets a
       * renderable result even offline / npm-less / without the brokered caps.
       */
      async getVersionInfo(): Promise<ZanaVersionInfo> {
        const [installed, latest] = await Promise.all([
          readInstalledZanaVersion(ctx, log),
          readLatestZanaVersion(ctx, log)
        ]);
        const updateAvailable = !!installed && !!latest && installed !== latest;
        let error: string | undefined;
        if (!installed && !latest) error = 'Could not read the installed or latest version.';
        else if (!installed) error = 'Zana MCP does not appear to be installed globally.';
        else if (!latest) error = 'Could not reach the npm registry to check for updates.';
        return {
          package: ZANA_PACKAGE,
          installed,
          latest,
          updateAvailable,
          upgradeCommand: ZANA_UPGRADE_COMMAND,
          error
        };
      }
    };
  }
};

/**
 * Read the globally-installed `@zana-ai/mcp` version via the brokered
 * `ctx.exec('npm', ['ls','-g',…,'--json'])`. Returns null when the broker cap is
 * absent, npm is missing, the package isn't installed globally, or the output
 * can't be parsed — never throws.
 */
async function readInstalledZanaVersion(ctx: MainModuleContext, log: Log): Promise<string | null> {
  if (!ctx.exec) return null;
  try {
    const res = await ctx.exec({
      bin: 'npm',
      args: ['ls', '-g', ZANA_PACKAGE, '--depth=0', '--json'],
      timeoutMs: 5000
    });
    // `npm ls` exits non-zero when the package is absent but still prints JSON;
    // parse stdout regardless of code.
    const parsed = JSON.parse(res.stdout) as {
      dependencies?: Record<string, { version?: string }>;
    };
    const v = parsed.dependencies?.[ZANA_PACKAGE]?.version;
    return typeof v === 'string' && v ? v : null;
  } catch (err) {
    log('readInstalledZanaVersion failed', err);
    return null;
  }
}

/**
 * Read the latest published `@zana-ai/mcp` version from the npm registry via the
 * brokered `ctx.fetch` (host applies the egress allowlist). Returns null on any
 * missing-cap / network / parse failure.
 */
async function readLatestZanaVersion(ctx: MainModuleContext, log: Log): Promise<string | null> {
  if (!ctx.fetch) return null;
  try {
    const res = await ctx.fetch(
      `https://registry.npmjs.org/${encodeURIComponent(ZANA_PACKAGE)}/latest`,
      { headers: { accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const body = JSON.parse(res.body) as { version?: string };
    return typeof body.version === 'string' && body.version ? body.version : null;
  } catch (err) {
    log('readLatestZanaVersion failed', err);
    return null;
  }
}
