import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DURABLE_CLAIM_STALL_MS, SquadExecutionService, assignmentText, withDurableClaimWallClockBackstop } from '../service.js';
import { createExecutionStore, type ExecutionDispatchAssignment, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// The worker's assignment text shows the unit's Verification steps and tells it when to heartbeat.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-assignment-text-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = { version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release', slots: [{ initialTask: 'Run tests' }] };
const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };

function build(filePath: string, unit: Record<string, unknown>) {
  const now = () => 1_000;
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
  const replyToSession = vi.fn(() => true);
  const service = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
        { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
      ] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }),
    replyToSession, now,
    resolveExactNativeRecoverySnapshots: () => []
  } as never);
  return { service, store, replyToSession, unit };
}

async function deliver(filePath: string, unit: Record<string, unknown>) {
  const ctx = build(filePath, unit);
  const started = await ctx.service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [unit] } as never);
  if (!started.ok) throw new Error(started.message);
  await ctx.service.dispatchReady(coordinator);
  const record = (await ctx.store.get('execution-1'))!;
  const claimed = record.workUnits![0];
  const text = ctx.replyToSession.mock.calls.find((call) => (call as unknown[])[0] === 'worker-1')![1] as string;
  return { ...ctx, record, claimed, text, fence: { claimId: claimed.claimId!, claimGeneration: claimed.claimGeneration! } };
}

const baseUnit = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'] };
const LONG_LINE = 'Long commands: for any command that can run longer than 3 minutes (E2E, coverage, a full test run, a build), run it in the background and call execution.work.heartbeat with this claimId and claimGeneration every 2-3 minutes until it finishes, with a turnCount one higher than on your previous call (start at 1); a claim with no progress for 10 minutes is taken back.';
const CLOSE = 'Close the unit through exactly one structured outcome: execution.work.complete, execution.work.block, execution.work.fail, or execution.work.release. Do not send routine progress or results to the coordinator.';
const withVerification = (verification?: string[]) => ({ workUnitId: 'a', slotId: 'slot-1', title: 'A', task: 'do a', files: ['a.txt'], ...(verification ? { verification } : {}) } as ExecutionDispatchAssignment);

describe('worker assignment text', () => {
  it('the delivered text lists the unit\'s Verification steps after File scope', async () => fixture(async (filePath) => {
    const { text } = await deliver(filePath, { ...baseUnit, verification: ['pnpm typecheck passes', 'vitest run is green'] });
    expect(text).toContain('\nVerification (run these before you complete the unit):\n- pnpm typecheck passes\n- vitest run is green');
    expect(text.indexOf('File scope: a.txt')).toBeLessThan(text.indexOf('Verification (run these'));
  }));

  it('assignmentText renders each step trimmed, between File scope and Upstream results', async () => fixture(async (filePath) => {
    const { record } = await deliver(filePath, { ...baseUnit, verification: ['x'] });
    const text = assignmentText(record, withVerification(['  first step  ', 'second step']));
    expect(text).toContain('File scope: a.txt\nVerification (run these before you complete the unit):\n- first step\n- second step');
  }));

  it('a unit without Verification and without a claim fence gets exactly today\'s text', async () => fixture(async (filePath) => {
    const { record } = await deliver(filePath, { ...baseUnit, verification: ['x'] });
    expect(assignmentText(record, withVerification())).toBe(`You are assigned work unit \`a\` — A.\nTask: do a\nFile scope: a.txt\n\n${CLOSE}`);
    expect(assignmentText(record, { ...withVerification(), verification: [] } as ExecutionDispatchAssignment)).toBe(`You are assigned work unit \`a\` — A.\nTask: do a\nFile scope: a.txt\n\n${CLOSE}`);
  }));

  it('with a claim fence but no Verification, the text is today\'s plus the long-command line only', async () => fixture(async (filePath) => {
    const { record } = await deliver(filePath, { ...baseUnit, verification: ['x'] });
    const text = assignmentText(record, { ...withVerification(), claimId: 'c-1', claimGeneration: 2 });
    expect(text).toBe(`You are assigned work unit \`a\` — A.\nTask: do a\nFile scope: a.txt\nClaim fence: claimId=c-1; claimGeneration=2. Include both in execution.work.heartbeat and every structured work outcome.\n${LONG_LINE}\n\n${CLOSE}`);
  }));

  it('the claim-fence line keeps the exact format e2e/sdk/harness.ts parses', async () => fixture(async (filePath) => {
    const { text, fence } = await deliver(filePath, { ...baseUnit, verification: ['pnpm typecheck passes'] });
    const match = text.match(/Claim fence: claimId=([^;\n]+); claimGeneration=(\d+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(fence.claimId);
    expect(Number(match![2])).toBe(fence.claimGeneration);
    expect(text).toContain(`Claim fence: claimId=${fence.claimId}; claimGeneration=${fence.claimGeneration}. Include both in execution.work.heartbeat and every structured work outcome.`);
  }));

  it('the long-command line follows the claim fence when one is present', async () => fixture(async (filePath) => {
    const { text, fence } = await deliver(filePath, { ...baseUnit, verification: ['x'] });
    const fenceLine = `Claim fence: claimId=${fence.claimId}; claimGeneration=${fence.claimGeneration}. Include both in execution.work.heartbeat and every structured work outcome.`;
    expect(text).toContain(`${fenceLine}\n${LONG_LINE}`);
  }));

  it('the long-command line is absent without a claim fence, and without a generation', async () => fixture(async (filePath) => {
    const { record } = await deliver(filePath, { ...baseUnit, verification: ['x'] });
    expect(assignmentText(record, withVerification(['a step']))).not.toContain('Long commands:');
    expect(assignmentText(record, { ...withVerification(['a step']), claimId: 'c-1' })).not.toContain('Long commands:');
  }));

  it('a Verification section over 4,000 characters is cut on a line boundary with a truncation marker', async () => fixture(async (filePath) => {
    const { record } = await deliver(filePath, { ...baseUnit, verification: ['x'] });
    const steps = Array.from({ length: 200 }, (_, index) => `step ${String(index).padStart(3, '0')} ${'v'.repeat(40)}`);
    const text = assignmentText(record, withVerification(steps));
    const start = text.indexOf('\nVerification (run these before you complete the unit):');
    expect(start).toBeGreaterThan(-1);
    const section = text.slice(start, text.indexOf('\n\n', start));
    expect(section.endsWith('\n- … (truncated)')).toBe(true);
    expect(section.length).toBeLessThanOrEqual(4_000 + '\n- … (truncated)'.length);
    expect(section).toContain('step 000');
    expect(section).not.toContain('step 199');
    // Every kept line is a whole step: nothing was cut mid-line.
    const kept = section.split('\n').slice(2, -1);
    expect(kept.length).toBeGreaterThan(10);
    for (const line of kept) expect(line).toMatch(/^- step \d{3} v{40}$/);
  }));

  it('a section within 4,000 characters is not marked as truncated', async () => fixture(async (filePath) => {
    const { record } = await deliver(filePath, { ...baseUnit, verification: ['x'] });
    expect(assignmentText(record, withVerification(['short step']))).not.toContain('(truncated)');
  }));

  it('a redelivered claim carries the same Verification steps as the first delivery', async () => fixture(async (filePath) => {
    const { service, replyToSession, claimed, fence } = await deliver(filePath, { ...baseUnit, verification: ['pnpm typecheck passes'] });
    replyToSession.mockClear();
    await expect(service.redeliverClaim('execution-1', claimed.id, fence, 'worker-1', 'PREFACE')).resolves.toBe(true);
    const redelivered = (replyToSession.mock.calls.find((call) => (call as unknown[])[0] === 'worker-1')![1]) as string;
    expect(redelivered).toContain('\nVerification (run these before you complete the unit):\n- pnpm typecheck passes');
    expect(redelivered).toContain(LONG_LINE);
  }));

  it('a single oversized first step yields only the truncation marker, never a partial step', async () => fixture(async (filePath) => {
    const { record } = await deliver(filePath, { ...baseUnit, verification: ['x'] });
    const text = assignmentText(record, withVerification(['w'.repeat(5_000), 'second step']));
    expect(text).toContain('\nVerification (run these before you complete the unit):\n- … (truncated)');
    expect(text).not.toContain('www');
    expect(text).not.toContain('second step');
  }));

  it('blank Verification steps are dropped, and a list of only blanks adds no section', async () => fixture(async (filePath) => {
    const { record } = await deliver(filePath, { ...baseUnit, verification: ['x'] });
    const mixed = assignmentText(record, withVerification(['real step', '   ', '']));
    expect(mixed).toContain('File scope: a.txt\nVerification (run these before you complete the unit):\n- real step\n\n');
    expect(mixed).not.toMatch(/^- *$/m);
    expect(assignmentText(record, withVerification(['  ', '']))).not.toContain('Verification (run these');
  }));

  it('redelivery places the Verification steps immediately after File scope', async () => fixture(async (filePath) => {
    const { service, replyToSession, claimed, fence } = await deliver(filePath, { ...baseUnit, verification: ['step one', 'step two'] });
    replyToSession.mockClear();
    await service.redeliverClaim('execution-1', claimed.id, fence, 'worker-1', 'PREFACE');
    const redelivered = replyToSession.mock.calls.find((call) => (call as unknown[])[0] === 'worker-1')![1] as string;
    expect(redelivered).toContain('File scope: a.txt\nVerification (run these before you complete the unit):\n- step one\n- step two\nClaim fence:');
  }));
});

describe('heartbeat advice in the assignment text', () => {
  const assignment = (over: Partial<ExecutionDispatchAssignment> = {}): ExecutionDispatchAssignment =>
    ({ workUnitId: 'a', slotId: 'slot-1', title: 'A', task: 'do a', claimId: 'c-1', claimGeneration: 1, ...over });
  const record = (policy?: Record<string, unknown>) => ({ request: { policy }, workUnits: [] } as unknown as ExecutionRecord);

  it('a first delivery tells the worker to start at 1', () => {
    expect(assignmentText(record(), assignment())).toContain('(start at 1)');
  });

  it('a redelivery after earlier heartbeats names the next count, so heartbeats are not no-ops', () => {
    expect(assignmentText(record(), assignment({ turnCount: 6 }))).toContain('(start at 7)');
  });

  it('names the durable default stall ceiling, so the text cannot drift from the real one', () => {
    // Durable runs get this ceiling injected, and the 2-3 minute cadence stays well inside it.
    const injected = withDurableClaimWallClockBackstop('job-team', undefined)!.maxClaimStallMs!;
    expect(injected).toBe(DEFAULT_DURABLE_CLAIM_STALL_MS);
    expect(DEFAULT_DURABLE_CLAIM_STALL_MS).toBeGreaterThan(3 * 60_000);
    expect(assignmentText(record(), assignment())).toContain('every 2-3 minutes');
    expect(assignmentText(record(), assignment())).toContain(`no progress for ${injected / 60_000} minutes is taken back`);
  });
});

describe('redelivery carries the stored heartbeat count', () => {
  it('a claim heartbeated to 3 and then redelivered tells the worker to start at 4', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-heartbeat-advice-'));
    try {
      const filePath = join(dir, 'executions.json');
      const now = () => 1_000;
      const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
      const replyToSession = vi.fn(() => true);
      const service = new SquadExecutionService({
        store,
        artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
        authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
          version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
            { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
            { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
          ] } } }),
        launchTeam: async () => ({ ok: true }),
        getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }),
        cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }),
        replyToSession, now, resolveExactNativeRecoverySnapshots: () => []
      } as never);
      const unit = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] };
      const started = await service.start('owner', 'project-1', { version: 1, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }], coordinationMode: 'job-team', workUnits: [unit] } as never);
      if (!started.ok) throw new Error(started.message);
      await service.dispatchReady({ executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' });
      let record = (await store.get('execution-1'))!;
      const claimed = record.workUnits![0];
      const fence = { claimId: claimed.claimId!, claimGeneration: claimed.claimGeneration! };
      record = await store.heartbeatWork('execution-1', record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { ...fence, turnCount: 3 });
      expect(record.workUnits![0].turnCount).toBe(3);
      replyToSession.mockClear();
      await expect(service.redeliverClaim('execution-1', 'a', fence, 'worker-1', 'PREFACE')).resolves.toBe(true);
      const text = (replyToSession.mock.calls.find((call) => (call as unknown[])[0] === 'worker-1')![1]) as string;
      expect(text).toContain('(start at 4)');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
