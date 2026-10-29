import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { MAX_BLOCKER_ANSWER_BYTES, type ExecutionCohortBinding, type ExecutionRequestV1, type ExecutionService } from './service.js';
import type { ExecutionRecord } from './store.js';
import { EXECUTION_HANDOFF_OPERATION, EXECUTION_RESUME_MONITOR_OPERATION, type createExecutionHandoffStore } from './handoff-store.js';
import { MAX_TEAM_INITIAL_TASK_BYTES } from '../launch/team-lifecycle-store.js';
import { isWithin } from '@zana-ai/zcc-path-confine';
import { EXECUTION_FAILURE_CODES, EXECUTION_FAILURE_DETAIL_MAX_CHARS } from '@zana-ai/zcc-domain/product';
import { LAUNCH_REVIEW_REQUIRED_MESSAGE, type LaunchApproval } from '@zana-ai/zcc-domain/squad-proposal';
import { MAX_EXECUTION_PLAN_BYTES, validOutputDeclaration } from './contracts.js';
import { assembledResultProjection } from './projection.js';

const slotSchema = z.strictObject({
  initialTask: z.string().min(1).refine(
    (value) => Buffer.byteLength(value, 'utf8') <= MAX_TEAM_INITIAL_TASK_BYTES,
    { message: `initialTask must not exceed ${MAX_TEAM_INITIAL_TASK_BYTES} UTF-8 bytes` }
  ),
  automatedSkillIds: z.array(z.string().min(1).max(256)).max(64).optional()
});
const workflowSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profileId: z.string().min(1).max(256),
  profileVersion: z.string().min(1).max(256),
  controller: z.strictObject({
    personaId: z.string().min(1).max(256),
    slotId: z.string().min(1).max(256)
  }),
  workers: z.array(z.strictObject({
    role: z.string().min(1).max(256),
    personaId: z.string().min(1).max(256),
    slotId: z.string().min(1).max(256)
  })).max(64),
  supportedRequestVersions: z.array(z.number().int().min(1).max(100)).min(1).max(8)
});
const workUnitSchema = z.strictObject({
  id: z.string().min(1).max(2048), title: z.string().min(1).max(2048), task: z.string().min(1).max(16384),
  dependencies: z.array(z.string().min(1).max(2048)).max(100), preferredRole: z.string().min(1).max(2048).optional(),
  files: z.array(z.string().min(1).max(2048)).max(100).optional(), verification: z.array(z.string().min(1).max(2048)).max(100).optional(), readOnly: z.boolean().optional(),
  requires: z.strictObject({
    skills: z.array(z.string().min(1).max(256)).max(50).optional(),
    mcpServers: z.array(z.string().min(1).max(256)).max(50).optional()
  }).optional(),
  routing: z.strictObject({
    version: z.literal(1), taskClass: z.string().min(1).max(2048).optional(),
    minimumLevel: z.enum(['low', 'medium', 'high', 'extra-high']).optional(),
    requiredCapabilities: z.array(z.string().min(1).max(2048)).max(100).optional(),
    requiredModalities: z.array(z.string().min(1).max(2048)).max(100).optional(),
    estimatedContextBytes: z.number().int().min(0).max(8 * 1024 * 1024).optional(),
    requiredRole: z.string().min(1).max(2048).optional(), preferredRole: z.string().min(1).max(2048).optional(),
    hardSlotId: z.string().min(1).max(2048).optional()
  }).optional(),
  output: z.unknown().refine(validOutputDeclaration, { message: 'invalid bounded output declaration' }).optional()
});
const executionStartSchema = z.strictObject({
  version: z.literal(1),
  launchKind: z.literal('team').optional(),
  launchDisplay: z.strictObject({ label: z.string().min(1).max(240) }).optional(),
  teamId: z.string().min(1),
  launchRequestId: z.string().min(1).max(256),
  jobTitle: z.string().min(1).max(240).optional(),
  summary: z.string().min(1).max(2048).optional(),
  slots: z.array(slotSchema).min(1).max(100),
  deadlineMs: z.number().int().min(1).max(24 * 60 * 60 * 1000).optional(),
  maxConcurrent: z.number().int().min(1).max(32).optional(),
  maxLaunches: z.number().int().min(1).max(32).optional(),
  maxTurnsPerClaim: z.number().int().min(1).max(10_000).optional(),
  maxClaimWallClockMs: z.number().int().min(1_000).max(24 * 60 * 60 * 1000).optional(),
  usageBudget: z.strictObject({ maxTokens: z.number().int().min(1).optional(), maxUsd: z.number().positive().optional() }).optional(),
  worktree: z.boolean().optional(),
  /**
   * Existing user-owned target, resolved by main against the registered project's own
   * git worktrees. Names a branch, never a path; conflicts with `worktree: true`.
   */
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('project-root') }),
    z.strictObject({ kind: z.literal('worktree'), branch: z.string().min(1).max(200) })
  ]).optional(),
  workflow: workflowSchema.optional(),
  workUnits: z.array(workUnitSchema).min(1).max(100).optional(),
  /**
   * true: the owner gets a [Squad report] when the run ends or needs a human answer. Opt-in, so
   * an existing owner that polls execution.snapshot keeps exactly what it had.
   */
  notify: z.boolean().optional()
});
const executionStartFileSchema = z.strictObject({
  requestPath: z.string().min(1).max(2048)
});
const executionStartInputSchema = z.union([executionStartSchema, executionStartFileSchema]);
const MAX_START_REQUEST_FILE_BYTES = 8 * 1024 * 1024;
const MAX_START_WORK_UNITS_BYTES = 512 * 1024;

const executionIdSchema = { executionId: z.string().min(1).max(2048) };
const executionControlSchema = { ...executionIdSchema, expectedStateVersion: z.number().int().min(0) };
const executionResumeRunSchema = { ...executionControlSchema, replay: z.boolean().optional() };
const executionRetainedRecoverySchema = { ...executionControlSchema, mode: z.enum(['exact-native', 'fresh-plan']) };
const executionEventsSchema = { ...executionIdSchema, after: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() };
const executionSnapshotSchema = { ...executionIdSchema, after: z.number().int().min(0).optional() };
const executionProducerEventSchema = {
  ...executionIdSchema,
  eventId: z.string().min(1).max(2048),
  slotId: z.string().min(1).max(2048).optional(),
  producerRole: z.enum(['worker', 'orchestrator']).optional(),
  type: z.enum(['progress', 'blocker', 'failure', 'outcome']),
  severity: z.enum(['info', 'warning', 'error']),
  summary: z.string().min(1).max(2048),
  detail: z.string().min(1).max(2048).optional(),
  blocker: z.object({ question: z.string().min(1).max(2048), options: z.array(z.string().min(1).max(2048)).max(20).optional() }).optional(),
  attention: z.boolean().optional(),
  progress: z.object({ completed: z.number().int().min(0), total: z.number().int().min(0) }).refine((value) => value.completed <= value.total).optional(),
  references: z.array(z.object({ label: z.string().min(1).max(2048), uri: z.string().min(1).max(2048) })).max(20).optional()
};
const executionMessageSchema = { ...executionControlSchema, slotId: z.string().min(1).max(2048), message: z.string().min(1).max(64 * 1024) };
/** Same cap as ExecutionService.deliverToBlocker (one shared constant), checked here so the caller gets the real reason. */
const executionRespondSchema = {
  ...executionIdSchema,
  expectedStateVersion: z.number().int().min(0).optional().describe('Required with slotId. Optional with blockerId: omitted means the latest state.'),
  slotId: z.string().min(1).max(2048).optional().describe('The slot to message. Pass slotId or blockerId, not both.'),
  blockerId: z.string().min(1).max(2048).optional().describe('A human blocker of this run to answer, as named in its [Squad report].'),
  clientRequestId: z.string().min(1).max(256).optional().describe('Idempotency key for a blocker answer; generated when omitted.'),
  message: z.string().min(1).max(64 * 1024)
};
const executionCompleteSchema = { ...executionIdSchema, summary: z.string().min(1).max(64 * 1024) };
const executionArtifactSchema = { ...executionIdSchema, name: z.string().min(1).max(512), mediaType: z.string().min(1).max(512), content: z.string().min(1).max(64 * 1024) };
const executionPlanSchema = { ...executionIdSchema, workUnits: z.array(workUnitSchema).min(1).max(100) };
const claimFenceSchema = z.object({ claimId: z.string().min(1).max(2048), claimGeneration: z.number().int().min(1) }).partial().refine(
  (value) => (value.claimId === undefined) === (value.claimGeneration === undefined),
  { message: 'claimId and claimGeneration must be provided together' }
).shape;
const executionWorkSchema = { ...executionIdSchema, workUnitId: z.string().min(1).max(2048), assignedSlotId: z.string().min(1).max(2048).optional(), ...claimFenceSchema };
const executionWorkHeartbeatSchema = {
  ...executionIdSchema,
  workUnitId: z.string().min(1).max(2048),
  claimId: z.string().min(1).max(2048),
  claimGeneration: z.number().int().min(1),
  turnCount: z.number().int().min(0).max(10_000).optional()
};
const executionWorkAssignSchema = { ...executionIdSchema, workUnitId: z.string().min(1).max(2048), assignedSlotId: z.string().min(1).max(2048) };
// No schema max on `result`: any over-cap result must reach the handler so it names the real limit.
// A schema max never bounded memory (the transport parses the body before validation), and the
// store keeps at most MAX_STRING characters, so dropping the old 64 KiB bound loses no protection.
const EXECUTION_RESULT_MAX_CHARS = 2048;
const executionWorkResultSchema = { ...executionWorkSchema, result: z.string().min(1), structuredResult: z.unknown().optional() };
const executionWorkFailureSchema = {
  ...executionWorkSchema,
  failure: z.string().min(1).max(EXECUTION_FAILURE_DETAIL_MAX_CHARS),
  failureCode: z.enum(EXECUTION_FAILURE_CODES).optional()
};
const executionWorkBlockSchema = { ...executionWorkSchema, blockerId: z.string().min(1).max(2048), question: z.string().min(1).max(2048), options: z.array(z.string().min(1).max(2048)).max(20).optional(), audience: z.enum(['human', 'coordinator']).optional() };
const executionWorkAnswerSchema = { ...executionIdSchema, blockerId: z.string().min(1).max(2048), answer: z.string().min(1).max(MAX_BLOCKER_ANSWER_BYTES) };
const executionDeliveryAckSchema = {
  deliveryId: z.string().min(1).max(2048), leaseId: z.string().min(1).max(2048), delivered: z.boolean(),
  error: z.string().min(1).max(1024).optional()
};
const executionSourceListSchema = { ...executionIdSchema, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(16).optional() };
const executionSourceReadSchema = { ...executionIdSchema, sourceId: z.string().min(1).max(2048), offset: z.number().int().min(0).optional(), maxBytes: z.number().int().min(1).max(64 * 1024).optional() };
const handoffRequestSchema = {
  targetSessionId: z.string().min(1).max(2048), ...executionIdSchema,
  operations: z.array(z.literal(EXECUTION_HANDOFF_OPERATION)).length(1)
};
const handoffExecuteSchema = {
  token: z.string().min(1).max(2048), ...executionControlSchema,
  action: z.enum(['stop', 'respond', 'resume']),
  slotId: z.string().min(1).max(2048).optional(),
  message: z.string().min(1).max(64 * 1024).optional()
};
const resumeMonitorRequestSchema = { targetSessionId: z.string().min(1).max(2048), ...executionIdSchema };
const monitorRequestSchema = { targetSessionId: z.string().min(1).max(2048), ...executionIdSchema };
const resumeMonitorExecuteSchema = { token: z.string().min(1).max(2048), ...executionMessageSchema };
const monitorStatusSchema = { token: z.string().min(1).max(2048), ...executionIdSchema };
const monitorEventsSchema = { ...monitorStatusSchema, after: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() };
const resumeBindingSchema = { ...executionIdSchema, token: z.string().min(1).max(2048) };
const mintResumeGrantSchema = executionIdSchema;
const revokeResumeGrantSchema = { ...executionIdSchema, effectiveOwnerPrincipalId: z.string().min(1).max(2048).optional() };

export interface ExecutionMemberFence {
  bindingId: string;
  generation: number;
}

export type ExecutionRouteBinding = ExecutionCohortBinding & { memberFence?: ExecutionMemberFence };

export const EXECUTION_MEMBER_TOOL_NAMES = {
  worker: [
    'execution.snapshot', 'execution.event', 'execution.work.claim', 'execution.work.heartbeat',
    'execution.work.complete', 'execution.work.fail', 'execution.work.block', 'execution.work.release',
    'execution.delivery.pull', 'execution.delivery.ack'
  ],
  orchestrator: [
    'execution.snapshot', 'execution.event', 'execution.plan.register', 'execution.work.assign',
    'execution.work.dispatch_ready', 'execution.work.retry', 'execution.work.answer',
    'execution.source.list', 'execution.source.read', 'execution.complete'
  ]
} as const;

export interface RegisterExecutionToolOptions {
  sessionId?: string;
  projectId: string;
  /** Host-resolved display name only; never accepted from an MCP caller. */
  projectName?: string;
  service: ExecutionService;
  /** Live cohort route gate; owner launch authority stays separate. */
  validateRouteIdentity?: (sessionId: string, projectId: string) => boolean | Promise<boolean>;
  /**
   * ASYNC owner-session gate for start / snapshot / resume_binding.
   * Accepts a live pty session OR a live Modern thread. Falls back to the
   * pty-only gate when unset so existing callers stay byte-identical.
   */
  validateOwnerRouteIdentity?: (sessionId: string, projectId: string) => boolean | Promise<boolean>;
  /** Expected generation from the trusted Modern forwarder route, never tool args. */
  memberFence?: ExecutionMemberFence;
  resolveCohortBinding?: (sessionId: string, projectId: string, memberFence?: ExecutionMemberFence) => ExecutionRouteBinding | undefined | Promise<ExecutionRouteBinding | undefined>;
  validateRecoveryBinding?: (sessionId: string, binding: ExecutionCohortBinding) => Promise<boolean>;
  handoffs?: ReturnType<typeof createExecutionHandoffStore>;
  validateHandoffTarget?: (sourceSessionId: string, targetSessionId: string, projectId: string) => boolean | Promise<boolean>;
  approveHandoff?: (sourceSessionId: string, targetSessionId: string, projectId: string, executionId: string, operation: typeof EXECUTION_HANDOFF_OPERATION | typeof EXECUTION_RESUME_MONITOR_OPERATION) => Promise<boolean>;
  /** How this route's session receives a `[Squad report]`: a CLI Agent PTY (default) or a Modern thread. */
  reportKind?: 'pty' | 'thread';
  /** Host-selected frozen catalogue for this authenticated member route. */
  allowedToolNames?: ReadonlySet<string>;
  /**
   * The launch-approval policy that applies to a Squad in this project. `review`
   * makes `execution.start` refuse so the agent proposes the run for the user to
   * Launch instead. Unwired ⇒ every start is refused (LAUNCH_APPROVAL_UNAVAILABLE).
   */
  resolveLaunchApproval?: (teamId: string, projectId: string) => LaunchApproval | Promise<LaunchApproval>;
}

export { LAUNCH_REVIEW_REQUIRED_MESSAGE };

/** Shared by the CLI Agent and Modern thread `execution.start` tool definitions. */
export const EXECUTION_START_DESCRIPTION =
  'Low-level start of one execution in this live session project (explicit slots, work units, policy). Deprecated for agent use: to launch a group of agents, prefer squad_launch. A launch target or project set to Review before launch refuses this with LAUNCH_REVIEW_REQUIRED. Pass either full request fields or a bounded requestPath. Main authorizes launch slots and stores launch identity before launch.';

function denied(name: string) {
  return { isError: true, content: [{ type: 'text' as const, text: `${name} unavailable: session MCP is not authorized for this live session.` }] };
}

type McpSafeExecutionRecord = Omit<ExecutionRecord, 'deliveries'>;

type BoundSnapshotExecutionRecord = Pick<ExecutionRecord,
  'id' | 'projectId' | 'teamId' | 'launchKind' | 'launchDisplay' | 'jobTitle' | 'summary'
  | 'attempt' | 'state' | 'stateVersion' | 'lastEventSequence' | 'policyResult' | 'workUnits'
  | 'blockers' | 'finalSummary' | 'coordinationMode' | 'createdAt' | 'updatedAt' | 'dismissedAt'
>;

function toMcpSafeExecution(record: ExecutionRecord): McpSafeExecutionRecord {
  const { deliveries: _deliveries, ...safe } = record;
  return sanitizeStructuredResults(safe) as McpSafeExecutionRecord;
}

function toBoundSnapshotExecution(record: ExecutionRecord): BoundSnapshotExecutionRecord {
  const {
    id, projectId, teamId, launchKind, launchDisplay, jobTitle, summary, attempt, state, stateVersion,
    lastEventSequence, policyResult, workUnits, blockers, finalSummary, coordinationMode, createdAt, updatedAt,
    dismissedAt
  } = record;
  return sanitizeStructuredResults({
    id, projectId, teamId, launchKind, launchDisplay, jobTitle, summary, attempt, state, stateVersion,
    lastEventSequence, policyResult, workUnits, blockers, finalSummary, coordinationMode, createdAt, updatedAt,
    dismissedAt
  }) as BoundSnapshotExecutionRecord;
}

function sanitizeStructuredResults(record: Omit<ExecutionRecord, 'deliveries'> | BoundSnapshotExecutionRecord): unknown {
  const { usageObservations: _usageObservations, usageBaseline: _usageBaseline, authorizationContext: _authorizationContext, launchIntent: _launchIntent, ...publicRecord } = record as typeof record & Record<string, unknown>;
  return {
    ...publicRecord,
    ...(record.workUnits ? { workUnits: record.workUnits.map(({ structuredResult: _structuredResult, ...unit }) => unit) } : {}),
    ...('assembledResult' in record && record.assembledResult ? { assembledResult: assembledResultProjection(record as ExecutionRecord) } : {})
  };
}

function hasBoundedWorkUnits(workUnits: unknown): boolean {
  return workUnits === undefined || Buffer.byteLength(JSON.stringify(workUnits), 'utf8') <= MAX_START_WORK_UNITS_BYTES;
}

/** Read and consume an ephemeral request from main's dedicated execution directory. */
export async function readStartRequestFile(
  requestPath: string,
  trustedRoot = join(homedir(), '.zcc', 'execution-requests'),
  fileOps = { lstat, open, realpath, rename, unlink }
): Promise<z.infer<typeof executionStartSchema>> {
  if (!isAbsolute(requestPath)) throw new Error('requestPath must be absolute');
  let root: string;
  let file: string;
  try {
    [root, file] = await Promise.all([fileOps.realpath(trustedRoot), fileOps.realpath(requestPath)]);
  } catch {
    throw new Error('requestPath is unavailable');
  }
  if (!isWithin(file, root) || file === root) throw new Error('requestPath must be within the execution request directory');
  let expected;
  let canonical;
  try {
    canonical = await fileOps.lstat(file);
    expected = await fileOps.lstat(requestPath);
  } catch {
    throw new Error('requestPath is unavailable');
  }
  const claimedPath = join(root, `.consuming-${process.pid}-${randomUUID()}`);
  try {
    await fileOps.rename(requestPath, claimedPath);
  } catch {
    throw new Error('requestPath is unavailable');
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let raw: Buffer;
  try {
    const claimed = await fileOps.lstat(claimedPath);
    if (claimed.dev !== expected.dev || claimed.ino !== expected.ino) {
      throw new Error('requestPath is unavailable');
    }
    if (expected.dev !== canonical.dev || expected.ino !== canonical.ino) {
      throw new Error(`requestPath must be a regular file no larger than ${MAX_START_REQUEST_FILE_BYTES} bytes`);
    }
    try {
      handle = await fileOps.open(claimedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw new Error(`requestPath must be a regular file no larger than ${MAX_START_REQUEST_FILE_BYTES} bytes`);
    }
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.dev !== claimed.dev || metadata.ino !== claimed.ino || metadata.size > MAX_START_REQUEST_FILE_BYTES) {
      throw new Error(`requestPath must be a regular file no larger than ${MAX_START_REQUEST_FILE_BYTES} bytes`);
    }
    raw = Buffer.allocUnsafe(MAX_START_REQUEST_FILE_BYTES + 1);
    let offset = 0;
    while (offset < raw.length) {
      const { bytesRead } = await handle.read(raw, offset, raw.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_START_REQUEST_FILE_BYTES) {
      throw new Error(`requestPath must be a regular file no larger than ${MAX_START_REQUEST_FILE_BYTES} bytes`);
    }
    const afterRead = await handle.stat();
    if (!afterRead.isFile() || afterRead.dev !== metadata.dev || afterRead.ino !== metadata.ino || afterRead.size !== offset
      || afterRead.mtimeMs !== metadata.mtimeMs || afterRead.ctimeMs !== metadata.ctimeMs) {
      throw new Error('requestPath is unavailable');
    }
    raw = raw.subarray(0, offset);
  } finally {
    await handle?.close().catch(() => undefined);
    await fileOps.unlink(claimedPath).catch(() => undefined);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('requestPath must contain valid JSON');
  }
  const parsed = executionStartSchema.safeParse(value);
  if (!parsed.success) throw new Error('requestPath does not contain a valid execution.start request');
  return parsed.data;
}

/** Compact reply for the work outcome tools: the full record is 80-113 KB in real runs. */
export function outcomeAck(record: ExecutionRecord, workUnitId: string) {
  const units = record.workUnits ?? [];
  const unit = units.find((candidate) => candidate.id === workUnitId);
  const count = (...states: string[]) => units.filter((candidate) => states.includes(candidate.state)).length;
  return {
    ok: true as const,
    executionId: record.id,
    executionState: record.state,
    workUnitId,
    status: unit?.state ?? null,
    claimGeneration: unit?.claimGeneration ?? null,
    remaining: { claimed: count('CLAIMED'), pending: count('PENDING', 'READY'), blocked: count('BLOCKED') }
  };
}

export function registerExecutionTools(server: McpServer, options: RegisterExecutionToolOptions): void {
  const authorized = async (): Promise<boolean> => {
    if (!options.sessionId || (await options.validateRouteIdentity?.(options.sessionId, options.projectId)) !== true) return false;
    if (options.memberFence) return true;
    const cohortBinding = await options.resolveCohortBinding?.(options.sessionId, options.projectId);
    return cohortBinding?.memberFence === undefined;
  };
  const ownerAuthorized = async (): Promise<boolean> => {
    if (!options.sessionId || options.memberFence) return false;
    const gate = options.validateOwnerRouteIdentity ?? options.validateRouteIdentity;
    if ((await gate?.(options.sessionId, options.projectId)) !== true) return false;
    const cohortBinding = await options.resolveCohortBinding?.(options.sessionId, options.projectId);
    return cohortBinding?.memberFence === undefined;
  };
  const binding = async (correlationExecutionId?: string): Promise<ExecutionCohortBinding | undefined> => {
    const resolved = options.sessionId ? await options.resolveCohortBinding?.(options.sessionId, options.projectId, options.memberFence) : undefined;
    if (!resolved || resolved.projectId !== options.projectId
      || correlationExecutionId && resolved.executionId !== correlationExecutionId) return undefined;
    if (options.memberFence && (resolved.memberFence?.bindingId !== options.memberFence.bindingId
      || resolved.memberFence?.generation !== options.memberFence.generation)) return undefined;
    if (resolved.slotId === 'orchestrator:recovery'
      && (!options.sessionId || !await options.validateRecoveryBinding?.(options.sessionId, resolved))) return undefined;
    return resolved;
  };
  const boundDenied = (name: string) => ({ isError: true as const, content: [{ type: 'text' as const, text: `${name} failed: session is not bound to this execution.` }] });
  const wrongAuthority = (name: string) => ({
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify({
      code: 'WRONG_AUTHORITY',
      tool: name,
      remediation: 'Use execution.snapshot for bound cohort execution'
    }) }]
  });
  const boundResult = (name: string, value: { ok: boolean; value?: unknown; message?: string }) => value.ok
    ? { content: [{ type: 'text' as const, text: JSON.stringify(value.value && typeof value.value === 'object' && 'id' in value.value ? toMcpSafeExecution(value.value as ExecutionRecord) : value.value) }] }
    : { isError: true, content: [{ type: 'text' as const, text: `${name} failed: ${value.message}` }] };
  const outcomeResult = (name: string, workUnitId: string, value: { ok: boolean; value?: unknown; message?: string }) => {
    const record = value.value as ExecutionRecord | undefined;
    return value.ok && record && typeof record === 'object' && 'id' in record && Array.isArray(record.workUnits)
      ? { content: [{ type: 'text' as const, text: JSON.stringify(outcomeAck(record, workUnitId)) }] }
      : boundResult(name, value);
  };

  // Shared registration wrapper: any handler that throws is logged with tool +
  // project context and returned to the caller as a SANITIZED MCP error, so an
  // internal failure never leaks a stack/message across the MCP boundary.
  const memberNames = new Set<string>(Object.values(EXECUTION_MEMBER_TOOL_NAMES).flat());
  const register: McpServer['registerTool'] = ((name: string, config: unknown, handler: (args: unknown) => unknown) => {
    if (options.memberFence && (!memberNames.has(name) || options.allowedToolNames && !options.allowedToolNames.has(name))) return;
    return server.registerTool(name as never, config as never, (async (args: unknown) => {
      try {
        if (options.memberFence) {
          if (!await authorized()) return denied(name);
          if (name === 'execution.event' && args && typeof args === 'object' && ('slotId' in args || 'producerRole' in args)) return denied(name);
          const bound = await binding((args as { executionId?: string }).executionId);
          if (!bound) return boundDenied(name);
          const allowedByCatalogue = !options.allowedToolNames || options.allowedToolNames.has(name);
          const allowedForRole = EXECUTION_MEMBER_TOOL_NAMES[bound.role]?.some((tool) => tool === name) === true;
          if (!allowedByCatalogue || !allowedForRole) return denied(name);
        }
        return await (handler(args) as Promise<unknown>);
      } catch (error) {
        console.error(`[execution-mcp] tool ${name} failed for project ${options.projectId}`, error);
        return { isError: true, content: [{ type: 'text' as const, text: `${name} failed: internal error.` }] };
      }
    }) as never);
  }) as McpServer['registerTool'];

  register('execution.whoami', {
    description: 'Read this live session MCP route identity. Execution starts in this session project unless a host feature explicitly selects another project.',
    inputSchema: {}
  }, async () => {
    if (!await authorized()) return denied('execution.whoami');
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          projectId: options.projectId,
          ...(options.projectName ? { projectName: options.projectName } : {}),
          sessionLive: true
        })
      }]
    };
  });

  register('execution.plan.register', { description: 'Coordinator registers one bounded durable work DAG.', inputSchema: executionPlanSchema }, async ({ executionId, workUnits }) => {
    if (!await authorized()) return denied('execution.plan.register'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.plan.register');
    if (Buffer.byteLength(JSON.stringify(workUnits), 'utf8') > MAX_EXECUTION_PLAN_BYTES) return boundResult('execution.plan.register', { ok: false, message: `execution plan exceeds ${MAX_EXECUTION_PLAN_BYTES} bytes` });
    return boundResult('execution.plan.register', await options.service.registerPlan(bound, workUnits));
  });
  register('execution.work.claim', { description: 'Worker claims one ready work unit using its host-bound slot.', inputSchema: executionWorkSchema }, async ({ executionId, workUnitId, assignedSlotId }) => {
    if (!await authorized()) return denied('execution.work.claim'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.claim');
    return boundResult('execution.work.claim', await options.service.claimWork(bound, workUnitId, assignedSlotId));
  });
  register('execution.work.assign', { description: 'Coordinator assigns one ready work unit to a worker slot.', inputSchema: executionWorkAssignSchema }, async ({ executionId, workUnitId, assignedSlotId }) => {
    if (!await authorized()) return denied('execution.work.assign'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.assign');
    return boundResult('execution.work.assign', await options.service.assignWork(bound, workUnitId, assignedSlotId));
  });
  register('execution.work.heartbeat', { description: 'Worker renews its current main-minted work claim lease.', inputSchema: executionWorkHeartbeatSchema }, async ({ executionId, workUnitId, claimId, claimGeneration, turnCount }) => {
    if (!await authorized()) return denied('execution.work.heartbeat'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.heartbeat');
    return boundResult('execution.work.heartbeat', await options.service.heartbeatWork(bound, workUnitId, claimId, claimGeneration, turnCount));
  });
  register('execution.work.dispatch_ready', { description: 'Coordinator hands scheduling to the engine: auto-assign EVERY ready work unit to a free worker slot and notify each worker. Call once after the plan is structured (units have tasks + dependencies); the engine then re-dispatches newly-ready units automatically as work completes, so no per-unit assign is needed.', inputSchema: executionIdSchema }, async ({ executionId }) => {
    if (!await authorized()) return denied('execution.work.dispatch_ready'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.dispatch_ready');
    return boundResult('execution.work.dispatch_ready', await options.service.dispatchReady(bound));
  });
  register('execution.work.complete', { description: 'Complete one assigned work unit. Preserve required prose result and include structuredResult when plan declares bounded output schema.', inputSchema: executionWorkResultSchema }, async ({ executionId, workUnitId, result, structuredResult, claimId, claimGeneration }) => {
    if (!await authorized()) return denied('execution.work.complete'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.complete');
    if (result.length > EXECUTION_RESULT_MAX_CHARS) {
      // structuredResult is only accepted for a unit that declares an output, so only then is it advice that works.
      const declaresOutput = await options.service.workUnitDeclaresOutput(bound, workUnitId).catch((error: unknown) => {
        console.error(`[execution-mcp] tool execution.work.complete could not check declared output for execution ${executionId} work unit ${workUnitId}`, error);
        return false;
      });
      const hint = declaresOutput ? ' Put the detail in structuredResult.' : '';
      return { isError: true, content: [{ type: 'text' as const, text: `execution.work.complete failed: result is ${result.length} chars; max ${EXECUTION_RESULT_MAX_CHARS}. Shorten it to a summary of at most ${EXECUTION_RESULT_MAX_CHARS} characters.${hint}` }] };
    }
    return outcomeResult('execution.work.complete', workUnitId, await options.service.completeWork(bound, workUnitId, result, claimId && claimGeneration ? { claimId, claimGeneration } : undefined, true, structuredResult));
  });
  register('execution.work.fail', { description: 'Fail one assigned work unit durably.', inputSchema: executionWorkFailureSchema }, async ({ executionId, workUnitId, failure, failureCode, claimId, claimGeneration }) => {
    if (!await authorized()) return denied('execution.work.fail'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.fail');
    const claim = claimId && claimGeneration ? { claimId, claimGeneration } : undefined;
    return outcomeResult('execution.work.fail', workUnitId, await (claim
      ? options.service.failWork(bound, workUnitId, failure, failureCode, claim, true)
      : options.service.failWork(bound, workUnitId, failure, failureCode, undefined, true)));
  });
  register('execution.work.block', { description: 'Block one assigned work unit with a durable question. audience "human" (default) routes to a human via the inbox; audience "coordinator" is a self-heal ask — it wakes the coordinator (no human) to decide a plan/spec detail and answer with execution.work.answer. options must be complete answers the recipient can submit verbatim. Omit options when the answer requires free-form data such as an absolute path, identifier, or explanation.', inputSchema: executionWorkBlockSchema }, async ({ executionId, workUnitId, blockerId, question, options: choices, audience, claimId, claimGeneration }) => {
    if (!await authorized()) return denied('execution.work.block'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.block');
    return outcomeResult('execution.work.block', workUnitId, await options.service.blockWork(bound, workUnitId, { id: blockerId, question, options: choices, ...(audience ? { audience } : {}) }, claimId && claimGeneration ? { claimId, claimGeneration } : undefined, true));
  });
  register('execution.work.answer', { description: 'Coordinator answers a coordinator-directed blocker (one raised with audience "coordinator"). The answer is delivered to the blocked worker, which resumes automatically. Not for human-audience blockers.', inputSchema: executionWorkAnswerSchema }, async ({ executionId, blockerId, answer }) => {
    if (!await authorized()) return denied('execution.work.answer'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.answer');
    return boundResult('execution.work.answer', await options.service.answerBlockerByCoordinator(bound, blockerId, answer));
  });
  register('execution.work.release', { description: 'Release one assigned work unit.', inputSchema: executionWorkSchema }, async ({ executionId, workUnitId, claimId, claimGeneration }) => {
    if (!await authorized()) return denied('execution.work.release'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.release');
    return outcomeResult('execution.work.release', workUnitId, await options.service.releaseWork(bound, workUnitId, claimId && claimGeneration ? { claimId, claimGeneration } : undefined, true));
  });
  register('execution.work.retry', { description: 'Coordinator retries and optionally reassigns failed or blocked work.', inputSchema: executionWorkSchema }, async ({ executionId, workUnitId, assignedSlotId }) => {
    if (!await authorized()) return denied('execution.work.retry'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.retry');
    return boundResult('execution.work.retry', await options.service.retryWork(bound, workUnitId, assignedSlotId));
  });
  register('execution.delivery.pull', { description: 'Pull one pending blocker response bound to this worker route.', inputSchema: {} }, async () => {
    if (!await authorized()) return denied('execution.delivery.pull'); const bound = await binding(); if (!bound) return boundDenied('execution.delivery.pull');
    return boundResult('execution.delivery.pull', await options.service.pullDelivery(bound));
  });
  register('execution.delivery.ack', { description: 'Acknowledge one leased blocker response from this exact worker route.', inputSchema: executionDeliveryAckSchema }, async ({ deliveryId, leaseId, delivered, error }) => {
    if (!await authorized()) return denied('execution.delivery.ack'); const bound = await binding(); if (!bound) return boundDenied('execution.delivery.ack');
    return boundResult('execution.delivery.ack', await options.service.ackDelivery(bound, deliveryId, leaseId, { delivered, error }));
  });
  register('execution.source.list', { description: 'Coordinator lists bounded source snapshot metadata.', inputSchema: executionSourceListSchema }, async ({ executionId, offset, limit }) => {
    if (!await authorized()) return denied('execution.source.list'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.source.list');
    return boundResult('execution.source.list', await options.service.listSources(bound, { offset, limit }));
  });
  register('execution.source.read', { description: 'Coordinator reads one bounded source snapshot chunk.', inputSchema: executionSourceReadSchema }, async ({ executionId, sourceId, offset, maxBytes }) => {
    if (!await authorized()) return denied('execution.source.read'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.source.read');
    return boundResult('execution.source.read', await options.service.readSource(bound, sourceId, { offset, maxBytes }));
  });

  register('execution.start', {
    description: EXECUTION_START_DESCRIPTION,
    inputSchema: executionStartInputSchema
  }, async (input) => {
    if (!await ownerAuthorized()) return denied('execution.start');
    let start: z.infer<typeof executionStartSchema>;
    try {
      start = 'requestPath' in input ? await readStartRequestFile(input.requestPath) : input;
      if (!hasBoundedWorkUnits(start.workUnits)) throw new Error(`workUnits must not exceed ${MAX_START_WORK_UNITS_BYTES} UTF-8 bytes`);
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: `execution.start failed: ${error instanceof Error ? error.message : String(error)}` }] };
    }
    let approval: LaunchApproval;
    try {
      if (!options.resolveLaunchApproval) throw new Error('launch approval resolver is not wired');
      approval = await options.resolveLaunchApproval(start.teamId, options.projectId);
    } catch (error) {
      console.error(`[execution-mcp] launch approval lookup failed for project ${options.projectId}`, error);
      return { isError: true, content: [{ type: 'text' as const, text: 'execution.start failed: LAUNCH_APPROVAL_UNAVAILABLE: the Squad launch approval setting could not be read, so the run was not started.' }] };
    }
    if (approval === 'review') {
      return { isError: true, content: [{ type: 'text' as const, text: `execution.start failed: LAUNCH_REVIEW_REQUIRED: ${LAUNCH_REVIEW_REQUIRED_MESSAGE}` }] };
    }
    const { version, launchKind, launchDisplay, teamId, launchRequestId, jobTitle, summary, slots, deadlineMs, maxConcurrent, maxLaunches, maxTurnsPerClaim, maxClaimWallClockMs, usageBudget, workflow, workUnits, worktree, target, notify } = start;
    const request: ExecutionRequestV1 = {
      version, launchKind, ...(launchDisplay === undefined ? {} : { launchDisplay }), teamId, launchRequestId, jobTitle, summary, slots,
      ...(workflow === undefined ? {} : { workflow }), ...(workUnits === undefined ? {} : { workUnits }), coordinationMode: 'job-team',
      ...(worktree === undefined ? {} : { worktree }),
      ...(target === undefined ? {} : { target }),
      policy: {
        ...(deadlineMs === undefined ? {} : { deadlineMs }),
        ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
        ...(maxLaunches === undefined ? {} : { maxLaunches }),
        ...(maxTurnsPerClaim === undefined ? {} : { maxTurnsPerClaim }),
        ...(maxClaimWallClockMs === undefined ? {} : { maxClaimWallClockMs }),
        ...(usageBudget === undefined ? {} : { usageBudget })
      }
    };
    // An owner that asked for it gets a [Squad report] when the run ends or needs a human.
    const result = await options.service.start(options.sessionId!, options.projectId, request,
      notify === true ? { reportTo: { kind: options.reportKind ?? 'pty', id: options.sessionId!, role: 'owner' } } : undefined);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify((({ resumeToken: _token, resumeTokenExpiresAt: _expiresAt, ...value }) => value)(result.value)) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.start failed: ${result.message}` }] };
  });

  register('execution.status', {
    description: 'Read one project-scoped execution.', inputSchema: executionIdSchema
  }, async ({ executionId }) => {
    if (!await ownerAuthorized()) return denied('execution.status');
    const cohort = await binding(executionId);
    if (cohort) return wrongAuthority('execution.status');
    const record = await options.service.status(options.sessionId!, options.projectId, executionId);
    return record
      ? { content: [{ type: 'text' as const, text: JSON.stringify(toMcpSafeExecution(record)) }] }
      : { isError: true, content: [{ type: 'text' as const, text: 'execution.status failed: execution not found for caller.' }] };
  });

  register('execution.resume_binding', {
    description: 'Bind this fresh session to an execution using a durable resume grant. Retry same token after a transient binding failure.', inputSchema: resumeBindingSchema
  }, async ({ executionId, token }) => {
    if (!await ownerAuthorized()) return denied('execution.resume_binding');
    // An owner's reports follow it to this fresh session.
    const result = await options.service.resumeBinding(options.sessionId!, options.projectId, executionId, token, options.reportKind ?? 'pty');
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.resume_binding failed: ${result.message}` }] };
  });

  register('execution.mint_resume_grant', {
    description: 'Mint a replacement resume grant for an active execution owned by this session when its start token was lost.', inputSchema: mintResumeGrantSchema
  }, async ({ executionId }) => {
    if (!await authorized()) return denied('execution.mint_resume_grant');
    const result = await options.service.mintResumeGrant(options.sessionId!, options.projectId, executionId);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.mint_resume_grant failed: ${result.message}` }] };
  });

  register('execution.revoke_resume_grant', {
    description: 'Revoke pending durable resume grants for one owner-scoped execution.', inputSchema: revokeResumeGrantSchema
  }, async ({ executionId, effectiveOwnerPrincipalId }) => {
    if (!await authorized()) return denied('execution.revoke_resume_grant');
    const result = await options.service.revokeResumeGrant(options.sessionId!, options.projectId, executionId, effectiveOwnerPrincipalId);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.revoke_resume_grant failed: ${result.message}` }] };
  });

  register('execution.list', {
    description: 'List recent project-scoped executions started by this session identity.', inputSchema: {}
  }, async () => {
    if (!await ownerAuthorized()) return denied('execution.list');
    const cohort = await binding();
    if (cohort) return wrongAuthority('execution.list');
    const records = await options.service.list(options.sessionId!, options.projectId);
    return { content: [{ type: 'text' as const, text: JSON.stringify(records.map(toMcpSafeExecution)) }] };
  });

  register('execution.events', {
    description: 'Read ordered execution events after an optional sequence cursor.', inputSchema: executionEventsSchema
  }, async ({ executionId, after, limit }) => {
    if (!await ownerAuthorized()) return denied('execution.events');
    const events = await options.service.events(options.sessionId!, options.projectId, executionId, after ?? 0, limit ?? 100);
    return { content: [{ type: 'text' as const, text: JSON.stringify(events) }] };
  });

  register('execution.snapshot', {
    description: 'Read one bounded durable execution snapshot. Does not reconcile or poll Team workers.', inputSchema: executionSnapshotSchema
  }, async ({ executionId, after }) => {
    if (!await (options.memberFence ? authorized() : ownerAuthorized())) return denied('execution.snapshot');
    try {
      const hostBinding = options.sessionId ? await options.resolveCohortBinding?.(options.sessionId, options.projectId, options.memberFence) : undefined;
      const bound = await binding(executionId);
      if ((hostBinding || options.memberFence) && !bound) return wrongAuthority('execution.snapshot');
      const snapshot = bound
        ? await options.service.snapshotBound(bound, after ?? 0)
        : await options.service.snapshot(options.sessionId!, options.projectId, executionId, after ?? 0);
      if (!snapshot) return { isError: true, content: [{ type: 'text' as const, text: 'execution.snapshot failed: execution not found for caller.' }] };
      const projectExecution = bound ? toBoundSnapshotExecution : toMcpSafeExecution;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ...snapshot,
            execution: projectExecution(snapshot.execution),
            executions: snapshot.executions.map(projectExecution),
            artifacts: snapshot.artifacts.map(({ content: _content, ...artifact }) => artifact)
          })
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `execution.snapshot failed: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  });

  register('execution.event', {
    description: 'Record one idempotent, owner-scoped lifecycle, blocker, failure, or outcome event.', inputSchema: executionProducerEventSchema
  }, async ({ executionId, eventId, slotId, producerRole, type, severity, summary, detail, blocker, attention, progress, references }) => {
    if (!await authorized()) return denied('execution.event');
    const bound = await binding(executionId);
    if (options.memberFence && !bound) return boundDenied('execution.event');
    if (bound) {
      const result = await options.service.reportBoundEvent(bound, { id: eventId, type, severity, summary, detail, blocker, attention, progress, references });
      return result.ok ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `execution.event failed: ${result.message}` }] };
    }
    const result = await options.service.reportEvent(options.sessionId!, options.projectId, executionId, {
      id: eventId, slotId, producerRole, type, severity, summary, detail, blocker, attention, progress, references
    });
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.event failed: ${result.message}` }] };
  });

  register('execution.stop', {
    description: 'Request a stop for one project-scoped Squad execution at an expected state version.', inputSchema: executionControlSchema
  }, async ({ executionId, expectedStateVersion }) => {
    if (!await ownerAuthorized()) return denied('execution.stop');
    const result = await options.service.stop(options.sessionId!, options.projectId, executionId, expectedStateVersion);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.stop failed: ${result.message}` }] };
  });

  register('execution.complete', {
    description: 'Coordinator-only durable completion for one Team job, with a final summary.', inputSchema: executionCompleteSchema
  }, async ({ executionId, summary }) => {
    if (!await authorized()) return denied('execution.complete');
    const bound = await binding(executionId);
    if (options.memberFence && !bound) return boundDenied('execution.complete');
    if (bound) {
      const result = await options.service.completeByCoordinatorBinding(bound, executionId, summary);
      return result.ok ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `execution.complete failed: ${result.message}` }] };
    }
    const result = await options.service.completeByCoordinator(options.sessionId!, options.projectId, executionId, summary);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.complete failed: ${result.message}` }] };
  });

  // Retry, recovery and resume are owner controls: a CLI Agent or Modern thread
  // owner passes the owner gate, and the service still checks the record's owner.
  register('execution.retry', {
    description: 'Retry a pre-dispatch blocked execution using a fresh Team launch identity.', inputSchema: executionControlSchema
  }, async ({ executionId, expectedStateVersion }) => {
    if (!await ownerAuthorized()) return denied('execution.retry');
    const result = await options.service.retry(options.sessionId!, options.projectId, executionId, expectedStateVersion);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.retry failed: ${result.message}` }] };
  });

  register('execution.recover_retained', {
    description: "Recover a retained stopped/failed Squad. mode 'exact-native' resumes the existing agents; mode 'fresh-plan' launches a NEW cohort from the retained plan.", inputSchema: executionRetainedRecoverySchema
  }, async ({ executionId, expectedStateVersion, mode }) => {
    if (!await ownerAuthorized()) return denied('execution.recover_retained');
    const result = await options.service.recoverRetained(options.sessionId!, options.projectId, executionId, expectedStateVersion, mode);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.recover_retained failed: ${result.message}` }] };
  });

  register('execution.relaunch_retained_plan', {
    description: 'Launch a NEW cohort from the retained plan. Does not resume existing agents. Completed work stays retained; all other units are reprompted.', inputSchema: executionControlSchema
  }, async ({ executionId, expectedStateVersion }) => {
    if (!await ownerAuthorized()) return denied('execution.relaunch_retained_plan');
    const result = await options.service.recoverRetained(options.sessionId!, options.projectId, executionId, expectedStateVersion, 'fresh-plan');
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.relaunch_retained_plan failed: ${result.message}` }] };
  });

  register('execution.resume_run', {
    description: 'Deprecated. Despite its name, launches a NEW cohort (same as execution.relaunch_retained_plan). To resume existing agents use execution.recover_retained with mode exact-native.', inputSchema: executionResumeRunSchema
  }, async ({ executionId, expectedStateVersion, replay }) => {
    if (!await ownerAuthorized()) return denied('execution.resume_run');
    const result = await options.service.resumeRun(options.sessionId!, options.projectId, executionId, expectedStateVersion, replay === true);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.resume_run failed: ${result.message}` }] };
  });

  register('execution.respond', {
    description: 'Deliver a response to one authorized execution slot (slotId), or answer one of the run\'s human blockers (blockerId) as its owner, e.g. the question a [Squad report] named. expectedStateVersion is required with slotId; with blockerId leave it out to use the latest state. Coordinator-directed blockers are not the owner\'s to answer.',
    inputSchema: executionRespondSchema
  }, async ({ executionId, expectedStateVersion, slotId, blockerId, clientRequestId, message }) => {
    if ((slotId === undefined) === (blockerId === undefined)) {
      // Authorization fails first, so an unauthorized caller learns nothing about input shape.
      if (!await authorized() && !await ownerAuthorized()) return denied('execution.respond');
      return { isError: true, content: [{ type: 'text' as const, text: 'execution.respond failed: pass exactly one of slotId or blockerId' }] };
    }
    if (blockerId !== undefined) {
      // An owner answers from a CLI Agent or a Modern thread, so the owner gate applies.
      if (!await ownerAuthorized()) return denied('execution.respond');
      const bytes = Buffer.byteLength(message, 'utf8');
      if (bytes > MAX_BLOCKER_ANSWER_BYTES) {
        return { isError: true, content: [{ type: 'text' as const, text: `execution.respond failed: answer is ${bytes} bytes; max ${MAX_BLOCKER_ANSWER_BYTES}.` }] };
      }
      const answered = await options.service.respondToHumanBlockerAsOwner(
        options.sessionId!, options.projectId, executionId, expectedStateVersion, blockerId, clientRequestId ?? `mcp:${randomUUID()}`, message
      );
      return answered.ok
        ? { content: [{ type: 'text' as const, text: JSON.stringify({ executionId, blockerId, stateVersion: answered.value.stateVersion, state: answered.value.state }) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `execution.respond failed: ${answered.message}` }] };
    }
    if (!await ownerAuthorized()) return denied('execution.respond');
    if (expectedStateVersion === undefined) return { isError: true, content: [{ type: 'text' as const, text: 'execution.respond failed: expectedStateVersion is required with slotId' }] };
    const result = await options.service.respond(options.sessionId!, options.projectId, executionId, expectedStateVersion, slotId!, message);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.respond failed: ${result.message}` }] };
  });

  register('execution.resume', {
    description: 'Resume a blocked execution by delivering a message to one authorized live slot. Does not relaunch stopped work.', inputSchema: executionMessageSchema
  }, async ({ executionId, expectedStateVersion, slotId, message }) => {
    if (!await ownerAuthorized()) return denied('execution.resume');
    const result = await options.service.resume(options.sessionId!, options.projectId, executionId, expectedStateVersion, slotId, message);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.resume failed: ${result.message}` }] };
  });

  register('execution.artifact.put', {
    description: 'Store one write-once, content-addressed execution artifact.', inputSchema: executionArtifactSchema
  }, async ({ executionId, name, mediaType, content }) => {
    if (!await authorized()) return denied('execution.artifact.put');
    const bound = await binding(executionId);
    if (bound) {
      const result = await options.service.putBoundArtifact(bound, name, mediaType, content);
      return result.ok ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `execution.artifact.put failed: ${result.message}` }] };
    }
    const result = await options.service.putArtifact(options.sessionId!, options.projectId, executionId, name, mediaType, content);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.artifact.put failed: ${result.message}` }] };
  });

  register('execution.artifact.list', {
    description: 'List execution artifacts scoped to this authenticated project and caller.', inputSchema: executionIdSchema
  }, async ({ executionId }) => {
    if (!await authorized()) return denied('execution.artifact.list');
    const bound = await binding(executionId);
    if (bound) {
      const result = await options.service.listBoundArtifacts(bound);
      return result.ok ? { content: [{ type: 'text' as const, text: JSON.stringify(withoutArtifactContent(result.value)) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `execution.artifact.list failed: ${result.message}` }] };
    }
    const artifacts = await options.service.listArtifacts(options.sessionId!, options.projectId, executionId);
    return artifacts
      ? { content: [{ type: 'text' as const, text: JSON.stringify(withoutArtifactContent(artifacts)) }] }
      : { isError: true, content: [{ type: 'text' as const, text: 'execution.artifact.list failed: execution not found for caller.' }] };
});

function withoutArtifactContent(value: unknown): unknown {
  return Array.isArray(value) ? value.map((artifact) => {
    if (!artifact || typeof artifact !== 'object') return artifact;
    const { content: _content, ...metadata } = artifact as Record<string, unknown>;
    return metadata;
  }) : value;
}

  if (options.handoffs && options.validateHandoffTarget && options.approveHandoff) {
    const requestHandoff = async (targetSessionId: string, executionId: string, operation: typeof EXECUTION_HANDOFF_OPERATION | typeof EXECUTION_RESUME_MONITOR_OPERATION) => {
      if (!await options.validateHandoffTarget!(options.sessionId!, targetSessionId, options.projectId)) {
        return { isError: true as const, content: [{ type: 'text' as const, text: 'execution handoff failed: target session is not live in this project.' }] };
      }
      const record = await options.service.status(options.sessionId!, options.projectId, executionId);
      if (!record) return { isError: true as const, content: [{ type: 'text' as const, text: 'execution handoff failed: execution not found for caller.' }] };
      if (record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') {
        return { isError: true as const, content: [{ type: 'text' as const, text: 'execution handoff failed: execution is terminal.' }] };
      }
      if (!await options.approveHandoff?.(options.sessionId!, targetSessionId, options.projectId, executionId, operation)) {
        return { isError: true as const, content: [{ type: 'text' as const, text: 'execution handoff failed: handoff was not approved.' }] };
      }
      try {
        const handoff = await options.handoffs!.mint({
          sourceOwnerSessionId: options.sessionId!, targetSessionId, projectId: options.projectId,
          executionId, operations: [operation], expiresAt: Date.now() + 60_000
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(handoff) }] };
      } catch (error) {
        return { isError: true as const, content: [{ type: 'text' as const, text: `execution handoff failed: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    };
    register('request_execution_handoff', {
      description: 'Request one short-lived, single-use execution.control capability for a live session in this project.',
      inputSchema: handoffRequestSchema
    }, async ({ targetSessionId, executionId, operations }) => {
      if (!await authorized()) return denied('request_execution_handoff');
      return requestHandoff(targetSessionId, executionId, operations[0]);
    });

    register('request_execution_resume_monitor_handoff', {
      description: 'Request one approved resume plus ten-minute read-only monitoring capability for one live session and bound execution.', inputSchema: resumeMonitorRequestSchema
    }, async ({ targetSessionId, executionId }) => {
      if (!await authorized()) return denied('request_execution_resume_monitor_handoff');
      return requestHandoff(targetSessionId, executionId, EXECUTION_RESUME_MONITOR_OPERATION);
    });

    register('request_execution_monitor_handoff', {
      description: 'Request fresh human approval for another ten-minute read-only monitor window on one live execution.', inputSchema: monitorRequestSchema
    }, async ({ targetSessionId, executionId }) => {
      if (!await authorized()) return denied('request_execution_monitor_handoff');
      const requested = await requestHandoff(targetSessionId, executionId, EXECUTION_RESUME_MONITOR_OPERATION);
      if ('isError' in requested && requested.isError) return requested;
      try {
        const { token } = JSON.parse(requested.content[0].text) as { token: string };
        const grant = await options.handoffs!.consume({ token, targetSessionId, projectId: options.projectId, executionId, operation: EXECUTION_RESUME_MONITOR_OPERATION });
        const monitor = await options.handoffs!.mint({
          sourceOwnerSessionId: grant.sourceOwnerSessionId, targetSessionId: grant.targetSessionId, projectId: grant.projectId,
          executionId: grant.executionId, operations: [EXECUTION_RESUME_MONITOR_OPERATION], kind: 'monitor', expiresAt: Date.now() + 10 * 60_000
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(monitor) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `request_execution_monitor_handoff failed: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    });

    register('execute_execution_handoff', {
      description: 'Use one handoff capability from its exact target session to stop, respond to, or resume its bound execution.',
      inputSchema: handoffExecuteSchema
    }, async ({ token, executionId, expectedStateVersion, action, slotId, message }) => {
      if (!await authorized()) return denied('execute_execution_handoff');
      if ((action === 'respond' || action === 'resume') && (!slotId || !message)) {
        return { isError: true, content: [{ type: 'text' as const, text: 'execute_execution_handoff failed: slotId and message are required.' }] };
      }
      try {
        const grant = await options.handoffs!.consume({ token, targetSessionId: options.sessionId!, projectId: options.projectId, executionId, operation: EXECUTION_HANDOFF_OPERATION });
        const result = await options.service.controlWithHandoff(grant, action, expectedStateVersion, slotId, message);
        return result.ok
          ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
          : { isError: true, content: [{ type: 'text' as const, text: `execute_execution_handoff failed: ${result.message}` }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `execute_execution_handoff failed: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    });

    register('execute_execution_resume_monitor_handoff', {
      description: 'Consume an approved one-time resume handoff, then receive a ten-minute read-only monitor token.', inputSchema: resumeMonitorExecuteSchema
    }, async ({ token, executionId, expectedStateVersion, slotId, message }) => {
      if (!await authorized()) return denied('execute_execution_resume_monitor_handoff');
      try {
        const grant = await options.handoffs!.consume({ token, targetSessionId: options.sessionId!, projectId: options.projectId, executionId, operation: EXECUTION_RESUME_MONITOR_OPERATION });
        const result = await options.service.controlWithHandoff(grant, 'resume', expectedStateVersion, slotId, message);
        if (!result.ok) return { isError: true, content: [{ type: 'text' as const, text: `execute_execution_resume_monitor_handoff failed: ${result.message}` }] };
        const monitor = await options.handoffs!.mint({
          sourceOwnerSessionId: grant.sourceOwnerSessionId, targetSessionId: grant.targetSessionId, projectId: grant.projectId,
          executionId: grant.executionId, operations: [EXECUTION_RESUME_MONITOR_OPERATION], kind: 'monitor', expiresAt: Date.now() + 10 * 60_000
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ execution: result.value, monitor }) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `execute_execution_resume_monitor_handoff failed: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    });

    const readMonitor = async (token: string, executionId: string) => options.handoffs!.inspect({ token, targetSessionId: options.sessionId!, projectId: options.projectId, executionId, operation: EXECUTION_RESUME_MONITOR_OPERATION });
    register('execution_handoff_status', { description: 'Read status using one valid ten-minute resume-monitor capability.', inputSchema: monitorStatusSchema }, async ({ token, executionId }) => {
      if (!await authorized()) return denied('execution_handoff_status');
      try {
        const grant = await readMonitor(token, executionId);
        const record = await options.service.status(grant.sourceOwnerSessionId, grant.projectId, grant.executionId);
        return record ? { content: [{ type: 'text' as const, text: JSON.stringify(toMcpSafeExecution(record)) }] } : { isError: true, content: [{ type: 'text' as const, text: 'execution_handoff_status failed: execution not found.' }] };
      } catch { return { isError: true, content: [{ type: 'text' as const, text: 'execution_handoff_status failed: monitor capability is not current.' }] }; }
    });
    register('execution_handoff_events', { description: 'Read events using one valid ten-minute resume-monitor capability.', inputSchema: monitorEventsSchema }, async ({ token, executionId, after, limit }) => {
      if (!await authorized()) return denied('execution_handoff_events');
      try {
        const grant = await readMonitor(token, executionId);
        const events = await options.service.events(grant.sourceOwnerSessionId, grant.projectId, grant.executionId, after ?? 0, limit ?? 100);
        return { content: [{ type: 'text' as const, text: JSON.stringify(events) }] };
      } catch { return { isError: true, content: [{ type: 'text' as const, text: 'execution_handoff_events failed: monitor capability is not current.' }] }; }
    });
  }

}

export interface ExecutionToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  schema: z.ZodType;
}

let executionToolDescriptors: readonly ExecutionToolDescriptor[] | undefined;

/** Capture the canonical registrations without constructing a transport or running handlers. */
export function getExecutionToolDescriptors(): readonly ExecutionToolDescriptor[] {
  if (executionToolDescriptors) return executionToolDescriptors;
  const descriptors: ExecutionToolDescriptor[] = [];
  registerExecutionTools({
    registerTool(name: string, config: { description: string; inputSchema: z.ZodType | z.ZodRawShape }) {
      const schema = config.inputSchema instanceof z.ZodType ? config.inputSchema : z.strictObject(config.inputSchema);
      descriptors.push({ name, description: config.description, schema, inputSchema: z.toJSONSchema(schema, { unrepresentable: 'any' }) });
    }
  } as unknown as McpServer, { projectId: '', service: {} as ExecutionService });
  executionToolDescriptors = descriptors;
  return descriptors;
}
