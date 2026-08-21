import { describe, it, expect, vi } from 'vitest';

// The registry imports persona-store + team-store, which import 'electron'.
// Only `sanitizePersona` / `sanitizeTeam` are reached here (pure), but the
// module-level `app.getPath` references in those files need a stub.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/zcc-registry-test' },
  shell: { openPath: vi.fn() }
}));

import {
  PersonaTeamRegistry,
  PERSONAS_PER_EXTENSION_MAX,
  TEAMS_PER_EXTENSION_MAX,
  TEAM_SLOT_MAX
} from '../../../../../desktop/src/extensions/persona-team-registry.js';
import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';

function entries(...pairs: Array<[string, string]>): ExtensionEntry[] {
  return pairs.map(([id, title]) => ({
    id,
    path: `/x/${id}`,
    manifest: { id, title, icon: 'Box', entry: {}, engines: { zccApi: '>=1' } },
    enabled: true,
    loaded: true,
    mainActive: true,
    consented: true,
    needsConsent: null
  }));
}

describe('PersonaTeamRegistry — personas', () => {
  it('namespaces ids as ext:<moduleId>:<slug> and stamps {extensionId,extensionTitle}', () => {
    const reg = new PersonaTeamRegistry(() => entries(['acme', 'Acme Co']));
    const accepted = reg.setPersonas('acme', [{ id: 'My Reviewer!', name: 'Reviewer' }]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].id).toBe('ext:acme:my-reviewer');
    expect(accepted[0].source).toEqual({ extensionId: 'acme', extensionTitle: 'Acme Co' });
  });

  it('stamps extensionId even when the title is unknown (no entry)', () => {
    const reg = new PersonaTeamRegistry(() => []);
    const [p] = reg.setPersonas('ghost', [{ id: 'x', name: 'X' }]);
    expect(p.source).toEqual({ extensionId: 'ghost' });
  });

  it('runs inputs through sanitizePersona — drops invalid (missing name / bad enum)', () => {
    const reg = new PersonaTeamRegistry(() => []);
    const accepted = reg.setPersonas('acme', [
      { id: 'ok', name: 'Good' },
      // A cross-provider model slug is now VALID (model is a free-form string —
      // the provider owns its dialect), so this persona is accepted, not dropped.
      { id: 'codex', name: 'Codex', model: 'gpt-5-codex' },
      // missing name → dropped
      { id: 'no-name' } as never,
      // invalid ENUM (permissionMode is still a closed set) → dropped
      { id: 'bad', name: 'Bad', permissionMode: 'wide-open' as never }
    ]);
    expect(accepted.map((p) => p.id)).toEqual(['ext:acme:ok', 'ext:acme:codex']);
  });

  it('caps at PERSONAS_PER_EXTENSION_MAX (slice before map)', () => {
    const reg = new PersonaTeamRegistry(() => []);
    const many = Array.from({ length: PERSONAS_PER_EXTENSION_MAX + 10 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`
    }));
    const accepted = reg.setPersonas('acme', many);
    expect(accepted).toHaveLength(PERSONAS_PER_EXTENSION_MAX);
  });

  it('REPLACES the set on re-register (declarative, not additive)', () => {
    const reg = new PersonaTeamRegistry(() => []);
    reg.setPersonas('acme', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    reg.setPersonas('acme', [{ id: 'c', name: 'C' }]);
    expect(reg.allPersonas().map((p) => p.id)).toEqual(['ext:acme:c']);
  });

  it('keeps each extension namespaced — no cross-ext shadowing', () => {
    const reg = new PersonaTeamRegistry(() => []);
    reg.setPersonas('acme', [{ id: 'shared', name: 'A' }]);
    reg.setPersonas('beta', [{ id: 'shared', name: 'B' }]);
    expect(reg.allPersonas().map((p) => p.id).sort()).toEqual([
      'ext:acme:shared',
      'ext:beta:shared'
    ]);
  });

  it('clearModule empties that extension and emits changed', () => {
    const reg = new PersonaTeamRegistry(() => []);
    reg.setPersonas('acme', [{ id: 'a', name: 'A' }]);
    let fired = false;
    reg.onChanged(() => {
      fired = true;
    });
    reg.clearModule('acme');
    expect(reg.allPersonas()).toEqual([]);
    expect(fired).toBe(true);
  });

  it('clearModule of an extension that never registered does not emit', () => {
    const reg = new PersonaTeamRegistry(() => []);
    let fired = false;
    reg.onChanged(() => {
      fired = true;
    });
    reg.clearModule('never');
    expect(fired).toBe(false);
  });

  it('setPersonas emits changed', () => {
    const reg = new PersonaTeamRegistry(() => []);
    let count = 0;
    reg.onChanged(() => {
      count += 1;
    });
    reg.setPersonas('acme', [{ id: 'a', name: 'A' }]);
    expect(count).toBe(1);
  });
});

describe('PersonaTeamRegistry — teams', () => {
  it('namespaces + stamps team source and clamps slot quantity to TEAM_SLOT_MAX', () => {
    const reg = new PersonaTeamRegistry(() => entries(['acme', 'Acme Co']));
    const [team] = reg.setTeams('acme', [
      {
        id: 'squad',
        name: 'Squad',
        slots: [
          { personaId: 'ext:acme:rev', quantity: 999 },
          { personaId: '', quantity: 1 } // dropped: empty personaId
        ]
      }
    ]);
    expect(team.id).toBe('ext:acme:squad');
    expect(team.source).toEqual({ extensionId: 'acme', extensionTitle: 'Acme Co' });
    expect(team.slots).toHaveLength(1);
    expect(team.slots[0].quantity).toBe(TEAM_SLOT_MAX);
  });

  it('drops teams missing required fields (no slots array / no name)', () => {
    const reg = new PersonaTeamRegistry(() => []);
    const accepted = reg.setTeams('acme', [
      { id: 'ok', name: 'OK', slots: [] },
      { id: 'no-slots', name: 'NoSlots' } as never, // no slots array → dropped
      { id: 'no-name', slots: [] } as never // no name → dropped
    ]);
    expect(accepted.map((t) => t.id)).toEqual(['ext:acme:ok']);
  });

  it('caps at TEAMS_PER_EXTENSION_MAX (slice before map)', () => {
    const reg = new PersonaTeamRegistry(() => []);
    const many = Array.from({ length: TEAMS_PER_EXTENSION_MAX + 5 }, (_, i) => ({
      id: `t${i}`,
      name: `T${i}`,
      slots: []
    }));
    const accepted = reg.setTeams('acme', many);
    expect(accepted).toHaveLength(TEAMS_PER_EXTENSION_MAX);
  });

  it('clearModule clears teams too', () => {
    const reg = new PersonaTeamRegistry(() => []);
    reg.setTeams('acme', [{ id: 't', name: 'T', slots: [] }]);
    reg.clearModule('acme');
    expect(reg.allTeams()).toEqual([]);
  });
});
