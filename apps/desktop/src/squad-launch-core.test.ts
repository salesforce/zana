import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { squadGoalTooLongMessage, squadSummaryTooLongMessage } from '@zana-ai/zcc-domain/squad-proposal';
import { AUTONOMOUS_DEFAULTS } from '@zana-ai/zcc-server/services/agents/autonomous-run-supervisor';
import { ExecutionSourceError, createExecutionSourceRegistry, type ExecutionSourcePathDescriptor } from '@zana-ai/zcc-server/services/execution/source-registry';
import { resolveSourcePolicy } from '@zana-ai/zcc-server/services/execution/source-policy';
import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';
import {
  createSquadSourceSnapshotter, launchSquad, redactCapturedExecutionSourcePaths,
  type SquadLaunchDeps, type SquadLaunchInput, type SquadSourceBundle, type SquadSourceSnapshotArgs
} from './squad-launch-core.js';

const validPlan = [
  '### write: Write output <!-- executable-step -->',
  '',
  '- **Depends on:** None',
  '- **Mode:** Mutating',
  '- **Write scope:** `output.txt`',
  '- **Work:** Create output.',
  '- **Verification:** Read output.'
].join('\n');

const proposal = {
  proposalId: 'proposal-1', proposerKind: 'pty', proposerId: 'session-9', proposerTitle: 'Planner'
} as unknown as NonNullable<ExecutionRecord['proposal']>;

function bundle(overrides: Partial<SquadSourceBundle> = {}): SquadSourceBundle {
  return {
    contentRef: 'content-1',
    pathDescriptors: [{ exactPath: '/repo/notes.md', canonicalPath: '/repo/notes.md', representations: ['/repo/notes.md'] }],
    sources: [{ id: 'src-1', name: 'notes.md', extractedText: 'see /repo/notes.md' }] as never,
    ...overrides
  } as SquadSourceBundle;
}

function makeDeps(overrides: Partial<SquadLaunchDeps> = {}) {
  const start = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, value: { id: 'exec-1', state: 'running' } }));
  const deps = {
    snapshotSources: vi.fn(async () => ({ ok: true as const })),
    removeSnapshot: vi.fn(async () => undefined),
    realpath: vi.fn(async (path: string) => path),
    sourceBases: () => ({ home: '/home/u', dataDirs: [], protectedRoots: [] }),
    newLaunchRequestId: () => 'ui:launch-1',
    inboxStore: { append: vi.fn(async () => undefined) },
    planCorrectionLaunchBinding: { beginLaunch: vi.fn(), forgetLaunch: vi.fn() },
    nameTeamExecution: vi.fn(async (_id: string, objective: string, explicitTitle?: string) => explicitTitle ?? `Named: ${objective}`),
    autonomousTimeoutMs: () => undefined,
    squadExecutionService: { start } as unknown as SquadLaunchDeps['squadExecutionService'],
    ...overrides
  } satisfies SquadLaunchDeps;
  return { deps, start: deps.squadExecutionService.start as unknown as typeof start };
}

function makeInput(overrides: Partial<SquadLaunchInput> = {}): SquadLaunchInput {
  return {
    teamId: 'team-1',
    project: { id: 'p1', name: 'Repo', path: '/repo' },
    slots: [{ role: 'orchestrator' }, { role: 'worker' }],
    goal: 'Ship the fix',
    coordinationMode: 'freeform',
    completionInboxNotice: false,
    sourceCapabilityIds: [],
    goalSources: [],
    ...overrides
  };
}

const sharedTask = 'Shared job goal: Ship the fix\n\nWork toward this goal. Coordinate through the Team orchestrator when one is present.';

describe('launchSquad', () => {
  it('builds the composer request exactly as the desktop launch always has and starts it without options', async () => {
    const { deps, start } = makeDeps();
    const result = await launchSquad(deps, makeInput(), { sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local' } });
    expect(result).toEqual({ ok: true, value: { executionId: 'exec-1', state: 'running' } });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]).toEqual(['interactive:local', 'p1', {
      version: 1,
      teamId: 'team-1',
      launchRequestId: 'ui:launch-1',
      coordinationMode: 'freeform',
      origin: 'explicit',
      jobTitle: 'Named: Ship the fix',
       objective: 'Ship the fix',
       summary: undefined,
       completionInboxNotice: false,
      slots: [
        { initialTask: `${sharedTask}\n\nCoordinate workers, delegate role-specific work, and explicitly report execution completion with a summary when goal is met.` },
        { initialTask: `${sharedTask}\n\nCheck orchestrator instructions and report progress or blockers to it.` }
      ],
      policy: { deadlineMs: AUTONOMOUS_DEFAULTS.timeoutMs }
    }]);
    expect(deps.snapshotSources).toHaveBeenCalledWith({ kind: 'window', windowId: 7 }, expect.objectContaining({
      projectId: 'p1', launchRequestId: 'ui:launch-1', sourceCapabilityIds: [], sourcePaths: [], goalSourceDescriptors: []
    }));
  });

  it('carries the requested completion inbox notice into the execution request', async () => {
    const { deps, start } = makeDeps();
    await launchSquad(deps, makeInput({ completionInboxNotice: true }), {
      sources: { kind: 'session', sessionId: 'agent-session' },
      owner: { principalId: 'agent-session' }
    });
    expect(start.mock.calls[0]![2]).toMatchObject({ completionInboxNotice: true });
  });

  it('gives a session launch its confined source paths and starts it unattended', async () => {
    const { deps, start } = makeDeps();
    const session = { kind: 'session' as const, sessionId: 'agent-session' };
    const reportTo = { kind: 'pty' as const, id: 'agent-session', role: 'owner' as const };
    await launchSquad(deps, makeInput({ sourcePaths: ['/repo/plan.md'] }), { sources: session, owner: { principalId: 'agent-session', reportTo } });
    expect(deps.snapshotSources).toHaveBeenCalledWith(session, expect.objectContaining({ sourcePaths: ['/repo/plan.md'], policy: expect.any(Object) }));
    expect(start.mock.calls[0]?.slice(0, 2)).toEqual(['agent-session', 'p1']);
    expect(start.mock.calls[0]?.[3]).toEqual({ reportTo });
  });

  it('never hands source paths to a window launch', async () => {
    const { deps } = makeDeps();
    await launchSquad(deps, makeInput({ sourcePaths: ['/repo/plan.md'] }), { sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local' } });
    expect(deps.snapshotSources).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourcePaths: [] }));
  });

  it('builds the same request for a session launch as for a window launch of the same input', async () => {
    const window = makeDeps();
    const session = makeDeps();
    await launchSquad(window.deps, makeInput(), { sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local' } });
    await launchSquad(session.deps, makeInput(), {
      sources: { kind: 'session', sessionId: 'agent-session' },
      owner: { principalId: 'agent-session', reportTo: { kind: 'pty', id: 'agent-session', role: 'owner' } }
    });
    expect(session.start.mock.calls[0]?.[2]).toEqual(window.start.mock.calls[0]?.[2]);
  });

  it('passes the proposal and proposer report target through to the start', async () => {
    const { deps, start } = makeDeps();
    const reportTo = { kind: 'pty' as const, id: 'session-9', role: 'proposer' as const, title: 'Planner' };
    await launchSquad(deps, makeInput(), { sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local', proposal, reportTo } });
    expect(start.mock.calls[0]?.[3]).toEqual({ proposal, reportTo });
  });

  it('starts under an agent owner with only a report target', async () => {
    const { deps, start } = makeDeps();
    const reportTo = { kind: 'thread' as const, id: 'thread-1', role: 'owner' as const };
    await launchSquad(deps, makeInput(), { owner: { principalId: 'agent-session', reportTo } });
    expect(start.mock.calls[0]?.[0]).toBe('agent-session');
    expect(start.mock.calls[0]?.[3]).toEqual({ reportTo });
  });

  it('redacts captured paths, keeps source metadata only, and seeds work units from a source plan', async () => {
    const sourceBundle = bundle({
      sources: [{ id: 'src-1', name: 'plan.md', extractedText: validPlan }] as never
    });
    const { deps, start } = makeDeps({
      snapshotSources: vi.fn(async () => ({ ok: true as const, sourceBundle })),
      autonomousTimeoutMs: () => 0
    });
    await launchSquad(deps, makeInput({
      goal: 'Follow /repo/notes.md', title: 'Run /repo/notes.md', summary: 'From /repo/notes.md', coordinationMode: 'structured'
    }), { sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local' } });
    const request = start.mock.calls[0]?.[2] as Record<string, any>;
    expect(request.objective).toBe('Follow [captured execution source: notes.md]');
    expect(request.jobTitle).toBe('Run [captured execution source: notes.md]');
    expect(request.summary).toBe('From [captured execution source: notes.md]');
    expect(request.sourceBundle).toEqual({ contentRef: 'content-1', sources: [{ id: 'src-1', name: 'plan.md' }] });
    expect(request.workUnits).toEqual([expect.objectContaining({ id: 'write' })]);
    expect(request.policy).toEqual({});
    expect(deps.nameTeamExecution).toHaveBeenCalledWith('ui:launch-1', 'Follow [captured execution source: notes.md]', 'Run [captured execution source: notes.md]', [validPlan]);
  });

  it('forwards a validated execution target onto the start request', async () => {
    const { deps, start } = makeDeps();
    await launchSquad(deps, makeInput({ target: { kind: 'worktree', branch: 'feat/x' } }), { owner: { principalId: 'interactive:local' } });
    expect((start.mock.calls[0]?.[2] as Record<string, any>).target).toEqual({ kind: 'worktree', branch: 'feat/x' });
  });

  it('omits target when none is selected (legacy)', async () => {
    const { deps, start } = makeDeps();
    await launchSquad(deps, makeInput(), { owner: { principalId: 'interactive:local' } });
    expect(start.mock.calls[0]?.[2]).not.toHaveProperty('target');
  });

  it('rejects an invalid target selector without snapshotting or starting', async () => {
    const { deps, start } = makeDeps();
    const result = await launchSquad(deps, makeInput({ target: { kind: 'worktree', branch: '../etc' } as never }), { owner: { principalId: 'interactive:local' } });
    expect(result).toMatchObject({ ok: false, code: 'INVALID' });
    expect(start).not.toHaveBeenCalled();
    expect(deps.snapshotSources).not.toHaveBeenCalled();
  });

  it('caps the deadline at the configured timeout', async () => {
    const { deps, start } = makeDeps({ autonomousTimeoutMs: () => 60_000 });
    await launchSquad(deps, makeInput(), { owner: { principalId: 'interactive:local' } });
    expect((start.mock.calls[0]?.[2] as Record<string, any>).policy).toEqual({ deadlineMs: 60_000 });
  });

  it('parks an invalid provided plan for correction when a window launched it', async () => {
    const { deps, start } = makeDeps();
    const result = await launchSquad(deps, makeInput({ coordinationMode: 'structured', goal: 'prose goal' }), {
      sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local' }
    });
    expect(result.ok).toBe(true);
    expect(deps.planCorrectionLaunchBinding.beginLaunch).toHaveBeenCalledWith('ui:launch-1', expect.any(String));
    expect(deps.inboxStore.append).not.toHaveBeenCalled();
    expect((start.mock.calls[0]?.[2] as Record<string, any>).slots[0].initialTask).toContain('prose goal');
  });

  it.each([
    ['no provider', undefined],
    ['a session provider', { kind: 'session' as const, sessionId: 'agent-session' }]
  ])('refuses an invalid provided plan with %s', async (_label, sources) => {
    const { deps, start } = makeDeps();
    const result = await launchSquad(deps, makeInput({ coordinationMode: 'structured', goal: 'prose goal' }), {
      sources, owner: { principalId: 'interactive:local' }
    });
    expect(result).toEqual({ ok: false, code: 'INVALID_PLAN', message: 'provided structured plan is invalid' });
    expect(deps.inboxStore.append).toHaveBeenCalledTimes(1);
    expect(deps.planCorrectionLaunchBinding.beginLaunch).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  describe('goal and summary limits', () => {
    const launch = (deps: SquadLaunchDeps, input: Partial<SquadLaunchInput>) =>
      launchSquad(deps, makeInput(input), { sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local' } });

    it('rejects a 2,049-character goal by name, without starting, parking a plan correction, and removes the snapshot', async () => {
      const { deps, start } = makeDeps({ snapshotSources: vi.fn(async () => ({ ok: true as const, sourceBundle: bundle() })) });
      const result = await launch(deps, { goal: 'g'.repeat(2049), coordinationMode: 'structured' });
      expect(result).toEqual({ ok: false, code: 'GOAL_TOO_LONG', message: squadGoalTooLongMessage(2049) });
      expect(start).not.toHaveBeenCalled();
      expect(deps.inboxStore.append).not.toHaveBeenCalled();
      expect(deps.planCorrectionLaunchBinding.beginLaunch).not.toHaveBeenCalled();
      expect(deps.removeSnapshot).toHaveBeenCalledTimes(1);
    });

    it('starts a 2,048-character goal without cutting it', async () => {
      const { deps, start } = makeDeps();
      const result = await launch(deps, { goal: 'g'.repeat(2048) });
      expect(result.ok).toBe(true);
      expect((start.mock.calls[0]?.[2] as Record<string, any>).objective).toHaveLength(2048);
    });

    it('rejects a 5,000-character goal instead of truncating it', async () => {
      const { deps, start } = makeDeps();
      const result = await launch(deps, { goal: 'g'.repeat(5000) });
      expect(result).toEqual({ ok: false, code: 'GOAL_TOO_LONG', message: squadGoalTooLongMessage(5000) });
      expect(start).not.toHaveBeenCalled();
    });

    it('measures the goal after captured paths are redacted to a longer placeholder', async () => {
      const goal = `/repo/notes.md${'g'.repeat(2026)}`;
      expect(goal).toHaveLength(2040);
      const redactedLength = `[captured execution source: notes.md]${'g'.repeat(2026)}`.length;
      expect(redactedLength).toBeGreaterThan(2048);
      const { deps, start } = makeDeps({ snapshotSources: vi.fn(async () => ({ ok: true as const, sourceBundle: bundle() })) });
      const result = await launch(deps, { goal });
      expect(result).toEqual({ ok: false, code: 'GOAL_TOO_LONG', message: squadGoalTooLongMessage(redactedLength, { afterSourceNames: true }) });
      expect(start).not.toHaveBeenCalled();
    });

    it('rejects a 2,049-character summary by name', async () => {
      const { deps, start } = makeDeps();
      const result = await launch(deps, { summary: 's'.repeat(2049) });
      expect(result).toEqual({ ok: false, code: 'SUMMARY_TOO_LONG', message: squadSummaryTooLongMessage(2049) });
      expect(start).not.toHaveBeenCalled();
    });
  });

  it('returns a snapshot refusal without starting', async () => {
    const { deps, start } = makeDeps({
      snapshotSources: vi.fn(async () => ({ ok: false as const, code: 'FOREIGN_CAPABILITY', message: 'other window' }))
    });
    const result = await launchSquad(deps, makeInput({ sourceCapabilityIds: ['cap-1'] }), {
      sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local' }
    });
    expect(result).toEqual({ ok: false, code: 'FOREIGN_CAPABILITY', message: 'other window' });
    expect(start).not.toHaveBeenCalled();
  });

  it('discards the snapshot and forgets the launch when the start fails', async () => {
    const start = vi.fn(async () => ({ ok: false as const, code: 'REQUIREMENT_FAILED', message: 'missing', requirementFailure: { skills: ['x'] } }));
    const { deps } = makeDeps({
      snapshotSources: vi.fn(async () => ({ ok: true as const, sourceBundle: bundle() })),
      squadExecutionService: { start } as unknown as SquadLaunchDeps['squadExecutionService']
    });
    const result = await launchSquad(deps, makeInput(), { sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local' } });
    expect(result).toEqual({ ok: false, code: 'REQUIREMENT_UNAVAILABLE', message: 'missing', requirementFailure: { skills: ['x'] } });
    expect(deps.removeSnapshot).toHaveBeenCalledWith('content-1');
    expect(deps.planCorrectionLaunchBinding.forgetLaunch).toHaveBeenCalledWith('ui:launch-1');
  });

  describe('discarding a launch that did not start', () => {
    const windowCtx = { sources: { kind: 'window' as const, windowId: 7 }, owner: { principalId: 'interactive:local' } };
    const withBundle = () => vi.fn(async () => ({ ok: true as const, sourceBundle: bundle() }));
    const invalidPlan = { coordinationMode: 'structured' as const, goal: 'prose goal' };

    it('removes the snapshot when a session launch refuses an invalid plan', async () => {
      const { deps, start } = makeDeps({ snapshotSources: withBundle() });
      const result = await launchSquad(deps, makeInput(invalidPlan), {
        sources: { kind: 'session', sessionId: 'agent-session' }, owner: { principalId: 'agent-session' }
      });
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PLAN' });
      expect(deps.removeSnapshot).toHaveBeenCalledWith('content-1');
      expect(deps.planCorrectionLaunchBinding.forgetLaunch).toHaveBeenCalledWith('ui:launch-1');
      expect(start).not.toHaveBeenCalled();
    });

    it('cleans up and rethrows when start rejects', async () => {
      const start = vi.fn(async () => { throw new Error('start exploded'); });
      const { deps } = makeDeps({
        snapshotSources: withBundle(),
        squadExecutionService: { start } as unknown as SquadLaunchDeps['squadExecutionService']
      });
      await expect(launchSquad(deps, makeInput(), windowCtx)).rejects.toThrow('start exploded');
      expect(deps.removeSnapshot).toHaveBeenCalledWith('content-1');
      expect(deps.planCorrectionLaunchBinding.forgetLaunch).toHaveBeenCalledWith('ui:launch-1');
    });

    it('removes the snapshot when the refusal notice cannot be appended', async () => {
      const { deps } = makeDeps({
        snapshotSources: withBundle(),
        inboxStore: { append: vi.fn(async () => { throw new Error('inbox down'); }) }
      });
      await expect(launchSquad(deps, makeInput(invalidPlan), { owner: { principalId: 'agent-session' } })).rejects.toThrow('inbox down');
      expect(deps.removeSnapshot).toHaveBeenCalledWith('content-1');
    });

    it('still returns the original refusal when cleanup itself fails, and logs it', async () => {
      const log = vi.fn();
      const { deps } = makeDeps({
        snapshotSources: withBundle(),
        removeSnapshot: vi.fn(async () => { throw new Error('disk gone'); }),
        log
      });
      deps.planCorrectionLaunchBinding.forgetLaunch.mockImplementation(() => { throw new Error('binding gone'); });
      const result = await launchSquad(deps, makeInput(invalidPlan), { owner: { principalId: 'agent-session' } });
      expect(result).toEqual({ ok: false, code: 'INVALID_PLAN', message: 'provided structured plan is invalid' });
      expect(deps.removeSnapshot).toHaveBeenCalledWith('content-1');
      expect(log).toHaveBeenCalledTimes(2);
    });

    it('keeps the snapshot and the binding when the start succeeds', async () => {
      const { deps } = makeDeps({ snapshotSources: withBundle() });
      const result = await launchSquad(deps, makeInput(), windowCtx);
      expect(result.ok).toBe(true);
      expect(deps.removeSnapshot).not.toHaveBeenCalled();
      expect(deps.planCorrectionLaunchBinding.forgetLaunch).not.toHaveBeenCalled();
    });
  });

  it('forgets the launch without removing anything when a source-free start fails', async () => {
    const start = vi.fn(async () => ({ ok: false as const, code: 'BUSY', message: 'busy' }));
    const { deps } = makeDeps({ squadExecutionService: { start } as unknown as SquadLaunchDeps['squadExecutionService'] });
    const result = await launchSquad(deps, makeInput(), { owner: { principalId: 'interactive:local' } });
    expect(result).toEqual({ ok: false, code: 'BUSY', message: 'busy' });
    expect(deps.removeSnapshot).not.toHaveBeenCalled();
    expect(deps.planCorrectionLaunchBinding.forgetLaunch).toHaveBeenCalledWith('ui:launch-1');
  });

  describe('proposed launch goal sources', () => {
    const inside: ExecutionSourcePathDescriptor = { exactPath: '/repo/a.md', canonicalPath: '/repo/a.md', representations: ['/repo/a.md'] };
    const reviewed: ExecutionSourcePathDescriptor = { exactPath: '/elsewhere/b.md', canonicalPath: '/elsewhere/b.md', representations: ['/elsewhere/b.md'] };

    it('attaches inside files, keeps reviewed outside files for redaction only', async () => {
      const { deps, start } = makeDeps();
      await launchSquad(deps, makeInput({
        goal: 'Read /repo/a.md and /elsewhere/b.md', goalSources: [inside, reviewed], reviewedSourcePaths: ['/elsewhere/b.md']
      }), { sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local', proposal } });
      expect(deps.snapshotSources).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ goalSourceDescriptors: [inside] }));
      expect((start.mock.calls[0]?.[2] as Record<string, any>).objective)
        .toBe('Read [captured execution source: a.md] and [captured execution source: b.md]');
    });

    it('refuses an outside file the card did not list before snapshotting', async () => {
      const { deps, start } = makeDeps();
      const result = await launchSquad(deps, makeInput({ goalSources: [inside, reviewed] }), {
        sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local', proposal }
      });
      expect(result).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED' });
      expect((result as { message: string }).message).toContain('/elsewhere/b.md');
      expect(deps.snapshotSources).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    });

    it('treats every goal file as outside when the Project path cannot be resolved', async () => {
      const { deps } = makeDeps({ realpath: vi.fn(async (path: string) => { if (path === '/repo') throw new Error('gone'); return path; }) });
      const result = await launchSquad(deps, makeInput({ goalSources: [inside] }), {
        sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local', proposal }
      });
      expect(result).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED' });
    });

    it('refuses a goal file outside the Project that a session launch did not list', async () => {
      const { deps, start } = makeDeps();
      const result = await launchSquad(deps, makeInput({ goalSources: [inside, reviewed] }), {
        sources: { kind: 'session', sessionId: 'agent-session' }, owner: { principalId: 'agent-session' }
      });
      expect(result).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('was not listed in sources') });
      expect(deps.snapshotSources).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    });

    it('keeps a listed outside goal file out of a session launch\'s goal capabilities but redacts it', async () => {
      const { deps, start } = makeDeps();
      await launchSquad(deps, makeInput({
        goal: 'Read /repo/a.md and /elsewhere/b.md', goalSources: [inside, reviewed], sourcePaths: ['/elsewhere/b.md'],
        // A session launch narrows by its own sources, never by a card's.
        reviewedSourcePaths: []
      }), { sources: { kind: 'session', sessionId: 'agent-session' }, owner: { principalId: 'agent-session' } });
      expect(deps.snapshotSources).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        goalSourceDescriptors: [inside], sourcePaths: ['/elsewhere/b.md']
      }));
      expect((start.mock.calls[0]?.[2] as Record<string, any>).objective)
        .toBe('Read [captured execution source: a.md] and [captured execution source: b.md]');
    });

    it('attaches every discovered goal file for an ordinary launch', async () => {
      const { deps } = makeDeps();
      await launchSquad(deps, makeInput({ goalSources: [inside, reviewed] }), {
        sources: { kind: 'window', windowId: 7 }, owner: { principalId: 'interactive:local' }
      });
      expect(deps.snapshotSources).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ goalSourceDescriptors: [inside, reviewed] }));
    });
  });
});

describe('createSquadSourceSnapshotter', () => {
  const descriptor: ExecutionSourcePathDescriptor = { exactPath: '/repo/a.md', canonicalPath: '/repo/a.md', representations: ['/repo/a.md'] };
  const args = (overrides: Partial<SquadSourceSnapshotArgs> = {}): SquadSourceSnapshotArgs => ({
    projectId: 'p1', launchRequestId: 'ui:launch/1', sourceCapabilityIds: [], sourcePaths: [], goalSourceDescriptors: [], policy: {} as never, ...overrides
  });
  function registry() {
    return {
      issue: vi.fn(async () => [{ id: 'goal-cap' }]),
      resolve: vi.fn(async () => bundle())
    };
  }

  it('touches nothing when the launch has no sources, whatever the provider', async () => {
    const fake = registry();
    const snapshot = createSquadSourceSnapshotter(fake as never);
    expect(await snapshot(undefined, args())).toEqual({ ok: true });
    expect(await snapshot({ kind: 'session', sessionId: 's' }, args())).toEqual({ ok: true });
    expect(fake.issue).not.toHaveBeenCalled();
    expect(fake.resolve).not.toHaveBeenCalled();
  });

  it('issues goal capabilities to the window, then resolves them with the attached ones once each', async () => {
    const fake = registry();
    const policy = { marker: true } as never;
    const result = await createSquadSourceSnapshotter(fake as never)({ kind: 'window', windowId: 7 }, args({
      sourceCapabilityIds: ['cap-1', 'goal-cap'], goalSourceDescriptors: [descriptor], policy
    }));
    expect(result).toEqual({ ok: true, sourceBundle: bundle() });
    expect(fake.issue).toHaveBeenCalledWith({ windowId: 7, projectId: 'p1', paths: ['/repo/a.md'], policy });
    expect(fake.resolve).toHaveBeenCalledWith({ windowId: 7, projectId: 'p1', capabilityIds: ['cap-1', 'goal-cap'], snapshotKey: 'ui:launch_1' });
  });

  it('resolves attached capabilities without issuing when the goal names no files', async () => {
    const fake = registry();
    await createSquadSourceSnapshotter(fake as never)({ kind: 'window', windowId: 7 }, args({ sourceCapabilityIds: ['cap-1'] }));
    expect(fake.issue).not.toHaveBeenCalled();
    expect(fake.resolve).toHaveBeenCalledWith(expect.objectContaining({ capabilityIds: ['cap-1'] }));
  });

  it('skips the snapshot when issuing yields no capabilities', async () => {
    const fake = { ...registry(), issue: vi.fn(async () => []) };
    const result = await createSquadSourceSnapshotter(fake as never)({ kind: 'window', windowId: 7 }, args({ goalSourceDescriptors: [descriptor] }));
    expect(result).toEqual({ ok: true, sourceBundle: undefined });
    expect(fake.resolve).not.toHaveBeenCalled();
  });

  it('issues a session\'s listed and goal paths to that session with the policy, then resolves them with the same binding', async () => {
    const fake = { issue: vi.fn(async (input: { paths: string[] }) => input.paths.map((path) => ({ id: path === '/repo/a.md' ? 'cap-a' : 'cap-b' }))), resolve: vi.fn(async () => bundle()) };
    const policy = { marker: true } as never;
    const binding = { kind: 'session', sessionId: 's' };
    const result = await createSquadSourceSnapshotter(fake as never)({ kind: 'session', sessionId: 's' }, args({
      sourcePaths: ['/repo/a.md', '/repo/b.md'], goalSourceDescriptors: [descriptor], policy
    }));
    expect(result).toEqual({ ok: true, sourceBundle: bundle() });
    expect(fake.issue.mock.calls).toEqual([
      [{ binding, projectId: 'p1', paths: ['/repo/a.md', '/repo/b.md'], policy }],
      [{ binding, projectId: 'p1', paths: ['/repo/a.md'], policy }]
    ]);
    // The goal names a listed file: the registry returns its capability again, resolved once.
    expect(fake.resolve).toHaveBeenCalledWith({ binding, projectId: 'p1', capabilityIds: ['cap-a', 'cap-b'], snapshotKey: 'ui:launch_1' });
  });

  it('issues only what a session launch has', async () => {
    const fake = registry();
    await createSquadSourceSnapshotter(fake as never)({ kind: 'session', sessionId: 's' }, args({ goalSourceDescriptors: [descriptor] }));
    expect(fake.issue).toHaveBeenCalledTimes(1);
    expect(fake.issue).toHaveBeenCalledWith(expect.objectContaining({ paths: ['/repo/a.md'] }));
    const empty = { ...registry(), issue: vi.fn(async () => []) };
    expect(await createSquadSourceSnapshotter(empty as never)({ kind: 'session', sessionId: 's' }, args({ sourcePaths: ['/repo/a.md'] })))
      .toEqual({ ok: true, sourceBundle: undefined });
    expect(empty.resolve).not.toHaveBeenCalled();
  });

  it('passes a session issue refusal through with its code', async () => {
    const fake = { ...registry(), issue: vi.fn(async () => { throw new ExecutionSourceError('UNSUPPORTED_SOURCE', 'id_rsa is in a protected location'); }) };
    expect(await createSquadSourceSnapshotter(fake as never)({ kind: 'session', sessionId: 's' }, args({ sourcePaths: ['/home/u/.ssh/id_rsa'] })))
      .toEqual({ ok: false, code: 'UNSUPPORTED_SOURCE', message: 'id_rsa is in a protected location' });
    expect(fake.resolve).not.toHaveBeenCalled();
  });

  it('refuses capability ids from a session, and sources without a trusted window', async () => {
    const fake = registry();
    const snapshot = createSquadSourceSnapshotter(fake as never);
    expect(await snapshot({ kind: 'session', sessionId: 's' }, args({ sourceCapabilityIds: ['cap-1'], sourcePaths: ['/repo/a.md'] })))
      .toEqual({ ok: false, code: 'INVALID_CAPABILITY', message: 'Agent sessions cannot present execution source capabilities' });
    expect(await snapshot(undefined, args({ goalSourceDescriptors: [descriptor] })))
      .toEqual({ ok: false, code: 'INVALID_CAPABILITY', message: 'Execution sources require a trusted window' });
    expect(fake.issue).not.toHaveBeenCalled();
  });

  it('maps registry errors onto their code and anything else onto SOURCE_SNAPSHOT_FAILED', async () => {
    const window = { kind: 'window' as const, windowId: 7 };
    const typed = { ...registry(), resolve: vi.fn(async () => { throw new ExecutionSourceError('FOREIGN_CAPABILITY', 'other window'); }) };
    expect(await createSquadSourceSnapshotter(typed as never)(window, args({ sourceCapabilityIds: ['cap-1'] })))
      .toEqual({ ok: false, code: 'FOREIGN_CAPABILITY', message: 'other window' });
    const plain = { ...registry(), issue: vi.fn(async () => { throw new Error('disk full'); }) };
    expect(await createSquadSourceSnapshotter(plain as never)(window, args({ goalSourceDescriptors: [descriptor] })))
      .toEqual({ ok: false, code: 'SOURCE_SNAPSHOT_FAILED', message: 'disk full' });
    const thrown = { ...registry(), resolve: vi.fn(async () => { throw 'boom'; }) };
    expect(await createSquadSourceSnapshotter(thrown as never)(window, args({ sourceCapabilityIds: ['cap-1'] })))
      .toEqual({ ok: false, code: 'SOURCE_SNAPSHOT_FAILED', message: 'boom' });
  });
});

describe('redactCapturedExecutionSourcePaths', () => {
  it('replaces the longest representation first and leaves undefined alone', () => {
    const descriptors = [
      { exactPath: '/a/b', canonicalPath: '/a/b', representations: ['/a/b'] },
      { exactPath: '/a/b/c.md', canonicalPath: '/a/b/c.md', representations: ['/a/b/c.md', '/a/b/c.md'] }
    ];
    expect(redactCapturedExecutionSourcePaths('see /a/b/c.md and /a/b', descriptors))
      .toBe('see [captured execution source: c.md] and [captured execution source: b]');
    expect(redactCapturedExecutionSourcePaths(undefined, descriptors)).toBeUndefined();
  });
});

describe('session sources through the real registry', () => {
  async function withFiles(run: (dir: string) => Promise<void>) {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'squad-launch-session-')));
    try {
      await mkdir(join(dir, 'project'), { recursive: true });
      await mkdir(join(dir, 'home', '.ssh'), { recursive: true });
      await writeFile(join(dir, 'project', 'plan.md'), '# plan');
      await writeFile(join(dir, 'home', '.ssh', 'config'), 'Host x');
      await run(dir);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  const registryIn = (dir: string) => {
    let n = 0;
    return createExecutionSourceRegistry({ rootDir: join(dir, 'store'), id: () => `cap-${++n}` });
  };
  const policyIn = (dir: string) => resolveSourcePolicy(realpath, { projectRoot: join(dir, 'project'), home: join(dir, 'home') });

  it('snapshots a confined file for the session, and leaves no capability another binding can use', async () => withFiles(async (dir) => {
    const registry = registryIn(dir);
    const result = await createSquadSourceSnapshotter(registry)({ kind: 'session', sessionId: 'agent-session' }, {
      projectId: 'p1', launchRequestId: 'agent:1', sourceCapabilityIds: [], sourcePaths: [join(dir, 'project', 'plan.md')],
      goalSourceDescriptors: [], policy: await policyIn(dir)
    });
    expect(result).toMatchObject({ ok: true, sourceBundle: { sources: [expect.objectContaining({ name: 'plan.md', extractedText: '# plan' })] } });
    // Consumed: a window or another session presenting the id gets nothing.
    await expect(registry.resolve({ windowId: 7, projectId: 'p1', capabilityIds: ['cap-1'], snapshotKey: 'w' })).rejects.toMatchObject({ code: 'REPLAYED_CAPABILITY' });
  }));

  it('leaves no snapshot on disk when a session launch is refused for an invalid plan', async () => withFiles(async (dir) => {
    const registry = registryIn(dir);
    const { deps, start } = makeDeps({
      snapshotSources: createSquadSourceSnapshotter(registry),
      removeSnapshot: (contentRef) => registry.removeSnapshot(contentRef),
      realpath,
      sourceBases: () => ({ home: join(dir, 'home'), dataDirs: [], protectedRoots: [] })
    });
    const result = await launchSquad(deps, makeInput({
      project: { id: 'p1', name: 'Repo', path: join(dir, 'project') },
      coordinationMode: 'structured', goal: 'prose goal', sourcePaths: [join(dir, 'project', 'plan.md')]
    }), { sources: { kind: 'session', sessionId: 'agent-session' }, owner: { principalId: 'agent-session' } });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PLAN' });
    expect(start).not.toHaveBeenCalled();
    expect(await readdir(join(dir, 'store'))).toEqual([]);
  }));

  it('refuses a protected file for the session with the registry\'s code', async () => withFiles(async (dir) => {
    const result = await createSquadSourceSnapshotter(registryIn(dir))({ kind: 'session', sessionId: 'agent-session' }, {
      projectId: 'p1', launchRequestId: 'agent:2', sourceCapabilityIds: [], sourcePaths: [join(dir, 'home', '.ssh', 'config')],
      goalSourceDescriptors: [], policy: await policyIn(dir)
    });
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_SOURCE' });
  }));
});
