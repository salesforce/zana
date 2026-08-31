import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The terminal IPC handlers moved to apps/desktop/src/ipc/terminals.ts and the
// launch/terminate helpers to apps/desktop/src/host.ts in the monorepo split.
const terminalsSource = readFileSync(
  new URL('../../../desktop/src/ipc/terminals.ts', import.meta.url),
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
    expect(handlers).not.toContain('createTerminalConfined(');
    expect(handlers.match(/launchAuthorizedTerminal\(/g)).toHaveLength(3);
    expect(handlers).not.toContain('restoreCapabilities.take');
    expect(handlers.match(/restoreCapabilities\.reserve/g)).toHaveLength(3);
    expect(handlers).not.toContain('confirmRendererRestore(');
    expect(handlers).toContain('restoreCapabilities.findExitedSession');
    expect(handlers).not.toContain('input.legacy.remoteTmuxId');
    expect(handlers).toContain('legacy reconnect target not found or identity mismatch');
    expect(handlers).toContain('restoreCapabilities.consume');
    expect(handlers).toContain('restoreCapabilities.release');
    expect(handlers).toContain('{ preallocatedSessionId: capability.sessionId }');
    expect(handlers).toContain('restore capability unavailable or already reserved');
    expect(handlers).toContain('restorePrincipal(capability)');
    expect(handlers).toContain('capability.request.cohort?.teamId');
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

});
