import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import {
  relaunchSquadWorker,
  type SquadWorkerRestartDeps
} from '../../apps/desktop/src/squad-worker-restart.js';

for (const targetKind of ['worktree', 'project-root'] as const) {
  it(`relaunches an unchanged user-owned ${targetKind} through its native restore capability`, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'squad-restart-target-')));
    const path = targetKind === 'project-root' ? root : join(root, '.worktrees', 'user-owned');
    mkdirSync(path, { recursive: true });
    const cohort = { cohortId: 'cohort', teamId: 'team', role: 'worker', executionId: 'execution', slotId: 'worker' };
    const session = { id: 'same-worker-session', projectId: 'project', profile: 'claude', cwd: path,
      status: 'running', restoreCapabilityId: 'capability', cohort };
    const request = { projectId: 'project', profile: 'claude', resumeSessionId: 'native-conversation', cohort };
    let launched: unknown;
    const deps = {
      getSession: () => session,
      getProject: () => ({ path: root }),
      resolveUserTarget: async () => ({ path, branch: 'main', targetKind }),
      getExecution: async () => ({ coordinationMode: 'structured', request: {
        target: targetKind === 'project-root' ? { kind: 'project-root' } : { kind: 'worktree', branch: 'main' }
      }, squadWorktree: { path, branch: 'main', ownership: 'user', targetKind } }),
      teamLaunchEnabled: () => false,
      restoreCapabilities: {
        reserve: () => ({ capability: { id: 'capability', sessionId: session.id, request }, reservationId: 'reservation' }),
        consume: () => undefined,
        release: () => undefined
      },
      followUp: { claim: async () => undefined, release: async () => undefined, isClaimed: () => false },
      restorePrincipal: () => ({ kind: 'team', id: 'restore:capability' }),
      isTeamWorkerRestore: () => true,
      launchAuthorizedTerminal: async (restoredRequest: unknown, _principal: unknown, spawnOptions: unknown) => {
        launched = { request: restoredRequest, spawnOptions };
        return { ok: true, value: session };
      }
    } as unknown as SquadWorkerRestartDeps;
    try {
      const result = await relaunchSquadWorker(deps, session as never);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual(launched, {
        request: { ...request, worktreeInfo: { path, branch: 'main' } },
        spawnOptions: { preallocatedSessionId: session.id, retainWorktree: false,
          coordinationMode: 'structured', autonomous: false, suppressPersonaInitialPrompt: true, tabNamerPrompt: null }
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
