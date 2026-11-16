/**
 * One finding shape for a plan judged against a Squad's roster: used by `squad_plan_check`, launch preflight
 * and `squad_launch` (the composer card). Pure; callers supply the roster as slot routes.
 */
import { isOrchestratorSlotId } from '@zana-ai/zcc-domain/product';
import { sanitizeRosterText, type SquadPlanBinding, type SquadPlanFinding } from '@zana-ai/zcc-domain/squad-proposal';
import {
  compareCheapestFit, evaluateSlotEligibility, preferMatchCount, preferRoleItems, slotOfferedRoles, slotRankingPriceUsd, splitRoleList,
  type SlotRouteSnapshotV1, type WorkUnitRoutingV1
} from '../execution/routing-policy.js';
import type { PortablePlanFinding } from '../execution/portable-plan.js';
import { antiAffinityResults, type AdmissionCheck, type PlanUnitRouting, type TierFitFinding } from './preflight.js';

export interface PlanFindingUnit extends PlanUnitRouting {
  requires?: { skills?: readonly string[]; mcpServers?: readonly string[] };
}

export interface PlanFindingInput {
  units: readonly PlanFindingUnit[];
  slotRoutes: readonly SlotRouteSnapshotV1[];
  /** Findings the parser produced (format repairs, warnings, blocking defects). */
  parserFindings?: readonly { severity: SquadPlanFinding['severity']; requirement: SquadPlanFinding['requirement']; stepId?: string; message: string }[];
  /** Admission checks for the same plan; skill and MCP reach failures are read from them. */
  admissionChecks?: readonly AdmissionCheck[];
  tierFit?: readonly TierFitFinding[];
  /** Slots the shared gate could not judge by level. */
  degradedSlots?: readonly { slotId: string; why: 'level-unknown' }[];
  declaredSquad?: string;
  launchSquad?: { id: string; name?: string };
  now?: number;
}

const workers = (slots: readonly SlotRouteSnapshotV1[]) => slots.filter((slot) => !isOrchestratorSlotId(slot.slotId));

const slotRef = (slot: SlotRouteSnapshotV1, reason: string) => ({
  slotId: slot.slotId, ...(sanitizeRosterText(slot.label) ? { label: sanitizeRosterText(slot.label) } : {}), personaId: sanitizeRosterText(slot.personaId) || slot.personaId, reason
});

/** The roles a Squad answers to, for the "this Squad offers ..." half of a suggestion. */
export function offeredRoleNames(slots: readonly SlotRouteSnapshotV1[]): string[] {
  const names = new Set<string>();
  for (const slot of workers(slots)) {
    for (const value of [slot.label, ...(slot.roles ?? []), slot.personaId]) { const name = sanitizeRosterText(value); if (name) names.add(name); }
  }
  return [...names];
}

/**
 * The hard `Required role` check, isolated in one function (requirement 19). A step is blocking when no worker slot
 * answers to every required item. Offers a replacement only when an item, after trim and case-fold, matches
 * exactly one slot's persona id, label or tag; there is no fuzzy matching.
 */
export function requiredRoleFindings(units: readonly PlanUnitRouting[], slotRoutes: readonly SlotRouteSnapshotV1[]): SquadPlanFinding[] {
  const pool = workers(slotRoutes);
  if (!pool.length && !units.some((unit) => unit.routing?.requiredRole)) return [];
  const findings: SquadPlanFinding[] = [];
  for (const unit of units) {
    const required = splitRoleList(unit.routing?.requiredRole);
    if (!required.length) continue;
    if (pool.some((slot) => { const offered = slotOfferedRoles(slot); return required.every((role) => offered.has(role)); })) continue;
    const roles = offeredRoleNames(pool);
    const unmatched = required.filter((role) => !pool.some((slot) => slotOfferedRoles(slot).has(role)));
    const candidates = pool.map((slot) => {
      const missing = required.filter((role) => !slotOfferedRoles(slot).has(role));
      return slotRef(slot, `missing ${missing.join(', ')}`);
    });
    const exact = unmatched.length === 1 ? pool.filter((slot) => slotOfferedRoles(slot).has(unmatched[0])) : [];
    const suggestion = exact.length === 1
      ? `Use "${sanitizeRosterText(exact[0].label) || sanitizeRosterText(exact[0].personaId)}" as the required role.`
      : roles.length ? `Change the required role to one this Squad offers: ${roles.join(', ')}.` : 'This Squad has no members to run the step.';
    findings.push({ stepId: unit.id, requirement: 'required-role', severity: 'blocking', candidateSlots: candidates, suggestion });
  }
  return findings;
}

function preferRoleFindings(units: readonly PlanUnitRouting[], slotRoutes: readonly SlotRouteSnapshotV1[]): SquadPlanFinding[] {
  const pool = workers(slotRoutes);
  const out: SquadPlanFinding[] = [];
  for (const unit of units) {
    const items = preferRoleItems(unit.routing);
    if (!items.length || !pool.length) continue;
    if (pool.some((slot) => preferMatchCount(unit.routing, slot) > 0)) continue;
    out.push({
      stepId: unit.id, requirement: 'prefer-role', severity: 'warning',
      candidateSlots: pool.map((slot) => slotRef(slot, 'no preferred role matched')),
      suggestion: `The step names ${items.join(', ')}; this Squad offers ${offeredRoleNames(pool).join(', ') || 'no roles'}.`
    });
  }
  return out;
}

/** The slot each step would start on: the shared ranking over slots that pass every hard requirement. */
export function planBindings(units: readonly PlanUnitRouting[], slotRoutes: readonly SlotRouteSnapshotV1[], levelExempt: ReadonlySet<string> = new Set(), now = Date.now()): SquadPlanBinding[] {
  const pool = workers(slotRoutes);
  return units.map((unit) => {
    const ranked = pool
      .filter((slot) => {
        const routing: WorkUnitRoutingV1 | undefined = unit.routing?.minimumLevel && levelExempt.has(slot.slotId)
          ? { ...unit.routing, minimumLevel: undefined } : unit.routing;
        return evaluateSlotEligibility(routing, slot, now).status !== 'FAIL';
      })
      .map((slot) => ({ slot, slotId: slot.slotId, priceUsd: slotRankingPriceUsd(slot, unit.routing?.estimatedContextBytes), preferMatches: preferMatchCount(unit.routing, slot) }))
      .sort((a, b) => compareCheapestFit(a, b));
    const first = ranked[0]?.slot;
    return first
      ? { stepId: unit.id, slotId: first.slotId, ...(first.label ? { label: first.label } : {}), personaId: first.personaId }
      : { stepId: unit.id, unbound: true as const };
  });
}

/** Counts of hard findings per requirement type, for the launch log (requirement 19). */
export function hardFindingCounts(findings: readonly SquadPlanFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) if (finding.severity === 'blocking') counts[finding.requirement] = (counts[finding.requirement] ?? 0) + 1;
  return counts;
}

export function buildPlanFindings(input: PlanFindingInput): SquadPlanFinding[] {
  const now = input.now ?? Date.now();
  const exempt = new Set((input.degradedSlots ?? []).map((slot) => slot.slotId));
  const pool = workers(input.slotRoutes);
  const out: SquadPlanFinding[] = [];

  for (const finding of input.parserFindings ?? []) {
    out.push({ ...(finding.stepId ? { stepId: finding.stepId } : {}), requirement: finding.requirement, severity: finding.severity, candidateSlots: [], suggestion: '', detail: finding.message });
  }
  if (input.declaredSquad && input.launchSquad && input.declaredSquad !== input.launchSquad.id && input.declaredSquad !== input.launchSquad.name) {
    const launching = input.launchSquad.name ?? input.launchSquad.id;
    out.push({
      requirement: 'squad', severity: 'warning', candidateSlots: [], suggestion: '',
      detail: `This plan was written for ${input.declaredSquad}, but you are launching it on ${launching}.`
    });
  }
  if (pool.length) {
    out.push(...requiredRoleFindings(input.units, pool));
    out.push(...preferRoleFindings(input.units, pool));
    const unitsById = new Map(input.units.map((unit) => [unit.id, unit]));
    for (const miss of antiAffinityResults(input.units, pool, exempt, now)) {
      if (miss.ok) continue;
      const unit = unitsById.get(miss.unitId);
      out.push({
        stepId: miss.unitId, requirement: 'not-same-worker', severity: 'blocking',
        candidateSlots: pool.filter((slot) => evaluateSlotEligibility(unit?.routing, slot, now).hardFailures.length === 0).map((slot) => slotRef(slot, `the only fit for ${miss.refs.join(', ')}`)),
        suggestion: `Add another member that can run this step, or drop the "not the same worker as ${miss.refs.join(', ')}" line.`
      });
    }
  }
  for (const check of input.admissionChecks ?? []) {
    if (check.status !== 'FAIL' || !check.required || !check.subject) continue;
    if (check.code === 'SKILL_AVAILABLE' || check.code === 'MCP_AVAILABLE') {
      out.push({
        stepId: check.subject, requirement: check.code === 'SKILL_AVAILABLE' ? 'skill' : 'mcp', severity: 'blocking',
        candidateSlots: pool.map((slot) => slotRef(slot, 'does not allow every required item')),
        suggestion: check.unavailable?.length ? `Needed: ${check.unavailable.join(', ')}.` : ''
      });
    }
  }
  for (const tier of input.tierFit ?? []) {
    out.push({ stepId: tier.unitId, requirement: 'tier', severity: 'warning', candidateSlots: [], suggestion: '', detail: tier.detail });
  }
  if (input.degradedSlots?.length) {
    out.push({
      requirement: 'tier', severity: 'warning', candidateSlots: [], suggestion: '',
      detail: `The model level of ${input.degradedSlots.map((slot) => slot.slotId).join(', ')} is not known, so its level is not checked; every other requirement still is.`,
      degraded: input.degradedSlots.map((slot) => ({ slotId: slot.slotId, why: slot.why }))
    });
  }
  return out;
}
