import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarnessExecutionTarget } from '@zana-ai/zcc-domain/harness-adapter';
import { ExecutionConsentService } from '@zana-ai/zcc-host-daemon/harness/execution-consent';
import { createExecutionConsentStore } from '@zana-ai/zcc-host-daemon/harness/execution-consent-store';
import type { ExecutionConsentBinding, ExecutionConsentReserveResult, ExecutionConsentScope } from '@zana-ai/zcc-host-daemon/harness/execution-consent-store';
import { collectTeamAdmissionInventory, evaluateTeamAdmission, normalizeExecutionPlan, preflightExecutionAuthorization, summarizePlanTierFit } from '../preflight.js';

const target = (patch: Partial<HarnessExecutionTarget> = {}): HarnessExecutionTarget => ({
  id: 'opencode.execution.accept-edits', state: 'accept-edits', equivalence: 'closest',
  effect: 'build plus auto-approve', materialDifference: 'broader approvals', risk: 'high',
  evidence: { id: 'opencode.execution.accept-edits', version: 1 }, evidenceStatus: 'approved',
  scopes: ['local'], profilePostures: ['default'], unattendedAllowed: false, consent: 'required',
  ...patch
});

const evidence = (patch = {}) => ({
  id: 'opencode.execution.accept-edits', version: 1, status: 'approved' as const,
  cliVersion: '1.2.3', scopes: ['local'] as const,
  probe: 'opencode --version plus policy contract suite',
  environmentAssumptions: ['clean temporary workspace'],
  observed: {
    filesystem: 'edits approved', commands: 'commands auto-approved', network: 'unchanged',
    approvalPrompts: 'no prompt for edits or commands', explicitDenialsRetained: true
  },
  reviewedAt: '2026-08-03', adapterOwnerApproval: 'opencode-adapter-owner',
  ...patch
});

const consent = (
  reserve: (input: ExecutionConsentBinding & { scope: ExecutionConsentScope; idempotencyKey: string }) => Promise<ExecutionConsentReserveResult>
    = vi.fn(async () => ({ outcome: 'denied' as const }))
) => ({ reserve });

describe('execution launch preflight', () => {
  const base = {
    adapterId: 'opencode', provenance: 'portable-mapped' as const, target: target(), evidence: evidence(),
    installedVersion: '1.2.3', scope: 'local' as const, profilePosture: 'default' as const,
    projectId: 'p1', mode: 'interactive' as const, consentScopes: ['one-launch', 'project'] as const,
    idempotencyKey: 'launch-1'
  };

  it('blocks OpenCode closest translation until matching consent is reserved', async () => {
    await expect(preflightExecutionAuthorization(base, consent())).resolves.toMatchObject({
      decision: 'blocked', reason: 'no matching consent'
    });
  });

  it('validates an explicit native target without translation consent', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({ ...base, provenance: 'explicit-native' }, consent(reserve))).resolves.toMatchObject({ decision: 'allowed', scope: 'local' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('validates a pinned native policy target without translation consent', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({
      ...base,
      adapterId: 'codex',
      provenance: 'explicit-native',
      target: target({ id: 'codex.execution.interactive', state: 'interactive', equivalence: 'exact', consent: 'none', unattendedAllowed: true, evidence: { id: 'codex.execution.interactive', version: 1 } }),
      evidence: { ...evidence(), id: 'codex.execution.interactive' }
    }, consent(reserve))).resolves.toMatchObject({ decision: 'allowed' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('blocks candidate evidence before consent lookup', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({ ...base, evidence: evidence({ status: 'candidate' }) }, consent(reserve))).resolves.toEqual({
      decision: 'blocked', reason: 'candidate evidence'
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('allows an approved exact portable mapping without consent', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({ ...base, target: target({ equivalence: 'exact', consent: 'none', unattendedAllowed: true }) }, consent(reserve))).resolves.toMatchObject({ decision: 'allowed' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('reserves a valid grant for approved closest mapping', async () => {
    const reserve = vi.fn(async () => ({
      outcome: 'reserved' as const,
       reservation: { id: 'reservation-1', grantId: 'grant-1', idempotencyKey: 'launch-1:one-launch', createdAt: 1, expiresAt: 2 },
       grant: { id: 'grant-1', adapterId: base.adapterId, targetId: base.target.id, targetDigest: 'ignored', evidenceDigest: 'ignored', projectId: 'p1', launchScope: 'local' as const, scope: 'one-launch' as const, createdAt: 1 }
    }));
    await expect(preflightExecutionAuthorization(base, consent(reserve))).resolves.toMatchObject({
      decision: 'allowed', consentReservation: { id: 'reservation-1' }
    });
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({
       adapterId: 'opencode', targetId: base.target.id, projectId: 'p1', idempotencyKey: 'launch-1:one-launch'
     }));
   });

  it('runs trusted interactive ceremony only after existing consent lookup fails', async () => {
    let attempts = 0;
    const reserve = vi.fn(async () => {
      attempts += 1;
      if (attempts <= 2) return { outcome: 'denied' as const };
      return {
        outcome: 'reserved' as const,
        reservation: { id: 'reservation-1', grantId: 'grant-1', idempotencyKey: 'launch-1:project', createdAt: 1, expiresAt: 2 },
        grant: { id: 'grant-1', adapterId: base.adapterId, targetId: base.target.id, targetDigest: 'td', evidenceDigest: 'ed', projectId: 'p1', launchScope: 'local' as const, scope: 'project' as const, createdAt: 1 }
      };
    });
    const request = vi.fn(async () => ({ decision: 'granted' as const, grant: { scope: 'project' as const } }));
    await expect(preflightExecutionAuthorization(base, { reserve, request })).resolves.toMatchObject({
      decision: 'allowed', consentReservation: { id: 'reservation-1' }
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ mode: 'interactive', adapterId: 'opencode' }));
  });

  it('never runs ceremony for headless or unattended launches', async () => {
    const reserve = vi.fn(async () => ({ outcome: 'denied' as const }));
    const request = vi.fn();
    for (const mode of ['headless', 'unattended'] as const) {
      const allowedTarget = target({ unattendedAllowed: true });
      await expect(preflightExecutionAuthorization({
        ...base, mode, target: allowedTarget, consentScopes: ['project']
      }, { reserve, request })).resolves.toEqual({ decision: 'blocked', reason: 'no matching consent' });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('blocks unattended use whenever target disallows it and never reserves consent', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({ ...base, mode: 'unattended' }, consent(reserve))).resolves.toEqual({
      decision: 'blocked', reason: 'target disallows unattended execution'
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('passes inherited native defaults without portable claims or consent', async () => {
    const reserve = vi.fn();
    await expect(preflightExecutionAuthorization({
      ...base, provenance: 'inherited-native-default', target: undefined, evidence: undefined
    }, consent(reserve))).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('auto-grants project consent for interactive closest mappings without a dialog', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-preflight-'));
    try {
      const store = createExecutionConsentStore({ filePath: join(dir, 'consent.json'), id: () => 'grant-1' });
      const service = new ExecutionConsentService({ store });
      await expect(preflightExecutionAuthorization(base, {
        reserve: store.reserve,
        request: service.request.bind(service)
      })).resolves.toMatchObject({
        decision: 'allowed',
        consentReservation: { id: expect.any(String), scope: 'project' }
      });
      expect((await store.list()).grants).toEqual([expect.objectContaining({ id: 'grant-1', scope: 'project' })]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Team admission', () => {
  const validPlan = [{
    id: 'build', title: 'Build', task: 'Build feature', dependencies: [],
    files: ['src/index.ts'], verification: ['pnpm test']
  }];

  it('normalizes file scopes and preserves DAG validation behavior', () => {
    expect(normalizeExecutionPlan([{ ...validPlan[0], files: ['./src\\index.ts'] }], true)[0]?.files).toEqual(['src/index.ts']);
    expect(() => normalizeExecutionPlan([
      { ...validPlan[0], id: 'a', dependencies: ['b'] },
      { ...validPlan[0], id: 'b', dependencies: ['a'] }
    ], true)).toThrow('work unit dependency cycle');
    expect(() => normalizeExecutionPlan([{ ...validPlan[0], files: ['../secret'] }], true)).toThrow('invalid work unit file scope');
  });

  it('normalizes bounded per-work-unit requirements and rejects malformed requirements', () => {
    const normalized = normalizeExecutionPlan([{
      ...validPlan[0], requires: { skills: ['review', 'review'], mcpServers: ['repo'] }
    }], true);
    expect(normalized[0]?.requires).toEqual({ skills: ['review'], mcpServers: ['repo'] });
    expect(() => normalizeExecutionPlan([{ ...validPlan[0], requires: { skills: Array.from({ length: 51 }, (_, index) => `skill-${index}`) } }], true))
      .toThrow('invalid work unit required skills');
    expect(() => normalizeExecutionPlan([{ ...validPlan[0], requires: { unknown: ['x'] } } as any], true))
      .toThrow('invalid work unit requires');
  });

  it('rejects a plan atomically when a work-unit requirement is unavailable', () => {
    const result = evaluateTeamAdmission({
      workUnits: [{ ...validPlan[0], requires: { skills: ['review'], mcpServers: ['repo'] } }],
      requireCompletePlan: true, slotCount: 1, maxSlots: 1, initialTasks: ['work'], now: 10,
      inventory: { version: 1, observedAt: 10, maxAgeMs: 100, skills: [{ name: 'review', available: true }], mcpServers: [{ name: 'repo', available: false }], models: [], providers: [] }
    });
    expect(result).toMatchObject({ ready: false, checks: expect.arrayContaining([
      expect.objectContaining({ code: 'SKILL_AVAILABLE', subject: 'build', status: 'PASS' }),
      expect.objectContaining({ code: 'MCP_AVAILABLE', subject: 'build', status: 'FAIL', unavailable: ['repo'], message: 'work unit build requirement unavailable: MCP servers: repo' })
    ]) });
  });

  it('does not label declared capabilities missing when inventory is unavailable', () => {
    const result = evaluateTeamAdmission({
      workUnits: [{ ...validPlan[0], requires: { skills: ['review'], mcpServers: ['repo'] } }],
      requireCompletePlan: true, slotCount: 1, maxSlots: 1, initialTasks: ['work'], now: 10
    });

    expect(result).toMatchObject({ ready: false, checks: expect.arrayContaining([
      expect.not.objectContaining({ code: 'SKILL_AVAILABLE', subject: 'build', unavailable: expect.anything() }),
      expect.not.objectContaining({ code: 'MCP_AVAILABLE', subject: 'build', unavailable: expect.anything() })
    ]) });
  });

  it('uses identical deterministic output for preview and admission calls', () => {
    const input = {
      workUnits: validPlan, requireCompletePlan: true, slotCount: 2, maxSlots: 4,
      initialTasks: ['Build', 'Review'], now: 2_000,
      requiredSkills: ['testing'], requiredMcpServers: ['repo'], requiredModels: [{ id: 'model-1', provider: 'provider-1' }], requiredProviders: ['provider-1'],
      inventory: {
        version: 1 as const, observedAt: 1_500, maxAgeMs: 1_000,
        skills: [{ name: 'testing', available: true }], mcpServers: [{ name: 'repo', available: true }],
        models: [{ id: 'model-1', provider: 'provider-1', status: 'available' as const }],
        providers: [{ id: 'provider-1', status: 'available' as const }]
      },
      budget: { version: 1 as const, maxContextBytes: 10_000, maxEstimatedTokens: 2_500, maxEstimatedUsd: 1, estimatedUsd: 0.25 }
    };
    const preview = evaluateTeamAdmission(input);
    const admission = evaluateTeamAdmission(input);
    expect(preview).toEqual(admission);
    expect(preview.ready).toBe(true);
  });

  it.each([
    ['SKIPPED', undefined],
    ['UNKNOWN', { version: 1 as const, observedAt: 0, maxAgeMs: 1, skills: [], mcpServers: [], models: [], providers: [] }]
  ])('fails closed when required capability is %s', (_status, inventory) => {
    const result = evaluateTeamAdmission({
      slotCount: 1, maxSlots: 1, initialTasks: ['work'], requiredSkills: ['missing'],
      inventory, now: 10
    });
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ code: 'SKILL_AVAILABLE', status: 'UNKNOWN', required: true }));
  });

  it('marks an offline provider UNKNOWN and rejects launch', () => {
    const result = evaluateTeamAdmission({
      slotCount: 1, maxSlots: 1, initialTasks: ['work'], requiredProviders: ['offline'], now: 10,
      inventory: { version: 1, observedAt: 10, maxAgeMs: 100, skills: [], mcpServers: [], models: [], providers: [{ id: 'offline', status: 'unknown' }] }
    });
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ code: 'PROVIDER_HEALTH', subject: 'offline', status: 'UNKNOWN' }));
  });

  it('matches model health by provider and model id', () => {
    const result = evaluateTeamAdmission({
      slotCount: 1, maxSlots: 1, initialTasks: ['work'],
      requiredModels: [{ id: 'shared-model', provider: 'expected-provider' }], now: 10,
      inventory: {
        version: 1, observedAt: 10, maxAgeMs: 100, skills: [], mcpServers: [], providers: [],
        models: [{ id: 'shared-model', provider: 'other-provider', status: 'available' }]
      }
    });
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({
      code: 'MODEL_HEALTH', subject: 'expected-provider:shared-model', status: 'UNKNOWN'
    }));
  });

  it('rejects context, token, and unknown USD budgets independently of slot limits', () => {
    const result = evaluateTeamAdmission({
      slotCount: 1, maxSlots: 32, initialTasks: ['x'.repeat(100)],
      budget: { version: 1, maxContextBytes: 50, maxEstimatedTokens: 10, maxEstimatedUsd: 1 }
    });
    expect(result.ready).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CONTEXT_BUDGET', status: 'FAIL' }),
      expect.objectContaining({ code: 'TOKEN_BUDGET', status: 'FAIL' }),
      expect.objectContaining({ code: 'USD_BUDGET', status: 'UNKNOWN' })
    ]));
  });

  it('does not report DAG validity when file validation stops normalization', () => {
    const result = evaluateTeamAdmission({
      workUnits: [
        { ...validPlan[0], id: 'a', dependencies: ['b'], files: ['../secret'] },
        { ...validPlan[0], id: 'b', dependencies: ['a'] }
      ],
      requireCompletePlan: true, slotCount: 1, maxSlots: 1, initialTasks: ['work']
    });
    expect(result.checks).toContainEqual(expect.objectContaining({ code: 'DAG_VALID', status: 'UNKNOWN' }));
    expect(result.checks).toContainEqual(expect.objectContaining({ code: 'FILE_SCOPES_VALID', status: 'FAIL' }));
  });

  it.each(['', 'x'.repeat(2_049)])('classifies malformed file scope as a file failure', (file) => {
    const result = evaluateTeamAdmission({
      workUnits: [{ ...validPlan[0], files: [file] }], requireCompletePlan: true,
      slotCount: 1, maxSlots: 1, initialTasks: ['work']
    });
    expect(result.checks).toContainEqual(expect.objectContaining({ code: 'DAG_VALID', status: 'UNKNOWN' }));
    expect(result.checks).toContainEqual(expect.objectContaining({ code: 'FILE_SCOPES_VALID', status: 'FAIL' }));
  });

  it('returns only normalized work-unit fields', () => {
    expect(normalizeExecutionPlan([{ ...validPlan[0], runtimeState: 'READY' }], true)[0]).not.toHaveProperty('runtimeState');
  });

  it('fails closed when a routed work unit has no qualified existing worker slot', () => {
    const result = evaluateTeamAdmission({
      workUnits: [{ ...validPlan[0], routing: { version: 1, requiredRole: 'reviewer' } }], requireCompletePlan: true,
      slotCount: 2, maxSlots: 2, initialTasks: ['worker', 'orchestrator'],
      slotRoutes: [{ slotId: 'slot-1', personaId: 'writer' }, { slotId: 'orchestrator:lead', personaId: 'reviewer' }]
    });
    expect(result).toMatchObject({ ready: false, checks: expect.arrayContaining([
      expect.objectContaining({ code: 'ROUTE_ELIGIBILITY', status: 'FAIL', subject: 'build' })
    ]) });
  });

  it('keeps routing eligibility advisory when Team enforcement is off', () => {
    const result = evaluateTeamAdmission({
      workUnits: [{ ...validPlan[0], routing: { version: 1, requiredRole: 'reviewer' } }], requireCompletePlan: true,
      slotCount: 1, maxSlots: 1, initialTasks: ['worker'], enforceRouting: false,
      slotRoutes: [{ slotId: 'slot-1', personaId: 'writer' }]
    });
    expect(result).toMatchObject({ ready: true, checks: expect.arrayContaining([
      expect.objectContaining({ code: 'ROUTE_ELIGIBILITY', status: 'FAIL', required: false, subject: 'build' })
    ]) });
  });

  it('collects canonical required inventory and preserves required entries beyond source bounds', async () => {
    const requiredModel = { id: 'model-required', provider: 'provider-required' };
    const inventory = await collectTeamAdmissionInventory({
      requiredSkills: ['required', 'required'], requiredMcpServers: ['repo'],
      requiredModels: [requiredModel, requiredModel], requiredProviders: ['provider-required']
    }, {
      now: () => 100, maxAgeMs: Infinity,
      listSkills: async () => [...Array.from({ length: 100 }, (_, index) => ({ name: `noise-${index}`, enabled: true })), { name: 'required', enabled: false }, { name: 'required', enabled: true }],
      listMcpServers: async () => [{ name: 'repo', enabled: true }],
      modelHealth: async (models) => models.map((model) => ({ ...model, status: 'available' as const })),
      providerHealth: async (ids) => ids.map((id) => ({ id, status: 'available' as const }))
    });
    expect(inventory).toMatchObject({ observedAt: 100, maxAgeMs: 0 });
    expect(inventory.skills).toEqual([{ name: 'required', available: true }]);
    expect(inventory.models).toEqual([{ ...requiredModel, status: 'available' }]);
  });

  it('fails closed and reports each rejected inventory source', async () => {
    const onError = vi.fn();
    const failure = async () => { throw new Error('offline'); };
    const inventory = await collectTeamAdmissionInventory({
      requiredSkills: ['skill'], requiredMcpServers: ['mcp'],
      requiredModels: [{ id: 'model', provider: 'provider' }], requiredProviders: ['provider']
    }, {
      listSkills: failure, listMcpServers: failure, modelHealth: failure, providerHealth: failure, onError
    });
    expect(onError.mock.calls.map(([source]) => source)).toEqual(['skills', 'mcpServers', 'models', 'providers']);
    expect(evaluateTeamAdmission({
      slotCount: 1, maxSlots: 1, initialTasks: ['work'], now: inventory.observedAt,
      requiredSkills: ['skill'], inventory
    })).toMatchObject({ ready: false });
    expect(inventory.sourceStatuses).toEqual([
      { source: 'skills', status: 'failed' }, { source: 'mcpServers', status: 'failed' },
      { source: 'models', status: 'failed' }, { source: 'providers', status: 'failed' }
    ]);
  });

  it('marks failed Skills and MCP reads unavailable without naming capabilities missing', async () => {
    const failure = async () => { throw new Error('transient discovery failure'); };
    const inventory = await collectTeamAdmissionInventory({ requiredSkills: ['review'], requiredMcpServers: ['repo'] }, {
      listSkills: failure, listMcpServers: failure, modelHealth: async () => [], providerHealth: async () => [], now: () => 10
    });
    const result = evaluateTeamAdmission({
      workUnits: [{ ...validPlan[0], requires: { skills: ['review'], mcpServers: ['repo'] } }],
      requireCompletePlan: true, slotCount: 1, maxSlots: 1, initialTasks: ['work'], inventory, now: 10
    });
    expect(result).toMatchObject({ ready: false, availabilityUnknown: { failedSources: ['skills', 'mcpServers'] } });
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SKILL_AVAILABLE', subject: 'build', status: 'UNKNOWN' }),
      expect.objectContaining({ code: 'MCP_AVAILABLE', subject: 'build', status: 'UNKNOWN' })
    ]));
    expect(result.checks.filter((check) => check.subject === 'build').flatMap((check) => check.unavailable ?? [])).toEqual([]);
  });

  it('reports availability unknown only for failed sources a requirement depends on', () => {
    const base = { slotCount: 1, maxSlots: 1, initialTasks: ['work'], now: 10 };
    const inventory = (failed: ('skills' | 'mcpServers' | 'models' | 'providers')[]) => ({
      version: 1 as const, observedAt: 10, maxAgeMs: 100, skills: [], mcpServers: [], models: [], providers: [],
      sourceStatuses: failed.map((source) => ({ source, status: 'failed' as const }))
    });
    // No requirement depends on a failed source: not an availability problem.
    expect(evaluateTeamAdmission({ ...base, inventory: inventory(['skills', 'mcpServers']) }).availabilityUnknown).toBeUndefined();
    // Failed model/provider reads never map to skill/MCP availability.
    expect(evaluateTeamAdmission({ ...base, requiredSkills: ['review'], inventory: { ...inventory(['models', 'providers']), skills: [{ name: 'review', available: true }] } }).availabilityUnknown).toBeUndefined();
    // Only the depended-on source is reported.
    expect(evaluateTeamAdmission({ ...base, requiredSkills: ['review'], inventory: inventory(['skills', 'mcpServers']) }).availabilityUnknown)
      .toEqual({ failedSources: ['skills'] });
    expect(evaluateTeamAdmission({
      ...base, workUnits: [{ ...validPlan[0], requires: { mcpServers: ['repo'] } }], requireCompletePlan: true, inventory: inventory(['skills', 'mcpServers'])
    }).availabilityUnknown).toEqual({ failedSources: ['mcpServers'] });
  });

  it('keeps source failure fallback when diagnostics throw', async () => {
    await expect(collectTeamAdmissionInventory({ requiredSkills: ['skill'] }, {
      listSkills: async () => { throw new Error('offline'); },
      listMcpServers: async () => [], modelHealth: async () => [], providerHealth: async () => [],
      onError: () => { throw new Error('logger offline'); }
    })).resolves.toMatchObject({ skills: [], sourceStatuses: expect.arrayContaining([{ source: 'skills', status: 'failed' }]) });
  });

  it('keeps digest stable across requirement and inventory ordering', () => {
    const baseInput = {
      slotCount: 1, maxSlots: 1, initialTasks: ['work'], now: 10,
      requiredSkills: ['b', 'a'], requiredProviders: ['b', 'a'],
      inventory: { version: 1 as const, observedAt: 10, maxAgeMs: 100, skills: [{ name: 'b', available: true }, { name: 'a', available: true }], mcpServers: [], models: [], providers: [{ id: 'b', status: 'available' as const }, { id: 'a', status: 'available' as const }] }
    };
    const reordered = { ...baseInput, requiredSkills: ['a', 'b'], requiredProviders: ['a', 'b'], inventory: { ...baseInput.inventory, skills: [...baseInput.inventory.skills].reverse(), providers: [...baseInput.inventory.providers].reverse() } };
    expect(evaluateTeamAdmission(baseInput).digest).toBe(evaluateTeamAdmission(reordered).digest);
  });
});

describe('summarizePlanTierFit (advisory)', () => {
  const slot = (slotId: string, level?: 'low' | 'medium' | 'high' | 'extra-high', personaId = slotId) => ({ slotId, personaId, ...(level ? { level } : {}) });
  const unit = (id: string, routing?: Record<string, unknown>) => ({ id, ...(routing ? { routing: { version: 1 as const, ...routing } } : {}) });

  it('returns nothing for units without routing, an empty plan, or a matched tier', () => {
    expect(summarizePlanTierFit([unit('a')], [slot('w1', 'high')]).findings).toEqual([]);
    expect(summarizePlanTierFit([], [slot('w1', 'low')]).findings).toEqual([]);
    expect(summarizePlanTierFit([unit('a', { minimumLevel: 'medium' })], [slot('w1', 'medium'), slot('w2', 'high')]).findings).toEqual([]);
  });

  it('flags over-tiered when the cheapest qualified slot sits above the declared minimum', () => {
    const { findings } = summarizePlanTierFit([unit('a', { minimumLevel: 'low', requiredRole: 'w-high' })], [slot('w-low', 'low'), slot('w-high', 'high', 'w-high')]);
    expect(findings).toEqual([{ unitId: 'a', kind: 'over-tiered', detail: expect.stringContaining('needs low but its cheapest qualified slot is high') }]);
  });

  it('does not flag over-tiered without a declared minimum or with unknown slot level', () => {
    expect(summarizePlanTierFit([unit('a', { requiredRole: 'w' })], [slot('w', 'high')]).findings).toEqual([]);
    expect(summarizePlanTierFit([unit('a', { taskClass: 'x' })], [slot('w')]).findings).toEqual([]);
  });

  it('flags under-tiered when only the minimum level keeps every worker slot out', () => {
    const { findings } = summarizePlanTierFit([unit('a', { minimumLevel: 'extra-high' })], [slot('w1', 'low'), slot('w2', 'high'), slot('orchestrator:0', 'extra-high')]);
    expect(findings).toEqual([{ unitId: 'a', kind: 'under-tiered', detail: expect.stringContaining('highest worker slot is high') }]);
  });

  it('flags no-eligible-slot for other mismatches and for an empty roster', () => {
    expect(summarizePlanTierFit([unit('a', { requiredRole: 'ghost' })], [slot('w1', 'low')]).findings).toMatchObject([{ unitId: 'a', kind: 'no-eligible-slot' }]);
    expect(summarizePlanTierFit([unit('a', { minimumLevel: 'low' })], []).findings).toMatchObject([{ kind: 'no-eligible-slot' }]);
    expect(summarizePlanTierFit([unit('a', { minimumLevel: 'low' })], [slot('orchestrator:0', 'low')]).findings).toMatchObject([{ kind: 'no-eligible-slot' }]);
  });

  it('stays silent when route facts are unknown', () => {
    expect(summarizePlanTierFit([unit('a', { minimumLevel: 'high' })], [slot('w1')]).findings).toEqual([]);
  });

  it('reports under-tiered with an unknown ceiling when no slot declares a level', () => {
    const slots = [{ slotId: 'w1', personaId: 'p', level: 'low' as const }];
    expect(summarizePlanTierFit([unit('a', { minimumLevel: 'high' })], slots, 1).findings[0]?.kind).toBe('under-tiered');
  });

  it('evaluateTeamAdmission exposes tier findings as warnings only, with ROUTE_ELIGIBILITY non-required when enforceRouting is false', () => {
    const plan = [{ id: 'a', title: 'A', task: 'do', dependencies: [], files: ['a.ts'], verification: ['t'], routing: { version: 1 as const, minimumLevel: 'extra-high' as const } }];
    const base = { workUnits: plan, requireCompletePlan: true, slotCount: 1, maxSlots: 4, initialTasks: ['x'], slotRoutes: [slot('w1', 'low')], now: 1 };
    const advisory = evaluateTeamAdmission({ ...base, enforceRouting: false });
    expect(advisory.ready).toBe(true);
    expect(advisory.checks.find((check) => check.code === 'ROUTE_ELIGIBILITY')).toMatchObject({ status: 'FAIL', required: false });
    expect(advisory.tierFit?.findings).toMatchObject([{ unitId: 'a', kind: 'under-tiered' }]);
    const enforced = evaluateTeamAdmission({ ...base, enforceRouting: true });
    expect(enforced.checks.find((check) => check.code === 'ROUTE_ELIGIBILITY')?.required).toBe(true);
    // Findings never change the digest.
    expect(advisory.digest).toBe(evaluateTeamAdmission({ ...base, enforceRouting: false, slotRoutes: base.slotRoutes }).digest);
    const clean = evaluateTeamAdmission({ ...base, slotRoutes: [slot('w1', 'extra-high')] });
    expect(clean.tierFit).toBeUndefined();
    expect(evaluateTeamAdmission({ ...base, slotRoutes: undefined }).tierFit).toBeUndefined();
  });

  it('evaluateTeamAdmission surfaces over-tiered and no-eligible-slot findings as warnings, and stays silent on unknown tiers', () => {
    const mk = (routing: Record<string, unknown>) => [{ id: 'a', title: 'A', task: 'do', dependencies: [], files: ['a.ts'], verification: ['t'], routing: { version: 1 as const, ...routing } }];
    const base = { requireCompletePlan: true, slotCount: 1, maxSlots: 4, initialTasks: ['x'], enforceRouting: false, now: 1 };
    const over = evaluateTeamAdmission({ ...base, workUnits: mk({ minimumLevel: 'low', requiredRole: 'w-high' }), slotRoutes: [slot('w-low', 'low'), slot('w-high', 'high', 'w-high')] });
    expect(over.tierFit?.findings).toMatchObject([{ unitId: 'a', kind: 'over-tiered' }]);
    expect(over.ready).toBe(true);
    const none = evaluateTeamAdmission({ ...base, workUnits: mk({ requiredRole: 'ghost' }), slotRoutes: [slot('w1', 'low')] });
    expect(none.tierFit?.findings).toMatchObject([{ unitId: 'a', kind: 'no-eligible-slot' }]);
    expect(none.ready).toBe(true);
    const unknown = evaluateTeamAdmission({ ...base, workUnits: mk({ minimumLevel: 'high' }), slotRoutes: [slot('w1')] });
    expect(unknown.tierFit).toBeUndefined();
  });

  it('tier findings and a hard skill-reach FAIL coexist: ready=false only because of the skill gap', () => {
    const plan = [{ id: 'a', title: 'A', task: 'do', dependencies: [], files: ['a.ts'], verification: ['t'], requires: { skills: ['review'] }, routing: { version: 1 as const, minimumLevel: 'extra-high' as const } }];
    const r = evaluateTeamAdmission({
      workUnits: plan, requireCompletePlan: true, slotCount: 1, maxSlots: 4, initialTasks: ['x'], enforceRouting: false, now: 1,
      slotRoutes: [{ ...slot('w1', 'low'), skillAllowlist: ['zcc-inbox'] }]
    });
    expect(r.tierFit?.findings).toMatchObject([{ kind: 'under-tiered' }]);
    const reach = r.checks.find((check) => check.code === 'SKILL_AVAILABLE' && check.status === 'FAIL');
    expect(reach).toMatchObject({ required: true, subject: 'a', unavailable: ['review'] });
    expect(r.ready).toBe(false);
  });
});
