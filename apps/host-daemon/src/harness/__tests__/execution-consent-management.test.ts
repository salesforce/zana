import { describe, expect, it, vi } from 'vitest';
import type { ExecutionConsentGrant } from '../execution-consent-store.js';
import { createExecutionConsentManagement } from '../execution-consent-management.js';

const baseGrant: ExecutionConsentGrant = {
  id: 'project-grant',
  scope: 'project',
  adapterId: 'codex',
  targetId: 'codex.execution.accept-edits',
  targetDigest: 'target',
  evidenceDigest: 'evidence',
  projectId: 'p1',
  launchScope: 'local',
  createdAt: 100
};

describe('execution consent management', () => {
  it('lists only active grants bound to the authorized project', async () => {
    const grants: ExecutionConsentGrant[] = [
      baseGrant,
      { ...baseGrant, id: 'other-project', projectId: 'p2' },
      { ...baseGrant, id: 'revoked', revokedAt: 150 },
      { ...baseGrant, id: 'expired', expiresAt: 199 }
    ];
    const store = {
      list: vi.fn(async () => ({ grants })),
      revokeProject: vi.fn()
    };
    const management = createExecutionConsentManagement({
      store,
      projectExists: (id) => id === 'p1',
      now: () => 200
    });

    expect(await management.listProjectGrants('p1')).toEqual([{
      id: 'project-grant',
      adapterId: 'codex',
      targetId: 'codex.execution.accept-edits',
      launchScope: 'local',
      createdAt: 100
    }]);
    await expect(management.listProjectGrants('forged')).rejects.toThrow('project not found');
  });

  it('revalidates project ownership and scope before durable revoke', async () => {
    let grants = [baseGrant];
    const store = {
      list: vi.fn(async () => ({ grants })),
      revokeProject: vi.fn(async () => { grants = []; return true; })
    };
    const management = createExecutionConsentManagement({
      store,
      projectExists: (id) => id === 'p1' || id === 'p2'
    });

    await expect(management.revokeProjectGrant('p2', baseGrant.id)).rejects.toThrow('grant not found');
    expect(store.revokeProject).not.toHaveBeenCalled();

    const remaining = await management.revokeProjectGrant('p1', baseGrant.id);
    expect(store.revokeProject).toHaveBeenCalledWith(baseGrant.id, 'p1');
    expect(remaining).toEqual([]);
  });

});
