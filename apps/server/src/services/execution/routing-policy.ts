import type { ModelLevel } from '@zana-ai/zcc-domain/harness-adapter';
import { estimateModelInputUsd, MODEL_PRICING_CATALOG_ID, MODEL_PRICING_CATALOG_VERSION } from './model-pricing-catalog.js';

export type SlotEligibilityStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface WorkUnitRoutingV1 {
  version: 1;
  taskClass?: string;
  minimumLevel?: ModelLevel;
  requiredCapabilities?: string[];
  requiredModalities?: string[];
  estimatedContextBytes?: number;
  requiredRole?: string;
  preferredRole?: string;
  /** Soft `Prefer role` items: eligible slots are ranked by how many they match. */
  preferRoles?: string[];
  /** Hard `Not same worker as` step ids (dependency ancestors): their claim-history slots are excluded. */
  excludeSameWorkerAs?: string[];
  hardSlotId?: string;
}

export interface SlotRouteSnapshotV1 {
  slotId: string;
  personaId: string;
  label?: string;
  roles?: string[];
  provider?: string;
  model?: string;
  level?: ModelLevel;
  roleOwnedModel?: boolean;
  capabilities?: string[];
  modalities?: string[];
  maxContextBytes?: number;
  health?: 'available' | 'unavailable' | 'unknown';
  observedAt?: number;
  maxAgeMs?: number;
}

export interface SlotEligibilityV1 {
  status: SlotEligibilityStatus;
  reasons: string[];
  /** Failed requirements no assignment path may ever work around (role, pinned slot). Structured, never parsed from `reasons`. */
  hardFailures: string[];
  /** Failed level/capacity-style checks; only these may fall back in advisory mode. */
  softFailures: string[];
  estimatedInputUsd?: number;
  pricingCatalogId: string;
  pricingCatalogVersion: number;
}

/** Reason text `evaluateSlotEligibility` emits when a slot is below the unit's minimum level. */
export const LEVEL_UNMET_REASON = 'minimum model level unmet';

const LEVELS: readonly ModelLevel[] = ['low', 'medium', 'high', 'extra-high'];

/** Splits a comma-separated role list into trimmed, lowercased, non-empty items. */
export function splitRoleList(value: string | undefined): string[] {
  return (value ?? '').split(',').map((role) => role.trim().toLowerCase()).filter(Boolean);
}

/** Everything a slot answers to for role matching: personaId, label and effective role tags, lowercased. */
export function slotOfferedRoles(slot: Pick<SlotRouteSnapshotV1, 'personaId' | 'label' | 'roles'>): Set<string> {
  return new Set([slot.personaId, slot.label, ...(slot.roles ?? [])]
    .filter((role): role is string => typeof role === 'string')
    .map((role) => role.trim().toLowerCase()));
}

/** `Prefer role` items: the explicit list plus a registered `preferredRole` read as one more item. */
export function preferRoleItems(routing: Pick<WorkUnitRoutingV1, 'preferRoles' | 'preferredRole'> | undefined): string[] {
  return [...new Set([...(routing?.preferRoles ?? []), ...(routing?.preferredRole ? [routing.preferredRole] : [])]
    .flatMap((item) => splitRoleList(item)))];
}

/** How many `Prefer role` items the slot matches (0 when none are declared). */
export function preferMatchCount(routing: Pick<WorkUnitRoutingV1, 'preferRoles' | 'preferredRole'> | undefined, slot: Pick<SlotRouteSnapshotV1, 'personaId' | 'label' | 'roles'>): number {
  const items = preferRoleItems(routing);
  if (!items.length) return 0;
  const offered = slotOfferedRoles(slot);
  return items.filter((item) => offered.has(item)).length;
}

/** Pure, fail-closed predicate shared by routing policy callers. */
export function evaluateSlotEligibility(routing: WorkUnitRoutingV1 | undefined, slot: SlotRouteSnapshotV1, now = Date.now()): SlotEligibilityV1 {
  const reasons: string[] = [];
  const unknown: string[] = [];
  const hardFailures: string[] = [];
  const softFailures: string[] = [];
  let hard = false;
  const require = (fact: boolean | undefined, reason: string) => {
    if (fact === false) { reasons.push(reason); (hard ? hardFailures : softFailures).push(reason); }
    if (fact === undefined) unknown.push(reason);
  };
  hard = true;
  if (routing?.hardSlotId) require(slot.slotId === routing.hardSlotId, 'hard slot mismatch');
  if (routing?.requiredRole) {
    const offered = slotOfferedRoles(slot);
    for (const role of splitRoleList(routing.requiredRole)) require(offered.has(role), `required role missing: ${role}`);
  }
  hard = false;
  const containsAll = (available: string[] | undefined, required: string[] | undefined, label: string) => {
    if (!required?.length) return;
    if (!available) return unknown.push(`${label} unknown`);
    for (const value of required) require(available.includes(value), `${label} missing: ${value}`);
  };
  containsAll(slot.capabilities, routing?.requiredCapabilities, 'capability');
  containsAll(slot.modalities, routing?.requiredModalities, 'modality');
  if (routing?.minimumLevel) {
    require(slot.level === undefined ? undefined : LEVELS.indexOf(slot.level) >= LEVELS.indexOf(routing.minimumLevel), LEVEL_UNMET_REASON);
  }
  if (routing?.estimatedContextBytes !== undefined) {
    require(slot.maxContextBytes === undefined ? undefined : slot.maxContextBytes >= routing.estimatedContextBytes, 'context ceiling unmet');
  }
  if (slot.health !== undefined) {
    const fresh = slot.observedAt !== undefined && slot.maxAgeMs !== undefined && now >= slot.observedAt && now - slot.observedAt <= slot.maxAgeMs;
    // Health is ADVISORY: only fresh, positive evidence of unavailability blocks
    // dispatch. A stale reading (observedAt past maxAgeMs) or an 'unknown'/
    // unresolved health is absence of information, NOT evidence of a down worker
    // — it must never gate an already-spawned worker. Gating on it wedged runs
    // permanently: the snapshot's 30s TTL would lapse between the edge-driven
    // route-fact refreshes, flip every slot to UNKNOWN, block dispatch, and (with
    // no work in flight) leave no completion edge to re-attempt. Positive,
    // in-window 'unavailable' still fails closed.
    if (fresh && slot.health === 'unavailable') { reasons.push('slot health unavailable'); softFailures.push('slot health unavailable'); }
  }
  const estimatedInputUsd = slot.provider && slot.model && routing?.estimatedContextBytes !== undefined
    ? estimateModelInputUsd(slot.provider, slot.model, routing.estimatedContextBytes) : undefined;
  return {
    status: reasons.length ? 'FAIL' : unknown.length ? 'UNKNOWN' : 'PASS',
    reasons: [...reasons, ...unknown].slice(0, 16),
    hardFailures: hardFailures.slice(0, 16),
    softFailures: softFailures.slice(0, 16),
    ...(estimatedInputUsd === undefined ? {} : { estimatedInputUsd }),
    pricingCatalogId: MODEL_PRICING_CATALOG_ID,
    pricingCatalogVersion: MODEL_PRICING_CATALOG_VERSION
  };
}

/** Fixed nominal input size used to rank slots by catalog unit price when a unit has no byte estimate. */
export const NOMINAL_CONTEXT_BYTES = 64 * 1024;

export interface CheapestFitCandidate {
  slotId: string;
  /** Catalog input price at the ranking size; undefined when the catalog has no entry (sorts after every priced slot). */
  priceUsd?: number;
  /** A `startOnDemand` seat that has not been started yet (D11). */
  deferred?: boolean;
  /** `Prefer role` items matched; more is better and outranks price. Absent counts as 0. */
  preferMatches?: number;
}

/** Catalog price for a slot's resolved model at the ranking size; undefined when unpriced. */
export function slotRankingPriceUsd(slot: Pick<SlotRouteSnapshotV1, 'provider' | 'model'>, estimatedContextBytes?: number): number | undefined {
  return slot.provider && slot.model ? estimateModelInputUsd(slot.provider, slot.model, estimatedContextBytes ?? NOMINAL_CONTEXT_BYTES) : undefined;
}

/**
 * One comparator for runtime slot choice (enforced dispatch, advisory dispatch and kickoff reassignment):
 * most `Prefer role` matches, then price
 * (unpriced after priced, never subtracted), then live before deferred (D11), then
 * the just-finished slot last. Equal returns 0, so a stable sort keeps the caller's
 * existing order as the final deterministic tie-break.
 */
export function compareCheapestFit(a: CheapestFitCandidate, b: CheapestFitCandidate, deprioritizeSlotId?: string): number {
  const preference = (b.preferMatches ?? 0) - (a.preferMatches ?? 0);
  if (preference !== 0) return preference;
  if (a.priceUsd !== b.priceUsd) {
    if (a.priceUsd === undefined) return 1;
    if (b.priceUsd === undefined) return -1;
    if (a.priceUsd < b.priceUsd) return -1;
    if (a.priceUsd > b.priceUsd) return 1;
  }
  return (Number(a.deferred === true) - Number(b.deferred === true))
    || (Number(a.slotId === deprioritizeSlotId) - Number(b.slotId === deprioritizeSlotId));
}

/**
 * Routing for the child unit of a scope re-split: it inherits the parent's tier and role constraints but never
 * its pinned slot (the parent's worker is busy with the original scope). A contract change is routed at least
 * at the `medium` (Standard) tier.
 */
export function splitChildRouting(parent: WorkUnitRoutingV1 | undefined, contract: boolean): WorkUnitRoutingV1 | undefined {
  if (!parent && !contract) return undefined;
  const { hardSlotId: _pinned, excludeSameWorkerAs: _excluded, ...inherited } = parent ?? { version: 1 as const };
  const rank = (level: ModelLevel | undefined) => (level === undefined ? -1 : LEVELS.indexOf(level));
  const minimumLevel = contract && rank(inherited.minimumLevel) < rank('medium') ? 'medium' : inherited.minimumLevel;
  return { ...inherited, version: 1, ...(minimumLevel ? { minimumLevel } : {}) };
}
