import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService, deriveJobTitle } from '../execution/service.js';
import { createExecutionStore } from '../execution/store.js';
import { createExecutionArtifactStore } from '../execution/artifact-store.js';
import { createResumeGrantStore } from '../execution/resume-grant-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-service-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release\nignored',
  slots: [{ initialTask: 'Run tests' }]
};

function deps(filePath: string, over: Partial<ConstructorParameters<typeof SquadExecutionService>[0]> = {}) {
  return {
    store: createExecutionStore({ filePath, id: () => 'execution-1' }),
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] }
    } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }),
    replyToSession: () => true,
    ...over
  };
}

describe('SquadExecutionService', () => {
  it('requires the live coordinator for explicit completion', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }));
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await expect(service.completeByCoordinator('worker-1', 'project-1', 'execution-1', 'done')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.completeByCoordinator('coordinator', 'project-1', 'execution-1', 'done')).resolves.toMatchObject({ ok: true, value: { state: 'COMPLETED' } });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
  }));

  it('fails only the original coordinator exit, not a replacement monitor', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }));
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.failCoordinatorExit('project-1', 'execution-1', 'monitor');
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
    await service.failCoordinatorExit('project-1', 'execution-1', 'coordinator');
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
  }));

  it('stops an overdue execution and cancels its Team lifecycle', async () => fixture(async (filePath) => {
    let now = Date.now();
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, {
      now: () => now,
      cancelTeamLaunch,
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] })
    }));
    await service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 100 } });
    now += 101;
    await expect(service.status('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ state: 'STOPPED' });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
  }));

  it('prefers caller job title and launches only after durable reservation and authorization', async () => fixture(async (filePath) => {
    const authorizeTeamLaunch = vi.fn(() => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTask: 'Run tests', authorizationId: 'auth-1' }],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [{ slotId: 'slot-1', personaId: 'persona-1', authorizationIdDigest: 'sha256:auth' }] }
    } }));
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch, launchTeam }));
    const result = await service.start('session-1', 'project-1', { ...request, jobTitle: 'Caller title' });
    expect(result).toMatchObject({ ok: true, value: { id: 'execution-1', jobTitle: 'Caller title', state: 'RUNNING', authorizationContext: { principalId: 'team:team-1:session-1:request-1' }, authorizationContextDigest: expect.any(String), launchIntent: { slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTaskDigest: expect.any(String) }] } } });
    expect(authorizeTeamLaunch).toHaveBeenCalledWith('session-1', 'team-1', 'project-1', 'request-1', {}, request.slots);
    expect(launchTeam).toHaveBeenCalledWith('team-1', 'project-1', expect.objectContaining({ requirePreauthorization: true }));
  }));

  it('blocks before launch when Team authorization rejects', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn();
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch: () => ({ ok: false as const, code: 'DENIED', message: 'team disabled' }), launchTeam, getTeamLaunch: async () => undefined }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toEqual({ ok: false, code: 'DENIED', message: 'team disabled' });
    expect(launchTeam).not.toHaveBeenCalled();
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('BLOCKED');
  }));

  it('retries a pre-dispatch authorization block with a fresh Team launch request', async () => fixture(async (filePath) => {
    let calls = 0;
    const authorizeTeamLaunch = vi.fn((_caller: string, _team: string, _project: string, launchRequestId: string) => {
      calls += 1;
      if (calls === 1) return { ok: false as const, code: 'DENIED', message: 'team temporarily disabled' };
      return { ok: true as const, value: {
        teamId: 'team-1', projectId: 'project-1', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTask: 'Run tests', authorizationId: 'fresh-auth' }],
        context: { version: 1 as const, principalId: `team:team-1:session-1:${launchRequestId}`, authorizedAt: 10, expiresAt: 20, slots: [{ slotId: 'slot-1', personaId: 'persona-1', authorizationIdDigest: 'sha256:fresh' }] }
      } };
    });
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch, launchTeam }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    const blocked = await service.status('session-1', 'project-1', 'execution-1');
    if (!blocked) throw new Error('missing blocked execution');
    await expect(service.retry('session-1', 'project-1', 'execution-1', blocked.stateVersion)).resolves.toMatchObject({ ok: true, value: { id: 'execution-1', attempt: 2, state: 'RUNNING', teamLaunchRequestId: 'execution-1:attempt:2' } });
    expect(authorizeTeamLaunch).toHaveBeenLastCalledWith('session-1', 'team-1', 'project-1', 'execution-1:attempt:2', {}, request.slots);
    expect(launchTeam).toHaveBeenCalledWith('team-1', 'project-1', expect.objectContaining({ launchRequestId: 'execution-1:attempt:2', executionId: 'execution-1', executionJobTitle: 'Build release' }));
  }));

  it('uses immutable audit owner for retries requested by an effective owner', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let tokenNumber = 0;
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `resume-token-${++tokenNumber}` });
    let calls = 0;
    const authorizeTeamLaunch = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? { ok: false as const, code: 'DENIED', message: 'blocked' }
        : { ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: { version: 1 as const, principalId: 'owner', authorizedAt: 10, expiresAt: 20, slots: [] } } };
    });
    const service = new SquadExecutionService(deps(filePath, { store, resumeGrants: grants, authorizeTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    const grant = await grants.mint({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'session-1' });
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', grant.token)).resolves.toMatchObject({ ok: true });
    const blocked = await store.get('execution-1');
    if (!blocked) throw new Error('missing execution');
    await expect(service.retry('session-2', 'project-1', 'execution-1', blocked.stateVersion)).resolves.toMatchObject({ ok: true });
    expect(authorizeTeamLaunch).toHaveBeenLastCalledWith('session-1', 'team-1', 'project-1', 'execution-1:attempt:2', {}, request.slots);
  }));

  it('reruns workflow profile preflight before retry', async () => fixture(async (filePath) => {
    let preflights = 0;
    const service = new SquadExecutionService(deps(filePath, {
      authorizeTeamLaunch: () => ({ ok: false as const, code: 'DENIED', message: 'team disabled' }),
      preflightWorkflow: () => (++preflights === 1 ? { ok: true } : { ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'profile drifted' })
    }));
    const workflow = { schemaVersion: 1 as const, profileId: 'profile', profileVersion: '1', controller: { personaId: 'controller', slotId: 'orchestrator:controller' }, workers: [], supportedRequestVersions: [1] };
    await service.start('session-1', 'project-1', { ...request, workflow });
    const record = await service.status('session-1', 'project-1', 'execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.retry('session-1', 'project-1', 'execution-1', record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'profile drifted' });
  }));

  it('blocks before launch when Team authorization lacks a durable context', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn();
    const service = new SquadExecutionService(deps(filePath, {
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [] } }),
      launchTeam
    }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, code: 'AUTHORIZATION_CONTEXT_UNAVAILABLE' });
    expect(launchTeam).not.toHaveBeenCalled();
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('BLOCKED');
  }));

  it('derives title from first summary line and confines reads to execution owner', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    expect(deriveJobTitle(request)).toBe('Build release');
    expect(await service.status('replacement-session', 'project-1', 'execution-1')).toBeUndefined();
    expect(await service.list('replacement-session', 'project-1')).toEqual([]);
    expect(await service.events('replacement-session', 'project-1', 'execution-1')).toEqual({ events: [] });
    expect(await service.status('replacement-session', 'other-project', 'execution-1')).toBeUndefined();
    expect(await service.list('replacement-session', 'other-project')).toEqual([]);
    expect(await service.events('replacement-session', 'other-project', 'execution-1')).toEqual({ events: [] });
    await expect(service.stop('replacement-session', 'project-1', 'execution-1', 3)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('rebinds a fresh owner with one durable grant without rewriting audit ownership', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const getTeamLaunch = vi.fn(async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] }));
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants, getTeamLaunch, cancelTeamLaunch }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true, value: { callerPrincipalId: 'session-1', effectiveOwnerPrincipalIds: ['session-2'] } });
    expect(await service.status('session-2', 'project-1', 'execution-1')).toMatchObject({ id: 'execution-1' });
    expect(await service.events('session-2', 'project-1', 'execution-1')).toMatchObject({ events: expect.any(Array) });
    const record = await service.status('session-2', 'project-1', 'execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.stop('session-2', 'project-1', 'execution-1', record.stateVersion)).resolves.toMatchObject({ ok: true });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    await expect(service.resumeBinding('session-3', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: false });
  }));

  it('rejects resume binding while an existing execution owner remains live', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const service = new SquadExecutionService(deps(filePath, {
      resumeGrants: grants,
      hasLivePredecessor: (_projectId, ownerIds) => ownerIds.includes('session-1')
    }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken))
      .resolves.toEqual({ ok: false, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor' });
  }));

  it('serializes competing resume bindings so only one replacement owner is admitted', async () => fixture(async (filePath) => {
    let token = 0;
    let firstCheck = true;
    let releaseCheck!: () => void;
    const checkStarted = new Promise<void>((resolve) => { releaseCheck = resolve; });
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `resume-token-${++token}` });
    const service = new SquadExecutionService(deps(filePath, {
      resumeGrants: grants,
      hasLivePredecessor: (_projectId, ownerIds) => {
        if (firstCheck) {
          firstCheck = false;
          releaseCheck();
          return false;
        }
        return ownerIds.includes('session-2');
      }
    }));
    await service.start('session-1', 'project-1', request);
    const first = await grants.mint({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'session-1' });
    const second = await grants.mint({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'session-1' });
    const binding = service.resumeBinding('session-2', 'project-1', 'execution-1', first.token);
    await checkStarted;
    const competing = service.resumeBinding('session-3', 'project-1', 'execution-1', second.token);
    await expect(binding).resolves.toMatchObject({ ok: true });
    await expect(competing).resolves.toEqual({
      ok: false, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor'
    });
  }));

  it('recovers a consumed binding after transient effective-owner persistence failure', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const addEffectiveOwner = store.addEffectiveOwner;
    let failOnce = true;
    const service = new SquadExecutionService(deps(filePath, {
      store: { ...store, addEffectiveOwner: async (...args) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('temporary write failure');
        }
        return addEffectiveOwner(...args);
      } },
      resumeGrants: grants
    }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: false, code: 'BINDING_TRANSIENT' });
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true, value: { effectiveOwnerPrincipalIds: ['session-2'] } });
  }));

  it('lets immutable owner mint a replacement grant after start token is lost', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'replacement-token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants }));
    await service.start('session-1', 'project-1', request);
    await expect(service.mintResumeGrant('other', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.mintResumeGrant('session-1', 'project-1', 'execution-1')).resolves.toEqual({ ok: true, value: { token: 'replacement-token', expiresAt: expect.any(Number) } });
  }));

  it('revokes durable grants and clears in-app token after terminal service transition', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const clearResumeToken = vi.fn();
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants, clearResumeToken }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    const record = await service.status('session-1', 'project-1', 'execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.stop('session-1', 'project-1', 'execution-1', record.stateVersion)).resolves.toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    expect(clearResumeToken).toHaveBeenCalledWith('project-1', 'execution-1');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('writes the initial resume token only through main-owned storage', async () => fixture(async (filePath) => {
    const cacheResumeToken = vi.fn();
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants, cacheResumeToken }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: true });
    expect(cacheResumeToken).toHaveBeenCalledWith('project-1', 'execution-1', 'resume-token', expect.any(Number));
  }));

  it('permits a fresh owner to bind and resume a blocked execution', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, resumeGrants: grants }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    const blocked = await store.transition('execution-1', running.stateVersion, 'BLOCKED', 'warning', 'Waiting');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true });
    await expect(service.resume('session-2', 'project-1', 'execution-1', blocked.stateVersion + 1, 'slot-1', 'Continue')).resolves.toMatchObject({ ok: true, value: { state: 'RUNNING' } });
  }));

  it('rejects a consumed handoff when its execution became terminal', async () => fixture(async (filePath) => {
    const dependencySet = deps(filePath);
    const cancelTeamLaunch = vi.fn(dependencySet.cancelTeamLaunch);
    const service = new SquadExecutionService({ ...dependencySet, cancelTeamLaunch });
    await service.start('session-1', 'project-1', request);
    const running = await service.status('session-1', 'project-1', 'execution-1');
    if (!running) throw new Error('missing execution');
    await dependencySet.store.transition('execution-1', running.stateVersion, 'COMPLETED', 'info', 'Execution completed');
    await expect(service.controlWithHandoff({ sourceOwnerSessionId: 'session-1', projectId: 'project-1', executionId: 'execution-1' }, 'stop', running.stateVersion + 1)).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
    expect(cancelTeamLaunch).not.toHaveBeenCalled();
  }));

  it('records producer events once with stable sequence and owner scope', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    const input = { id: 'event-1', slotId: 'slot-1', type: 'blocker' as const, severity: 'warning' as const, summary: 'Need input', blocker: { question: 'Ship now?', options: ['yes', 'no'] } };
    await expect(service.reportEvent('other', 'project-1', 'execution-1', input)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.reportEvent('session-1', 'project-1', 'execution-1', input)).resolves.toMatchObject({ ok: true, value: { outcome: 'accepted', event: { sequence: expect.any(Number), blocker: input.blocker } } });
    await expect(service.reportEvent('session-1', 'project-1', 'execution-1', input)).resolves.toMatchObject({ ok: true, value: { outcome: 'replay' } });
  }));


  it('completes worker-only Teams from worker task reports', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ workers: [{ projectId: 'project-1', task: 'caller-reported-complete' }] }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('COMPLETED');
  }));

  it('blocks a replay when lifecycle evidence is missing instead of trusting durable execution state', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => undefined }));
    await service.start('session-1', 'project-1', request);
    await expect(service.start('session-1', 'project-1', request)).resolves.toEqual({
      ok: false, code: 'BLOCKED', message: 'execution is blocked'
    });
  }));

  it('records failed state when authorization throws', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch: () => { throw new Error('authorization store unavailable'); }, getTeamLaunch: async () => undefined }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, message: 'authorization store unavailable' });
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
  }));

  it('does not report a failed launch as success after a concurrent state update', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const launchTeam = vi.fn(async () => {
      const record = await store.get('execution-1');
      if (!record) throw new Error('missing execution');
      await store.event(record.id, record.stateVersion, 'info', 'Concurrent update');
      throw new Error('launch transport failed');
    });
    const service = new SquadExecutionService(deps(filePath, { store, launchTeam }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
    expect((await store.get('execution-1'))?.state).toBe('FAILED');
  }));

  it('does not block status polling during durable startup before Team lifecycle exists', async () => fixture(async (filePath) => {
    let releaseAuthorization!: () => void;
    const authorization = new Promise<never>((_resolve, reject) => { releaseAuthorization = () => reject(new Error('stop test')); });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, authorizeTeamLaunch: () => authorization, getTeamLaunch: async () => undefined }));
    const start = service.start('session-1', 'project-1', request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('STARTING');
    releaseAuthorization();
    await expect(start).resolves.toMatchObject({ ok: false });
  }));

  it('recovers stale startup without Team lifecycle as a blocker', async () => fixture(async (filePath) => {
    let now = 0;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    const claimed = await store.claim({
      callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Build',
      requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
    });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    now = 2 * 60_000;
    const service = new SquadExecutionService(deps(filePath, { store, getTeamLaunch: async () => undefined }));
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('BLOCKED');
  }));

  it('recovers a persisted startup when Team lifecycle has live workers', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({ callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Build', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] } });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const service = new SquadExecutionService(deps(filePath, { store, getTeamLaunch: async () => ({ workers: [{ projectId: 'project-1', process: 'running' }] }) }));
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
  }));

  it('fails execution when Team lifecycle records failed launch slots or all workers exit', async () => fixture(async (filePath) => {
    const lifecycle = { workers: [{ projectId: 'project-1', task: 'unknown', process: 'running' }], launchResult: { failedSlots: [{ slotId: 'slot-2' }] } };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle }));
    await service.start('session-1', 'project-1', request);
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
  }));

  it('keeps failed partial launches stoppable while workers remain live', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const lifecycle = { workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }], launchResult: { failedSlots: [{ slotId: 'slot-2' }] } };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.status('session-1', 'project-1', 'execution-1');
    await expect(service.stop('session-1', 'project-1', 'execution-1', 5)).resolves.toMatchObject({ ok: true, value: { state: 'FAILED' } });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
  }));

  it('stops only caller-owned execution through the existing Team cancellation path', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await expect(service.stop('session-1', 'project-1', 'execution-1', 4)).resolves.toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    await expect(service.stop('other', 'project-1', 'execution-1', 4)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('rejects stale stop before Team cancellation', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await expect(service.stop('session-1', 'project-1', 'execution-1', 0)).resolves.toMatchObject({ ok: false, code: 'CONFLICT', current: { stateVersion: 4 } });
    expect(cancelTeamLaunch).not.toHaveBeenCalled();
  }));

  it('responds only through an owned slot and resumes blocked work after delivery', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, replyToSession }));
    await service.start('session-1', 'project-1', request);
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    await store.transition(running.id, running.stateVersion, 'BLOCKED', 'warning', 'Waiting');
    await expect(service.resume('session-1', 'project-1', 'execution-1', 5, 'slot-1', 'Continue')).resolves.toMatchObject({ ok: true, value: { state: 'RUNNING' } });
    expect(replyToSession).toHaveBeenCalledWith('worker-1', 'Continue');
    await expect(service.respond('session-1', 'project-1', 'execution-1', 7, 'other-slot', 'Nope')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('rejects stale resume before reading or messaging Team workers', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] }));
    const replyToSession = vi.fn(() => true);
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch, replyToSession }));
    await service.start('session-1', 'project-1', request);
    await expect(service.resume('session-1', 'project-1', 'execution-1', 0, 'slot-1', 'Continue')).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(getTeamLaunch).toHaveBeenCalledTimes(0);
    expect(replyToSession).not.toHaveBeenCalled();
  }));

  it('records write-once artifacts and permits same-project replacement reads', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    await expect(service.putArtifact('session-1', 'project-1', 'execution-1', 'result.json', 'application/json', '{"ok":true}')).resolves.toMatchObject({ ok: true, value: { contentDigest: expect.stringMatching(/^sha256:/) } });
    await expect(service.putArtifact('session-1', 'project-1', 'execution-1', 'result.json', 'application/json', '{"ok":false}')).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await service.listArtifacts('replacement-session', 'project-1', 'execution-1')).toBeUndefined();
    expect(await service.listArtifacts('replacement-session', 'other-project', 'execution-1')).toBeUndefined();
  }));

  it('reads a bounded durable snapshot without reconciling Team lifecycle', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ workers: [] }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.putArtifact('session-1', 'project-1', 'execution-1', 'result.json', 'application/json', '{"ok":true}');
    const snapshot = await service.snapshot('session-1', 'project-1', 'execution-1');
    expect(snapshot).toMatchObject({ execution: { id: 'execution-1', state: 'RUNNING' }, executions: [{ id: 'execution-1' }], artifacts: [{ name: 'result.json' }], truncated: false });
    expect(getTeamLaunch).not.toHaveBeenCalled();
  }));

  it('stops durable snapshot before later reads when total deadline expires', async () => fixture(async (filePath) => {
    let clock = 0;
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, monotonicNow: () => clock }));
    await service.start('session-1', 'project-1', request);
    const originalList = store.list;
    store.list = async (...args) => {
      clock = 15_000;
      return originalList(...args);
    };
    await expect(service.snapshot('session-1', 'project-1', 'execution-1')).rejects.toThrow('Snapshot exceeded 15-second budget');
  }));

  it('does not accept artifacts after execution reaches a terminal state', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('session-1', 'project-1', request);
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    await store.transition(running.id, running.stateVersion, 'COMPLETED', 'info', 'Done');
    await expect(service.putArtifact('session-1', 'project-1', 'execution-1', 'late.json', 'application/json', '{}')).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
  }));

  it('persists workflow preflight failure before blocking launch', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new SquadExecutionService(deps(filePath, {
      launchTeam,
      preflightWorkflow: () => ({ ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'missing controller slot' })
    }));
    await expect(service.start('session-1', 'project-1', {
      ...request,
      workflow: { schemaVersion: 1, profileId: 'profile', profileVersion: '1', controller: { personaId: 'controller', slotId: 'orchestrator:controller' }, workers: [], supportedRequestVersions: [1] }
    })).resolves.toEqual({ ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'missing controller slot' });
    expect(launchTeam).not.toHaveBeenCalled();
    expect(await service.status('session-1', 'project-1', 'execution-1')).toMatchObject({ state: 'BLOCKED', jobTitle: 'Build release' });
  }));

  it('lists executions for an effective owner after a successful resume binding', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true });
    await expect(service.list('session-2', 'project-1')).resolves.toMatchObject([{ id: 'execution-1' }]);
  }));

  it('persists explicit resolved models and rejects duplicate slot snapshots', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    const started = await service.start('session-1', 'project-1', { ...request, resolvedModels: [{ slotId: 'slot-1', provider: 'provider', model: 'model' }] });
    expect(started).toMatchObject({ ok: true, value: { resolvedModels: [{ slotId: 'slot-1', provider: 'provider', model: 'model' }] } });
    const duplicate = await service.start('session-1', 'project-1', { ...request, launchRequestId: 'request-2', resolvedModels: [{ slotId: 'slot-1', provider: 'a', model: 'a' }, { slotId: 'slot-1', provider: 'b', model: 'b' }] });
    expect(duplicate).toEqual({ ok: false, code: 'INVALID', message: 'duplicate resolved model slot' });
  }));

  it('records optional policy result without rewriting generic execution completion', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    const result = await service.recordPolicyResult('project-1', 'execution-1', {
      version: 1, executionId: 'execution-1', attempt: 1, outputDigest: 'sha256:output', extensionDigest: 'sha256:extension', status: 'ELIGIBLE_FOR_DELIVERY', summary: 'Policy approved'
    });
    expect(result).toMatchObject({ ok: true, value: { state: 'RUNNING', policyResult: { status: 'ELIGIBLE_FOR_DELIVERY' } } });
    expect(await service.recordPolicyResult('other-project', 'execution-1', {})).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

});
