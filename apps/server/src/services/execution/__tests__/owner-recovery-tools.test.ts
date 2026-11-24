import { describe, expect, it, vi } from 'vitest';
import { EXECUTION_MEMBER_TOOL_NAMES, registerExecutionTools } from '../execution-mcp-tool.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>;
const text = (reply: { content: Array<{ text?: string }> }) => reply.content[0].text ?? '';

function build(opts: { owner?: boolean; member?: boolean } = {}) {
  const tools = new Map<string, Handler>();
  const service = {
    restartSlotAsOwner: vi.fn(async () => ({ ok: true as const, value: { slotId: 's', sessionId: 'n', mode: 'restarted' as const, sessionLive: true as const } })),
    releaseUnitAsOwner: vi.fn(async () => ({ ok: true as const, value: { stateVersion: 9 } })),
    respondToSlotAsOwner: vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'RUNNING' }, sessionLive: true, restarted: 'respawned' as const })),
    blockerSlotLive: vi.fn(async () => false),
    respondToHumanBlockerAsOwner: vi.fn(async () => ({ ok: true as const, value: { stateVersion: 3, state: 'RUNNING' } }))
  };
  registerExecutionTools({ registerTool: (name: string, _d: unknown, handler: Handler) => { tools.set(name, handler); } } as never, {
    sessionId: 'thread-1', projectId: 'project-1', service: service as never,
    validateRouteIdentity: () => true,
    validateOwnerRouteIdentity: async () => opts.owner !== false,
    ...(opts.member ? { memberFence: { bindingId: 'b', generation: 1 }, resolveCohortBinding: () => ({ executionId: 'execution-1', projectId: 'project-1', slotId: 's', role: 'worker', memberFence: { bindingId: 'b', generation: 1 } }) } : {})
  } as never);
  return { tools, service };
}

describe('owner recovery tools', () => {
  it('are owner tools only: never in the worker or coordinator member catalogues', () => {
    for (const name of ['execution.slot_restart', 'execution.unit_release']) {
      expect(EXECUTION_MEMBER_TOOL_NAMES.worker).not.toContain(name);
      expect(EXECUTION_MEMBER_TOOL_NAMES.orchestrator).not.toContain(name);
    }
  });

  it('slot_restart and unit_release run for the owner and pass the host-resolved session, not caller input', async () => {
    const { tools, service } = build();
    const restart = await tools.get('execution.slot_restart')!({ executionId: 'execution-1', slotId: 's' });
    expect(JSON.parse(text(restart))).toMatchObject({ slotId: 's', sessionLive: true });
    expect(service.restartSlotAsOwner).toHaveBeenCalledWith('thread-1', 'project-1', 'execution-1', 's');
    const released = await tools.get('execution.unit_release')!({ executionId: 'execution-1', workUnitId: 'a' });
    expect(JSON.parse(text(released))).toEqual({ executionId: 'execution-1', workUnitId: 'a', state: 'READY', stateVersion: 9 });
    expect(service.releaseUnitAsOwner).toHaveBeenCalledWith('thread-1', 'project-1', 'execution-1', 'a');
  });

  it('a non-owner route is denied without reaching the service, and a member route does not get the tools at all', async () => {
    const ctx = build({ owner: false });
    for (const [name, args] of [['execution.slot_restart', { executionId: 'execution-1', slotId: 's' }], ['execution.unit_release', { executionId: 'execution-1', workUnitId: 'a' }]] as const) {
      const reply = await ctx.tools.get(name)!(args);
      expect(reply.isError).toBe(true);
      expect(text(reply)).toContain('not authorized');
    }
    expect(ctx.service.restartSlotAsOwner).not.toHaveBeenCalled();
    expect(ctx.service.releaseUnitAsOwner).not.toHaveBeenCalled();
    const member = build({ member: true });
    expect(member.tools.has('execution.slot_restart')).toBe(false);
    expect(member.tools.has('execution.unit_release')).toBe(false);
  });

  it('surfaces service refusals with their code', async () => {
    const { tools, service } = build();
    service.restartSlotAsOwner.mockResolvedValueOnce({ ok: false, code: 'RATE_LIMITED', message: 'wait 30s' } as never);
    service.releaseUnitAsOwner.mockResolvedValueOnce({ ok: false, code: 'INVALID', message: 'work unit is ready, not claimed' } as never);
    expect(text(await tools.get('execution.slot_restart')!({ executionId: 'execution-1', slotId: 's' }))).toBe('execution.slot_restart failed: RATE_LIMITED: wait 30s');
    expect(text(await tools.get('execution.unit_release')!({ executionId: 'execution-1', workUnitId: 'a' }))).toBe('execution.unit_release failed: INVALID: work unit is ready, not claimed');
  });

  it('execution.respond with slotId returns sessionLive and any restart; a failed restart says sessionLive false', async () => {
    const { tools, service } = build();
    const ok = await tools.get('execution.respond')!({ executionId: 'execution-1', expectedStateVersion: 1, slotId: 's', message: 'go' });
    expect(JSON.parse(text(ok))).toMatchObject({ mode: 'compact', executionId: 'execution-1', sessionLive: true, restarted: 'respawned' });
    expect(service.respondToSlotAsOwner).toHaveBeenCalledWith('thread-1', 'project-1', 'execution-1', 1, 's', 'go');
    service.respondToSlotAsOwner.mockResolvedValueOnce({ ok: false, code: 'RESTART_FAILED', message: 'dead', sessionLive: false } as never);
    expect(text(await tools.get('execution.respond')!({ executionId: 'execution-1', expectedStateVersion: 1, slotId: 's', message: 'go' }))).toBe('execution.respond failed: dead (sessionLive: false)');
  });

  it('a blocker answer includes sessionLive of the blocked slot when known', async () => {
    const { tools, service } = build();
    const reply = await tools.get('execution.respond')!({ executionId: 'execution-1', blockerId: 'b1', message: 'Atlas' });
    expect(JSON.parse(text(reply))).toMatchObject({ blockerId: 'b1', sessionLive: false });
    service.blockerSlotLive.mockResolvedValueOnce(undefined as never);
    expect(JSON.parse(text(await tools.get('execution.respond')!({ executionId: 'execution-1', blockerId: 'b1', message: 'Atlas' })))).not.toHaveProperty('sessionLive');
    service.blockerSlotLive.mockRejectedValueOnce(new Error('x'));
    expect((await tools.get('execution.respond')!({ executionId: 'execution-1', blockerId: 'b1', message: 'Atlas' })).isError).toBeFalsy();
  });
});
