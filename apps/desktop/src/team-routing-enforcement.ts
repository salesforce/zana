import type { Team } from '@zana-ai/zcc-domain/product';
import type { ResolvedModelSnapshotV1 } from '@zana-ai/zcc-server/services/execution/store';

export interface TeamRoutingEnforcementDecision {
  requested: boolean;
  enforced: boolean;
  degraded: boolean;
}

/**
 * A Team override wins over the global default. Enforcement needs a known level
 * for every worker slot; missing route facts degrade safely to advisory routing.
 */
export function decideTeamRoutingEnforcement(
  team: Pick<Team, 'routingEnforced'> | undefined,
  globalEnabled: boolean,
  resolvedModels: readonly Pick<ResolvedModelSnapshotV1, 'slotId' | 'level'>[],
  workerSlotIds: readonly string[]
): TeamRoutingEnforcementDecision {
  const requested = team?.routingEnforced ?? globalEnabled;
  if (!requested) return { requested, enforced: false, degraded: false };
  const modelsBySlotId = new Map(resolvedModels.map((model) => [model.slotId, model]));
  const enforced = workerSlotIds.length > 0 && workerSlotIds.every((slotId) => {
    const level = modelsBySlotId.get(slotId)?.level;
    return typeof level === 'string' && level.trim().length > 0;
  });
  return { requested, enforced, degraded: !enforced };
}
