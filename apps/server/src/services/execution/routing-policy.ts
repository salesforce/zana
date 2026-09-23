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
  hardSlotId?: string;
}

export interface SlotRouteSnapshotV1 {
  slotId: string;
  personaId: string;
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
  estimatedInputUsd?: number;
  pricingCatalogId: string;
  pricingCatalogVersion: number;
}

const LEVELS: readonly ModelLevel[] = ['low', 'medium', 'high', 'extra-high'];

/** Pure, fail-closed predicate shared by routing policy callers. */
export function evaluateSlotEligibility(routing: WorkUnitRoutingV1 | undefined, slot: SlotRouteSnapshotV1, now = Date.now()): SlotEligibilityV1 {
  const reasons: string[] = [];
  const unknown: string[] = [];
  const require = (fact: boolean | undefined, reason: string) => {
    if (fact === false) reasons.push(reason);
    if (fact === undefined) unknown.push(reason);
  };
  if (routing?.hardSlotId) require(slot.slotId === routing.hardSlotId, 'hard slot mismatch');
  if (routing?.requiredRole) require(slot.personaId === routing.requiredRole, 'required role mismatch');
  const containsAll = (available: string[] | undefined, required: string[] | undefined, label: string) => {
    if (!required?.length) return;
    if (!available) return unknown.push(`${label} unknown`);
    for (const value of required) require(available.includes(value), `${label} missing: ${value}`);
  };
  containsAll(slot.capabilities, routing?.requiredCapabilities, 'capability');
  containsAll(slot.modalities, routing?.requiredModalities, 'modality');
  if (routing?.minimumLevel) {
    require(slot.level === undefined ? undefined : LEVELS.indexOf(slot.level) >= LEVELS.indexOf(routing.minimumLevel), 'minimum model level unmet');
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
    if (fresh && slot.health === 'unavailable') reasons.push('slot health unavailable');
  }
  const estimatedInputUsd = slot.provider && slot.model && routing?.estimatedContextBytes !== undefined
    ? estimateModelInputUsd(slot.provider, slot.model, routing.estimatedContextBytes) : undefined;
  return {
    status: reasons.length ? 'FAIL' : unknown.length ? 'UNKNOWN' : 'PASS',
    reasons: [...reasons, ...unknown].slice(0, 16),
    ...(estimatedInputUsd === undefined ? {} : { estimatedInputUsd }),
    pricingCatalogId: MODEL_PRICING_CATALOG_ID,
    pricingCatalogVersion: MODEL_PRICING_CATALOG_VERSION
  };
}
