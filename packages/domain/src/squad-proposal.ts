/**
 * Pure types and helpers for Squad launch proposals: an agent in a PTY or
 * thread proposes a Squad run, the user reviews it in the composer, and main
 * launches it. No I/O; shared by main, the MCP tools and the renderer.
 */
import { z } from 'zod';
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
  | 'NO_ORCHESTRATOR' | 'HOST_UNSUPPORTED' | 'SOURCE_NOT_ALLOWED' | 'SOURCE_NOT_FILE'
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
  /** Path inside the project, or the `~`-abbreviated absolute path of a file outside it. */
  relPath: string;
  bytes: number;
  /** The file is outside the project (under HOME or the clone root); absent for files inside it. */
  outsideProject?: boolean;
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

const timestamp = z.number().finite().nonnegative();

/**
 * A persisted proposal record, checked in full before the ledger is trusted. It checks types
 * and structure only: input caps live in `squad_propose`, so a release that changes a cap (or a
 * downgrade) never discards stored proposals. Unknown keys are allowed (a newer Zana may add some).
 */
export const squadProposalRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  proposer: z.object({ kind: z.enum(['pty', 'thread']), id: z.string().min(1), title: z.string().optional() }),
  teamId: z.string().min(1),
  goal: z.string().min(1),
  planning: z.enum(['infer', 'provided']),
  sources: z.array(z.object({
    path: z.string().min(1),
    relPath: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    outsideProject: z.boolean().optional()
  })),
  title: z.string().optional(),
  summary: z.string().optional(),
  planSteps: z.array(z.object({
    id: z.string().min(1),
    title: z.string(),
    dependencies: z.array(z.string()),
    writeScope: z.array(z.string())
  })).optional(),
  state: z.enum(['pending', 'launched', 'dismissed', 'expired']),
  inboxEntryId: z.string().optional(),
  executionId: z.string().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
  expiresAt: timestamp
}).refine((record) => record.state !== 'launched' || typeof record.executionId === 'string', {
  message: 'a launched proposal names its execution'
});

export interface SquadProposalResult {
  proposalId: string;
  inboxEntryId: string;
  team: { id: string; name: string; workers: number; orchestrator: string };
  planning: SquadPlanning;
  plan: { steps: Array<{ id: string; title: string }> } | null;
  sources: Array<{ path: string; bytes: number; outsideProject?: boolean }>;
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
  /** `path` and `outsideProject` are set for a file outside the project, so the composer can show where it is. */
  sources: Array<{ id: string; name: string; byteSize: number; expiresAt: number; path?: string; outsideProject?: boolean }>;
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
