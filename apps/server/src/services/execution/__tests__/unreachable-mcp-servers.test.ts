import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, slotReachesRequirements, unitSlotEligibility, unreachableMcpServers, type ExecutionWorkUnitInput, type ResolvedModelSnapshotV1 } from '../store.js';

// D10: required-but-excluded is a hard FAIL; allowlisted-but-missing is advisory and never blocks.

const unit = (...mcpServers: string[]) => ({ requires: { mcpServers } });
const model = (mcpServers?: string[], extra: Partial<ResolvedModelSnapshotV1> = {}) => ({ slotId: 'w0', provider: 'claude', model: 'm', ...(mcpServers ? { mcpServers } : {}), ...extra }) as ResolvedModelSnapshotV1;

describe('unreachableMcpServers', () => {
  it('reports a required server the allowlist excludes (hard mismatch)', () => {
    expect(unreachableMcpServers(unit('github', 'slack'), model(['zcc-inbox', 'github']))).toEqual(['slack']);
  });
  it('treats an absent allowlist as unrestricted and a missing model as unrestricted', () => {
    expect(unreachableMcpServers(unit('github'), model())).toEqual([]);
    expect(unreachableMcpServers(unit('github'), undefined)).toEqual([]);
  });
  it('an empty allowlist excludes everything required; nothing required is always reachable', () => {
    expect(unreachableMcpServers(unit('github'), model([]))).toEqual(['github']);
    expect(unreachableMcpServers({}, model([]))).toEqual([]);
    expect(unreachableMcpServers(unit(), model([]))).toEqual([]);
  });
  it('allowlisted-but-missing is advisory only: an allowlist entry for an uninstalled server never fails a requirement it covers', () => {
    // The allowlist covers the requirement; whether the server is installed is not this check's concern.
    expect(unreachableMcpServers(unit('not-installed'), model(['zcc-inbox', 'not-installed']))).toEqual([]);
  });
  it('matches namespaced keys exactly and bare entries cover plugin and ext servers of that name', () => {
    expect(unreachableMcpServers(unit('plugin:p:gh'), model(['plugin:p:gh']))).toEqual([]);
    expect(unreachableMcpServers(unit('plugin:p:gh'), model(['plugin:q:gh']))).toEqual(['plugin:p:gh']);
    expect(unreachableMcpServers(unit('plugin:p:gh'), model(['gh']))).toEqual([]);
    expect(unreachableMcpServers(unit('ext:e:gh'), model(['ext:e:gh']))).toEqual([]);
    expect(unreachableMcpServers(unit('ext:e:gh'), model(['plugin:e:gh']))).toEqual(['ext:e:gh']);
    expect(unreachableMcpServers(unit('gh'), model(['plugin:p:gh']))).toEqual([]);
    expect(unreachableMcpServers(unit('gh'), model(['ext:e:gh']))).toEqual([]);
    expect(unreachableMcpServers(unit('gh'), model(['plugin:p:other']))).toEqual(['gh']);
  });
});

describe('slot eligibility', () => {
  it('hard-FAILs a slot whose allowlist excludes a required server, with a reason', () => {
    const result = unitSlotEligibility(unit('slack'), { slotId: 'w0', personaId: 'p' }, model(['zcc-inbox']));
    expect(result.status).toBe('FAIL');
    expect(result.reasons).toContain('mcp server unreachable: slack');
  });
  it('does not fail a slot that covers the requirement or is unrestricted', () => {
    expect(unitSlotEligibility(unit('slack'), { slotId: 'w0', personaId: 'p' }, model(['slack'])).status).not.toBe('FAIL');
    expect(unitSlotEligibility(unit('slack'), { slotId: 'w0', personaId: 'p' }, model()).status).not.toBe('FAIL');
  });
  it('combines skill and MCP reasons', () => {
    const result = unitSlotEligibility({ requires: { skills: ['review'], mcpServers: ['slack'] } }, { slotId: 'w0', personaId: 'p' }, model(['zcc-inbox'], { skillAllowlist: ['zcc-inbox'] }));
    expect(result.reasons).toEqual(expect.arrayContaining(['skill unreachable: review', 'mcp server unreachable: slack']));
  });
  it('slotReachesRequirements needs both skills and MCP reach', () => {
    const both = { requires: { skills: ['review'], mcpServers: ['slack'] } };
    expect(slotReachesRequirements(both, model(['slack'], { skillAllowlist: ['review'] }))).toBe(true);
    expect(slotReachesRequirements(both, model(['slack'], { skillAllowlist: ['zcc-inbox'] }))).toBe(false);
    expect(slotReachesRequirements(both, model(['zcc-inbox'], { skillAllowlist: ['review'] }))).toBe(false);
  });
});

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-unreachable-mcp-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

type Store = ReturnType<typeof createExecutionStore>;
async function running(store: Store, roster: Array<{ slotId: string; mcpServers?: string[] }>, workUnit: Partial<ExecutionWorkUnitInput>) {
  const req = {
    callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship feature',
    requestDigest: 'digest-1', launchRequestId: 'request-1', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
  };
  let record = (await store.claim(req)).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, {
    version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
      { slotId: 'orchestrator', personaId: 'lead', authorizationIdDigest: 'o' },
      ...roster.map((slot) => ({ slotId: slot.slotId, personaId: 'engineer', authorizationIdDigest: slot.slotId }))
    ]
  }, 'authorization-digest');
  record = await store.replaceResolvedModels(record.id, roster.map((slot) => ({
    slotId: slot.slotId, personaId: 'engineer', provider: 'claude', model: 'claude-haiku-4', maxContextBytes: 10_000_000, ...(slot.mcpServers ? { mcpServers: slot.mcpServers } : {})
  })));
  return store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true, ...workUnit }]);
}

describe('dispatch', () => {
  it('fails the unit NO_QUALIFIED_ROUTE when no worker slot allows a required MCP server', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const record = await running(store, [{ slotId: 'w0', mcpServers: ['zcc-inbox'] }], { requires: { mcpServers: ['slack'] } });
    const { record: after, assignments } = await store.dispatchReady(record.id);
    expect(assignments).toEqual([]);
    expect(after.workUnits![0]).toMatchObject({ state: 'FAILED', failureCode: 'NO_QUALIFIED_ROUTE', failure: 'no authorized worker slot allows every required MCP server' });
  }));
  it('routes the unit to the slot whose allowlist covers the required server', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const record = await running(store, [{ slotId: 'w0', mcpServers: ['zcc-inbox'] }, { slotId: 'w1', mcpServers: ['zcc-inbox', 'slack'] }], { requires: { mcpServers: ['slack'] } });
    const { assignments } = await store.dispatchReady(record.id);
    expect(assignments[0].slotId).toBe('w1');
  }));
  it('does not block when the allowlist covers a server that may be missing (advisory)', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    const record = await running(store, [{ slotId: 'w0', mcpServers: ['zcc-inbox', 'absent-server'] }], { requires: { mcpServers: ['absent-server'] } });
    const { assignments } = await store.dispatchReady(record.id);
    expect(assignments[0].slotId).toBe('w0');
  }));
  it('rejects a malformed model MCP allowlist', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution', now: () => 1_000 });
    await expect(running(store, [{ slotId: 'w0', mcpServers: [''] }], {})).rejects.toThrow();
  }));
});
