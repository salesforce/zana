import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerExecutionTools } from '../execution-mcp-tool.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>;

function fakeServer() {
  const tools = new Map<string, ToolHandler>();
  return {
    server: { registerTool: (name: string, _definition: { inputSchema?: Record<string, z.ZodTypeAny> }, handler: ToolHandler) => { tools.set(name, handler); } },
    tools
  };
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

// 20 work units with long results: today's reply serialises all of them.
const bigRecord = {
  id: 'execution-1',
  state: 'BLOCKED',
  deliveries: [],
  workUnits: Array.from({ length: 20 }, (_, index) => ({ id: `unit-${index}`, state: 'COMPLETED', result: `RESULT-${index}-${'x'.repeat(2000)}` }))
};
const delivery = { id: 'delivery-9', state: 'PENDING', blockerId: 'b1', payload: { text: 'the coordinator answer text' } };
const success = { ok: true as const, pending: true as const, notified: true, delivery, value: bigRecord, resumeRequested: true };
const EXPECTED_RECEIPT = {
  ok: true, executionId: 'execution-1', blockerId: 'b1', deliveryId: 'delivery-9',
  pending: true, notified: true, resumeRequested: true, state: 'BLOCKED'
};

function setup(answerResult: unknown = success) {
  const service = { answerBlockerByCoordinator: vi.fn(async () => answerResult) };
  const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator', role: 'orchestrator' as const };
  const { server, tools } = fakeServer();
  registerExecutionTools(server as never, { sessionId: 'pm', projectId: 'project-1', service: service as never, validateRouteIdentity: () => true, resolveCohortBinding: () => binding });
  return { service, tools };
}

const input = { executionId: 'execution-1', blockerId: 'b1', answer: 'Use the second interface.' };
const answer = (tools: Map<string, ToolHandler>, args: Record<string, unknown> = input) => tools.get('execution.work.answer')!(args);

describe('execution.work.answer receipt (#691)', () => {
  it('REQ-1: returns the compact receipt, not the record', async () => {
    const { tools, service } = setup();
    const reply = await answer(tools);
    expect(reply.isError).toBeUndefined();
    expect(service.answerBlockerByCoordinator).toHaveBeenCalledTimes(1);
    expect(JSON.parse(text(reply))).toEqual(EXPECTED_RECEIPT);
  });

  it('REQ-1: carries no work-unit list or other unit result', async () => {
    const { tools } = setup();
    const body = text(await answer(tools));
    expect(body).not.toContain('workUnits');
    expect(body).not.toContain('RESULT-');
    expect(body).not.toContain('unit-');
    expect(JSON.parse(body)).not.toHaveProperty('id');
  });

  it('REQ-2: stays under 1 KB for 20 units with long results', async () => {
    const { tools } = setup();
    expect(Buffer.byteLength(text(await answer(tools)), 'utf8')).toBeLessThan(1024);
  });

  it('REQ-3: a replayed answer returns a receipt of the same shape', async () => {
    const { tools, service } = setup();
    const first = JSON.parse(text(await answer(tools)));
    const second = JSON.parse(text(await answer(tools)));
    expect(service.answerBlockerByCoordinator).toHaveBeenCalledTimes(2);
    expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
    expect(second).toEqual(EXPECTED_RECEIPT);
  });

  it('REQ-3: a replay with notified=false and no resume keeps the shape', async () => {
    const { tools } = setup({ ...success, notified: false, resumeRequested: false });
    expect(JSON.parse(text(await answer(tools)))).toEqual({ ...EXPECTED_RECEIPT, notified: false, resumeRequested: false });
  });

  // REQ-4: failure output stays exactly `<tool> failed: <message>` (guards against regressions; green today by design).
  it.each([
    ['not found', 'execution blocker not found'],
    ['wrong audience', 'blocker requires owner resolution'],
    ['terminal run', 'execution is already completed'],
    ['invalid input', 'invalid execution blocker answer request'],
    ['stale state', 'stale execution state']
  ])('REQ-4: %s failure keeps today\'s error text', async (_label, message) => {
    const { tools } = setup({ ok: false, code: 'X', message });
    const reply = await answer(tools);
    expect(reply.isError).toBe(true);
    expect(text(reply)).toBe(`execution.work.answer failed: ${message}`);
  });

  it('REQ-4: a failure never returns a receipt', async () => {
    const { tools } = setup({ ok: false, code: 'NOT_FOUND', message: 'execution blocker not found', value: bigRecord });
    const reply = await answer(tools);
    expect(text(reply)).not.toContain('deliveryId');
    expect(text(reply)).not.toContain('workUnits');
  });

  it('REQ-4: an unbound session is denied before the service is called', async () => {
    const service = { answerBlockerByCoordinator: vi.fn() };
    const { server, tools } = fakeServer();
    registerExecutionTools(server as never, { sessionId: 'pm', projectId: 'project-1', service: service as never, validateRouteIdentity: () => true, resolveCohortBinding: () => undefined });
    const reply = await answer(tools);
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain('session is not bound to this execution.');
    expect(service.answerBlockerByCoordinator).not.toHaveBeenCalled();
  });
});
