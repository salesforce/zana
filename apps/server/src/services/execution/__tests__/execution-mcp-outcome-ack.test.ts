import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { outcomeAck, registerExecutionTools } from '../execution-mcp-tool.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>;

function fakeServer() {
  const tools = new Map<string, ToolHandler>();
  const schemas = new Map<string, Record<string, z.ZodTypeAny>>();
  return {
    server: { registerTool: (name: string, definition: { inputSchema?: Record<string, z.ZodTypeAny> }, handler: ToolHandler) => { tools.set(name, handler); schemas.set(name, definition.inputSchema ?? {}); } },
    tools, schemas
  };
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

const states = ['COMPLETED', 'CLAIMED', 'PENDING', 'READY', 'BLOCKED', 'COMPLETED', 'COMPLETED', 'FAILED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED'];
const bigRecord = {
  id: 'execution-1',
  state: 'RUNNING',
  deliveries: [],
  workUnits: states.map((state, index) => ({ id: `unit-${index}`, state, claimGeneration: index === 0 ? 3 : undefined, result: 'x'.repeat(2000) }))
};

function setup(record: unknown = bigRecord, declaresOutput = false) {
  const ok = { ok: true as const, value: record };
  const service = {
    completeWork: vi.fn(async () => ok), failWork: vi.fn(async () => ok), blockWork: vi.fn(async () => ok), releaseWork: vi.fn(async () => ok),
    claimWork: vi.fn(async () => ok), heartbeatWork: vi.fn(async () => ok),
    workUnitDeclaresOutput: vi.fn(async () => declaresOutput)
  };
  const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
  const { server, tools, schemas } = fakeServer();
  registerExecutionTools(server as never, { sessionId: 'worker', projectId: 'project-1', service: service as never, validateRouteIdentity: () => true, resolveCohortBinding: () => binding });
  return { service, tools, schemas };
}

const base = { executionId: 'execution-1', workUnitId: 'unit-0' };
const calls: Array<[string, Record<string, unknown>]> = [
  ['execution.work.complete', { ...base, result: 'done' }],
  ['execution.work.fail', { ...base, failure: 'broke' }],
  ['execution.work.block', { ...base, blockerId: 'b1', question: 'Which?' }],
  ['execution.work.release', base]
];

describe('Squad outcome tool acknowledgements', () => {
  it.each(calls)('%s returns a compact ack', async (name, input) => {
    const { tools } = setup();
    const reply = text(await tools.get(name)!(input));
    expect(reply.length).toBeLessThan(2048);
    expect(JSON.parse(reply)).toEqual({
      ok: true, executionId: 'execution-1', executionState: 'RUNNING', workUnitId: 'unit-0', status: 'COMPLETED', claimGeneration: 3,
      remaining: { claimed: 1, pending: 2, blocked: 1 }
    });
  });

  it('gives status null and claimGeneration null for a missing unit', async () => {
    const { tools } = setup();
    const ack = JSON.parse(text(await tools.get('execution.work.release')!({ ...base, workUnitId: 'nope' })));
    expect(ack).toMatchObject({ ok: true, workUnitId: 'nope', status: null, claimGeneration: null });
    expect(ack).not.toHaveProperty('workUnits');
  });

  it('still returns the record for claim and heartbeat', async () => {
    const { tools } = setup();
    const claim = JSON.parse(text(await tools.get('execution.work.claim')!(base)));
    expect(claim.workUnits).toHaveLength(12);
    const beat = JSON.parse(text(await tools.get('execution.work.heartbeat')!({ ...base, claimId: 'c', claimGeneration: 1 })));
    expect(beat.workUnits).toHaveLength(12);
  });

  it('refuses a 2049-char result without calling the service', async () => {
    const { tools, service } = setup();
    const reply = await tools.get('execution.work.complete')!({ ...base, result: 'x'.repeat(2049) });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain('2049');
    expect(text(reply)).toContain('max 2048');
    expect(text(reply)).toContain('Shorten it to a summary of at most 2048 characters.');
    // structuredResult would be rejected for a unit without an output, so it is not advised.
    expect(text(reply)).not.toContain('structuredResult');
    expect(service.completeWork).not.toHaveBeenCalled();
  });

  it('points at structuredResult only when the unit declares an output', async () => {
    const { tools } = setup(bigRecord, true);
    const reply = await tools.get('execution.work.complete')!({ ...base, result: 'x'.repeat(2049) });
    expect(text(reply)).toContain('Put the detail in structuredResult.');
  });

  it('lets a 2049-char result past the input schema, so the handler can name the limit', () => {
    const { schemas } = setup();
    const input = z.object(schemas.get('execution.work.complete')!);
    const call = { executionId: 'execution-1', workUnitId: 'unit-0' };
    expect(input.safeParse({ ...call, result: 'x'.repeat(2049) }).success).toBe(true);
    expect(input.safeParse({ ...call, result: 'x'.repeat(70_000) }).success).toBe(true);
    // The other outcome tools keep their own caps.
    expect(z.object(schemas.get('execution.work.block')!).safeParse({ ...call, blockerId: 'b', question: 'q'.repeat(2049) }).success).toBe(false);
  });

  it('names the limit for a 70,000-char result', async () => {
    const { tools, service } = setup();
    const reply = await tools.get('execution.work.complete')!({ ...base, result: 'x'.repeat(70_000) });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain('70000');
    expect(text(reply)).toContain('max 2048');
    expect(service.completeWork).not.toHaveBeenCalled();
  });

  it('logs and falls back when the declared-output check fails', async () => {
    const { tools, service } = setup();
    const boom = new Error('lookup failed');
    service.workUnitDeclaresOutput.mockRejectedValueOnce(boom);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reply = await tools.get('execution.work.complete')!({ ...base, result: 'x'.repeat(2049) });
    expect(text(reply)).toContain('max 2048');
    expect(text(reply)).not.toContain('structuredResult');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('execution.work.complete'), boom);
    expect(spy.mock.calls[0]![0]).toContain('execution-1');
    expect(spy.mock.calls[0]![0]).toContain('unit-0');
    spy.mockRestore();
  });

  it('accepts exactly 2048 chars', async () => {
    const { tools, service } = setup();
    const reply = await tools.get('execution.work.complete')!({ ...base, result: 'x'.repeat(2048) });
    expect(reply.isError).toBeUndefined();
    expect(service.completeWork).toHaveBeenCalledTimes(1);
  });

  it('passes a non-record value through unchanged', async () => {
    const { tools } = setup({ note: 'plain' });
    expect(JSON.parse(text(await tools.get('execution.work.release')!(base)))).toEqual({ note: 'plain' });
  });

  it('counts nothing for a record without work units', () => {
    expect(outcomeAck({ id: 'execution-1', state: 'STARTING' } as never, 'unit-0')).toEqual({
      ok: true, executionId: 'execution-1', executionState: 'STARTING', workUnitId: 'unit-0', status: null, claimGeneration: null,
      remaining: { claimed: 0, pending: 0, blocked: 0 }
    });
  });

  it('passes the claim fence and the blocker audience through to the service', async () => {
    const { service, tools } = setup();
    const fence = { claimId: 'claim-1', claimGeneration: 3 };
    await tools.get('execution.work.complete')!({ ...base, ...fence, result: 'done' });
    expect(service.completeWork).toHaveBeenCalledWith(expect.anything(), 'unit-0', 'done', fence, true, undefined);
    await tools.get('execution.work.block')!({ ...base, ...fence, blockerId: 'b1', question: 'Which?', audience: 'coordinator' });
    expect(service.blockWork).toHaveBeenCalledWith(expect.anything(), 'unit-0', { id: 'b1', question: 'Which?', options: undefined, audience: 'coordinator' }, fence, true);
    await tools.get('execution.work.release')!({ ...base, ...fence });
    expect(service.releaseWork).toHaveBeenCalledWith(expect.anything(), 'unit-0', fence, true);
  });

  it('drops the structuredResult hint when looking up the unit fails', async () => {
    const { service, tools } = setup();
    service.workUnitDeclaresOutput.mockRejectedValueOnce(new Error('store unavailable'));
    const reply = await tools.get('execution.work.complete')!({ ...base, result: 'x'.repeat(2049) });
    expect(reply.isError).toBe(true);
    expect(text(reply)).not.toContain('structuredResult');
  });

  it('keeps error replies unchanged', async () => {
    const { tools, service } = setup();
    service.releaseWork.mockResolvedValueOnce({ ok: false, message: 'stale claim' } as never);
    const reply = await tools.get('execution.work.release')!(base);
    expect(reply.isError).toBe(true);
    expect(text(reply)).toBe('execution.work.release failed: stale claim');
  });
});
