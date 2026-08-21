/**
 * Shapes shared between the zana-hub main module and its renderer panel.
 *
 * These are SMALL projections of the on-disk `~/.zana/*.json` records — only
 * the fields the dashboard renders. The full records carry much more; main
 * reads defensively and narrows to these so the renderer contract stays stable
 * even as Zana's on-disk schema evolves.
 */

/** A reusable team template (`~/.zana/teams/<id>.json`). */
export interface ZanaTeamSummary {
  id: string;
  name: string;
  icon?: string;
  /** One-line team description, if declared. */
  description?: string;
  /** Number of declared roster slots. */
  slots: number;
  /** Total workers across slots (Σ slot.quantity) — the real headcount. */
  workerTotal: number;
  /** Compact roster preview, e.g. "architect · backend-dev×2 · test-writer". */
  roster?: string;
  /** Concurrency ceiling from `rules.maxConcurrentWorkers` (or maxTotalWorkers). */
  maxWorkers?: number;
  autoStart: boolean;
  updatedAt?: string;
}

/** A reusable launch profile / persona (`~/.zana/profiles/<id>.json`). */
export interface ZanaProfileSummary {
  id: string;
  /** Human name — Zana stores it as `displayName` (falls back to `name`, then id). */
  name: string;
  icon?: string;
  model?: string;
  /** Grouping category, e.g. "engineering" | "ops". */
  category?: string;
  /** One-line role description, if declared. */
  description?: string;
}

/** A reusable skill (`~/.zana/skills/<id>.json`). */
export interface ZanaSkillSummary {
  id: string;
  name: string;
  /** e.g. "instruction" | "mcp" | … — free-form so new kinds don't break us. */
  type?: string;
  enabled: boolean;
  description?: string;
}

/** A sprint (`~/.zana/sprints/_index.json`). */
export interface ZanaSprintSummary {
  id: string;
  status: string;
  updatedAt?: string;
}

/** A spawned agent run (`~/.zana/runs/<id>.json`). */
export interface ZanaRunSummary {
  id: string;
  profileName?: string;
  profileIcon?: string;
  /** "running" | "errored" | "completed" | … (Zana's run state). */
  state: string;
  model?: string;
  mode?: string;
  lastAction?: string;
  spawnedAt?: number;
  lastActivity?: number;
}

/** Which catalog/activity kind a detail request targets. */
export type ZanaDetailKind = 'team' | 'profile' | 'skill' | 'run';

/**
 * One labelled field in a detail view. `block: true` marks a long, multi-line
 * value (a system prompt, skill content, an initial prompt, a run result) that
 * the panel renders in a scrollable monospace box rather than on the label row.
 */
export interface ZanaDetailField {
  label: string;
  value: string;
  /** Render as a full-width, pre-wrapped block (long text) rather than inline. */
  block?: boolean;
}

/**
 * The full record behind one Teams/Profiles/Skills/Runs row, read on demand
 * when the user clicks it. Main curates an ORDERED, bounded field list from the
 * on-disk JSON (long values capped, known-huge buffers dropped) so the renderer
 * stays dumb and the payload stays small.
 */
export interface ZanaDetail {
  kind: ZanaDetailKind;
  id: string;
  title: string;
  icon?: string;
  fields: ZanaDetailField[];
}

/** The whole-framework snapshot the panel renders in one shot. */
export interface ZanaHubOverview {
  /** Whether a `~/.zana` directory was found at all. */
  present: boolean;
  /** Reusable catalog. */
  teams: ZanaTeamSummary[];
  profiles: ZanaProfileSummary[];
  skills: ZanaSkillSummary[];
  /** Live-ish work. */
  sprints: ZanaSprintSummary[];
  /** Recent agent runs (newest first, bounded). */
  runs: ZanaRunSummary[];
  /** Run-state tally across ALL runs read (not just the returned slice). */
  runStateCounts: Record<string, number>;
  /** Count of registered persistent workers (`~/.zana/workers.json`). */
  workerCount: number;
  /** Count of in-flight autopilot goals (`~/.zana/automation-state.json`). */
  autopilotGoalCount: number;
  /** Non-fatal read problems, surfaced so the panel can hint at partial data. */
  warnings: string[];
}

/** One roster slot in a team template. */
export interface ZanaTeamSlot {
  profileId: string;
  quantity: number;
}

/**
 * The FULL editable team template — the shape the editor form binds to and
 * `saveTeam` accepts. `id` absent ⇒ create (a slug is minted from `name`).
 * `slots` is the source of truth; `workerProfileIds` / `maxTotalWorkers` are
 * derived on save and are NOT part of this input shape.
 */
export interface ZanaTeamTemplate {
  id?: string;
  name: string;
  icon?: string;
  description?: string;
  orchestratorProfileId?: string;
  slots: ZanaTeamSlot[];
  initialPrompt?: string;
  /** → rules.maxConcurrentWorkers (independent of slot totals). */
  maxConcurrentWorkers?: number;
  autoStart?: boolean;
}

/** A profile option for the slot / orchestrator dropdowns. */
export interface ZanaProfileOption {
  id: string;
  displayName: string;
  icon?: string;
}

/**
 * The FULL editable profile template — the shape the profile editor form binds
 * to and `saveProfile` accepts. `id` absent ⇒ create (a UUID is minted for the
 * filename, mirroring Zana's own convention). Unknown/unedited keys on the
 * existing file are preserved round-trip by the normalizer.
 */
export interface ZanaProfileTemplate {
  id?: string;
  displayName: string;
  icon?: string;
  description?: string;
  category?: string;
  model?: string;
  effortLevel?: string;
  permissionMode?: string;
  systemPrompt?: string;
  /** One tool matcher per entry (e.g. `Read`, `mcp__plugin_codesearch_codesearch__*`). */
  allowedTools: string[];
  disallowedTools: string[];
}

/** `getProfile` result: the editable projection PLUS the raw parsed object so
 * `saveProfile` can merge onto it and preserve unknown keys round-trip. */
export interface GetProfileResult {
  template: ZanaProfileTemplate;
  raw: Record<string, unknown>;
}

/** `saveProfile` result — never throws; failure is data. */
export type SaveProfileResult = { ok: true; id: string } | { ok: false; error: string };

/** `getTeam` result: the editable projection PLUS the raw parsed object so
 * `saveTeam` can merge onto it and preserve unknown keys round-trip. */
export interface GetTeamResult {
  template: ZanaTeamTemplate;
  raw: Record<string, unknown>;
}

/** `saveTeam` result — never throws; failure is data. */
export type SaveTeamResult = { ok: true; id: string } | { ok: false; error: string };
