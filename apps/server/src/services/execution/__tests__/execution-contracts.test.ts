import { describe, expect, it } from 'vitest';
import { assembleExecutionResult, evaluateRouteFit, hasOnlyKeys, usageRollup, validateStructuredResult, validOutputDeclaration } from '../contracts.js';
import type { ExecutionRecord, ExecutionUsageObservationV1 } from '../store.js';

function observation(over: Partial<ExecutionUsageObservationV1> = {}): ExecutionUsageObservationV1 {
  return {
    version: 1, observationId: 'o1', executionAttempt: 1, role: 'worker', slotId: 'slot-1', sessionId: 'session-1',
    workUnitId: 'unit-1', workAttempt: 1, claimGeneration: 1, adapterEpoch: 0, sampleKind: 'heartbeat', sequence: 1,
    provider: 'provider', model: 'model', routingIdentity: 'route', cumulative: { inputTokens: 10, outputTokens: 2 },
    delta: { inputTokens: 10, outputTokens: 2 }, completeness: 'complete', observedAt: 1, ...over
  };
}

describe('execution phase 5 contracts', () => {
  it('rolls up known counters by role without converting unknown values to zero', () => {
    const rollup = usageRollup([
      observation(),
      observation({ observationId: 'o2', role: 'orchestrator', slotId: 'orchestrator', sessionId: 'lead', workUnitId: undefined, delta: { outputTokens: 3 }, cumulative: { outputTokens: 3 }, sequence: 2 })
    ]);
    expect(rollup).toMatchObject({ inputTokens: 10, outputTokens: 5, completeness: 'complete', observationCount: 2 });
    expect(rollup).not.toHaveProperty('providerCostUsd');
    expect(rollup.byRole).toEqual([
      { role: 'orchestrator', outputTokens: 3 },
      { role: 'worker', inputTokens: 10, outputTokens: 2 }
    ]);
  });

  it('validates bounded declared output subset and returns path-specific repair reasons', () => {
    const declaration = { version: 1 as const, schema: {
      type: 'object' as const, additionalProperties: false as const, required: ['status'], properties: {
        status: { type: 'string' as const, enum: ['ok', 'failed'] }, count: { type: 'integer' as const }
      }
    } };
    expect(validOutputDeclaration(declaration)).toBe(true);
    expect(validateStructuredResult(declaration, { status: 'ok', count: 2 })).toEqual({ ok: true, value: { status: 'ok', count: 2 } });
    expect(validateStructuredResult(declaration, { status: 'other' })).toEqual({ ok: false, reason: '$.status must match enum' });
    expect(validateStructuredResult(declaration, { status: 'ok', secret: true })).toEqual({ ok: false, reason: '$.secret is not allowed' });
    expect(validOutputDeclaration({ version: 1, schema: { type: 'array', maxItems: 101, items: { type: 'string' } } })).toBe(false);
    expect(validateStructuredResult(declaration, {})).toEqual({ ok: false, reason: '$.status is required' });
    expect(validateStructuredResult({ version: 1, schema: { type: 'array', maxItems: 1, items: { type: 'boolean' } } }, [true, false])).toEqual({ ok: false, reason: '$ exceeds maxItems' });
    expect(validateStructuredResult({ version: 1, schema: { type: 'number' } }, Number.NaN)).toEqual({ ok: false, reason: '$ must be finite number' });
    expect(validateStructuredResult({ version: 1, schema: { type: 'integer' } }, 1.5)).toEqual({ ok: false, reason: '$ must be integer' });
    expect(validateStructuredResult({ version: 1, schema: { type: 'string', maxLength: 1 } }, 'long')).toEqual({ ok: false, reason: '$ exceeds maxLength' });
    expect(validateStructuredResult({ version: 1, schema: { type: 'object', properties: {} } }, null)).toEqual({ ok: false, reason: '$ must be object' });
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(validateStructuredResult(declaration, circular)).toEqual({ ok: false, reason: 'structuredResult must be JSON serializable' });
    expect(validOutputDeclaration({ version: 1, schema: { type: 'string', pattern: '.*' } })).toBe(false);
    expect(validOutputDeclaration({ version: 1, schema: { type: 'object', properties: {}, title: 'nope' } })).toBe(false);
  });

  it('combines compacted usage baseline with retained observations', () => {
    const rollup = usageRollup([observation({ delta: { inputTokens: 2, providerCostUsd: 0.5 } })], {
      version: 1, inputTokens: 100, providerCostUsd: 2, completeness: 'complete', observationCount: 10, gapCount: 0,
      byRole: [{ role: 'worker', inputTokens: 100, providerCostUsd: 2 }]
    });
    expect(rollup).toMatchObject({ inputTokens: 102, providerCostUsd: 2.5, observationCount: 11 });
  });

  it('assembles deterministic plan-order result and keeps route fit observe-only', () => {
    const record = {
      state: 'COMPLETED', finalSummary: 'done', resolvedModels: [{ slotId: 'slot-1', provider: 'provider', model: 'model' }],
      workUnits: [
        { id: 'b', title: 'B', task: 'b', dependencies: [], state: 'COMPLETED', assignedSlotId: 'slot-1', attempt: 1, result: 'result', structuredResult: { ok: true }, history: [], verification: ['test'] },
        { id: 'a', title: 'A', task: 'a', dependencies: [], state: 'SKIPPED', assignedSlotId: 'slot-1', attempt: 0, history: [] }
      ], usageObservations: [observation()], routingDecisions: [
        { workUnitId: 'b', attempt: 1, policyVersion: 1, observedStateVersion: 1, pricingCatalogId: 'p', pricingCatalogVersion: 1, recommendedSlotId: 'slot-1', candidates: [{ slotId: 'slot-1', status: 'PASS', reasons: [] }] },
        { workUnitId: 'a', attempt: 1, policyVersion: 1, observedStateVersion: 2, pricingCatalogId: 'p', pricingCatalogVersion: 1, recommendedSlotId: 'slot-1', candidates: [{ slotId: 'slot-1', status: 'PASS', reasons: [] }] }
      ]
    } as unknown as ExecutionRecord;
    const assembled = assembleExecutionResult(record, [{ name: 'report', mediaType: 'text/plain', contentDigest: 'sha256:x' } as never], 'summary');
    expect(assembled).toMatchObject({ outcome: 'partial', units: [{ id: 'b' }, { id: 'a' }], usage: { inputTokens: 10 }, digest: expect.stringMatching(/^sha256:/) });
    record.assembledResult = assembled;
    const proposal = evaluateRouteFit(record, 10);
    expect(proposal).toMatchObject({ active: false, outcome: 'partial', fit: 'appropriate', evaluatorVersion: 'route-fit-v1' });
  });

  it('keeps route fit indeterminate with unknown usage or too few samples', () => {
    const record = { resolvedModels: [], workUnits: [], usageObservations: [], routingDecisions: [] } as unknown as ExecutionRecord;
    expect(evaluateRouteFit(record, 1)).toMatchObject({ active: false, outcome: 'failure', fit: 'indeterminate', reason: 'No work units were available to evaluate.', samples: 0 });
  });

  it('exports strict key allowlisting for durable contract validators', () => {
    expect(hasOnlyKeys({ version: 1, value: true }, ['version', 'value'])).toBe(true);
    expect(hasOnlyKeys({ version: 1, secret: true }, ['version'])).toBe(false);
  });

  it('classifies illegal routes underpowered and large legal tier gaps overpowered', () => {
    const base = {
      assembledResult: { outcome: 'success' },
      usageObservations: [observation()],
      workUnits: [{ id: 'u', title: 'U', task: 'u', dependencies: [], state: 'COMPLETED', attempt: 1, assignedSlotId: 's', routing: { version: 1, minimumLevel: 'low' }, history: [] }],
      resolvedModels: [{ slotId: 's', provider: 'p', model: 'm', level: 'high' }],
      routingDecisions: [
        { workUnitId: 'u', attempt: 1, policyVersion: 1, observedStateVersion: 1, pricingCatalogId: 'p', pricingCatalogVersion: 1, recommendedSlotId: 's', candidates: [{ slotId: 's', status: 'PASS', reasons: [] }] },
        { workUnitId: 'u', attempt: 2, policyVersion: 1, observedStateVersion: 2, pricingCatalogId: 'p', pricingCatalogVersion: 1, recommendedSlotId: 's', candidates: [{ slotId: 's', status: 'PASS', reasons: [] }] }
      ]
    } as unknown as ExecutionRecord;
    expect(evaluateRouteFit(base, 1)).toMatchObject({ fit: 'overpowered' });
    base.routingDecisions![0].candidates[0].status = 'FAIL';
    expect(evaluateRouteFit(base, 1)).toMatchObject({ fit: 'underpowered' });
  });
});
