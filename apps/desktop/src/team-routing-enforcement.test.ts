import { describe, expect, it } from 'vitest';
import { decideTeamRoutingEnforcement } from './team-routing-enforcement.js';

const worker = { slotId: '0:worker:0', level: 'medium' as const };
const workerSlots = ['0:worker:0'];

describe('decideTeamRoutingEnforcement', () => {
  it('uses a Team value before global configuration', () => {
    expect(decideTeamRoutingEnforcement({ routingEnforced: false }, true, [worker], workerSlots))
      .toEqual({ requested: false, enforced: false, degraded: false });
    expect(decideTeamRoutingEnforcement({ routingEnforced: true }, false, [worker], workerSlots))
      .toEqual({ requested: true, enforced: true, degraded: false });
  });

  it('degrades requested enforcement when any worker level is unknown', () => {
    expect(decideTeamRoutingEnforcement(undefined, true, [worker, { slotId: '1:worker:0', level: undefined }], [...workerSlots, '1:worker:0']))
      .toEqual({ requested: true, enforced: false, degraded: true });
    expect(decideTeamRoutingEnforcement(undefined, true, [worker], [...workerSlots, '1:worker:0']))
      .toEqual({ requested: true, enforced: false, degraded: true });
  });

  it('degrades rather than enforces when worker roster has not arrived', () => {
    expect(decideTeamRoutingEnforcement({ routingEnforced: true }, false, [], []))
      .toEqual({ requested: true, enforced: false, degraded: true });
  });
});
