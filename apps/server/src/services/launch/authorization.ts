import { randomUUID } from 'node:crypto';
import type { LaunchAuthorization, LaunchAuthorizationBinding, LaunchAuthorizationState, LaunchPrincipal, LaunchPrincipalRef } from './types.js';

export function canTransitionAuthorization(from: LaunchAuthorizationState, to: LaunchAuthorizationState): boolean {
  return from === 'authorized' && (to === 'consumed' || to === 'expired' || to === 'revoked');
}

export interface LaunchAuthorizationDeps {
  resolvePrincipal: (id: string) => LaunchPrincipal | undefined;
  now?: () => number;
  id?: () => string;
  maxAuthorizations?: number;
}

export interface LaunchAuthorizationRequest {
  principal: LaunchPrincipalRef;
  projectId: string;
  launchDigest: string;
  binding: LaunchAuthorizationBinding;
  expiresAt?: number;
  /** The launch path re-issues a pre-issued approval just before spawning; a respawn approval stays a respawn (#579). */
  respawnOf?: string;
}

export type LaunchAuthorizationResult =
  | { decision: 'authorized'; authorization: LaunchAuthorization }
  | { decision: 'denied'; reason: string; usage?: LaunchCapacityUsage; limit?: LaunchCapacityLimit };

/** Most respawns one seat may get in a run (#579). Same size as the execution store's work-unit cap, kept here so launch does not import execution. */
export const MAX_RESPAWNS_PER_SLOT = 100;

/** How long a respawn approval can wait to be spent: it is minted just before the new session starts. */
export const RESPAWN_APPROVAL_TTL_MS = 2 * 60_000;

export type LaunchRespawnResult =
  | { ok: true; authorization: LaunchAuthorization }
  | { ok: false; reason: string };

/** What a respawn needs to remember about a consumed team-slot approval. */
interface ConsumedSlot {
  principal: LaunchPrincipalRef;
  projectId: string;
  launchDigest: string;
  binding: LaunchAuthorizationBinding;
}

/** The binding as the human approved it, with sorted keys: expiry and launch deadline belong to one session, not to the seat. */
function seatBindingKey(binding: LaunchAuthorizationBinding): string {
  const { expiresAt: _expiresAt, deadlineAt: _deadlineAt, ...seat } = binding;
  return JSON.stringify(Object.fromEntries(Object.entries(seat).sort(([a], [b]) => (a < b ? -1 : 1))));
}

export interface LaunchCapacityUsage { active: number; launched: number }
export interface LaunchCapacityLimit { concurrent: number; launchesPerRun: number }

export class LaunchAuthorizationService {
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly maxAuthorizations: number;
  private readonly authorizations = new Map<string, LaunchAuthorization>();
  private readonly runState = new Map<string, { launched: number; active: Set<string> }>();
  /** Consumed team-slot approvals a respawn may be minted from (#579); `complete()` deletes the approval itself. */
  private readonly consumedSlots = new Map<string, ConsumedSlot>();
  /** Respawns spent per principal and slot, capped at MAX_RESPAWNS_PER_SLOT. */
  private readonly respawns = new Map<string, Map<string, number>>();
  /** Respawn approvals (minted, not yet gone) and the consumed approval each was minted from. */
  private readonly respawnIds = new Map<string, string>();
  /** Priors whose respawn approval was just revoked to be re-issued by the launch path. */
  private readonly rotatingRespawns = new Set<string>();

  constructor(private readonly deps: LaunchAuthorizationDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.id = deps.id ?? randomUUID;
    this.maxAuthorizations = deps.maxAuthorizations ?? 4_096;
  }

  authorize(input: LaunchAuthorizationRequest): LaunchAuthorizationResult {
    this.pruneExpired();
    const principal = this.deps.resolvePrincipal(input.principal.id);
    if (!principal) return { decision: 'denied', reason: 'unknown principal' };
    if (principal.kind !== input.principal.kind) return { decision: 'denied', reason: 'principal kind mismatch' };
    if (!principal.allowedProjectIds.includes(input.projectId)) {
      return { decision: 'denied', reason: `project "${input.projectId}" is not allowed` };
    }
    if (input.binding.consumerKind === 'team-slot') {
      if (principal.kind !== 'team' || !input.binding.teamId || !principal.allowedTeamIds.includes(input.binding.teamId)) {
        return { decision: 'denied', reason: `team "${input.binding.teamId ?? ''}" is not allowed` };
      }
      if (!input.binding.slotId || !input.binding.personaId) {
        return { decision: 'denied', reason: 'team launch is missing slot or persona binding' };
      }
    }
    this.expireAuthorizedReservations(principal.id);
    const state = this.runState.get(principal.id) ?? { launched: 0, active: new Set<string>() };
    const rotating = input.respawnOf !== undefined && this.rotatingRespawns.delete(input.respawnOf);
    if (input.respawnOf !== undefined && !rotating) return { decision: 'denied', reason: 'respawn authorization is not being re-issued' };
    if (!rotating && state.launched >= principal.maxLaunchesPerRun) return this.capacityDenial(principal, state, 'principal launch budget exhausted');
    if (state.active.size >= principal.maxConcurrent) return this.capacityDenial(principal, state, 'principal concurrent launch limit reached');
    const createdAt = this.now();
    if (input.expiresAt !== undefined && input.expiresAt <= createdAt) {
      return { decision: 'denied', reason: 'authorization already expired' };
    }
    if (this.authorizations.size >= this.maxAuthorizations) {
      return { decision: 'denied', reason: 'authorization store limit reached' };
    }
    const authorization: LaunchAuthorization = {
      id: this.id(), principal: { ...input.principal }, projectId: input.projectId,
      launchDigest: input.launchDigest, binding: structuredClone(input.binding), state: 'authorized', createdAt, expiresAt: input.expiresAt
    };
    this.authorizations.set(authorization.id, authorization);
    if (rotating) this.respawnIds.set(authorization.id, input.respawnOf!);
    state.active.add(authorization.id);
    this.runState.set(principal.id, state);
    return { decision: 'authorized', authorization: { ...authorization } };
  }

  complete(id: string): void {
    const authorization = this.authorizations.get(id);
    if (!authorization) {
      for (const [principalId, state] of this.runState) {
        if (!state.active.delete(id)) continue;
        const principal = this.deps.resolvePrincipal(principalId);
        if (state.active.size === 0 && principal?.kind !== 'team') this.runState.delete(principalId);
        return;
      }
      return;
    }
    const state = this.runState.get(authorization.principal.id);
    state?.active.delete(id);
    this.authorizations.delete(id);
    this.respawnIds.delete(id);
    if (state?.active.size === 0 && authorization.principal.kind !== 'team') this.runState.delete(authorization.principal.id);
  }

  get(id: string): LaunchAuthorization | undefined {
    const authorization = this.authorizations.get(id);
    return authorization ? { ...authorization } : undefined;
  }

  pruneExpired(): void {
    const now = this.now();
    for (const [id, authorization] of this.authorizations) {
      if (authorization.expiresAt === undefined || authorization.expiresAt > now) continue;
      if (authorization.state === 'authorized') authorization.state = 'expired';
      this.complete(id);
      this.authorizations.delete(id);
    }
  }

  hasActivePrincipal(principalId: string): boolean {
    return (this.runState.get(principalId)?.active.size ?? 0) > 0;
  }

  forgetPrincipal(principalId: string): boolean {
    const state = this.runState.get(principalId);
    if (state && state.active.size > 0) return false;
    this.runState.delete(principalId);
    for (const [id, authorization] of this.authorizations) {
      if (authorization.principal.id === principalId) {
        this.authorizations.delete(id);
        this.respawnIds.delete(id);
      }
    }
    for (const [id, consumed] of this.consumedSlots) {
      if (consumed.principal.id !== principalId) continue;
      this.consumedSlots.delete(id);
      this.rotatingRespawns.delete(id);
    }
    this.respawns.delete(principalId);
    return true;
  }

  consume(id: string, digest: string): { ok: true; authorization: LaunchAuthorization } | { ok: false; reason: string } {
    const authorization = this.authorizations.get(id);
    if (!authorization) return { ok: false, reason: 'unknown authorization' };
    if (authorization.state !== 'authorized') return { ok: false, reason: `authorization is ${authorization.state}` };
    const now = this.now();
    if (authorization.expiresAt !== undefined && authorization.expiresAt <= now) {
      authorization.state = 'expired';
      this.complete(id);
      return { ok: false, reason: 'authorization is expired' };
    }
    if (authorization.launchDigest !== digest) return { ok: false, reason: 'launch digest mismatch' };
    const state = this.runState.get(authorization.principal.id);
    const principal = this.deps.resolvePrincipal(authorization.principal.id);
    if (!state || !principal) return { ok: false, reason: 'unknown principal' };
    const respawn = this.respawnIds.has(id);
    if (!respawn && state.launched >= principal.maxLaunchesPerRun) return { ok: false, reason: 'principal launch budget exhausted' };
    authorization.state = 'consumed';
    authorization.consumedAt = now;
    if (respawn) this.spendRespawn(authorization, id);
    else state.launched += 1;
    this.rememberConsumedSlot(authorization);
    return { ok: true, authorization: { ...authorization } };
  }

  consumePreissued(
    id: string,
    expected: Pick<LaunchAuthorization, 'principal' | 'projectId' | 'binding'>
  ): { ok: true; authorization: LaunchAuthorization } | { ok: false; reason: string } {
    const validated = this.validatePreissued(id, expected);
    if (!validated.ok) return validated;
    return this.consume(id, validated.authorization.launchDigest);
  }

  validatePreissued(
    id: string,
    expected: Pick<LaunchAuthorization, 'principal' | 'projectId' | 'binding'>
  ): { ok: true; authorization: LaunchAuthorization } | { ok: false; reason: string } {
    const authorization = this.authorizations.get(id);
    if (!authorization) return { ok: false, reason: 'unknown authorization' };
    if (authorization.state !== 'authorized') return { ok: false, reason: `authorization is ${authorization.state}` };
    if (authorization.expiresAt !== undefined && authorization.expiresAt <= this.now()) {
      authorization.state = 'expired';
      this.complete(id);
      return { ok: false, reason: 'authorization is expired' };
    }
    if (authorization.principal.id !== expected.principal.id || authorization.principal.kind !== expected.principal.kind) {
      return { ok: false, reason: 'authorization principal mismatch' };
    }
    if (authorization.projectId !== expected.projectId) return { ok: false, reason: 'authorization project mismatch' };
    if (JSON.stringify(authorization.binding) !== JSON.stringify(expected.binding)) {
      return { ok: false, reason: 'authorization binding mismatch' };
    }
    return { ok: true, authorization: { ...authorization } };
  }

  /**
   * Mint the single-use approval for a fresh session of a seat whose first one ended (#579). It accepts only a
   * team-slot approval this service consumed for the same principal, project and seat binding, once that
   * session's approval is complete() (so maxConcurrent holds). The respawn counts toward MAX_RESPAWNS_PER_SLOT
   * and not toward the run's launches; its consume() skips `launched`. The prior approval can be used once.
   */
  authorizeRespawn(
    priorAuthorizationId: string,
    expected: Pick<LaunchAuthorization, 'principal' | 'projectId' | 'binding'>
  ): LaunchRespawnResult {
    this.pruneExpired();
    const prior = this.consumedSlots.get(priorAuthorizationId);
    if (!prior) return { ok: false, reason: 'no consumed team-slot authorization to respawn from' };
    // complete() removes an approval whose session ended; one still stored belongs to a session that may be live.
    if (this.authorizations.has(priorAuthorizationId)) return { ok: false, reason: 'the earlier session of this seat has not completed' };
    if (prior.principal.id !== expected.principal.id || prior.principal.kind !== expected.principal.kind) {
      return { ok: false, reason: 'respawn principal mismatch' };
    }
    if (prior.projectId !== expected.projectId) return { ok: false, reason: 'respawn project mismatch' };
    if (seatBindingKey(prior.binding) !== seatBindingKey(expected.binding)) return { ok: false, reason: 'respawn binding mismatch' };
    const principal = this.deps.resolvePrincipal(prior.principal.id);
    const state = this.runState.get(prior.principal.id);
    if (!principal || principal.kind !== 'team' || !state) return { ok: false, reason: 'unknown principal' };
    if (!principal.allowedProjectIds.includes(prior.projectId)) return { ok: false, reason: `project "${prior.projectId}" is not allowed` };
    if (state.active.size >= principal.maxConcurrent) return { ok: false, reason: 'principal concurrent launch limit reached' };
    const slotId = prior.binding.slotId ?? '';
    if (this.outstandingRespawn(priorAuthorizationId) !== undefined) return { ok: false, reason: 'a respawn authorization is already outstanding' };
    if ((this.respawns.get(principal.id)?.get(slotId) ?? 0) >= MAX_RESPAWNS_PER_SLOT) return { ok: false, reason: 'seat respawn limit reached' };
    const createdAt = this.now();
    if (this.authorizations.size >= this.maxAuthorizations) return { ok: false, reason: 'authorization store limit reached' };
    const { deadlineAt: _deadlineAt, ...seatBinding } = structuredClone(expected.binding);
    const authorization: LaunchAuthorization = {
      id: this.id(), principal: { ...prior.principal }, projectId: prior.projectId, launchDigest: prior.launchDigest,
      binding: seatBinding, state: 'authorized', createdAt, expiresAt: createdAt + RESPAWN_APPROVAL_TTL_MS
    };
    this.authorizations.set(authorization.id, authorization);
    this.respawnIds.set(authorization.id, priorAuthorizationId);
    state.active.add(authorization.id);
    return { ok: true, authorization: { ...authorization } };
  }

  /** The respawn approval minted from `priorAuthorizationId` that is still waiting to be spent, if any. */
  outstandingRespawn(priorAuthorizationId: string): string | undefined {
    for (const [id, prior] of this.respawnIds) {
      if (prior !== priorAuthorizationId) continue;
      const authorization = this.authorizations.get(id);
      if (authorization?.state === 'authorized' && (authorization.expiresAt === undefined || authorization.expiresAt > this.now())) return id;
    }
    return undefined;
  }

  /** The consumed approval a respawn approval was minted from, so the launch path can re-issue it as a respawn. */
  respawnPriorOf(id: string): string | undefined {
    return this.respawnIds.get(id);
  }

  /** Whether an approval was minted by {@link authorizeRespawn}, so the launch path keeps it as it is. */
  isRespawn(id: string): boolean {
    return this.respawnIds.has(id);
  }

  /** A respawn approval was spent: its prior is used up and the seat's respawn count goes up. */
  private spendRespawn(authorization: LaunchAuthorization, id: string): void {
    this.consumedSlots.delete(this.respawnIds.get(id)!);
    const bySlot = this.respawns.get(authorization.principal.id) ?? new Map<string, number>();
    const slotId = authorization.binding.slotId ?? '';
    bySlot.set(slotId, (bySlot.get(slotId) ?? 0) + 1);
    this.respawns.set(authorization.principal.id, bySlot);
  }

  revoke(id: string): boolean {
    const authorization = this.authorizations.get(id);
    if (!authorization || !canTransitionAuthorization(authorization.state, 'revoked')) return false;
    authorization.state = 'revoked';
    authorization.revokedAt = this.now();
    const prior = this.respawnIds.get(id);
    if (prior !== undefined) this.rotatingRespawns.add(prior);
    this.complete(id);
    return true;
  }

  restoreCapacity(principal: LaunchPrincipal, launched: number, activeAuthorizationIds: readonly string[]): void {
    if (!Number.isInteger(launched) || launched < 0 || launched > principal.maxLaunchesPerRun) {
      throw new Error('invalid restored launch count');
    }
    const existing = this.runState.get(principal.id);
    if (existing && (existing.launched !== launched
      || [...existing.active].some((id) => !activeAuthorizationIds.includes(id)))) {
      throw new Error('conflicting restored launch capacity');
    }
    this.runState.set(principal.id, { launched, active: new Set(activeAuthorizationIds) });
  }

  /** Keep what a respawn needs about a consumed team-slot approval; the oldest are dropped past the store limit. */
  private rememberConsumedSlot(authorization: LaunchAuthorization): void {
    if (authorization.binding.consumerKind !== 'team-slot') return;
    this.consumedSlots.set(authorization.id, {
      principal: { ...authorization.principal }, projectId: authorization.projectId,
      launchDigest: authorization.launchDigest, binding: structuredClone(authorization.binding)
    });
    for (const id of this.consumedSlots.keys()) {
      if (this.consumedSlots.size <= this.maxAuthorizations) break;
      this.consumedSlots.delete(id);
    }
  }

  private capacityDenial(
    principal: LaunchPrincipal,
    state: { launched: number; active: Set<string> },
    reason: string
  ): Extract<LaunchAuthorizationResult, { decision: 'denied' }> {
    return {
      decision: 'denied', reason,
      usage: { active: state.active.size, launched: state.launched },
      limit: { concurrent: principal.maxConcurrent, launchesPerRun: principal.maxLaunchesPerRun }
    };
  }

  private expireAuthorizedReservations(principalId: string): void {
    const state = this.runState.get(principalId);
    if (!state) return;
    const now = this.now();
    for (const id of [...state.active]) {
      const authorization = this.authorizations.get(id);
      if (authorization?.state === 'authorized'
        && authorization.expiresAt !== undefined
        && authorization.expiresAt <= now) {
        authorization.state = 'expired';
        state.active.delete(id);
      }
    }
    if (state.active.size === 0) {
      const principal = this.deps.resolvePrincipal(principalId);
      if (principal?.kind !== 'team') this.runState.delete(principalId);
    }
  }
}
