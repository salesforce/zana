import { describe, expect, it } from 'vitest';
import { resolveRoutingEnforcement, routingPolicyOf } from './team-routing-enforcement.js';

const worker = { slotId: '0:worker:0', level: 'medium' as const };
const workerSlots = ['0:worker:0'];

describe('resolveRoutingEnforcement', () => {
  it('uses a Team value before global configuration', () => {
    expect(resolveRoutingEnforcement({ routingEnforced: false }, true, [worker], workerSlots))
      .toEqual({ requested: false, levelEnforced: false, hardRequirements: true, degradedSlots: [] });
    expect(resolveRoutingEnforcement({ routingEnforced: true }, false, [worker], workerSlots))
      .toEqual({ requested: true, levelEnforced: true, hardRequirements: true, degradedSlots: [] });
    expect(resolveRoutingEnforcement(undefined, true, [worker], workerSlots).requested).toBe(true);
  });

  it('an unknown level degrades only that slot and keeps hard requirements', () => {
    const unknown = { slotId: '1:worker:0', level: undefined };
    expect(resolveRoutingEnforcement(undefined, true, [worker, unknown], [...workerSlots, '1:worker:0']))
      .toEqual({ requested: true, levelEnforced: true, hardRequirements: true, degradedSlots: [{ slotId: '1:worker:0', why: 'level-unknown' }] });
    // A slot with no snapshot or a blank level is also degraded.
    const result = resolveRoutingEnforcement(undefined, true, [worker, { slotId: '2:worker:0', level: '  ' as never }], [...workerSlots, '1:worker:0', '2:worker:0']);
    expect(result.degradedSlots.map((slot) => slot.slotId)).toEqual(['1:worker:0', '2:worker:0']);
  });

  it('no known level at all falls back to advisory level checks but keeps hard requirements', () => {
    expect(resolveRoutingEnforcement({ routingEnforced: true }, false, [{ slotId: '0:worker:0', level: undefined }], workerSlots))
      .toEqual({ requested: true, levelEnforced: false, hardRequirements: true, degradedSlots: [] });
  });

  it('has no hard requirements and no enforcement before the worker roster arrives', () => {
    expect(resolveRoutingEnforcement({ routingEnforced: true }, false, [], []))
      .toEqual({ requested: true, levelEnforced: false, hardRequirements: false, degradedSlots: [] });
  });

  it('records the gate result as the run routing policy', () => {
    expect(routingPolicyOf(resolveRoutingEnforcement(undefined, true, [worker, { slotId: '1:worker:0', level: undefined }], [...workerSlots, '1:worker:0'])))
      .toEqual({ version: 1, hardRequirements: true, requested: true, levelEnforced: true, degradedSlots: [{ slotId: '1:worker:0', why: 'level-unknown' }] });
    expect(routingPolicyOf(resolveRoutingEnforcement({ routingEnforced: false }, true, [worker], workerSlots)))
      .toEqual({ version: 1, hardRequirements: true, requested: false, levelEnforced: false });
  });
});
