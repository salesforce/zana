import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, levelCheckSkipped, recordedLevelPolicy, unitSlotEligibility, type ExecutionRoutingPolicyV1 } from '../store.js';

async function withStore(run: (store: ReturnType<typeof createExecutionStore>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-gate-'));
  try { await run(createExecutionStore({ filePath: join(dir, 'e.json'), id: () => 'execution', now: () => 1_000 })); } finally { await rm(dir, { recursive: true, force: true }); }
}
const claimWith = (store: ReturnType<typeof createExecutionStore>, routingPolicy?: unknown) => store.claim({
  callerPrincipalId: 's', projectId: 'p', teamId: 't', jobTitle: 'j', requestDigest: 'd', launchRequestId: 'r', resolvedModels: [],
  request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] },
  ...(routingPolicy ? { routingPolicy: routingPolicy as ExecutionRoutingPolicyV1 } : {})
});

describe('routingPolicy gate record', () => {
  it('records and reloads the per-requirement flags and degraded slots', async () => withStore(async (store) => {
    const { record } = await claimWith(store, { version: 1, hardRequirements: true, requested: true, levelEnforced: true, degradedSlots: [{ slotId: 'w:1', why: 'level-unknown' }], junk: 1 });
    expect(record.routingPolicy).toEqual({ version: 1, hardRequirements: true, requested: true, levelEnforced: true, degradedSlots: [{ slotId: 'w:1', why: 'level-unknown' }] });
    expect((await store.get(record.id))!.routingPolicy).toEqual(record.routingPolicy);
    expect(levelCheckSkipped(record, 'w:1')).toBe(true);
    expect(levelCheckSkipped(record, 'w:2')).toBe(false);
    expect(recordedLevelPolicy(record)).toEqual({ requested: true, levelEnforced: true });
  }));
  it('drops malformed degraded entries and a legacy policy has no level flags', async () => withStore(async (store) => {
    const { record } = await claimWith(store, { version: 1, hardRequirements: true, degradedSlots: [{ slotId: '', why: 'level-unknown' }, { slotId: 'w:1', why: 'other' }] });
    expect(record.routingPolicy!.degradedSlots).toEqual([{ slotId: 'w:1', why: 'level-unknown' }]);
    expect(recordedLevelPolicy(record)).toBeUndefined();
    expect(recordedLevelPolicy({})).toBeUndefined();
    expect(levelCheckSkipped({}, 'w:1')).toBe(false);
  }));
});

describe('degraded slot skips only the level check', () => {
  const unit = { routing: { version: 1 as const, requiredRole: 'engineer', minimumLevel: 'high' as const } };
  const slot = { slotId: 'w:1', personaId: 'engineer' };
  const model = { slotId: 'w:1', personaId: 'engineer', provider: 'anthropic', model: 'm' } as never;
  it('unknown level without skip is UNKNOWN; with skip it passes', () => {
    expect(unitSlotEligibility(unit, slot, model).status).toBe('UNKNOWN');
    expect(unitSlotEligibility(unit, slot, model, undefined, true).status).toBe('PASS');
  });
  it('role and exclusion still fail for a degraded slot', () => {
    expect(unitSlotEligibility({ routing: { version: 1, requiredRole: 'reviewer', minimumLevel: 'high' } }, slot, model, undefined, true).hardFailures).toEqual(['required role missing: reviewer']);
    expect(unitSlotEligibility(unit, slot, model, new Set(['w:1']), true).hardFailures).toContain('not same worker as a referenced step');
  });
});
