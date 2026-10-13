import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The terminal IPC handlers moved to apps/desktop/src/ipc/terminals.ts and the
// launch/terminate helpers to apps/desktop/src/host.ts in the monorepo split.
const terminalsSource = readFileSync(
  new URL('../../../desktop/src/ipc/terminals.ts', import.meta.url),
  'utf8'
);
// Capability restore/reconnect launch logic was extracted from ipc/terminals.ts.
const restoreLaunchSource = readFileSync(
  new URL('../../../desktop/src/terminal-restore-launch.ts', import.meta.url),
  'utf8'
);
const hostSource = readFileSync(
  new URL('../../../desktop/src/host.ts', import.meta.url),
  'utf8'
);

describe('restore/reconnect trust boundary', () => {
  it('routes capability-backed restore and reconnect through authorization coordinator', () => {
    const handlers = terminalsSource.slice(
      terminalsSource.indexOf('IPC.terminals.restore,'),
      terminalsSource.indexOf('IPC.terminals.write,')
    );
    const launcher = restoreLaunchSource;
    expect(handlers).not.toContain('createTerminalConfined(');
    expect(terminalsSource).not.toContain('createTerminalConfined(');
    expect(launcher).not.toContain('createTerminalConfined(');
    // Legacy-confirmed restore calls the coordinator directly; capability-backed
    // restore/reconnect delegate to the extracted launcher, which reaches the
    // coordinator only through the single ctx.launchAuthorizedTerminal adapter.
    expect(handlers.match(/launchAuthorizedTerminal\(/g)).toHaveLength(1);
    expect(handlers.match(/restoreCapabilityLaunch\(/g)).toHaveLength(1);
    expect(handlers.match(/reconnectCapabilityLaunch\(/g)).toHaveLength(1);
    expect(handlers.match(/launch: launchRestoredTerminal/g)).toHaveLength(2);
    expect(terminalsSource.match(/ctx\.launchAuthorizedTerminal\(/g)).toHaveLength(2);
    expect(launcher.match(/opts\.launch\(/g)).toHaveLength(2);
    expect(handlers).not.toContain('restoreCapabilities.take');
    expect(handlers.match(/restoreCapabilities\.reserve/g)).toHaveLength(3);
    expect(handlers).not.toContain('confirmRendererRestore(');
    expect(handlers).toContain('restoreCapabilities.findExitedSession');
    expect(handlers).not.toContain('input.legacy.remoteTmuxId');
    expect(handlers).toContain('legacy reconnect target not found or identity mismatch');
    expect(handlers.match(/reservations: ctx\.restoreCapabilities/g)).toHaveLength(2);
    expect(launcher).toContain('reservations.consume(');
    expect(launcher).toContain('reservations.release(');
    expect(launcher).toContain('preallocatedSessionId: capability.sessionId');
    expect(launcher.match(/capability\.followUpExecutionId/g)).toHaveLength(5);
    expect(launcher.match(/retainWorktree: Boolean\(capability\.followUpExecutionId\)/g)).toHaveLength(2);
    expect(handlers).not.toContain('maySpawn:');
    expect(launcher).not.toContain('maySpawn');
    expect(handlers).toContain('restore capability unavailable or already reserved');
    expect(handlers).toContain('restorePrincipal(capability)');
    expect(launcher).toContain('opts.restorePrincipal(capability)');
    expect(launcher).toContain('capability.request.cohort?.teamId');
    expect(handlers).toContain('reconnect capability unavailable or already reserved');
  });

  it('removes restore authority and cleanly terminates sessions on explicit close', () => {
    const close = terminalsSource.slice(
      terminalsSource.indexOf('IPC.terminals.close,'),
      terminalsSource.indexOf('IPC.terminals.backlog,')
    );
    expect(close).toContain('(id: string) => ctx.terminateSession(id)');
    const terminate = hostSource.slice(
      hostSource.indexOf('async function terminateSession('),
      hostSource.indexOf('const teamLifecycleIntegration')
    );
    expect(terminate).toContain('restoreCapabilities.removeSession(sessionId)');
    expect(terminate).toContain('await ptys.killRemoteTmux(sessionId)');
    expect(terminate).toContain('ptys.closeExpected(sessionId)');
    expect(terminate).toContain('await killLocalTmuxSession(sessionId)');
  });

  it('resolves framework persona before immutable preflight and snapshots it for spawn', () => {
    const launch = hostSource.slice(
      hostSource.indexOf('async function launchAuthorizedTerminal('),
      hostSource.indexOf('/** Interactive renderer launch')
    );
    expect(launch.indexOf('resolveFrameworkPersona(')).toBeLessThan(launch.indexOf('preflightLaunch('));
    expect(launch).toContain('frameworkPersona: authorizedPlan.resolved.frameworkPersona');
  });

  it('keeps restore ownership metadata separate from callback lifecycle gates', () => {
    const launch = hostSource.slice(
      hostSource.indexOf('async function launchAuthorizedTerminal('),
      hostSource.indexOf('/** Interactive renderer launch')
    );
    expect(launch).toContain('followUpExecutionId?: string');
    expect(launch).toContain('beforeSpawn: spawnLifecycle?.maySpawn');
    expect(launch).toContain('afterSpawn: spawnLifecycle?.claimRunning');
    expect(launch).toContain('followUpExecutionId,');
    expect(launch).not.toContain('spawnLifecycle?.followUpExecutionId');
  });

});
