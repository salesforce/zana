import type { Team } from '@zana-ai/zcc-domain/product';
import type { ExecutionRoutingPolicyV1, ResolvedModelSnapshotV1 } from '@zana-ai/zcc-server/services/execution/store';

export interface DegradedRoutingSlot {
  slotId: string;
  why: 'level-unknown';
}

export interface RoutingEnforcement {
  /** Team override, else the global default, asked for level and capacity enforcement. */
  requested: boolean;
  /** Level and capacity checks are enforced. Governed by `routingEnforced` only. */
  levelEnforced: boolean;
  /** Role, tag, skill, MCP and anti-affinity requirements never fall back. Independent of `routingEnforced`. */
  hardRequirements: boolean;
  /** Slots whose level is unknown: only their own level check is skipped. */
  degradedSlots: DegradedRoutingSlot[];
}

/**
 * The one enforcement gate (admission and the launch-time policy record both call it). A Team override
 * wins over the global default. An unknown slot level disables the level check for that slot only; with
 * no known level at all, level enforcement degrades to advisory. Hard requirements stay on whenever the
 * run has worker slots.
 */
export function resolveRoutingEnforcement(
  team: Pick<Team, 'routingEnforced'> | undefined,
  globalEnabled: boolean,
  resolvedModels: readonly Pick<ResolvedModelSnapshotV1, 'slotId' | 'level'>[],
  workerSlotIds: readonly string[]
): RoutingEnforcement {
  const requested = team?.routingEnforced ?? globalEnabled;
  const hardRequirements = workerSlotIds.length > 0;
  if (!requested) return { requested, levelEnforced: false, hardRequirements, degradedSlots: [] };
  const modelsBySlotId = new Map(resolvedModels.map((model) => [model.slotId, model]));
  const degradedSlots: DegradedRoutingSlot[] = workerSlotIds
    .filter((slotId) => {
      const level = modelsBySlotId.get(slotId)?.level;
      return !(typeof level === 'string' && level.trim().length > 0);
    })
    .map((slotId) => ({ slotId, why: 'level-unknown' as const }));
  const levelEnforced = workerSlotIds.length > 0 && degradedSlots.length < workerSlotIds.length;
  return { requested, levelEnforced, hardRequirements, degradedSlots: levelEnforced ? degradedSlots : [] };
}

/** The gate result as recorded on the run at launch. */
export function routingPolicyOf(enforcement: RoutingEnforcement): ExecutionRoutingPolicyV1 {
  return {
    version: 1,
    hardRequirements: enforcement.hardRequirements,
    requested: enforcement.requested,
    levelEnforced: enforcement.levelEnforced,
    ...(enforcement.degradedSlots.length ? { degradedSlots: enforcement.degradedSlots.map((slot) => ({ ...slot })) } : {})
  };
}
