import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('launch coordinator production spawn guard', () => {
  it('keeps direct PtyManager.create callsites limited to the coordinator bridge', () => {
    const root = join(process.cwd(), 'src/main');
    const sources = ['index.ts', 'scheduler.ts', 'goal-manager.ts', 'run-suggestion.ts', 'control-plane.ts'];
    const direct = sources.flatMap((file) => {
      const text = readFileSync(join(root, file), 'utf8');
      return [...text.matchAll(/\b(?:this\.deps\.)?ptys\.create\s*\(/g)].map((match) => `${file}:${text.slice(0, match.index).split('\n').length}`);
    });
    expect(direct).toEqual([
      expect.stringMatching(/^index\.ts:/),
      expect.stringMatching(/^index\.ts:/)
    ]);
  });

  it('keeps new-launch callers on main authorization seams', () => {
    const text = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8');
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
    const bootstrapStart = text.indexOf('async function bootstrapNormal()');
    const bootstrapSetup = text.slice(bootstrapStart, text.indexOf('// Arm the e2e observability tap FIRST', bootstrapStart));
    expect(bootstrapSetup).toMatch(
      /try \{[\s\S]*try \{[\s\S]*await launchLedger\.reconcileStartup\(\{[\s\S]*\}\);[\s\S]*\} finally \{[\s\S]*await squadExecutionService\.restoreDeadlines\(\);[\s\S]*\}[\s\S]*\} catch \(error\) \{[\s\S]*normalBootstrapStarted = false;[\s\S]*throw error;[\s\S]*\}/
    );
  });
});
