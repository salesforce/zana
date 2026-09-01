import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { ExecutionCohortBinding, ExecutionRequestV1, ExecutionService } from './service.js';
import type { ExecutionRecord } from './store.js';
import { EXECUTION_HANDOFF_OPERATION, EXECUTION_RESUME_MONITOR_OPERATION, type createExecutionHandoffStore } from './handoff-store.js';
import { MAX_TEAM_INITIAL_TASK_BYTES } from '../launch/team-lifecycle-store.js';
import { isWithin } from '@zana-ai/zcc-path-confine';

const slotSchema = z.strictObject({
  initialTask: z.string().min(1).refine(
    (value) => Buffer.byteLength(value, 'utf8') <= MAX_TEAM_INITIAL_TASK_BYTES,
    { message: `initialTask must not exceed ${MAX_TEAM_INITIAL_TASK_BYTES} UTF-8 bytes` }
  )
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
const workUnitSchema = z.object({
  id: z.string().min(1).max(2048), title: z.string().min(1).max(2048), task: z.string().min(1).max(2048),
  dependencies: z.array(z.string().min(1).max(2048)).max(100), preferredRole: z.string().min(1).max(2048).optional(),
  files: z.array(z.string().min(1).max(2048)).max(100).optional(), verification: z.array(z.string().min(1).max(2048)).max(100).optional(), readOnly: z.boolean().optional()
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
  workflow: workflowSchema.optional(),
  workUnits: z.array(workUnitSchema).min(1).max(100).optional()
});
const executionStartFileSchema = z.strictObject({
  requestPath: z.string().min(1).max(2048)
});
const executionStartInputSchema = z.union([executionStartSchema, executionStartFileSchema]);
const MAX_START_REQUEST_FILE_BYTES = 8 * 1024 * 1024;
const MAX_START_WORK_UNITS_BYTES = 512 * 1024;

const executionIdSchema = { executionId: z.string().min(1).max(2048) };
const executionControlSchema = { ...executionIdSchema, expectedStateVersion: z.number().int().min(0) };
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
const executionCompleteSchema = { ...executionIdSchema, summary: z.string().min(1).max(64 * 1024) };
const executionArtifactSchema = { ...executionIdSchema, name: z.string().min(1).max(512), mediaType: z.string().min(1).max(512), content: z.string().min(1).max(64 * 1024) };
const executionPlanSchema = { ...executionIdSchema, workUnits: z.array(workUnitSchema).min(1).max(100) };
const executionWorkSchema = { ...executionIdSchema, workUnitId: z.string().min(1).max(2048), assignedSlotId: z.string().min(1).max(2048).optional() };
const executionWorkAssignSchema = { ...executionIdSchema, workUnitId: z.string().min(1).max(2048), assignedSlotId: z.string().min(1).max(2048) };
const executionWorkResultSchema = { ...executionWorkSchema, result: z.string().min(1).max(2048) };
const executionWorkFailureSchema = { ...executionWorkSchema, failure: z.string().min(1).max(2048) };
const executionWorkBlockSchema = { ...executionWorkSchema, blockerId: z.string().min(1).max(2048), question: z.string().min(1).max(2048), options: z.array(z.string().min(1).max(2048)).max(20).optional() };
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

export interface RegisterExecutionToolOptions {
  sessionId?: string;
  projectId: string;
  /** Host-resolved display name only; never accepted from an MCP caller. */
  projectName?: string;
  service: ExecutionService;
  validateRouteIdentity?: (sessionId: string, projectId: string) => boolean;
  resolveCohortBinding?: (sessionId: string, projectId: string) => ExecutionCohortBinding | undefined;
  validateRecoveryBinding?: (sessionId: string, binding: ExecutionCohortBinding) => Promise<boolean>;
  handoffs?: ReturnType<typeof createExecutionHandoffStore>;
  validateHandoffTarget?: (sourceSessionId: string, targetSessionId: string, projectId: string) => boolean;
  approveHandoff?: (sourceSessionId: string, targetSessionId: string, projectId: string, executionId: string, operation: typeof EXECUTION_HANDOFF_OPERATION | typeof EXECUTION_RESUME_MONITOR_OPERATION) => Promise<boolean>;
}

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
  return safe;
}

function toBoundSnapshotExecution(record: ExecutionRecord): BoundSnapshotExecutionRecord {
  const {
    id, projectId, teamId, launchKind, launchDisplay, jobTitle, summary, attempt, state, stateVersion,
    lastEventSequence, policyResult, workUnits, blockers, finalSummary, coordinationMode, createdAt, updatedAt,
    dismissedAt
  } = record;
  return {
    id, projectId, teamId, launchKind, launchDisplay, jobTitle, summary, attempt, state, stateVersion,
    lastEventSequence, policyResult, workUnits, blockers, finalSummary, coordinationMode, createdAt, updatedAt,
    dismissedAt
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

export function registerExecutionTools(server: McpServer, options: RegisterExecutionToolOptions): void {
  const authorized = (): boolean => !!options.sessionId
    && (options.validateRouteIdentity?.(options.sessionId, options.projectId) ?? false);
  const binding = async (correlationExecutionId?: string): Promise<ExecutionCohortBinding | undefined> => {
    const resolved = options.sessionId ? options.resolveCohortBinding?.(options.sessionId, options.projectId) : undefined;
    if (!resolved || correlationExecutionId && resolved.executionId !== correlationExecutionId) return undefined;
    if (resolved.slotId === 'orchestrator:recovery'
      && (!options.sessionId || !await options.validateRecoveryBinding?.(options.sessionId, resolved))) return undefined;
    return resolved;
  };
  const boundDenied = (name: string) => ({ isError: true as const, content: [{ type: 'text' as const, text: `${name} failed: session is not bound to this execution.` }] });
  const boundResult = (name: string, value: { ok: boolean; value?: unknown; message?: string }) => value.ok
    ? { content: [{ type: 'text' as const, text: JSON.stringify(value.value) }] }
    : { isError: true, content: [{ type: 'text' as const, text: `${name} failed: ${value.message}` }] };

  server.registerTool('execution.whoami', {
    description: 'Read this live session MCP route identity. Execution starts in this session project unless a host feature explicitly selects another project.',
    inputSchema: {}
  }, async () => {
    if (!authorized()) return denied('execution.whoami');
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

  server.registerTool('execution.plan.register', { description: 'Coordinator registers one bounded durable work DAG.', inputSchema: executionPlanSchema }, async ({ executionId, workUnits }) => {
    if (!authorized()) return denied('execution.plan.register'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.plan.register');
    return boundResult('execution.plan.register', await options.service.registerPlan(bound, workUnits));
  });
  server.registerTool('execution.work.claim', { description: 'Worker claims one ready work unit using its host-bound slot.', inputSchema: executionWorkSchema }, async ({ executionId, workUnitId, assignedSlotId }) => {
    if (!authorized()) return denied('execution.work.claim'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.claim');
    return boundResult('execution.work.claim', await options.service.claimWork(bound, workUnitId, assignedSlotId));
  });
  server.registerTool('execution.work.assign', { description: 'Coordinator assigns one ready work unit to a worker slot.', inputSchema: executionWorkAssignSchema }, async ({ executionId, workUnitId, assignedSlotId }) => {
    if (!authorized()) return denied('execution.work.assign'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.assign');
    return boundResult('execution.work.assign', await options.service.assignWork(bound, workUnitId, assignedSlotId));
  });
  server.registerTool('execution.work.complete', { description: 'Complete one assigned work unit.', inputSchema: executionWorkResultSchema }, async ({ executionId, workUnitId, result }) => {
    if (!authorized()) return denied('execution.work.complete'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.complete');
    return boundResult('execution.work.complete', await options.service.completeWork(bound, workUnitId, result));
  });
  server.registerTool('execution.work.fail', { description: 'Fail one assigned work unit durably.', inputSchema: executionWorkFailureSchema }, async ({ executionId, workUnitId, failure }) => {
    if (!authorized()) return denied('execution.work.fail'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.fail');
    return boundResult('execution.work.fail', await options.service.failWork(bound, workUnitId, failure));
  });
  server.registerTool('execution.work.block', { description: 'Block one assigned work unit with a durable question.', inputSchema: executionWorkBlockSchema }, async ({ executionId, workUnitId, blockerId, question, options: choices }) => {
    if (!authorized()) return denied('execution.work.block'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.block');
    return boundResult('execution.work.block', await options.service.blockWork(bound, workUnitId, { id: blockerId, question, options: choices }));
  });
  server.registerTool('execution.work.release', { description: 'Release one assigned work unit.', inputSchema: executionWorkSchema }, async ({ executionId, workUnitId }) => {
    if (!authorized()) return denied('execution.work.release'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.release');
    return boundResult('execution.work.release', await options.service.releaseWork(bound, workUnitId));
  });
  server.registerTool('execution.work.retry', { description: 'Coordinator retries and optionally reassigns failed or blocked work.', inputSchema: executionWorkSchema }, async ({ executionId, workUnitId, assignedSlotId }) => {
    if (!authorized()) return denied('execution.work.retry'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.work.retry');
    return boundResult('execution.work.retry', await options.service.retryWork(bound, workUnitId, assignedSlotId));
  });
  server.registerTool('execution.delivery.pull', { description: 'Pull one pending blocker response bound to this worker route.', inputSchema: {} }, async () => {
    if (!authorized()) return denied('execution.delivery.pull'); const bound = await binding(); if (!bound) return boundDenied('execution.delivery.pull');
    return boundResult('execution.delivery.pull', await options.service.pullDelivery(bound));
  });
  server.registerTool('execution.delivery.ack', { description: 'Acknowledge one leased blocker response from this exact worker route.', inputSchema: executionDeliveryAckSchema }, async ({ deliveryId, leaseId, delivered, error }) => {
    if (!authorized()) return denied('execution.delivery.ack'); const bound = await binding(); if (!bound) return boundDenied('execution.delivery.ack');
    return boundResult('execution.delivery.ack', await options.service.ackDelivery(bound, deliveryId, leaseId, { delivered, error }));
  });
  server.registerTool('execution.source.list', { description: 'Coordinator lists bounded source snapshot metadata.', inputSchema: executionSourceListSchema }, async ({ executionId, offset, limit }) => {
    if (!authorized()) return denied('execution.source.list'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.source.list');
    return boundResult('execution.source.list', await options.service.listSources(bound, { offset, limit }));
  });
  server.registerTool('execution.source.read', { description: 'Coordinator reads one bounded source snapshot chunk.', inputSchema: executionSourceReadSchema }, async ({ executionId, sourceId, offset, maxBytes }) => {
    if (!authorized()) return denied('execution.source.read'); const bound = await binding(executionId); if (!bound) return boundDenied('execution.source.read');
    return boundResult('execution.source.read', await options.service.readSource(bound, sourceId, { offset, maxBytes }));
  });

  server.registerTool('execution.start', {
    description: 'Start one execution in this live session project. Pass either full request fields or a bounded requestPath. Main authorizes launch slots and stores launch identity before launch.',
    inputSchema: executionStartInputSchema
  }, async (input) => {
    if (!authorized()) return denied('execution.start');
    let start: z.infer<typeof executionStartSchema>;
    try {
      start = 'requestPath' in input ? await readStartRequestFile(input.requestPath) : input;
      if (!hasBoundedWorkUnits(start.workUnits)) throw new Error(`workUnits must not exceed ${MAX_START_WORK_UNITS_BYTES} UTF-8 bytes`);
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: `execution.start failed: ${error instanceof Error ? error.message : String(error)}` }] };
    }
    const { version, launchKind, launchDisplay, teamId, launchRequestId, jobTitle, summary, slots, deadlineMs, maxConcurrent, maxLaunches, workflow, workUnits } = start;
    const request: ExecutionRequestV1 = {
      version, launchKind, ...(launchDisplay === undefined ? {} : { launchDisplay }), teamId, launchRequestId, jobTitle, summary, slots,
      ...(workflow === undefined ? {} : { workflow }), ...(workUnits === undefined ? {} : { workUnits }), coordinationMode: 'job-team',
      policy: {
        ...(deadlineMs === undefined ? {} : { deadlineMs }),
        ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
        ...(maxLaunches === undefined ? {} : { maxLaunches })
      }
    };
    const result = await options.service.start(options.sessionId!, options.projectId, request);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify((({ resumeToken: _token, resumeTokenExpiresAt: _expiresAt, ...value }) => value)(result.value)) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.start failed: ${result.message}` }] };
  });

  server.registerTool('execution.status', {
    description: 'Read one project-scoped execution.', inputSchema: executionIdSchema
  }, async ({ executionId }) => {
    if (!authorized()) return denied('execution.status');
    const record = await options.service.status(options.sessionId!, options.projectId, executionId);
    return record
      ? { content: [{ type: 'text' as const, text: JSON.stringify(toMcpSafeExecution(record)) }] }
      : { isError: true, content: [{ type: 'text' as const, text: 'execution.status failed: execution not found for caller.' }] };
  });

  server.registerTool('execution.resume_binding', {
    description: 'Bind this fresh session to an execution using a durable resume grant. Retry same token after a transient binding failure.', inputSchema: resumeBindingSchema
  }, async ({ executionId, token }) => {
    if (!authorized()) return denied('execution.resume_binding');
    const result = await options.service.resumeBinding(options.sessionId!, options.projectId, executionId, token);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.resume_binding failed: ${result.message}` }] };
  });

  server.registerTool('execution.mint_resume_grant', {
    description: 'Mint a replacement resume grant for an active execution owned by this session when its start token was lost.', inputSchema: mintResumeGrantSchema
  }, async ({ executionId }) => {
    if (!authorized()) return denied('execution.mint_resume_grant');
    const result = await options.service.mintResumeGrant(options.sessionId!, options.projectId, executionId);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.mint_resume_grant failed: ${result.message}` }] };
  });

  server.registerTool('execution.revoke_resume_grant', {
    description: 'Revoke pending durable resume grants for one owner-scoped execution.', inputSchema: revokeResumeGrantSchema
  }, async ({ executionId, effectiveOwnerPrincipalId }) => {
    if (!authorized()) return denied('execution.revoke_resume_grant');
    const result = await options.service.revokeResumeGrant(options.sessionId!, options.projectId, executionId, effectiveOwnerPrincipalId);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.revoke_resume_grant failed: ${result.message}` }] };
  });

  server.registerTool('execution.list', {
    description: 'List recent project-scoped executions started by this session identity.', inputSchema: {}
  }, async () => {
    if (!authorized()) return denied('execution.list');
    const records = await options.service.list(options.sessionId!, options.projectId);
    return { content: [{ type: 'text' as const, text: JSON.stringify(records.map(toMcpSafeExecution)) }] };
  });

  server.registerTool('execution.events', {
    description: 'Read ordered execution events after an optional sequence cursor.', inputSchema: executionEventsSchema
  }, async ({ executionId, after, limit }) => {
    if (!authorized()) return denied('execution.events');
    const events = await options.service.events(options.sessionId!, options.projectId, executionId, after ?? 0, limit ?? 100);
    return { content: [{ type: 'text' as const, text: JSON.stringify(events) }] };
  });

  server.registerTool('execution.snapshot', {
    description: 'Read one bounded durable execution snapshot. Does not reconcile or poll Team workers.', inputSchema: executionSnapshotSchema
  }, async ({ executionId, after }) => {
    if (!authorized()) return denied('execution.snapshot');
    try {
      const hostBinding = options.sessionId ? options.resolveCohortBinding?.(options.sessionId, options.projectId) : undefined;
      const bound = await binding(executionId);
      if (hostBinding && !bound) return boundDenied('execution.snapshot');
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

  server.registerTool('execution.event', {
    description: 'Record one idempotent, owner-scoped lifecycle, blocker, failure, or outcome event.', inputSchema: executionProducerEventSchema
  }, async ({ executionId, eventId, slotId, producerRole, type, severity, summary, detail, blocker, attention, progress, references }) => {
    if (!authorized()) return denied('execution.event');
    const bound = await binding(executionId);
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

  server.registerTool('execution.stop', {
    description: 'Request a stop for one project-scoped Squad execution at an expected state version.', inputSchema: executionControlSchema
  }, async ({ executionId, expectedStateVersion }) => {
    if (!authorized()) return denied('execution.stop');
    const result = await options.service.stop(options.sessionId!, options.projectId, executionId, expectedStateVersion);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.stop failed: ${result.message}` }] };
  });

  server.registerTool('execution.complete', {
    description: 'Coordinator-only durable completion for one Team job, with a final summary.', inputSchema: executionCompleteSchema
  }, async ({ executionId, summary }) => {
    if (!authorized()) return denied('execution.complete');
    const bound = await binding(executionId);
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

  server.registerTool('execution.retry', {
    description: 'Retry a pre-dispatch blocked execution using a fresh Team launch identity.', inputSchema: executionControlSchema
  }, async ({ executionId, expectedStateVersion }) => {
    if (!authorized()) return denied('execution.retry');
    const result = await options.service.retry(options.sessionId!, options.projectId, executionId, expectedStateVersion);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.retry failed: ${result.message}` }] };
  });

  server.registerTool('execution.respond', {
    description: 'Deliver a response to one authorized execution slot.', inputSchema: executionMessageSchema
  }, async ({ executionId, expectedStateVersion, slotId, message }) => {
    if (!authorized()) return denied('execution.respond');
    const result = await options.service.respond(options.sessionId!, options.projectId, executionId, expectedStateVersion, slotId, message);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.respond failed: ${result.message}` }] };
  });

  server.registerTool('execution.resume', {
    description: 'Resume a blocked execution by delivering a message to one authorized live slot. Does not relaunch stopped work.', inputSchema: executionMessageSchema
  }, async ({ executionId, expectedStateVersion, slotId, message }) => {
    if (!authorized()) return denied('execution.resume');
    const result = await options.service.resume(options.sessionId!, options.projectId, executionId, expectedStateVersion, slotId, message);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.resume failed: ${result.message}` }] };
  });

  server.registerTool('execution.artifact.put', {
    description: 'Store one write-once, content-addressed execution artifact.', inputSchema: executionArtifactSchema
  }, async ({ executionId, name, mediaType, content }) => {
    if (!authorized()) return denied('execution.artifact.put');
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

  server.registerTool('execution.artifact.list', {
    description: 'List execution artifacts scoped to this authenticated project and caller.', inputSchema: executionIdSchema
  }, async ({ executionId }) => {
    if (!authorized()) return denied('execution.artifact.list');
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
      if (!options.validateHandoffTarget!(options.sessionId!, targetSessionId, options.projectId)) {
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
    server.registerTool('request_execution_handoff', {
      description: 'Request one short-lived, single-use execution.control capability for a live session in this project.',
      inputSchema: handoffRequestSchema
    }, async ({ targetSessionId, executionId, operations }) => {
      if (!authorized()) return denied('request_execution_handoff');
      return requestHandoff(targetSessionId, executionId, operations[0]);
    });

    server.registerTool('request_execution_resume_monitor_handoff', {
      description: 'Request one approved resume plus ten-minute read-only monitoring capability for one live session and bound execution.', inputSchema: resumeMonitorRequestSchema
    }, async ({ targetSessionId, executionId }) => {
      if (!authorized()) return denied('request_execution_resume_monitor_handoff');
      return requestHandoff(targetSessionId, executionId, EXECUTION_RESUME_MONITOR_OPERATION);
    });

    server.registerTool('request_execution_monitor_handoff', {
      description: 'Request fresh human approval for another ten-minute read-only monitor window on one live execution.', inputSchema: monitorRequestSchema
    }, async ({ targetSessionId, executionId }) => {
      if (!authorized()) return denied('request_execution_monitor_handoff');
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

    server.registerTool('execute_execution_handoff', {
      description: 'Use one handoff capability from its exact target session to stop, respond to, or resume its bound execution.',
      inputSchema: handoffExecuteSchema
    }, async ({ token, executionId, expectedStateVersion, action, slotId, message }) => {
      if (!authorized()) return denied('execute_execution_handoff');
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

    server.registerTool('execute_execution_resume_monitor_handoff', {
      description: 'Consume an approved one-time resume handoff, then receive a ten-minute read-only monitor token.', inputSchema: resumeMonitorExecuteSchema
    }, async ({ token, executionId, expectedStateVersion, slotId, message }) => {
      if (!authorized()) return denied('execute_execution_resume_monitor_handoff');
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
    server.registerTool('execution_handoff_status', { description: 'Read status using one valid ten-minute resume-monitor capability.', inputSchema: monitorStatusSchema }, async ({ token, executionId }) => {
      if (!authorized()) return denied('execution_handoff_status');
      try {
        const grant = await readMonitor(token, executionId);
        const record = await options.service.status(grant.sourceOwnerSessionId, grant.projectId, grant.executionId);
        return record ? { content: [{ type: 'text' as const, text: JSON.stringify(toMcpSafeExecution(record)) }] } : { isError: true, content: [{ type: 'text' as const, text: 'execution_handoff_status failed: execution not found.' }] };
      } catch { return { isError: true, content: [{ type: 'text' as const, text: 'execution_handoff_status failed: monitor capability is not current.' }] }; }
    });
    server.registerTool('execution_handoff_events', { description: 'Read events using one valid ten-minute resume-monitor capability.', inputSchema: monitorEventsSchema }, async ({ token, executionId, after, limit }) => {
      if (!authorized()) return denied('execution_handoff_events');
      try {
        const grant = await readMonitor(token, executionId);
        const events = await options.service.events(grant.sourceOwnerSessionId, grant.projectId, grant.executionId, after ?? 0, limit ?? 100);
        return { content: [{ type: 'text' as const, text: JSON.stringify(events) }] };
      } catch { return { isError: true, content: [{ type: 'text' as const, text: 'execution_handoff_events failed: monitor capability is not current.' }] }; }
    });
  }

}
