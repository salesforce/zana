import { describe, expect, it, vi } from 'vitest';
import { authorizeRequest, dispatchOp, type ControlPlaneDeps } from '../control-plane.js';

function deps(createTerminal = vi.fn(async () => ({ ok: true as const, value: { id: 's1' } as never }))): ControlPlaneDeps {
  return {
    listProjects: () => [], listTerminals: () => [], createTerminal,
    closeTerminal: () => false, summarizeAndCloseTerminals: async () => ({ closed: 0, summarized: 0 }),
    replyTerminal: () => false, getAgentStatus: () => 'unknown', isLiveSession: () => true,
    listAgents: () => [], sendToAgent: () => ({ ok: false, error: 'no' }),
    listPersonas: () => [], listTeams: () => [], listSchedules: () => [],
    runScheduleNow: () => ({ ok: false, code: 'NO', message: 'no' }),
    setScheduleEnabled: () => ({ ok: false, code: 'NO', message: 'no' }),
    authorizeOrchestratorMutation: () => ({ ok: true })
  };
}

describe('control-plane launch principal', () => {
  it('retains only main-attested orchestrator session identity', () => {
    expect(authorizeRequest({
      token: 't', nonce: 'n', op: 'term.create', callerSessionId: 'orch-1', callerCredential: 'bound'
    }, { token: 't', nonce: 'n' }, (id) => id === 'orch-1', (_id, credential) => credential === 'bound')).toMatchObject({
      ok: true, caller: 'orchestrator', callerSessionId: 'orch-1'
    });
  });

  it('confines orchestrator mutation to main-attested project and closable sessions', async () => {
    const createTerminal = vi.fn(async () => ({ ok: true as const, value: { id: 's1' } as never }));
    const d = deps(createTerminal);
    d.authorizeOrchestratorMutation = (_sessionId, op, args) =>
      op === 'term.create' && args.projectId === 'p1'
        ? { ok: true }
        : { ok: false, reason: 'outside orchestrator cohort/project' };
    await expect(dispatchOp('term.create', { projectId: 'p2', profile: 'claude' }, d, { class: 'orchestrator', sessionId: 'orch-1' }))
      .resolves.toMatchObject({ ok: false, code: 'FORBIDDEN_SCOPE' });
    await expect(dispatchOp('term.close', { sessionId: 'foreign' }, d, { class: 'orchestrator', sessionId: 'orch-1' }))
      .resolves.toMatchObject({ ok: false, code: 'FORBIDDEN_SCOPE' });
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it('does not promote a forged live orchestrator id without its bound credential', () => {
    expect(authorizeRequest({
      token: 't', nonce: 'n', op: 'term.create', callerSessionId: 'orch-1'
    }, { token: 't', nonce: 'n' }, () => true, () => false)).toMatchObject({
      ok: false, code: 'FORBIDDEN_AGENT'
    });
  });

  it('passes caller class to main launch seam instead of deriving it from args', async () => {
    const createTerminal = vi.fn(async () => ({ ok: true as const, value: { id: 's1' } as never }));
    await dispatchOp('term.create', { projectId: 'p1', profile: 'claude' }, deps(createTerminal), {
      class: 'orchestrator', sessionId: 'orch-1'
    });
    expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }), {
      class: 'orchestrator', sessionId: 'orch-1'
    });
  });
});
