// @ts-nocheck
import { dialog, type BrowserWindow } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import { projectExecutionProjection, executionBoardProjection } from '@zana-ai/zcc-server/services/execution/projection';
import { resolveExecutionMessageArgs } from '@zana-ai/zcc-server/services/execution/message-compat';
import { relaunchExecutionMonitor } from '@zana-ai/zcc-server/services/execution/relaunch-monitor';
import { ExecutionSourceError } from '@zana-ai/zcc-server/services/execution/source-registry';
import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';
import type {
  Result,
  TeamJobLaunchInput,
  TeamJobLaunchResult,
  ExecutionBoardProjection,
  ExecutionBoardSnapshot
} from '@zana-ai/zcc-domain/product';

export function registerExecutionBoardIpc(): void {
  const { safeHandle, safeHandleFromWindow, ptys, teams, personas, windows,
    executionStore, executionResumeTokens, executionSources, squadExecutionService,
    startTeamJobFromUi, getTeamLaunch, createTerminalConfined } = ctx;

  const isExecutionProjectAllowed = (win: BrowserWindow, projectId: string) => {
    const scopedProjectId = windows.get(win.id)?.projectId;
    return !scopedProjectId || scopedProjectId === projectId;
  };

  const executionProjection = (record: ExecutionRecord): ExecutionBoardProjection => {
    const live = ptys.list(record.projectId).find((session) => session.cohort?.executionId === record.id
      && session.cohort.role === 'orchestrator' && session.status !== 'exited');
    return executionBoardProjection(record, live?.id);
  };
  const executionBoardOwner = async (projectId: string, executionId: string) =>
    (await executionStore.getInProject(projectId, executionId))?.callerPrincipalId;

  // Team job launch (Job Team). main authorizes the whole launch and stamps the
  // originating window; a project the window is not scoped to is rejected (Rule 1).
  safeHandleFromWindow<[TeamJobLaunchInput], Result<TeamJobLaunchResult>>(
    IPC.teams.startJob,
    (win, input) => !isExecutionProjectAllowed(win, input?.projectId)
      ? { ok: false, code: 'NOT_FOUND', message: 'project not found' }
      : startTeamJobFromUi(input, { windowId: win.id }),
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'Team job launch unavailable' })
  );

  safeHandleFromWindow<[string, number | undefined, number | undefined], { executions: ExecutionBoardProjection[]; hasMore: boolean }>(
    IPC.executionBoard.listProject,
    async (win, projectId, before, limit = 50) => {
      if (typeof projectId !== 'string' || !projectId.trim()) return { executions: [], hasMore: false };
      if (!isExecutionProjectAllowed(win, projectId)) return { executions: [], hasMore: false };
      const project = store.listProjects().find((candidate) => candidate.id === projectId);
      if (!project) return { executions: [], hasMore: false };
      const page = await squadExecutionService.listProject(project.id, before, limit);
      const executions = projectExecutionProjection(page.records, ptys.list(project.id)).map((execution) => ({
        ...execution,
        hasResumeToken: executionResumeTokens.status(project.id, execution.executionId).state === 'available',
        teamName: teams.list().find((team) => team.id === execution.teamId)?.name ?? execution.teamId
      }));
      return { executions, hasMore: page.hasMore };
    },
    () => ({ executions: [], hasMore: false })
  );

  safeHandleFromWindow<[string, string, number | undefined], ExecutionBoardSnapshot | undefined>(
    IPC.executionBoard.snapshot,
    async (win, projectId, executionId, after) => {
      if (typeof projectId !== 'string' || typeof executionId !== 'string'
        || !isExecutionProjectAllowed(win, projectId)
        || !store.listProjects().some((project) => project.id === projectId)) return undefined;
      const record = await executionStore.getInProject(projectId, executionId);
      if (!record) return undefined;
      const snapshot = await squadExecutionService.snapshot(record.callerPrincipalId, projectId, executionId,
        typeof after === 'number' && Number.isInteger(after) && after >= 0 ? after : 0);
      if (!snapshot) return undefined;
      const execution = executionProjection(snapshot.execution);
      return {
        execution,
        events: snapshot.events.map(({ id, sequence, severity, summary, createdAt, detail, blocker, progress, slotId, producerRole, eventType, references }) =>
          ({ id, sequence, severity, summary, createdAt, ...(detail ? { detail } : {}), ...(blocker ? { blocker } : {}), ...(progress ? { progress } : {}), ...(slotId ? { slotId } : {}), ...(producerRole ? { producerRole } : {}), ...(eventType ? { eventType } : {}), ...(references ? { references } : {}) })),
        nextAfter: snapshot.nextAfter,
        truncated: snapshot.truncated,
        artifacts: snapshot.artifacts.map(({ id, name, mediaType, contentDigest, attempt, createdAt, producerRole, producerSlotId }) =>
          ({ id, name, mediaType, contentDigest, attempt, createdAt, ...(producerRole ? { producerRole } : {}), ...(producerSlotId ? { producerSlotId } : {}) })),
        artifactsTruncated: snapshot.artifactsTruncated
      };
    },
    () => undefined
  );

  safeHandleFromWindow<[string, string, string], Result<{ content: string }>>(
    IPC.executionBoard.readArtifact,
    async (win, projectId, executionId, artifactId) => {
      if (!isExecutionProjectAllowed(win, projectId)) return { ok: false, code: 'NOT_FOUND', message: 'execution artifact not found' };
      const record = await executionStore.getInProject(projectId, executionId);
      if (!record) return { ok: false, code: 'NOT_FOUND', message: 'execution artifact not found' };
      const artifact = await squadExecutionService.readArtifact(record.callerPrincipalId, projectId, executionId, artifactId);
      return artifact ? { ok: true, value: { content: artifact.content } } : { ok: false, code: 'NOT_FOUND', message: 'execution artifact not found' };
    },
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'Execution artifact unavailable' })
  );

  safeHandleFromWindow<[string, string], Result<{ dismissedSessionIds: string[] }>>(
    IPC.executionBoard.dismiss,
    async (win, projectId, executionId) => {
      if (!isExecutionProjectAllowed(win, projectId)) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      const owner = await executionBoardOwner(projectId, executionId);
      if (!owner) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      const result = await squadExecutionService.dismiss(owner, projectId, executionId);
      return result.ok ? { ok: true, value: result.value } : { ok: false, code: result.code, message: result.message };
    },
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'execution dismissal unavailable' })
  );

  safeHandleFromWindow<[string, string, number], Result<ExecutionBoardProjection>>(
    IPC.executionBoard.stop,
    async (win, projectId, executionId, expectedStateVersion) => {
      if (!isExecutionProjectAllowed(win, projectId)) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      if (!Number.isInteger(expectedStateVersion)) {
        return { ok: false, code: 'INVALID', message: 'invalid execution control request' };
      }
      const owner = await executionBoardOwner(projectId, executionId);
      if (!owner) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      const result = await squadExecutionService.stop(owner, projectId, executionId, expectedStateVersion);
      return result.ok
        ? { ok: true, value: executionProjection(result.value) }
        : { ok: false, code: result.code, message: result.message };
    },
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'execution control unavailable' })
  );

  const executionMessageControl = async (
    action: 'respond' | 'resume', projectId: string, executionId: string,
    expectedStateVersion: number, blockerId: string, clientRequestId: string, message: string
  ): Promise<Result<ExecutionBoardProjection>> => {
    if (!Number.isInteger(expectedStateVersion) || typeof blockerId !== 'string' || !blockerId.trim()
      || typeof clientRequestId !== 'string' || !clientRequestId.trim() || typeof message !== 'string') {
      return { ok: false, code: 'INVALID', message: 'invalid execution message request' };
    }
    const owner = await executionBoardOwner(projectId, executionId);
    if (!owner) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
    const result = action === 'respond'
      ? await squadExecutionService.respondToBlocker(owner, projectId, executionId, expectedStateVersion, blockerId, clientRequestId, message)
      : await squadExecutionService.resumeBlocker(owner, projectId, executionId, expectedStateVersion, blockerId, clientRequestId, message);
    return result.ok
      ? { ok: true, value: executionProjection(result.value) }
      : { ok: false, code: result.code, message: result.message };
  };
  const executionMessageHandler = (action: 'respond' | 'resume') => async (win: BrowserWindow, projectId: string, executionId: string, expectedStateVersion: number, ...args: string[]) => {
    if (!isExecutionProjectAllowed(win, projectId)) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found' };
    const record = await executionStore.getInProject(projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found' };

    let effectiveStateVersion = expectedStateVersion;
    if (expectedStateVersion === -1) {
      effectiveStateVersion = record.stateVersion;
    }

    const resolved = resolveExecutionMessageArgs(executionId, effectiveStateVersion, record.blockers ?? [], args);
    if (!resolved) return { ok: false as const, code: 'NOT_FOUND', message: 'execution blocker not found' };
    if ('error' in resolved) return { ok: false as const, code: 'CONFLICT', message: resolved.error ?? 'execution blocker is ambiguous' };

    const blocker = record.blockers?.find((b) => b.id === resolved.blockerId);
    if (!blocker) return { ok: false as const, code: 'NOT_FOUND', message: 'execution blocker not found' };
    if (blocker.resolved) return { ok: false as const, code: 'CONFLICT', message: 'execution blocker is already resolved' };

    return executionMessageControl(action, projectId, executionId, effectiveStateVersion, resolved.blockerId, resolved.clientRequestId, resolved.message);
  };
  safeHandleFromWindow<[string, string, number, ...string[]], Result<ExecutionBoardProjection>>(IPC.executionBoard.respond,
    executionMessageHandler('respond'),
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'execution control unavailable' })
  );
  safeHandleFromWindow<[string, string, number, ...string[]], Result<ExecutionBoardProjection>>(IPC.executionBoard.resume,
    executionMessageHandler('resume'),
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'execution control unavailable' })
  );

  safeHandleFromWindow<[string, string, number, string, string], Result<ExecutionBoardProjection>>(
    IPC.executionBoard.retryDelivery,
    async (win, projectId, executionId, expectedStateVersion, blockerId, deliveryId) => {
      if (!isExecutionProjectAllowed(win, projectId)) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      if (!Number.isInteger(expectedStateVersion) || typeof blockerId !== 'string' || !blockerId.trim()
        || typeof deliveryId !== 'string' || !deliveryId.trim()) {
        return { ok: false, code: 'INVALID', message: 'invalid execution delivery retry request' };
      }
      const owner = await executionBoardOwner(projectId, executionId);
      if (!owner) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      const result = await squadExecutionService.retryBlockerDelivery(owner, projectId, executionId, expectedStateVersion, blockerId, deliveryId);
      return result.ok ? { ok: true, value: executionProjection(result.value) }
        : { ok: false, code: result.code, message: result.message };
    },
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'execution control unavailable' })
  );

  safeHandleFromWindow<[string, string, number], Result<ExecutionBoardProjection>>(
    IPC.executionBoard.retry,
    async (win, projectId, executionId, expectedStateVersion) => {
      if (!isExecutionProjectAllowed(win, projectId)) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      if (!Number.isInteger(expectedStateVersion)) {
        return { ok: false, code: 'INVALID', message: 'invalid execution control request' };
      }
      const owner = await executionBoardOwner(projectId, executionId);
      if (!owner) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      const result = await squadExecutionService.retry(owner, projectId, executionId, expectedStateVersion);
      return result.ok
        ? { ok: true, value: executionProjection(result.value) }
        : { ok: false, code: result.code, message: result.message };
    },
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'execution control unavailable' })
  );

  const executionWorkControl = async (
    action: 'retry' | 'release' | 'reassign', projectId: string, executionId: string,
    expectedStateVersion: number, workUnitId: string, assignedSlotId?: string
  ): Promise<Result<ExecutionBoardProjection>> => {
    if (!Number.isInteger(expectedStateVersion) || typeof workUnitId !== 'string' || !workUnitId.trim()
      || assignedSlotId !== undefined && (typeof assignedSlotId !== 'string' || !assignedSlotId.trim())) {
      return { ok: false, code: 'INVALID', message: 'invalid execution work control request' };
    }
    const owner = await executionBoardOwner(projectId, executionId);
    if (!owner) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
    const result = action === 'retry'
      ? await squadExecutionService.retryWorkFromBoard(owner, projectId, executionId, expectedStateVersion, workUnitId, assignedSlotId)
      : action === 'release'
        ? await squadExecutionService.releaseWorkFromBoard(owner, projectId, executionId, expectedStateVersion, workUnitId)
        : await squadExecutionService.reassignWorkFromBoard(owner, projectId, executionId, expectedStateVersion, workUnitId, assignedSlotId!);
    return result.ok ? { ok: true, value: executionProjection(result.value) }
      : { ok: false, code: result.code, message: result.message };
  };
  safeHandleFromWindow<[string, string, number, string, string | undefined], Result<ExecutionBoardProjection>>(
    IPC.executionBoard.retryWork,
    (win, projectId, executionId, expectedStateVersion, workUnitId, assignedSlotId) => isExecutionProjectAllowed(win, projectId)
      ? executionWorkControl('retry', projectId, executionId, expectedStateVersion, workUnitId, assignedSlotId)
      : { ok: false as const, code: 'NOT_FOUND', message: 'execution not found' },
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'execution control unavailable' })
  );
  safeHandleFromWindow<[string, string, number, string], Result<ExecutionBoardProjection>>(
    IPC.executionBoard.releaseWork,
    (win, projectId, executionId, expectedStateVersion, workUnitId) => isExecutionProjectAllowed(win, projectId)
      ? executionWorkControl('release', projectId, executionId, expectedStateVersion, workUnitId)
      : { ok: false as const, code: 'NOT_FOUND', message: 'execution not found' },
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'execution control unavailable' })
  );
  safeHandleFromWindow<[string, string, number, string, string], Result<ExecutionBoardProjection>>(
    IPC.executionBoard.reassignWork,
    (win, projectId, executionId, expectedStateVersion, workUnitId, assignedSlotId) => isExecutionProjectAllowed(win, projectId)
      ? executionWorkControl('reassign', projectId, executionId, expectedStateVersion, workUnitId, assignedSlotId)
      : { ok: false as const, code: 'NOT_FOUND', message: 'execution not found' },
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'execution control unavailable' })
  );

  safeHandleFromWindow<[string, string], Result<true>>(
    IPC.executionBoard.clearResumeToken,
    async (win, projectId, executionId) => {
      if (!isExecutionProjectAllowed(win, projectId)) return { ok: false, code: 'NOT_FOUND', message: 'execution not found for project' };
      const project = store.listProjects().find((candidate) => candidate.id === projectId);
      const record = project ? await executionStore.getInProject(project.id, executionId) : undefined;
      if (!project || !record) return { ok: false, code: 'NOT_FOUND', message: 'execution not found for project' };
      try {
        executionResumeTokens.clear(project.id, record.id);
        return { ok: true, value: true };
      } catch (error) {
        return { ok: false, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
      }
    },
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'execution token unavailable' })
  );

  safeHandleFromWindow<[string, string], Result<{ sessionId: string }>>(
    IPC.executionBoard.relaunchMonitor,
    async (win, projectId, executionId) => {
      if (!isExecutionProjectAllowed(win, projectId)) return { ok: false, code: 'NOT_FOUND', message: 'execution not found for project' };
      return relaunchExecutionMonitor({
        findProject: (id) => store.listProjects().find((candidate) => candidate.id === id),
        getExecution: (id, execution) => executionStore.getInProject(id, execution),
        confirm: async (record) => (await dialog.showMessageBox({
          type: 'question', buttons: ['Launch monitor', 'Cancel'], defaultId: 1, cancelId: 1,
          title: 'Relaunch execution monitor', message: `Launch a monitor for "${record.jobTitle}"?`,
          detail: 'Rotation creates a replacement credential, invalidates every older credential, and grants the new monitor access until the fixed recovery deadline.'
        })).response === 0,
        rotateRecovery: async (id, execution, expectedStateVersion, expectedGeneration) => {
          const rotated = await squadExecutionService.rotateRecoveryGrant(id, execution, expectedStateVersion, expectedGeneration);
          return rotated.ok
            ? { ok: true as const, value: { token: rotated.value.token, generation: rotated.value.generation } }
            : rotated;
        },
        readSource: (contentRef, sourceId, offset) => executionSources.read(contentRef, sourceId, { offset, maxBytes: 64 * 1024 }),
        getWorkerRoster: async (record) => {
          const result = await getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
          const lifecycle = (result.ok ? result.value : undefined) as {
            workers?: Array<{ slotId?: string; sessionId?: string; title?: string; process?: string }>;
          } | undefined;
          return (lifecycle?.workers ?? []).filter((worker) => worker.slotId).map((worker) => ({
            slotId: worker.slotId!, ...(worker.sessionId ? { sessionId: worker.sessionId } : {}),
            ...(worker.title ? { label: worker.title } : {}), ...(worker.process ? { status: worker.process } : {})
          }));
        },
        findOrchestratorPersona: () => personas.list().find((candidate) => candidate.id === 'builtin:orchestrator'),
        createMonitor: createTerminalConfined,
        bindMonitor: (sessionId, id, execution, token) => squadExecutionService.resumeBinding(sessionId, id, execution, token),
        closeMonitor: (sessionId) => ptys.close(sessionId),
        clearToken: (id, execution) => executionResumeTokens.clear(id, execution),
        revokeBinding: (sessionId, id, execution) => squadExecutionService.abandonResumeBinding(id, execution, sessionId),
        waitBeforeBindRetry: (attempt) => new Promise((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1)))
      }, projectId, executionId);
    },
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'monitor relaunch unavailable' })
  );

  safeHandleFromWindow<[string], Result<Awaited<ReturnType<typeof executionSources.issue>>>>(
    IPC.executionSources.pick,
    async (win, projectId) => {
      if (typeof projectId !== 'string' || !store.listProjects().some((project) => project.id === projectId)) {
        return { ok: false, code: 'NOT_FOUND', message: 'project not found' };
      }
      const scopedProjectId = windows.get(win.id)?.projectId;
      if (scopedProjectId && scopedProjectId !== projectId) {
        return { ok: false, code: 'NOT_FOUND', message: 'project not found' };
      }
      const pick = await dialog.showOpenDialog(win, {
        title: 'Add execution sources',
        properties: ['openFile', 'multiSelections']
      });
      if (pick.canceled) return { ok: true, value: [] };
      try {
        return { ok: true, value: await executionSources.issue({ windowId: win.id, projectId, paths: pick.filePaths }) };
      } catch (error) {
        return error instanceof ExecutionSourceError
          ? { ok: false, code: error.code, message: error.message }
          : { ok: false, code: 'SOURCE_SELECTION_FAILED', message: error instanceof Error ? error.message : String(error) };
      }
    },
    () => ({ ok: false, code: 'UNAVAILABLE', message: 'Execution source chooser unavailable' })
  );
}
