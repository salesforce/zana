import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SquadExecutionRequestV1, SquadExecutionService } from './execution/service.js';
import { EXECUTION_HANDOFF_OPERATION, EXECUTION_RESUME_MONITOR_OPERATION, type createExecutionHandoffStore } from './execution/handoff-store.js';

const slotSchema = z.object({
  initialTask: z.string().min(1).max(64 * 1024)
});
const executionStartSchema = {
  version: z.literal(1),
  teamId: z.string().min(1),
  launchRequestId: z.string().min(1).max(256),
  jobTitle: z.string().min(1).max(240).optional(),
  summary: z.string().min(1).max(2048).optional(),
  slots: z.array(slotSchema).min(1).max(100),
  deadlineMs: z.number().int().min(1).max(24 * 60 * 60 * 1000).optional(),
  maxConcurrent: z.number().int().min(1).max(32).optional(),
  maxLaunches: z.number().int().min(1).max(32).optional(),
  workflow: z.unknown().optional()
};

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
const executionArtifactSchema = { ...executionIdSchema, name: z.string().min(1).max(512), mediaType: z.string().min(1).max(512), content: z.string().min(1).max(64 * 1024) };
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
  service: SquadExecutionService;
  validateRouteIdentity?: (sessionId: string, projectId: string) => boolean;
  handoffs?: ReturnType<typeof createExecutionHandoffStore>;
  validateHandoffTarget?: (sourceSessionId: string, targetSessionId: string, projectId: string) => boolean;
  approveHandoff?: (sourceSessionId: string, targetSessionId: string, projectId: string, executionId: string, operation: typeof EXECUTION_HANDOFF_OPERATION | typeof EXECUTION_RESUME_MONITOR_OPERATION) => Promise<boolean>;
}

function denied(name: string) {
  return { isError: true, content: [{ type: 'text' as const, text: `${name} failed: originating session is not live in this project.` }] };
}

export function registerExecutionTools(server: McpServer, options: RegisterExecutionToolOptions): void {
  const authorized = (): boolean => !!options.sessionId
    && (options.validateRouteIdentity?.(options.sessionId, options.projectId) ?? false);

  server.registerTool('execution.start', {
    description: 'Start one generic, project-scoped Squad execution. Main authorizes Team slots and stores job identity before launch.',
    inputSchema: executionStartSchema
  }, async ({ version, teamId, launchRequestId, jobTitle, summary, slots, deadlineMs, maxConcurrent, maxLaunches, workflow }) => {
    if (!authorized()) return denied('execution.start');
    const request: SquadExecutionRequestV1 = {
      version, teamId, launchRequestId, jobTitle, summary, slots, ...(workflow === undefined ? {} : { workflow: workflow as SquadExecutionRequestV1['workflow'] }),
      policy: {
        ...(deadlineMs === undefined ? {} : { deadlineMs }),
        ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
        ...(maxLaunches === undefined ? {} : { maxLaunches })
      }
    };
    const result = await options.service.start(options.sessionId!, options.projectId, request);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.start failed: ${result.message}` }] };
  });

  server.registerTool('execution.status', {
    description: 'Read one project-scoped Squad execution.', inputSchema: executionIdSchema
  }, async ({ executionId }) => {
    if (!authorized()) return denied('execution.status');
    const record = await options.service.status(options.sessionId!, options.projectId, executionId);
    return record
      ? { content: [{ type: 'text' as const, text: JSON.stringify(record) }] }
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
    description: 'List recent project-scoped Squad executions started by this session identity.', inputSchema: {}
  }, async () => {
    if (!authorized()) return denied('execution.list');
    const records = await options.service.list(options.sessionId!, options.projectId);
    return { content: [{ type: 'text' as const, text: JSON.stringify(records) }] };
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
      const snapshot = await options.service.snapshot(options.sessionId!, options.projectId, executionId, after ?? 0);
      if (!snapshot) return { isError: true, content: [{ type: 'text' as const, text: 'execution.snapshot failed: execution not found for caller.' }] };
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ...snapshot,
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
    const result = await options.service.putArtifact(options.sessionId!, options.projectId, executionId, name, mediaType, content);
    return result.ok
      ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
      : { isError: true, content: [{ type: 'text' as const, text: `execution.artifact.put failed: ${result.message}` }] };
  });

  server.registerTool('execution.artifact.list', {
    description: 'List execution artifacts scoped to this authenticated project and caller.', inputSchema: executionIdSchema
  }, async ({ executionId }) => {
    if (!authorized()) return denied('execution.artifact.list');
    const artifacts = await options.service.listArtifacts(options.sessionId!, options.projectId, executionId);
    return artifacts
      ? { content: [{ type: 'text' as const, text: JSON.stringify(artifacts) }] }
      : { isError: true, content: [{ type: 'text' as const, text: 'execution.artifact.list failed: execution not found for caller.' }] };
  });

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
        return record ? { content: [{ type: 'text' as const, text: JSON.stringify(record) }] } : { isError: true, content: [{ type: 'text' as const, text: 'execution_handoff_status failed: execution not found.' }] };
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
