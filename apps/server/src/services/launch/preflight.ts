import { randomUUID } from 'node:crypto';
import { launchDigest } from './digest.js';
import type { LaunchAuthorizationBinding, LaunchConsumerKind, LaunchPrincipalRef } from './types.js';
import type { HarnessExecutionTarget, HarnessProfilePosture, HarnessScope } from '@zana-ai/zcc-domain/harness-adapter';
import type { ExecutionEvidenceFixture } from '@zana-ai/zcc-host-daemon/harness/execution-evidence';
import { evaluateExecutionEvidence } from '@zana-ai/zcc-host-daemon/harness/execution-evidence';
import type {
  ExecutionConsentBinding,
  ExecutionConsentReserveResult,
  ExecutionConsentScope
} from '@zana-ai/zcc-host-daemon/harness/execution-consent-store';
import type { ExecutionConsentCeremonyInput } from '@zana-ai/zcc-host-daemon/harness/execution-consent';

export interface LaunchPreflightDeps<TResolved> {
  principal: () => LaunchPrincipalRef;
  resolve: () => TResolved;
  sessionId?: () => string;
  idempotencyKey?: () => string;
  binding?: () => {
    consumerKind: LaunchConsumerKind;
    personaId?: string;
    teamId?: string;
    slotId?: string;
    scope: 'local' | 'remote';
    autonomous: boolean;
  };
  now?: () => number;
  authorizationTtlMs?: number;
}

export interface LaunchPreflight<TRequest, TResolved> {
  request: TRequest;
  principal: LaunchPrincipalRef;
  resolved: TResolved;
  sessionId: string;
  idempotencyKey: string;
  digest: string;
  binding: LaunchAuthorizationBinding;
}

export type ExecutionTargetProvenance = 'explicit-native' | 'portable-mapped' | 'inherited-native-default';

export interface ExecutionAuthorizationInput {
  adapterId: string;
  provenance: ExecutionTargetProvenance;
  target?: HarnessExecutionTarget;
  evidence?: ExecutionEvidenceFixture;
  installedVersion?: string;
  scope: HarnessScope;
  profilePosture: HarnessProfilePosture;
  projectId: string;
  mode: 'interactive' | 'headless' | 'unattended';
  consentScopes: readonly ExecutionConsentScope[];
  idempotencyKey: string;
}

export type ExecutionPreflightDecision =
  | {
      decision: 'allowed';
      scope: HarnessScope;
      targetDigest?: string;
      evidenceDigest?: string;
      consentReservation?: { id: string; scope: ExecutionConsentScope };
    }
  | { decision: 'blocked'; reason: string };

interface ExecutionConsentPreflight {
  reserve: (input: ExecutionConsentBinding & { scope: ExecutionConsentScope; idempotencyKey: string }) => Promise<ExecutionConsentReserveResult>;
  request?: (input: ExecutionConsentCeremonyInput) => Promise<
    { decision: 'granted'; grant: { scope: ExecutionConsentScope } } | { decision: 'denied'; reason: string }
  >;
}

export function executionTargetDigest(target: HarnessExecutionTarget): string {
  return launchDigest({
    id: target.id,
    state: target.state,
    equivalence: target.equivalence,
    effect: target.effect,
    materialDifference: target.materialDifference,
    risk: target.risk,
    evidence: target.evidence
  });
}

/** Validate main-derived execution metadata and reserve, but do not consume, translation consent. */
export async function preflightExecutionAuthorization(
  input: ExecutionAuthorizationInput,
  consent: ExecutionConsentPreflight
): Promise<ExecutionPreflightDecision> {
  if (input.provenance === 'inherited-native-default') return { decision: 'allowed', scope: input.scope };
  if (!input.target) return { decision: 'blocked', reason: 'missing execution target' };
  if (input.mode === 'unattended' && input.target.unattendedAllowed === false) {
    return { decision: 'blocked', reason: 'target disallows unattended execution' };
  }
  const evaluated = evaluateExecutionEvidence(input.target, input.evidence, {
    cliVersion: input.installedVersion,
    scope: input.scope,
    profilePosture: input.profilePosture
  });
  if (evaluated.classification === 'unavailable') return { decision: 'blocked', reason: evaluated.reason };

  const needsTranslationConsent = input.provenance === 'portable-mapped'
    && (input.target.equivalence === 'closest' || input.target.equivalence === 'conditional');
  if (!needsTranslationConsent) {
    return {
      decision: 'allowed', scope: input.scope,
      targetDigest: executionTargetDigest(input.target), evidenceDigest: evaluated.evidenceDigest
    };
  }
  const targetDigest = executionTargetDigest(input.target);
  let reservation = await reserveMatchingConsent(input, consent, targetDigest, evaluated.evidenceDigest);
  if (reservation.outcome === 'denied' && input.mode === 'interactive' && consent.request) {
    const ceremony = await consent.request({
      adapterId: input.adapterId,
      target: input.target,
      targetDigest,
      evidenceDigest: evaluated.evidenceDigest,
      projectId: input.projectId,
      launchScope: input.scope,
      mode: input.mode
    });
    if (ceremony.decision === 'denied') return { decision: 'blocked', reason: ceremony.reason };
    if (!input.consentScopes.includes(ceremony.grant.scope)) {
      return { decision: 'blocked', reason: 'consent scope unavailable for launch mode' };
    }
    reservation = await reserveMatchingConsent(input, consent, targetDigest, evaluated.evidenceDigest, [ceremony.grant.scope]);
  }
  if (reservation.outcome === 'denied') return { decision: 'blocked', reason: 'no matching consent' };
  return {
    decision: 'allowed',
    scope: input.scope,
    targetDigest,
    evidenceDigest: evaluated.evidenceDigest,
    consentReservation: { id: reservation.reservation.id, scope: reservation.grant.scope }
  };
}

async function reserveMatchingConsent(
  input: ExecutionAuthorizationInput,
  consent: ExecutionConsentPreflight,
  targetDigest: string,
  evidenceDigest: string,
  scopes = input.consentScopes
): Promise<ExecutionConsentReserveResult> {
  for (const scope of scopes) {
    const reservation = await consent.reserve({
      adapterId: input.adapterId,
      targetId: input.target!.id,
      targetDigest,
      evidenceDigest,
      projectId: input.projectId,
      launchScope: input.scope,
      scope,
      idempotencyKey: `${input.idempotencyKey}:${scope}`
    });
    if (reservation.outcome === 'reserved') return reservation;
  }
  return { outcome: 'denied' };
}

/** Build main-owned launch intent. Caller input contributes request fields only. */
export function preflightLaunch<TRequest, TResolved>(
  request: TRequest,
  deps: LaunchPreflightDeps<TResolved>
): LaunchPreflight<TRequest, TResolved> {
  const principal = deps.principal();
  // Detach from live stores/caller objects before any async evidence or consent
  // work. Digest and eventual spawn consume same immutable value graph.
  const requestSnapshot = immutableSnapshot(request);
  const resolved = immutableSnapshot(deps.resolve());
  const sessionId = (deps.sessionId ?? randomUUID)();
  const idempotencyKey = (deps.idempotencyKey ?? randomUUID)();
  const bindingInput = deps.binding?.() ?? {
    consumerKind: 'terminal' as const,
    scope: projectScopeOf(resolved),
    autonomous: false
  };
  const binding: LaunchAuthorizationBinding = immutableSnapshot({
    ...bindingInput,
    initialTaskDigest: launchDigest(requestSnapshot),
    storeRevision: storeRevisionOf(resolved),
    projectIdentityDigest: launchDigest(projectOf(resolved)),
    expiresAt: (deps.now ?? Date.now)() + (deps.authorizationTtlMs ?? 5 * 60_000)
  });
  const digest = launchDigest({ principal, request: requestSnapshot, resolved, sessionId, binding });
  return { request: requestSnapshot, principal, resolved, sessionId, idempotencyKey, digest, binding };
}

function projectOf(resolved: unknown): unknown {
  return resolved && typeof resolved === 'object' ? (resolved as { project?: unknown }).project : undefined;
}

function storeRevisionOf(resolved: unknown): string {
  const value = resolved && typeof resolved === 'object' ? (resolved as { storeRevision?: unknown }).storeRevision : undefined;
  return typeof value === 'string' ? value : launchDigest(resolved);
}

function projectScopeOf(resolved: unknown): 'local' | 'remote' {
  const project = projectOf(resolved);
  return project && typeof project === 'object' && (project as { remote?: unknown }).remote ? 'remote' : 'local';
}

function immutableSnapshot<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

/** Bind execution evidence and consent scope into final authorization digest. */
export function finalizeLaunchPreflight<TRequest, TResolved>(
  plan: LaunchPreflight<TRequest, TResolved>,
  executionAuthorization: Extract<ExecutionPreflightDecision, { decision: 'allowed' }>
): LaunchPreflight<TRequest, TResolved> & { executionAuthorization: typeof executionAuthorization } {
  const execution = {
    scope: executionAuthorization.scope,
    targetDigest: executionAuthorization.targetDigest,
    evidenceDigest: executionAuthorization.evidenceDigest,
    consentScope: executionAuthorization.consentReservation?.scope
  };
  const binding = immutableSnapshot({
    ...plan.binding,
    scope: executionAuthorization.scope,
    evidenceDigest: executionAuthorization.evidenceDigest,
    consentReservation: executionAuthorization.consentReservation
  });
  return {
    ...plan,
    digest: launchDigest({
      principal: plan.principal, request: plan.request, resolved: plan.resolved,
      sessionId: plan.sessionId, binding, execution
    }),
    binding,
    executionAuthorization
  };
}
