import { describe, it, expect, vi } from 'vitest';
import {
  registerLaunchTeamTool,
  type RegisterLaunchTeamToolOpts
} from '../launch-team-mcp-tool.js';
import type { Result } from '../../shared/types.js';

/**
 * Minimal fake McpServer that captures registered tool handlers so we invoke
 * each directly without an HTTP transport. Mirrors the close-idle-agents test.
 */
type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}>;

function fakeServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _def: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    }
  };
  return { server, tools };
}

function text(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.find((c) => c.type === 'text')?.text ?? '';
}

function makeOpts(over: Partial<RegisterLaunchTeamToolOpts> = {}): RegisterLaunchTeamToolOpts {
  return {
    sessionId: 'caller',
    projectId: 'p1',
    launchTeam: vi.fn(
      (_teamId: string, _projectId?: string): Result<any> => ({
        ok: true,
        value: { launched: 3, cohortId: 'cohort-1', launchRequestId: 'req', workers: [], failedSlots: [] }
      })
    ),
    authorizeTeamLaunch: vi.fn((): Result<import('../../shared/types.js').TeamLaunchAuthorizationResult> => ({
      ok: true, value: { teamId: 'squad', projectId: 'p1', slots: [] }
    })),
    cancelTeamLaunch: vi.fn(() => ({
      ok: true as const,
      value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [], lifecycleState: 'cancel-pending' as const }
    })),
    getTeamLaunch: vi.fn((): Result<unknown> => ({ ok: true, value: { launchRequestId: 'req', workers: [] } })),
    reportTeamTask: vi.fn((): Result<unknown> => ({ ok: true, value: { launchRequestId: 'req' } })),
    validateRouteIdentity: vi.fn(() => true),
    ...over
  };
}

const structuredLaunchArgs = {
  teamId: 'squad',
  launchRequestId: 'request-structured',
  slots: [{
    slotId: '0:builtin:reviewer:0',
    initialTask: 'Review exact bytes',
    authorizationId: 'auth-structured'
  }]
};

describe('registerLaunchTeamTool', () => {
  it('registers the launch_team tool', () => {
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts());
    expect([...tools.keys()]).toEqual([
      'authorize_team_launch', 'launch_team', 'cancel_team_launch', 'get_team_launch', 'report_team_task'
    ]);
  });

  it('cancels only by route-derived principal and rejects stale route identity', async () => {
    const cancelTeamLaunch = vi.fn(() => ({
      ok: true as const,
      value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [], lifecycleState: 'cancel-pending' as const }
    }));
    const validateRouteIdentity = vi.fn(() => true);
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ cancelTeamLaunch, validateRouteIdentity }));

    const result = await tools.get('cancel_team_launch')!({ launchRequestId: 'request-7' });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('caller', 'request-7');
    expect(validateRouteIdentity).toHaveBeenCalledWith('caller', 'p1');
    expect(text(result)).toContain('worker-1');

    validateRouteIdentity.mockReturnValue(false);
    const stale = await tools.get('cancel_team_launch')!({ launchRequestId: 'request-8' });
    expect(stale.isError).toBe(true);
    expect(cancelTeamLaunch).not.toHaveBeenCalledWith('caller', 'request-8');
  });

  it('blocks authorization and launch when the route identity is not live in its project', async () => {
    const authorizeTeamLaunch = vi.fn((): Result<import('../../shared/types.js').TeamLaunchAuthorizationResult> => ({
      ok: true, value: { teamId: 'squad', projectId: 'p1', slots: [] }
    }));
    const launchTeam = vi.fn((): Result<any> => ({ ok: true, value: { launched: 1, cohortId: 'cohort-1' } }));
    const validateRouteIdentity = vi.fn(() => false);
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ authorizeTeamLaunch, launchTeam, validateRouteIdentity }));

    const authorization = await tools.get('authorize_team_launch')!({
      teamId: 'squad', slots: [{ initialTask: 'Review exact bytes' }]
    });
    const launch = await tools.get('launch_team')!({ teamId: 'squad' });

    expect(authorization.isError).toBe(true);
    expect(text(authorization)).toContain('originating session is not live in this project');
    expect(launch.isError).toBe(true);
    expect(text(launch)).toContain('originating session is not live in this project');
    expect(validateRouteIdentity).toHaveBeenCalledTimes(2);
    expect(validateRouteIdentity).toHaveBeenNthCalledWith(1, 'caller', 'p1');
    expect(validateRouteIdentity).toHaveBeenNthCalledWith(2, 'caller', 'p1');
    expect(authorizeTeamLaunch).not.toHaveBeenCalled();
    expect(launchTeam).not.toHaveBeenCalled();

    validateRouteIdentity.mockReturnValue(true);
    const validAuthorization = await tools.get('authorize_team_launch')!({
      teamId: 'squad', slots: [{ initialTask: 'Review exact bytes' }]
    });
    const validLaunch = await tools.get('launch_team')!(structuredLaunchArgs);

    expect(validAuthorization.isError).toBeFalsy();
    expect(validLaunch.isError).toBeFalsy();
    expect(authorizeTeamLaunch).toHaveBeenCalledOnce();
    expect(launchTeam).toHaveBeenCalledOnce();
  });

  it('preauthorizes route-bound request policy and per-slot tasks', async () => {
    const authorizeTeamLaunch = vi.fn(() => ({ ok: true, value: {
      teamId: 'squad', projectId: 'p1', slots: [
        { slotId: '0:builtin:reviewer:0', personaId: 'builtin:reviewer', initialTask: 'Review exact bytes', authorizationId: 'auth-real-1' }
      ]
    } }) as const);
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ authorizeTeamLaunch } as never));

    const res = await tools.get('authorize_team_launch')!({
      teamId: 'squad', launchRequestId: 'request-1', deadlineMs: 5_000,
      slots: [{ initialTask: 'Review exact bytes' }]
    });

    expect(authorizeTeamLaunch).toHaveBeenCalledWith(
      'caller', 'squad', 'p1', 'request-1', { deadlineMs: 5_000 }, [{ initialTask: 'Review exact bytes' }]
    );
    expect(text(res)).toContain('auth-real-1');
    expect(text(res)).toContain('0:builtin:reviewer:0');
  });

  it('defaults the structured launch project to the caller’s own when none is supplied', async () => {
    const launchTeam = vi.fn(() => ({ ok: true, value: { launched: 2, cohortId: 'c' } }) as const);
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ launchTeam }));
    await tools.get('launch_team')!(structuredLaunchArgs);
    expect(launchTeam).toHaveBeenCalledWith('squad', 'p1', expect.objectContaining({
      callerPrincipalId: 'caller', launchRequestId: 'request-structured', requirePreauthorization: true
    }));
  });

  it('rejects an explicit projectId outside the caller route', async () => {
    const launchTeam = vi.fn(() => ({ ok: true, value: { launched: 1, cohortId: 'c' } }) as const);
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ launchTeam }));
    const result = await tools.get('launch_team')!({ teamId: 'squad', projectId: 'p2' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('cross-project launches are not allowed');
    expect(launchTeam).not.toHaveBeenCalled();
  });

  it('rejects cross-project authorization before issuing slot capabilities', async () => {
    const authorizeTeamLaunch = vi.fn();
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ authorizeTeamLaunch }));

    const result = await tools.get('authorize_team_launch')!({
      teamId: 'squad', projectId: 'p2', launchRequestId: 'request-cross-project',
      slots: [{ initialTask: 'Review exact bytes' }]
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('cross-project launches are not allowed');
    expect(authorizeTeamLaunch).not.toHaveBeenCalled();
  });

  it('rejects bare cohort-only launch and directs the caller through authorization', async () => {
    const { server, tools } = fakeServer();
    const launchTeam = vi.fn();
    registerLaunchTeamTool(server as never, makeOpts({ launchTeam }));
    const res = await tools.get('launch_team')!({ teamId: 'squad' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('call authorize_team_launch first');
    expect(launchTeam).not.toHaveBeenCalled();
  });

  it('surfaces a launch failure as an error result', async () => {
    const launchTeam = vi.fn(
      () => ({ ok: false, code: 'NOT_FOUND', message: 'team not found: ghost' }) as const
    );
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ launchTeam }));
    const res = await tools.get('launch_team')!({ ...structuredLaunchArgs, teamId: 'ghost' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('team not found: ghost');
  });

  it('explains a zero-tab launch (no slot personas resolved)', async () => {
    const launchTeam = vi.fn(
      () => ({ ok: true, value: { launched: 0, cohortId: 'c' } }) as const
    );
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ launchTeam }));
    const res = await tools.get('launch_team')!(structuredLaunchArgs);
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(text(res))).toMatchObject({ launched: 0, cohortId: 'c' });
  });

  it('errors when there is no originating session', async () => {
    const launchTeam = vi.fn();
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ sessionId: undefined, launchTeam }));
    const res = await tools.get('launch_team')!(structuredLaunchArgs);
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('no originating session');
    expect(launchTeam).not.toHaveBeenCalled();
  });

  it('forwards caller identity, launchRequestId, and bounded per-slot tasks', async () => {
    const launchTeam = vi.fn((): Result<any> => ({ ok: true, value: {
      launched: 1, cohortId: 'c', launchRequestId: 'req-7',
      workers: [{ sessionId: 'worker-1', slotId: 'builtin:reviewer:0', personaId: 'builtin:reviewer' }], failedSlots: []
    } }));
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ launchTeam }));
    const res = await tools.get('launch_team')!({
      teamId: 'squad', launchRequestId: 'req-7', deadlineMs: 5_000,
      slots: [{ slotId: 'builtin:reviewer:0', initialTask: 'Review this change', authorizationId: 'auth-real-7' }]
    });
    expect(launchTeam).toHaveBeenCalledWith('squad', 'p1', {
      callerPrincipalId: 'caller', launchRequestId: 'req-7', policy: { deadlineMs: 5_000 }, requirePreauthorization: true,
      slots: [{ slotId: 'builtin:reviewer:0', initialTask: 'Review this change', authorizationId: 'auth-real-7' }]
    });
    expect(text(res)).toContain('worker-1');
    expect(() => JSON.parse(text(res))).not.toThrow();
  });

  it('reads lifecycle and reports task outcome using route-derived caller identity', async () => {
    const getTeamLaunch = vi.fn((): Result<unknown> => ({ ok: true, value: { launchRequestId: 'req-8' } }));
    const reportTeamTask = vi.fn((): Result<unknown> => ({ ok: true, value: { task: 'caller-reported-complete' } }));
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ getTeamLaunch, reportTeamTask }));

    const status = await tools.get('get_team_launch')!({ launchRequestId: 'req-8' });
    const reported = await tools.get('report_team_task')!({ launchRequestId: 'req-8', slotId: 'slot-1', outcome: 'complete' });

    expect(getTeamLaunch).toHaveBeenCalledWith('caller', 'req-8');
    expect(reportTeamTask).toHaveBeenCalledWith('caller', 'req-8', 'slot-1', 'complete');
    expect(JSON.parse(text(status))).toMatchObject({ launchRequestId: 'req-8' });
    expect(JSON.parse(text(reported))).toMatchObject({ task: 'caller-reported-complete' });
  });

  it('reports failed slots in output', async () => {
    const launchTeam = vi.fn((): Result<any> => ({ ok: true, value: {
      launched: 1, cohortId: 'c', launchRequestId: 'req', workers: [{ sessionId: 'worker-1' }],
      failedSlots: [{ slotId: 'slot-2', personaId: 'ghost', reason: 'unknown persona' }]
    } }));
    const { server, tools } = fakeServer();
    registerLaunchTeamTool(server as never, makeOpts({ launchTeam }));
    const res = await tools.get('launch_team')!(structuredLaunchArgs);
    expect(text(res)).toContain('worker-1');
    expect(text(res)).toContain('slot-2');
    expect(text(res)).toContain('unknown persona');
  });
});
