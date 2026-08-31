/**
 * Minimal type definitions for the CLI, mirroring shapes from
 * `@zana-ai/zcc-domain`. These are the read-only subsets the CLI needs.
 * We declare them here instead of importing the domain package to keep the
 * package self-contained and avoid path-mapping complexity.
 */

// MIRROR of core's `packages/domain/src/launch-provider.ts` VALID_PROFILES. Kept in sync
// by `src/main/__tests__/profile-completeness.guard.test.ts` — add a profile in
// core and this list must match, or the guard fails.
export type LaunchProfileId =
  | 'shell'
  | 'claude'
  | 'claude-resume'
  | 'claude-yolo'
  | 'cursor'
  | 'cursor-resume'
  | 'cursor-yolo'
  | 'codex'
  | 'codex-resume'
  | 'codex-yolo'
  | 'pi'
  | 'pi-resume'
  | 'opencode'
  | 'opencode-resume';

export interface Project {
  id: string;
  name: string;
  path: string;
  tag?: string;
  color?: string;
  createdAt: number;
  lastActiveAt: number;
  remote?: ProjectRemote;
}

export interface ProjectRemote {
  host: string;
  user?: string;
  remotePath?: string;
}

export interface Persona {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  baseProfile?: LaunchProfileId;
  model?: 'opus' | 'sonnet' | 'haiku' | 'default';
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  appendSystemPrompt?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  addDirs?: string[];
  mcpServers?: string[];
  initialPrompt?: string;
  source?: 'builtin' | 'user' | { projectId: string; projectName?: string };
}

/**
 * Non-sensitive persona metadata as returned by the `persona.list` control-plane
 * op (mirrors the app-side `PersonaSummary`). The CLI resolves `--persona <name>`
 * against this; it never needs the launch internals.
 */
export interface PersonaSummary {
  id: string;
  name: string;
  description?: string;
  baseProfile?: LaunchProfileId;
  model?: 'opus' | 'sonnet' | 'haiku' | 'default';
}

/**
 * Non-sensitive team metadata as returned by the `team.list` control-plane op
 * (mirrors the app-side `TeamSummary`). Read-only and agent-allowed — carries no
 * launch internals, just enough to list the team catalogue.
 */
export interface TeamSummary {
  id: string;
  name: string;
  description?: string;
  /** Number of slot rows (NOT the total tab count — slots may have quantity > 1). */
  slotCount: number;
}

export type InboxNotifyLevel = 'silent' | 'quiet' | 'loud';

export interface ScheduleStatus {
  lastRunAt?: string;
  lastRunResult?: 'success' | 'error' | 'skipped';
  lastRunSessionId?: string;
  nextRunAt?: string;
  runCount: number;
  runs: ScheduleRun[];
}

export interface ScheduleRun {
  id?: string;
  at: string;
  result: 'success' | 'error' | 'skipped';
  sessionId?: string;
  durationMs?: number;
  finishedAt?: string;
  message?: string;
  report?: string;
  reportedAt?: string;
  reportStatus?: 'success' | 'partial' | 'failure';
}

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  projectId: string;
  profile: LaunchProfileId;
  personaId?: string;
  extraArgs?: string[];
  prompt?: string;
  schedule: {
    every: string;
  };
  overlap: 'skip';
  history: {
    retain: number;
  };
  status: ScheduleStatus;
  createdAt: string;
  updatedAt: string;
  source?: 'global' | { projectId: string };
  inboxLevel?: InboxNotifyLevel;
  autoCloseOnFinish?: boolean;
  maxDurationMinutes?: number;
  group?: string;
}

export type FollowUpStatus = 'open' | 'resolved' | 'dismissed';
export type FollowUpKind = 'question' | 'decision' | 'note';

/**
 * Read-only subset of the app-side `FollowUp` (see `@zana-ai/zcc-domain`).
 * Follow-ups are file-backed (one JSON per record under `~/.zcc/followups` or
 * `<project>/.zcc/followups`), so the CLI reads them directly — no running app
 * required, same as schedules / inbox.
 */
export interface FollowUp {
  id: string;
  projectId: string;
  title: string;
  detail?: string;
  kind: FollowUpKind;
  status: FollowUpStatus;
  origin:
    | { source: 'idle-triage'; sessionId: string; confidence?: number }
    | { source: 'agent'; sessionId: string }
    | { source: 'user' };
  sessionId?: string;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  /** Loader-stamped: 'global' or the owning project. Not persisted on disk. */
  source?: 'global' | { projectId: string };
}

export interface InboxDoc {
  path: string;
}

export interface InboxEntry {
  id: string;
  ts: number;
  projectId: string;
  projectLabel?: string;
  docs?: InboxDoc[];
  comments?: string;
  sessionId?: string;
  scheduled?: boolean;
  notify?: InboxNotifyLevel;
}
