import { describe, expect, it } from 'vitest';
import { buildSquadBundle, preflightWorkflowProfile, sanitizeWorkflowMetadata, validateSquadBundle } from '../squad-bundle.js';

const team = {
  id: 'team-1', name: 'Release Squad', orchestratorPersonaId: 'controller',
  slots: [{ personaId: 'worker' }]
};
const personas = [
  { id: 'controller', name: 'Controller' },
  { id: 'worker', name: 'Worker' }
];
const workflow = {
  schemaVersion: 1 as const,
  profileId: 'release-workflow',
  profileVersion: '1.0.0',
  controller: { personaId: 'controller', slotId: 'orchestrator:controller' },
  workers: [{ role: 'builder', personaId: 'worker', slotId: '0:worker:0' }],
  supportedRequestVersions: [1]
};

describe('squad bundle workflow metadata', () => {
  it('keeps legacy v1 bundles valid without workflow metadata', () => {
    expect(validateSquadBundle({ kind: 'zcc-squad-bundle', version: 1, team, personas })).toMatchObject({ team: { id: 'team-1' }, personas: [{ id: 'controller' }, { id: 'worker' }] });
  });

  it('round-trips valid workflow metadata without adding runtime authority', () => {
    const bundle = buildSquadBundle(team as any, personas as any, workflow);
    expect(bundle.workflow).toEqual(workflow);
    expect(validateSquadBundle(bundle)).toMatchObject({ workflow });
  });

  it('drops malformed metadata while importing valid Team and personas', () => {
    const validated = validateSquadBundle({
      kind: 'zcc-squad-bundle', version: 1, team, personas,
      workflow: { ...workflow, workers: [{ role: 'builder', personaId: 'worker', slotId: 'orchestrator:controller' }] }
    });
    expect(validated).toMatchObject({ team: { id: 'team-1' } });
    expect('workflow' in validated && validated.workflow).toBeFalsy();
  });

  it('rejects unsupported bundle versions and malformed workflow schema', () => {
    expect(validateSquadBundle({ kind: 'zcc-squad-bundle', version: 2, team, personas })).toEqual({ error: 'unsupported bundle version: 2' });
    expect(sanitizeWorkflowMetadata({ ...workflow, schemaVersion: 2 })).toBeUndefined();
  });

  it('requires exact current Team slots and personas for workflow preflight', () => {
    expect(preflightWorkflowProfile(workflow, team as any, personas as any)).toMatchObject({ ok: true, slots: [
      { slotId: '0:worker:0', role: 'worker' }, { slotId: 'orchestrator:controller', role: 'orchestrator' }
    ] });
    expect(preflightWorkflowProfile({ ...workflow, controller: { personaId: 'worker', slotId: '0:worker:0' }, workers: [] }, team as any, personas as any)).toMatchObject({ ok: false, message: expect.stringContaining('does not match') });
    expect(preflightWorkflowProfile({ ...workflow, workers: [] }, team as any, personas as any)).toMatchObject({ ok: false, message: expect.stringContaining('cover every') });
    expect(preflightWorkflowProfile(workflow, team as any, [personas[0]] as any)).toMatchObject({ ok: false, message: expect.stringContaining('unknown persona') });
  });
});
