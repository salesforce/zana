import type { Persona, PersonaInput, SquadBundle, SquadBundleWorkflowMetadataV1, Team, TeamInput } from '@zana-ai/zcc-domain/product';
import { sanitizePersona } from './persona-store.js';
import { sanitizeTeam } from './team-store.js';
import { expandTeamSlots, type ExpandedTeamSlot } from './team-slot-expansion.js';

const BUNDLE_KIND = 'zcc-squad-bundle' as const;
const BUNDLE_VERSION = 1 as const;

/** Every persona id a team references — orchestrator first, then slots, deduped. */
function referencedPersonaIds(team: Team): string[] {
  const ids = new Set<string>();
  if (team.orchestratorPersonaId) ids.add(team.orchestratorPersonaId);
  for (const slot of team.slots) ids.add(slot.personaId);
  return [...ids];
}

/** Strip the loader-stamped `source` field — never round-tripped through a bundle. */
function withoutSource<T extends { source?: unknown }>(value: T): Omit<T, 'source'> {
  const { source: _source, ...rest } = value;
  void _source;
  return rest;
}

/**
 * Build a {@link SquadBundle} for `team`, resolving its referenced personas out
 * of `allPersonas` (the merged store list). A persona id that doesn't resolve
 * is silently omitted — mirrors how a launch already tolerates an unresolved
 * slot — so exporting a team with a dangling reference still produces a usable
 * (if incomplete) bundle rather than failing outright.
 */
export function buildSquadBundle(
  team: Team,
  allPersonas: Persona[],
  workflow?: SquadBundleWorkflowMetadataV1
): SquadBundle {
  const byId = new Map(allPersonas.map((p) => [p.id, p] as const));
  const personas: Array<PersonaInput & { id: string }> = [];
  for (const id of referencedPersonaIds(team)) {
    const persona = byId.get(id);
    if (persona) personas.push(withoutSource(persona) as PersonaInput & { id: string });
  }
  return {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    team: withoutSource(team) as TeamInput & { id: string },
    personas,
    ...(workflow ? { workflow: sanitizeWorkflowMetadata(workflow) } : {})
  };
}

/**
 * Validate + normalize a raw parsed JSON value into its team + persona pieces,
 * or an error string. Runs the SAME {@link sanitizeTeam}/{@link sanitizePersona}
 * gates the disk loaders and editor UI use, so a hand-edited bundle file is held
 * to the same bar as any other persona/team JSON. A persona entry that fails
 * sanitization is skipped (not fatal) — matches the tolerant-disk-loader
 * convention — but the team itself must be valid, and at least the team is
 * required.
 */
export function validateSquadBundle(
  raw: unknown
): { team: Team; personas: Persona[]; workflow?: SquadBundleWorkflowMetadataV1 } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const r = raw as Partial<SquadBundle>;
  if (r.kind !== BUNDLE_KIND) return { error: `not a squad bundle (kind: ${String(r.kind)})` };
  if (r.version !== BUNDLE_VERSION) return { error: `unsupported bundle version: ${String(r.version)}` };

  const team = sanitizeTeam(r.team);
  if (!team) return { error: 'invalid team: missing name/slots or invalid field' };

  const rawPersonas = Array.isArray(r.personas) ? r.personas : [];
  const personas: Persona[] = [];
  for (const entry of rawPersonas) {
    const persona = sanitizePersona(entry);
    if (persona) personas.push(persona);
  }

  const workflow = sanitizeWorkflowMetadata(r.workflow);
  return { team, personas, ...(workflow ? { workflow } : {}) };
}

const MAX_WORKFLOW_STRING = 256;
const MAX_WORKFLOW_WORKERS = 64;
const WORKFLOW_KEYS = new Set(['schemaVersion', 'profileId', 'profileVersion', 'controller', 'workers', 'supportedRequestVersions']);
const CONTROLLER_KEYS = new Set(['personaId', 'slotId']);
const WORKER_KEYS = new Set(['role', 'personaId', 'slotId']);

function hasExactKeys(value: object, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function boundedWorkflowString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_WORKFLOW_STRING ? value : undefined;
}

/** Drop malformed optional metadata. A valid Team/persona bundle must remain importable. */
export function sanitizeWorkflowMetadata(value: unknown): SquadBundleWorkflowMetadataV1 | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (!hasExactKeys(value, WORKFLOW_KEYS)) return undefined;
  const metadata = value as Partial<SquadBundleWorkflowMetadataV1>;
  if (metadata.schemaVersion !== 1) return undefined;
  const profileId = boundedWorkflowString(metadata.profileId);
  const profileVersion = boundedWorkflowString(metadata.profileVersion);
  const controller = metadata.controller;
  if (!controller || typeof controller !== 'object' || !hasExactKeys(controller, CONTROLLER_KEYS)) return undefined;
  const controllerPersonaId = boundedWorkflowString(controller?.personaId);
  const controllerSlotId = boundedWorkflowString(controller?.slotId);
  if (!profileId || !profileVersion || !controllerPersonaId || !controllerSlotId
    || !Array.isArray(metadata.workers) || metadata.workers.length > MAX_WORKFLOW_WORKERS
    || !Array.isArray(metadata.supportedRequestVersions) || metadata.supportedRequestVersions.length === 0
    || metadata.supportedRequestVersions.length > 8
    || metadata.supportedRequestVersions.some((version) => !Number.isInteger(version) || version < 1 || version > 100)) {
    return undefined;
  }
  const workers: SquadBundleWorkflowMetadataV1['workers'] = [];
  const slotIds = new Set([controllerSlotId]);
  for (const worker of metadata.workers) {
    if (!worker || typeof worker !== 'object' || !hasExactKeys(worker, WORKER_KEYS)) return undefined;
    const role = boundedWorkflowString(worker?.role);
    const personaId = boundedWorkflowString(worker?.personaId);
    const slotId = boundedWorkflowString(worker?.slotId);
    if (!role || !personaId || !slotId || slotIds.has(slotId)) return undefined;
    slotIds.add(slotId);
    workers.push({ role, personaId, slotId });
  }
  return {
    schemaVersion: 1,
    profileId,
    profileVersion,
    controller: { personaId: controllerPersonaId, slotId: controllerSlotId },
    workers,
    supportedRequestVersions: [...new Set(metadata.supportedRequestVersions)]
  };
}

export type WorkflowProfilePreflight =
  | { ok: true; slots: ExpandedTeamSlot[] }
  | { ok: false; code: 'INVALID_WORKFLOW_PROFILE'; message: string };

/** Validate portable metadata against current host-owned Team/persona state. */
export function preflightWorkflowProfile(
  workflow: unknown,
  team: Team,
  personas: readonly Persona[]
): WorkflowProfilePreflight {
  const profile = sanitizeWorkflowMetadata(workflow);
  if (!profile) return { ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'workflow profile metadata is invalid' };
  const known = new Set(personas.map((persona) => persona.id));
  const slots = expandTeamSlots(team);
  const declared = [
    { ...profile.controller, role: 'orchestrator' as const },
    ...profile.workers.map((worker) => ({ ...worker, role: 'worker' as const }))
  ];
  if (declared.some((slot) => !known.has(slot.personaId))) {
    return { ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'workflow profile references an unknown persona' };
  }
  for (const declaration of declared) {
    const slot = slots.find((candidate) => candidate.slotId === declaration.slotId);
    if (!slot || slot.personaId !== declaration.personaId || slot.role !== declaration.role) {
      return { ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: `workflow profile does not match Team slot ${declaration.slotId}` };
    }
  }
  if (declared.length !== slots.length) {
    return { ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'workflow profile does not cover every Team slot' };
  }
  return { ok: true, slots };
}
