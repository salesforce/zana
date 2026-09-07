import { describe, expect, it } from 'vitest';
import type { Persona, SquadBundleWorkflowMetadataV1, Team } from '@zana-ai/zcc-domain/product';
import { preflightWorkflowProfile, sanitizeWorkflowMetadata } from '../squad-bundle.js';

function validMetadata(): SquadBundleWorkflowMetadataV1 {
  return {
    schemaVersion: 1,
    profileId: 'profile-1',
    profileVersion: '1.0',
    controller: { personaId: 'controller', slotId: 'orchestrator:controller' },
    workers: [{ role: 'worker', personaId: 'worker', slotId: '0:worker:0' }],
    supportedRequestVersions: [1]
  };
}

function validTeam(): Team {
  return {
    id: 'team-1',
    name: 'Team',
    orchestratorPersonaId: 'controller',
    slots: [
      { personaId: 'worker', quantity: 1 },
      { personaId: 'controller', quantity: 1 }
    ]
  };
}

function validPersonas(): Persona[] {
  return [
    { id: 'controller', name: 'Controller' },
    { id: 'worker', name: 'Worker' }
  ];
}

describe('sanitizeWorkflowMetadata', () => {
  it('round-trips valid metadata unchanged', () => {
    expect(sanitizeWorkflowMetadata(validMetadata())).toEqual(validMetadata());
  });

  it('rejects a non-object value', () => {
    expect(sanitizeWorkflowMetadata('nope')).toBeUndefined();
    expect(sanitizeWorkflowMetadata(null)).toBeUndefined();
  });

  it('rejects extra/missing top-level keys', () => {
    const { ...extra } = validMetadata() as Record<string, unknown>;
    (extra as Record<string, unknown>).extraKey = 'x';
    expect(sanitizeWorkflowMetadata(extra)).toBeUndefined();

    const missing = validMetadata() as Partial<SquadBundleWorkflowMetadataV1>;
    delete missing.profileVersion;
    expect(sanitizeWorkflowMetadata(missing)).toBeUndefined();
  });

  it('rejects a wrong schemaVersion', () => {
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), schemaVersion: 2 })).toBeUndefined();
  });

  it('rejects missing/wrong-type profileId', () => {
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), profileId: '' })).toBeUndefined();
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), profileId: 123 })).toBeUndefined();
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), profileId: 'x'.repeat(257) })).toBeUndefined();
  });

  it('rejects missing/wrong-type profileVersion', () => {
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), profileVersion: '' })).toBeUndefined();
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), profileVersion: 9 })).toBeUndefined();
  });

  it('rejects a malformed controller (missing/extra keys, missing personaId/slotId)', () => {
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), controller: {} })).toBeUndefined();
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), controller: { personaId: 'controller' } })).toBeUndefined();
    expect(
      sanitizeWorkflowMetadata({
        ...validMetadata(),
        controller: { personaId: 'controller', slotId: 'orchestrator:controller', extra: 1 }
      })
    ).toBeUndefined();
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), controller: { personaId: '', slotId: 's' } })).toBeUndefined();
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), controller: { personaId: 'p', slotId: '' } })).toBeUndefined();
  });

  it('rejects missing/invalid workers array or over the size limit', () => {
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), workers: 'not-an-array' })).toBeUndefined();
    expect(
      sanitizeWorkflowMetadata({
        ...validMetadata(),
        workers: Array.from({ length: 65 }, (_, i) => ({ role: 'worker', personaId: `w${i}`, slotId: `s${i}` }))
      })
    ).toBeUndefined();
  });

  it('rejects a malformed worker entry (missing keys, extra keys, duplicate slotId)', () => {
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), workers: [{ role: 'worker', personaId: 'w' }] })).toBeUndefined();
    expect(
      sanitizeWorkflowMetadata({
        ...validMetadata(),
        workers: [{ role: 'worker', personaId: 'w', slotId: 's', extra: 1 }]
      })
    ).toBeUndefined();
    // duplicate slotId against the controller's own slotId
    expect(
      sanitizeWorkflowMetadata({
        ...validMetadata(),
        workers: [{ role: 'worker', personaId: 'w', slotId: 'orchestrator:controller' }]
      })
    ).toBeUndefined();
    // duplicate slotId across two workers
    expect(
      sanitizeWorkflowMetadata({
        ...validMetadata(),
        workers: [
          { role: 'worker', personaId: 'w1', slotId: 'dup' },
          { role: 'worker', personaId: 'w2', slotId: 'dup' }
        ]
      })
    ).toBeUndefined();
  });

  it('rejects missing/empty/oversized supportedRequestVersions', () => {
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), supportedRequestVersions: 'nope' })).toBeUndefined();
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), supportedRequestVersions: [] })).toBeUndefined();
    expect(
      sanitizeWorkflowMetadata({ ...validMetadata(), supportedRequestVersions: Array.from({ length: 9 }, (_, i) => i + 1) })
    ).toBeUndefined();
  });

  it('rejects an out-of-range or non-integer supportedRequestVersions entry', () => {
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), supportedRequestVersions: [0] })).toBeUndefined();
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), supportedRequestVersions: [101] })).toBeUndefined();
    expect(sanitizeWorkflowMetadata({ ...validMetadata(), supportedRequestVersions: [1.5] })).toBeUndefined();
  });

  it('dedupes supportedRequestVersions on a successful round trip', () => {
    const result = sanitizeWorkflowMetadata({ ...validMetadata(), supportedRequestVersions: [1, 1, 2] });
    expect(result?.supportedRequestVersions).toEqual([1, 2]);
  });
});

describe('preflightWorkflowProfile', () => {
  it('succeeds for a matching profile/team/persona set', () => {
    const result = preflightWorkflowProfile(validMetadata(), validTeam(), validPersonas());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slots).toEqual([
        { slotId: '0:worker:0', personaId: 'worker', role: 'worker' },
        { slotId: 'orchestrator:controller', personaId: 'controller', role: 'orchestrator' }
      ]);
    }
  });

  it('rejects invalid workflow metadata before touching team/personas', () => {
    const result = preflightWorkflowProfile({ not: 'valid' }, validTeam(), validPersonas());
    expect(result).toEqual({ ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'workflow profile metadata is invalid' });
  });

  it('rejects a profile referencing an unknown persona', () => {
    const result = preflightWorkflowProfile(validMetadata(), validTeam(), [{ id: 'controller', name: 'Controller' }]);
    expect(result).toEqual({
      ok: false,
      code: 'INVALID_WORKFLOW_PROFILE',
      message: 'workflow profile references an unknown persona'
    });
  });

  it('rejects a profile whose slotId does not match any Team slot', () => {
    const metadata = { ...validMetadata(), controller: { personaId: 'controller', slotId: 'no-such-slot' } };
    const result = preflightWorkflowProfile(metadata, validTeam(), validPersonas());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('does not match Team slot');
  });

  it('rejects a mismatched slot (right slotId, wrong personaId)', () => {
    // worker declaration claims the worker slotId but attributes it to the controller persona.
    const metadata = {
      ...validMetadata(),
      workers: [{ role: 'worker', personaId: 'controller', slotId: '0:worker:0' }]
    };
    const result = preflightWorkflowProfile(metadata, validTeam(), validPersonas());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('does not match Team slot');
  });

  it('rejects an incomplete profile that does not cover every Team slot', () => {
    // Team has an extra worker slot the profile never declares.
    const team: Team = {
      ...validTeam(),
      slots: [
        { personaId: 'worker', quantity: 2 },
        { personaId: 'controller', quantity: 1 }
      ]
    };
    const result = preflightWorkflowProfile(validMetadata(), team, validPersonas());
    expect(result).toEqual({
      ok: false,
      code: 'INVALID_WORKFLOW_PROFILE',
      message: 'workflow profile does not cover every Team slot'
    });
  });

  it('rejects duplicate declared slots (profile declares the same slotId twice)', () => {
    const metadata = {
      ...validMetadata(),
      workers: [
        { role: 'worker', personaId: 'worker', slotId: '0:worker:0' },
        { role: 'worker', personaId: 'worker', slotId: '0:worker:0' }
      ]
    };
    // sanitizeWorkflowMetadata itself rejects duplicate worker slotIds up front.
    const result = preflightWorkflowProfile(metadata, validTeam(), validPersonas());
    expect(result).toEqual({ ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'workflow profile metadata is invalid' });
  });
});
