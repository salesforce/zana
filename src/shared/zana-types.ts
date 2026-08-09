/**
 * Shared Zana domain types — used by both the main capability (which fills
 * them from on-disk `.zana/` JSON files) and the renderer panel (which renders
 * them). Plain data only; safe to import from either process (no node/react).
 *
 * Zana stores work-tracking as plain JSON under a `.zana/` dir — there is no
 * daemon or MCP to talk to. The main module reads those files directly and
 * shapes them into the types below.
 */

/** One comment on a ticket. Best-effort: `comments[]` is often empty. */
export interface ZanaComment {
  /** Display name of the author, when recorded. */
  author?: string;
  /** Comment text. */
  body: string;
  /** ISO timestamp the comment was created. */
  createdAt?: string;
}

/** One Zana ticket (`.zana/tickets/<uuid>/ticket.json`), lightly normalised. */
export interface ZanaTicket {
  /** Stable ticket id (the dir uuid / `ticket.json` `id`). */
  id: string;
  title: string;
  description?: string;
  /** Free-string status, e.g. `backlog`, `in-progress`, `done`. */
  status: string;
  priority?: string;
  /** Display name of the assignee, when set. */
  assigneeName?: string;
  /** Raw assignee id (an actor/agent id), when set. Mirrored from `ticket.json`. */
  assigneeId?: string;
  /** Id of the profile this ticket is assigned to, when set. Mirrored from `ticket.json`. */
  assigneeProfileId?: string;
  /** Id of the sprint this ticket belongs to, when set. */
  sprintId?: string;
  /** Free-form labels. Always an array (defaults to `[]`). */
  labels: string[];
  /** Ids of tickets blocking this one. Always an array (defaults to `[]`). */
  blockedBy: string[];
  /** Ticket type, e.g. `bug`, `feature`, `chore`. */
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  /** ISO timestamp the ticket was closed; null/absent while open. */
  closedAt?: string;
  /** Short summary written when the ticket was resolved. */
  resultSummary?: string;
  /** Inline comments, when present. */
  comments?: ZanaComment[];
}

/** One entry in a ticket's audit/activity log. */
export interface ZanaAuditEntry {
  id?: string;
  action: string;            // 'created' | 'claimed' | 'status_changed' | …
  actor?: string;
  details?: Record<string, unknown>;
  timestamp?: string;
}

/** Full ticket detail (snapshot ticket + the heavier on-demand fields). */
export interface ZanaTicketDetail extends ZanaTicket {
  createdBy?: string;
  reworkCount?: number;
  reviewPhase?: string;
  audit: ZanaAuditEntry[];   // chronological as stored
}

/**
 * A Zana sprint (`.zana/sprints/_index.json` entry). Sprints are lightweight;
 * a sprint's tickets are found by matching `ZanaTicket.sprintId`, so the
 * counts below are derived in the main module rather than stored on disk.
 */
export interface ZanaSprint {
  id: string;
  status?: string;
  updatedAt?: string;
  /** Display name (falls back to a short form of the id when unnamed). */
  name?: string;
  /** Total tickets matching this sprint id (derived). */
  ticketCount?: number;
  /** Of those, how many are still open (derived). */
  openCount?: number;
}

/**
 * A generated documentation artifact (`.zana/artifacts/<uuid>.json`). The
 * `content` markdown can be large, so the snapshot ships artifacts with
 * content inlined but the panel may also fetch a single one on demand.
 */
export interface ZanaArtifact {
  id: string;
  title: string;
  /** Artifact type, e.g. `design-doc`, `requirement-spec`, `architecture-doc`. */
  type?: string;
  /** Markdown body. May be empty when the file omits it. */
  content: string;
  /** Free-form tags. Always an array (defaults to `[]`). */
  tags: string[];
  /** Who/what generated the artifact. */
  createdBy?: string;
  /** Ticket ids this artifact documents. Always an array (defaults to `[]`). */
  linkedTickets: string[];
  createdAt?: string;
}

/**
 * A Zana agent profile. Profiles come from two places, distinguished by
 * `origin`:
 *   - 'workspace' — a user file under `~/.zana/profiles/<id>.json`
 *   - 'builtin'   — shipped inside the installed `@zana-ai/core` package
 * Drives the assignment picker and the Profiles view. The list payload omits
 * the (potentially large) `systemPrompt`; use {@link ZanaProfileDetail} for it.
 */
export interface ZanaProfile {
  id: string;
  displayName: string;
  description?: string;
  icon?: string;       // emoji
  category?: string;
  /** Where the profile is defined: a workspace file or a Zana built-in. */
  origin: 'workspace' | 'builtin';
  /** Model the profile runs on, e.g. `sonnet`/`opus`, when declared. */
  model?: string;
  /** Tool names the profile is explicitly allowed to use, when declared. */
  allowedTools?: string[];
  /** Tool names the profile is explicitly denied, when declared. */
  disallowedTools?: string[];
}

/** Full profile detail incl. the (potentially large) system prompt. */
export interface ZanaProfileDetail extends ZanaProfile {
  /** The profile's system prompt. Can be large; kept out of the list payload. */
  systemPrompt?: string;
  /** Permission mode, e.g. `default`/`acceptEdits`/`bypassPermissions`. */
  permissionMode?: string;
  /** Reasoning effort level, when declared. */
  effortLevel?: string;
}

/**
 * One assignment choice an assignee picker can emit:
 *   - { kind: 'profile' } → assign to a workspace profile
 *   - { kind: 'name' }    → assign to a free-text name (no profile)
 *   - { kind: 'clear' }   → unassign
 *
 * A domain type (the assign payload), shared by the `useTickets` store (B3) and
 * the assign-picker view (C4). Lives here so neither imports the other.
 */
export type AssignChoice =
  | { kind: 'profile'; profileId: string; displayName: string }
  | { kind: 'name'; assigneeName: string }
  | { kind: 'clear' };

/** Aggregate metrics computed over the loaded tickets/sprints/artifacts. */
export interface ZanaKpis {
  totalTickets: number;
  openTickets: number;
  closedTickets: number;
  /** Open tickets that have at least one entry in `blockedBy`. */
  blockedTickets: number;
  /** Ticket counts keyed by raw status string. */
  byStatus: Record<string, number>;
  /** Ticket counts keyed by priority (tickets without a priority are skipped). */
  byPriority: Record<string, number>;
  sprintCount: number;
  artifactCount: number;
  /** Tickets whose `closedAt` falls within the last 7 days. */
  throughput7d?: number;
}

/**
 * Describes where a snapshot's data was read from. A workspace can have its
 * own `.zana/`; otherwise the main module falls back to the global `~/.zana/`.
 */
export interface ZanaSource {
  /** `project` = a workspace `.zana/`; `global` = `~/.zana/`. */
  kind: 'project' | 'global';
  /** Human label for the source toggle (notes a fallback when relevant). */
  label: string;
  /** Absolute path to the resolved `.zana/` dir. */
  path: string;
}

/** A project the panel can scope to, with cheap probe results for the rail. */
export interface ZanaProjectSource {
  id: string;            // project id ('' for the global entry)
  name: string;          // display label ('Global' for ~/.zana)
  path: string;          // project path ('' for global)
  hasZana: boolean;      // a .zana/ dir exists
  openTickets: number;   // open-ticket count for the rail badge
  kind: 'global' | 'project';
}

/** Everything the panel needs for one render, from one source. */
export interface ZanaSnapshot {
  source: ZanaSource;
  kpis: ZanaKpis;
  /** Tickets sorted by `updatedAt` descending. */
  tickets: ZanaTicket[];
  sprints: ZanaSprint[];
  /** Artifacts sorted by `createdAt` descending. */
  artifacts: ZanaArtifact[];
  /**
   * Whether this source's `.zana/` skeleton already exists on disk. Distinct
   * from "arrays are empty" — a freshly-`Init`-ed workspace has zero
   * tickets/sprints/artifacts too, so the panel needs this to tell "never
   * initialized" (show the Init Zana CTA) from "initialized, nothing in it
   * yet" (show a plain empty board) instead of showing the CTA forever.
   */
  isInitialized: boolean;
}

/**
 * Result of the `getVersionInfo` capability: the locally-installed Zana MCP
 * package version vs. the latest published on npm. Either field is null when it
 * couldn't be determined (not installed / offline); `updateAvailable` is only
 * true when both are known and differ.
 */
export interface ZanaVersionInfo {
  /** The npm package this reports on (`@zana-ai/mcp`). */
  package: string;
  /** Globally-installed version, or null when not installed / unreadable. */
  installed: string | null;
  /** Latest version published to npm, or null when the registry check failed. */
  latest: string | null;
  /** True only when both versions are known and `installed !== latest`. */
  updateAvailable: boolean;
  /** The one-line shell command that upgrades the global install. */
  upgradeCommand: string;
  /** Set when the check partially failed, for a muted hint in the UI. */
  error?: string;
}

/** Statuses we treat as terminal/closed when `closedAt` isn't set. */
const CLOSED_STATUSES = new Set([
  'done',
  'closed',
  'completed',
  'cancelled',
  'canceled',
  'rejected'
]);

/**
 * Whether a ticket is closed. A non-null `closedAt` always wins; otherwise the
 * raw status is matched (case-insensitively) against a known closed-set.
 */
export function isClosedZanaStatus(status: string, closedAt?: string | null): boolean {
  if (closedAt) return true;
  return CLOSED_STATUSES.has((status ?? '').trim().toLowerCase());
}
