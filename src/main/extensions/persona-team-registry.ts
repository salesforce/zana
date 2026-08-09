/**
 * In-memory registry of extension-contributed Personas and Teams (design
 * §3a). The single shared source both module hosts (the in-process
 * `MainModuleHost` and the out-of-process `ExtensionProcessHost`) write to when
 * an extension calls `ctx.personas.register(...)` / `ctx.teams.register(...)`.
 *
 * Lifecycle-bound + in-memory by design: registrations are NEVER written to
 * disk. They are cleared on teardown / disable / crash / hot-reload so a dead
 * extension never leaves zombie personas/teams behind (the host wires
 * `clearModule(id)` into every teardown choke point).
 *
 * Rule 6 (no extension id in core logic): the registry NEVER hardcodes a
 * concrete extension id. Provenance is stamped from the `moduleId` the HOST
 * passes — the authenticated id it already owns (`mod.id` in registry.ts /
 * `state.moduleId` in process-host.ts), never an id the extension supplies in a
 * payload. The `extensionTitle` is resolved from the live extension entries via
 * the injected lookup, again keyed by the host-supplied id.
 *
 * Rule 5 (bounded): hard per-extension + per-slot caps, applied with `slice`
 * BEFORE the sanitize map; `setPersonas`/`setTeams` REPLACE this extension's
 * full set (declarative, not additive) so a chatty extension can't accumulate.
 */

import { EventEmitter } from 'node:events';
import type { ExtensionEntry, Persona, PersonaInput, Team, TeamInput } from '../../shared/types.js';
import { sanitizePersona } from '../persona-store.js';
import { sanitizeTeam } from '../team-store.js';

/** Rule 5: max personas one extension may contribute. Excess is sliced off. */
export const PERSONAS_PER_EXTENSION_MAX = 50;
/** Rule 5: max teams one extension may contribute. */
export const TEAMS_PER_EXTENSION_MAX = 20;
/** Rule 5: max tabs (quantity) a single team slot may request, and the clamp on each slot. */
export const TEAM_SLOT_MAX = 16;

/** Lookup that resolves an extension's display title from its id (host-supplied). */
type EntriesRef = () => ExtensionEntry[];

/**
 * Slug a raw persona/team id into a filesystem/url-safe stem so the host can
 * namespace it as `ext:<moduleId>:<slug>`. Mirrors PersonaStore's id rules.
 */
function slugId(raw: unknown, fallback: string): string {
  const base =
    String(typeof raw === 'string' ? raw : '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || fallback;
  return base;
}

export class PersonaTeamRegistry extends EventEmitter {
  /** moduleId → that extension's accepted (sanitized, namespaced, stamped) personas. */
  private readonly personasByModule = new Map<string, Persona[]>();
  /** moduleId → that extension's accepted teams. */
  private readonly teamsByModule = new Map<string, Team[]>();

  constructor(private readonly entriesRef?: EntriesRef) {
    super();
  }

  /** Resolve the human title for an extension id from the live entries (best-effort). */
  private titleFor(moduleId: string): string | undefined {
    const entry = this.entriesRef?.().find((e) => e.id === moduleId);
    return entry?.manifest?.title ?? undefined;
  }

  /**
   * REPLACE this extension's persona set (declarative). `moduleId` is the
   * AUTHENTICATED id the host owns — never trusted from the extension. Caps to
   * PERSONAS_PER_EXTENSION_MAX, runs each through the shared `sanitizePersona`
   * gate, namespaces the id as `ext:<moduleId>:<slug>`, and stamps
   * `source:{extensionId,extensionTitle}`. Returns the accepted personas; emits
   * `changed` so the PersonaStore re-merges.
   */
  setPersonas(moduleId: string, raw: PersonaInput[]): Persona[] {
    const title = this.titleFor(moduleId);
    const list = Array.isArray(raw) ? raw.slice(0, PERSONAS_PER_EXTENSION_MAX) : [];
    const accepted: Persona[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const input = list[i];
      const slug = slugId((input as { id?: unknown })?.id, `persona-${i + 1}`);
      const id = `ext:${moduleId}:${slug}`;
      if (seen.has(id)) continue; // an extension can't shadow its own slot
      const persona = sanitizePersona({ ...input, id });
      if (!persona) continue; // invalid (missing name / bad enum) → dropped
      persona.source = { extensionId: moduleId, ...(title ? { extensionTitle: title } : {}) };
      accepted.push(persona);
      seen.add(id);
    }
    this.personasByModule.set(moduleId, accepted);
    this.emit('changed');
    return accepted;
  }

  /** REPLACE this extension's team set (declarative). Same contract as {@link setPersonas}. */
  setTeams(moduleId: string, raw: TeamInput[]): Team[] {
    const title = this.titleFor(moduleId);
    const list = Array.isArray(raw) ? raw.slice(0, TEAMS_PER_EXTENSION_MAX) : [];
    const accepted: Team[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const input = list[i];
      const slug = slugId((input as { id?: unknown })?.id, `team-${i + 1}`);
      const id = `ext:${moduleId}:${slug}`;
      if (seen.has(id)) continue;
      const team = sanitizeTeam({ ...input, id });
      if (!team) continue;
      team.source = { extensionId: moduleId, ...(title ? { extensionTitle: title } : {}) };
      accepted.push(team);
      seen.add(id);
    }
    this.teamsByModule.set(moduleId, accepted);
    this.emit('changed');
    return accepted;
  }

  /**
   * Drop EVERY registration for an extension — called on teardown / disable /
   * crash / kill / hot-reload. Emits `changed` only when something was actually
   * removed, so a no-op clear (an ext that never registered) doesn't churn.
   */
  clearModule(moduleId: string): void {
    const had = this.personasByModule.delete(moduleId);
    const hadTeams = this.teamsByModule.delete(moduleId);
    if (had || hadTeams) this.emit('changed');
  }

  /** Flattened view of every extension's personas (for the PersonaStore merge). */
  allPersonas(): Persona[] {
    const out: Persona[] = [];
    for (const list of this.personasByModule.values()) out.push(...list);
    return out;
  }

  /** Flattened view of every extension's teams (for the TeamStore merge). */
  allTeams(): Team[] {
    const out: Team[] = [];
    for (const list of this.teamsByModule.values()) out.push(...list);
    return out;
  }

  /** Subscribe to (de)registration changes. Returns an unsubscribe fn. */
  onChanged(cb: () => void): () => void {
    this.on('changed', cb);
    return () => this.off('changed', cb);
  }
}
