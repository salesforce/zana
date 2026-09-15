import { randomUUID } from 'node:crypto';
import { launchDigest } from './digest.js';
import { projectIdentityDigest } from './commit-revalidation.js';
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

export type AdmissionCheckStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'UNKNOWN';

export type AdmissionCheckCode =
  | 'DAG_VALID'
  | 'FILE_SCOPES_VALID'
  | 'SLOT_CAPACITY'
  | 'SKILL_AVAILABLE'
  | 'MCP_AVAILABLE'
  | 'MODEL_HEALTH'
  | 'PROVIDER_HEALTH'
  | 'CONTEXT_BUDGET'
  | 'TOKEN_BUDGET'
  | 'USD_BUDGET';

export interface AdmissionCheck {
  code: AdmissionCheckCode;
  status: AdmissionCheckStatus;
  required: boolean;
  subject?: string;
  message: string;
}

export interface AdmissionBudgetV1 {
  version: 1;
  maxContextBytes?: number;
  maxEstimatedTokens?: number;
  maxEstimatedUsd?: number;
  estimatedUsd?: number;
}

export interface AdmissionCapabilityInventoryV1 {
  version: 1;
  observedAt: number;
  maxAgeMs: number;
  skills: readonly { name: string; available: boolean }[];
  mcpServers: readonly { name: string; available: boolean }[];
  models: readonly { id: string; status: 'available' | 'unavailable' | 'unknown'; provider: string }[];
  providers: readonly { id: string; status: 'available' | 'unavailable' | 'unknown' }[];
}

export interface AdmissionWorkUnitInput {
  id: string;
  title: string;
  task: string;
  dependencies: string[];
  preferredRole?: string;
  files?: string[];
  verification?: string[];
  readOnly?: boolean;
}

export interface TeamAdmissionInput {
  workUnits?: readonly AdmissionWorkUnitInput[];
  requireCompletePlan?: boolean;
  slotCount: number;
  maxSlots: number;
  initialTasks: readonly string[];
  sourceBytes?: number;
  requiredSkills?: readonly string[];
  requiredMcpServers?: readonly string[];
  requiredModels?: readonly string[];
  requiredProviders?: readonly string[];
  budget?: AdmissionBudgetV1;
  inventory?: AdmissionCapabilityInventoryV1;
  now?: number;
}

export interface TeamAdmissionRequirements {
  requiredSkills?: readonly string[];
  requiredMcpServers?: readonly string[];
  requiredModels?: readonly string[];
  requiredProviders?: readonly string[];
  budget?: AdmissionBudgetV1;
}

export interface TeamAdmissionInventorySources {
  listSkills: () => Promise<readonly { name: string; enabled: boolean }[]>;
  listMcpServers: () => Promise<readonly { name: string; enabled: boolean }[]>;
  modelHealth: (ids: readonly string[]) => Promise<readonly { id: string; provider: string; status: 'available' | 'unavailable' | 'unknown' }[]>;
  providerHealth: (ids: readonly string[]) => Promise<readonly { id: string; status: 'available' | 'unavailable' | 'unknown' }[]>;
  now?: () => number;
  maxAgeMs?: number;
}

export interface TeamAdmissionResultV1 {
  version: 1;
  ready: boolean;
  digest: string;
  estimate: { contextBytes: number; tokens: number; usd?: number };
  checks: AdmissionCheck[];
}

const MAX_ADMISSION_REQUIREMENTS = 100;

/** Pure Team admission policy used by preview and launch. Required non-PASS checks fail closed. */
export function evaluateTeamAdmission(input: TeamAdmissionInput): TeamAdmissionResultV1 {
  const checks: AdmissionCheck[] = [];
  const add = (check: AdmissionCheck) => checks.push(check);
  let normalizedPlan: AdmissionWorkUnitInput[] | undefined;
  try {
    normalizedPlan = input.workUnits === undefined
      ? undefined
      : normalizeExecutionPlan(input.workUnits, input.requireCompletePlan);
    add({ code: 'DAG_VALID', status: input.workUnits ? 'PASS' : 'SKIPPED', required: !!input.workUnits, message: input.workUnits ? 'DAG is valid' : 'No DAG supplied' });
    add({ code: 'FILE_SCOPES_VALID', status: input.workUnits ? 'PASS' : 'SKIPPED', required: !!input.workUnits, message: input.workUnits ? 'File scopes are valid' : 'No file scopes supplied' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    add({ code: 'DAG_VALID', status: message.includes('file scope') ? 'PASS' : 'FAIL', required: true, message });
    add({ code: 'FILE_SCOPES_VALID', status: message.includes('file scope') ? 'FAIL' : 'UNKNOWN', required: true, message });
  }
  add({
    code: 'SLOT_CAPACITY', status: input.slotCount > 0 && input.slotCount <= input.maxSlots ? 'PASS' : 'FAIL', required: true,
    message: input.slotCount > 0 && input.slotCount <= input.maxSlots ? `${input.slotCount} slots fit capacity` : `${input.slotCount} slots exceed capacity ${input.maxSlots}`
  });

  const now = input.now ?? Date.now();
  const inventoryFresh = !!input.inventory && input.inventory.maxAgeMs >= 0
    && now - input.inventory.observedAt <= input.inventory.maxAgeMs;
  capabilityChecks('SKILL_AVAILABLE', bounded(input.requiredSkills), input.inventory?.skills, inventoryFresh, add);
  capabilityChecks('MCP_AVAILABLE', bounded(input.requiredMcpServers), input.inventory?.mcpServers, inventoryFresh, add);
  healthChecks('MODEL_HEALTH', bounded(input.requiredModels), input.inventory?.models, inventoryFresh, add);
  healthChecks('PROVIDER_HEALTH', bounded(input.requiredProviders), input.inventory?.providers, inventoryFresh, add);

  const contextBytes = input.initialTasks.reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0)
    + (normalizedPlan ?? input.workUnits ?? []).reduce((sum, unit) => sum + Buffer.byteLength(`${unit.title}\n${unit.task}\n${unit.verification?.join('\n') ?? ''}`, 'utf8'), 0)
    + Math.max(0, input.sourceBytes ?? 0);
  const tokens = Math.ceil(contextBytes / 4);
  const budget = input.budget;
  budgetCheck('CONTEXT_BUDGET', budget?.maxContextBytes, contextBytes, add);
  budgetCheck('TOKEN_BUDGET', budget?.maxEstimatedTokens, tokens, add);
  if (budget?.maxEstimatedUsd === undefined) {
    add({ code: 'USD_BUDGET', status: 'SKIPPED', required: false, message: 'No USD budget supplied' });
  } else if (budget.estimatedUsd === undefined) {
    add({ code: 'USD_BUDGET', status: 'UNKNOWN', required: true, message: 'USD estimate unavailable' });
  } else {
    budgetCheck('USD_BUDGET', budget.maxEstimatedUsd, budget.estimatedUsd, add);
  }
  const estimate = { contextBytes, tokens, ...(budget?.estimatedUsd === undefined ? {} : { usd: budget.estimatedUsd }) };
  const ready = checks.every((check) => !check.required || check.status === 'PASS');
  const identity = {
    workUnits: normalizedPlan,
    slotCount: input.slotCount,
    maxSlots: input.maxSlots,
    initialTasks: input.initialTasks,
    sourceBytes: input.sourceBytes,
    requiredSkills: bounded(input.requiredSkills),
    requiredMcpServers: bounded(input.requiredMcpServers),
    requiredModels: bounded(input.requiredModels),
    requiredProviders: bounded(input.requiredProviders),
    budget: input.budget,
    inventory: input.inventory && {
      version: input.inventory.version,
      maxAgeMs: input.inventory.maxAgeMs,
      skills: input.inventory.skills,
      mcpServers: input.inventory.mcpServers,
      models: input.inventory.models,
      providers: input.inventory.providers
    }
  };
  return { version: 1, ready, digest: launchDigest({ version: 1, identity, estimate, checks }), estimate, checks };
}

/** Build one bounded inventory snapshot. Any failed source becomes UNKNOWN at evaluation. */
export async function collectTeamAdmissionInventory(
  requirements: TeamAdmissionRequirements,
  sources: TeamAdmissionInventorySources
): Promise<AdmissionCapabilityInventoryV1> {
  const observedAt = (sources.now ?? Date.now)();
  const [skills, mcpServers, models, providers] = await Promise.all([
    safeInventory(() => sources.listSkills(), []),
    safeInventory(() => sources.listMcpServers(), []),
    safeInventory(() => sources.modelHealth(bounded(requirements.requiredModels)), []),
    safeInventory(() => sources.providerHealth(bounded(requirements.requiredProviders)), [])
  ]);
  return {
    version: 1,
    observedAt,
    maxAgeMs: Math.max(0, sources.maxAgeMs ?? 30_000),
    skills: skills.slice(0, MAX_ADMISSION_REQUIREMENTS).map((skill) => ({ name: skill.name, available: skill.enabled })),
    mcpServers: mcpServers.slice(0, MAX_ADMISSION_REQUIREMENTS).map((server) => ({ name: server.name, available: server.enabled })),
    models: models.slice(0, MAX_ADMISSION_REQUIREMENTS),
    providers: providers.slice(0, MAX_ADMISSION_REQUIREMENTS)
  };
}

export function normalizeExecutionPlan<T extends AdmissionWorkUnitInput>(inputs: readonly T[], requireComplete = false): T[] {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) throw new Error('invalid execution work unit count');
  const ids = new Set<string>();
  const units = inputs.map((input) => {
    const id = boundedString(input.id, 'work unit id');
    if (ids.has(id)) throw new Error('duplicate work unit id');
    ids.add(id);
    if (!Array.isArray(input.dependencies) || input.dependencies.length > 100) throw new Error('invalid work unit dependencies');
    const dependencies = input.dependencies.map((dependency: string) => boundedString(dependency, 'work unit dependency'));
    const files = input.files?.map(normalizeFileScope);
    const verification = input.verification?.map((step: string) => boundedString(step, 'work unit verification'));
    if (requireComplete && !input.readOnly && !files?.length) throw new Error('mutating work unit requires file scope');
    if (requireComplete && !verification?.length) throw new Error('work unit requires verification');
    return {
      id,
      title: boundedString(input.title, 'work unit title'),
      task: boundedString(input.task, 'work unit task'),
      dependencies,
      ...(input.preferredRole ? { preferredRole: boundedString(input.preferredRole, 'work unit preferred role') } : {}),
      ...(files ? { files } : {}),
      ...(verification ? { verification } : {}),
      ...(input.readOnly ? { readOnly: true } : {})
    } as T;
  });
  for (const unit of units) for (const dependency of unit.dependencies) if (!ids.has(dependency)) throw new Error('missing work unit dependency');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('work unit dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const unit of units) visit(unit.id);
  return units;
}

function normalizeFileScope(value: string): string {
  const raw = boundedString(value, 'work unit file scope').replace(/\\/g, '/');
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) throw new Error('invalid work unit file scope');
  const parts: string[] = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') throw new Error('invalid work unit file scope');
    parts.push(part);
  }
  if (!parts.length) throw new Error('invalid work unit file scope');
  return parts.join('/');
}

function boundedString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) throw new Error(`invalid ${label}`);
  return value.trim();
}

function bounded(values: readonly string[] | undefined): readonly string[] {
  return (values ?? []).slice(0, MAX_ADMISSION_REQUIREMENTS);
}

async function safeInventory<T>(read: () => Promise<readonly T[]>, fallback: readonly T[]): Promise<readonly T[]> {
  try { return await read(); } catch { return fallback; }
}

function capabilityChecks(
  code: 'SKILL_AVAILABLE' | 'MCP_AVAILABLE', required: readonly string[],
  inventory: readonly { name: string; available: boolean }[] | undefined, fresh: boolean,
  add: (check: AdmissionCheck) => void
): void {
  if (!required.length) return add({ code, status: 'SKIPPED', required: false, message: 'No requirements supplied' });
  for (const subject of required) {
    const found = inventory?.find((item) => item.name === subject);
    const status = !fresh || !found ? 'UNKNOWN' : found.available ? 'PASS' : 'FAIL';
    add({ code, status, required: true, subject, message: status === 'PASS' ? `${subject} is available` : status === 'FAIL' ? `${subject} is unavailable` : `${subject} availability is unknown` });
  }
}

function healthChecks(
  code: 'MODEL_HEALTH' | 'PROVIDER_HEALTH', required: readonly string[],
  inventory: readonly ({ id: string; status: 'available' | 'unavailable' | 'unknown' })[] | undefined, fresh: boolean,
  add: (check: AdmissionCheck) => void
): void {
  if (!required.length) return add({ code, status: 'SKIPPED', required: false, message: 'No requirements supplied' });
  for (const subject of required) {
    const found = inventory?.find((item) => item.id === subject);
    const status = !fresh || !found || found.status === 'unknown' ? 'UNKNOWN' : found.status === 'available' ? 'PASS' : 'FAIL';
    add({ code, status, required: true, subject, message: status === 'PASS' ? `${subject} is available` : status === 'FAIL' ? `${subject} is unavailable` : `${subject} health is unknown` });
  }
}

function budgetCheck(code: 'CONTEXT_BUDGET' | 'TOKEN_BUDGET' | 'USD_BUDGET', limit: number | undefined, actual: number, add: (check: AdmissionCheck) => void): void {
  if (limit === undefined) return add({ code, status: 'SKIPPED', required: false, message: 'No budget supplied' });
  const pass = Number.isFinite(limit) && limit >= 0 && actual <= limit;
  add({ code, status: pass ? 'PASS' : 'FAIL', required: true, message: pass ? `${actual} is within budget ${limit}` : `${actual} exceeds budget ${limit}` });
}

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
    projectIdentityDigest: projectIdentityDigest(projectOf(resolved)),
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
