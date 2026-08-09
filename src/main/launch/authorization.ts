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
}

export type LaunchAuthorizationResult =
  | { decision: 'authorized'; authorization: LaunchAuthorization }
  | { decision: 'denied'; reason: string; usage?: LaunchCapacityUsage; limit?: LaunchCapacityLimit };

export interface LaunchCapacityUsage { active: number; launched: number }
export interface LaunchCapacityLimit { concurrent: number; launchesPerRun: number }

export class LaunchAuthorizationService {
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly maxAuthorizations: number;
  private readonly authorizations = new Map<string, LaunchAuthorization>();
  private readonly runState = new Map<string, { launched: number; active: Set<string> }>();

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
    if (state.launched >= principal.maxLaunchesPerRun) return this.capacityDenial(principal, state, 'principal launch budget exhausted');
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
      if (authorization.principal.id === principalId) this.authorizations.delete(id);
    }
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
    if (state.launched >= principal.maxLaunchesPerRun) return { ok: false, reason: 'principal launch budget exhausted' };
    authorization.state = 'consumed';
    authorization.consumedAt = now;
    state.launched += 1;
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

  revoke(id: string): boolean {
    const authorization = this.authorizations.get(id);
    if (!authorization || !canTransitionAuthorization(authorization.state, 'revoked')) return false;
    authorization.state = 'revoked';
    authorization.revokedAt = this.now();
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
