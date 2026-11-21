import { describe, expect, it, vi } from 'vitest';
import { EXECUTION_MEMBER_TOOL_NAMES, registerExecutionTools } from '../execution-mcp-tool.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>;

function build(role: 'orchestrator' | 'worker', respawnWorker = vi.fn(async () => ({ ok: true, value: { slotId: 's', sessionId: 'n', respawn: 1, cap: 2 } }))) {
  const tools = new Map<string, Handler>();
  const server = { registerTool: (name: string, _d: unknown, handler: Handler) => { tools.set(name, handler); } };
  registerExecutionTools(server as never, {
    sessionId: 'pm', projectId: 'project-1', service: { respawnWorker } as never, validateRouteIdentity: () => true,
    resolveCohortBinding: () => ({ executionId: 'execution-1', projectId: 'project-1', slotId: role === 'orchestrator' ? 'orchestrator:lead' : 's', role })
  });
  return { tools, respawnWorker };
}

describe('execution.worker.respawn tool', () => {
  it('is in the orchestrator member catalogue only', () => {
    expect(EXECUTION_MEMBER_TOOL_NAMES.orchestrator).toContain('execution.worker.respawn');
    expect(EXECUTION_MEMBER_TOOL_NAMES.worker).not.toContain('execution.worker.respawn');
  });

  it('runs for the orchestrator', async () => {
    const { tools, respawnWorker } = build('orchestrator');
    const reply = await tools.get('execution.worker.respawn')!({ executionId: 'execution-1', slotId: 's' });
    expect(reply.isError).toBeUndefined();
    expect(respawnWorker).toHaveBeenCalledWith(expect.objectContaining({ role: 'orchestrator' }), 's');
  });

  it('denies a worker-role caller without reaching the service', async () => {
    const { tools, respawnWorker } = build('worker');
    const reply = await tools.get('execution.worker.respawn')!({ executionId: 'execution-1', slotId: 's' });
    expect(reply.isError).toBe(true);
    expect(respawnWorker).not.toHaveBeenCalled();
  });
});
