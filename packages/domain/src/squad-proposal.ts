/**
 * Pure types and helpers for Squad launch proposals: an agent in a PTY or
 * thread proposes a Squad run, the user reviews it in the composer, and main
 * launches it. No I/O; shared by main, the MCP tools and the renderer.
 */
import type { Persona } from './product.js';

/** How the Squad's plan is produced: the orchestrator infers it, or the goal/sources provide it. */
export type SquadPlanning = 'infer' | 'provided';

export const SQUAD_PROPOSAL_LIMITS = {
  goalChars: 2048,
  titleChars: 256,
  summaryChars: 2048,
  maxSources: 16,
  planTextBytes: 1_048_576,
  maxPendingPerProject: 20,
  maxRecords: 200,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  reportChars: 2048,
  ptyQuietMs: 30_000,
  ptyQueueMax: 10
} as const;

export type SquadProposalErrorCode =
  | 'DISABLED' | 'NOT_LIVE' | 'INVALID' | 'TEAM_NOT_FOUND'
  | 'NO_ORCHESTRATOR' | 'HOST_UNSUPPORTED' | 'SOURCE_OUTSIDE_PROJECT' | 'SOURCE_NOT_FILE'
  | 'SOURCE_TOO_LARGE' | 'TOO_MANY_SOURCES' | 'INVALID_PLAN' | 'ORCHESTRATOR_CANNOT_PLAN'
  | 'PROPOSER_IN_SQUAD' | 'TOO_MANY_PROPOSALS' | 'NOT_FOUND' | 'EXPIRED' | 'NOT_PENDING'
  | 'SOURCE_UNREADABLE';

export interface SquadProposalInput {
  teamId: string;
  goal: string;
  planning?: SquadPlanning;
  sources?: string[];
  title?: string;
  summary?: string;
}

export interface SquadProposer {
  kind: 'pty' | 'thread';
  id: string;
  title?: string;
}

export interface SquadProposalSource {
  /** Realpath of the source file. */
  path: string;
  relPath: string;
  bytes: number;
}

export interface SquadPlanStep {
  id: string;
  title: string;
  dependencies: string[];
  writeScope: string[];
}

export interface SquadProposalRecord {
  id: string;
  projectId: string;
  proposer: SquadProposer;
  teamId: string;
  goal: string;
  planning: SquadPlanning;
  sources: SquadProposalSource[];
  title?: string;
  summary?: string;
  planSteps?: SquadPlanStep[];
  state: 'pending' | 'launched' | 'dismissed' | 'expired';
  inboxEntryId?: string;
  executionId?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface SquadProposalResult {
  proposalId: string;
  inboxEntryId: string;
  team: { id: string; name: string; workers: number; orchestrator: string };
  planning: SquadPlanning;
  plan: { steps: Array<{ id: string; title: string }> } | null;
  sources: Array<{ path: string; bytes: number }>;
  expiresAt: number;
}

export type SquadPlanCheckResult =
  | { ok: true; steps: SquadPlanStep[] }
  | { ok: false; reason: string };

/** Safe renderer projection that pre-fills the composer from a proposal. */
export interface SquadLaunchPrefill {
  proposalId: string;
  projectId: string;
  teamId: string;
  coordinationMode: 'freeform' | 'structured';
  goal: string;
  title?: string;
  summary?: string;
  sources: Array<{ id: string; name: string; byteSize: number; expiresAt: number }>;
  proposerTitle?: string;
  planStepCount?: number;
}

export function planningToCoordinationMode(p: SquadPlanning): 'freeform' | 'structured' {
  return p === 'provided' ? 'structured' : 'freeform';
}

/**
 * Whether a persona can write files, i.e. can be trusted to infer and record a
 * plan. `allowedTools` is ignored: it is not strict in interactive mode. Only a
 * bare `Write`/`Edit` deny counts; path-scoped entries such as `Write(~/.zcc/**)` don't.
 */
export function personaCanWriteFiles(
  p: Pick<Persona, 'deniedTools' | 'permissionMode' | 'executionState' | 'codexSandbox'>
): boolean {
  const denied = p.deniedTools ?? [];
  if (denied.includes('Write') || denied.includes('Edit')) return false;
  if (p.permissionMode === 'plan') return false;
  if (p.executionState === 'plan') return false;
  if (p.codexSandbox === 'read-only') return false;
  return true;
}
