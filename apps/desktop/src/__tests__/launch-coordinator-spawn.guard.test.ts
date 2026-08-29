import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('launch coordinator production spawn guard', () => {
  it('keeps direct PtyManager.create callsites limited to the coordinator bridge', () => {
    const files = [
      'apps/desktop/src/host.ts',
      'apps/server/src/services/scheduler/scheduler.ts',
      'apps/server/src/services/goals/goal-manager.ts',
      'apps/server/src/services/suggestions/run-suggestion.ts',
      'apps/desktop/src/control/control-plane.ts'
    ];
    const direct = files.flatMap((file) => {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      return [...text.matchAll(/\b(?:this\.deps\.)?ptys\.create\s*\(/g)].map((match) => `${file}:${text.slice(0, match.index).split('\n').length}`);
    });
    expect(direct).toEqual([
      expect.stringMatching(/^apps\/desktop\/src\/host\.ts:/),
      expect.stringMatching(/^apps\/desktop\/src\/host\.ts:/)
    ]);
  });

  it('keeps new-launch callers on main authorization seams', () => {
    const text = [
      'apps/desktop/src/host.ts',
      'apps/desktop/src/ipc/inbox.ts',
      'apps/desktop/src/ipc/personas.ts',
      'apps/desktop/src/control/control-plane.ts'
    ].map((file) => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');
    for (const principal of [
      'interactive:local',
      'restore:${capability.id}',
      'control-plane:operator',
      'suggestion:${id}',
      'team:${team.id}:${callerPrincipalId}:${launchRequestId}',
      'team:${team.id}:${cohortId}'
    ]) expect(text).toContain(principal);
    expect(text).toContain('launchLedger.reconcileStartup({');
    expect(text).toContain("launchLedger.transition(ledgerEntryId, 'exited')");
    expect(text).toContain('scope: project.remote ? \'remote\' : \'local\'');
    expect(text).toContain('await launchLedger.reconcileStartup({');
    expect(text).toContain('reapOrphanTmuxSessions((sessionId) => ptys.getSession(sessionId) !== null)');
    expect(text).toContain('restoreCapabilities.removeSession(sessionId)');
    expect(text).toContain('teamLifecycleIntegration.reconcileStartup([...recovered])');
  });
});
