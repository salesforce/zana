import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

describe('restore/reconnect trust boundary', () => {
  it('routes capability-backed restore and reconnect through authorization coordinator', () => {
    const handlers = source.slice(
      source.indexOf('IPC.terminals.restore,'),
      source.indexOf('IPC.terminals.write,')
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
    const close = source.slice(
      source.indexOf('IPC.terminals.close,'),
      source.indexOf('IPC.terminals.backlog,')
    );
    expect(close).toContain('(id: string) => terminateSession(id)');
    const terminate = source.slice(
      source.indexOf('async function terminateSession('),
      source.indexOf('const teamLifecycleIntegration')
    );
    expect(terminate).toContain('restoreCapabilities.removeSession(sessionId)');
    expect(terminate).toContain('await ptys.killRemoteTmux(sessionId)');
    expect(terminate).toContain('ptys.closeExpected(sessionId)');
    expect(terminate).toContain('await killLocalTmuxSession(sessionId)');
  });

  it('resolves framework persona before immutable preflight and snapshots it for spawn', () => {
    const launch = source.slice(
      source.indexOf('async function launchAuthorizedTerminal('),
      source.indexOf('/** Interactive renderer launch')
    );
    expect(launch.indexOf('resolveFrameworkPersona(')).toBeLessThan(launch.indexOf('preflightLaunch('));
    expect(launch).toContain('frameworkPersona: authorizedPlan.resolved.frameworkPersona');
  });

});
