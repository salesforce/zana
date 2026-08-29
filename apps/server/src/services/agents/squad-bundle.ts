import type { Persona, PersonaInput, SquadBundle, Team, TeamInput } from '@zana-ai/zcc-domain/product';
import { sanitizePersona } from './persona-store.js';
import { sanitizeTeam } from './team-store.js';

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
export function buildSquadBundle(team: Team, allPersonas: Persona[]): SquadBundle {
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
    personas
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
): { team: Team; personas: Persona[] } | { error: string } {
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

  return { team, personas };
}
