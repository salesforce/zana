import { describe, expect, it, vi } from 'vitest';
import { registerExecutionTools } from '../execution-mcp-tool.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>;

const FIRST = 'session is not bound to this execution.';
const RECOVERY = 'If your session restarted, call execution.whoami to see this session\'s binding, then ask the Squad owner to recover the coordinator from the Squad panel. Do not retry with another execution id.';

function build(resolved: { executionId: string; projectId: string; slotId: string; role: 'orchestrator' | 'worker' } | undefined) {
  const tools = new Map<string, ToolHandler>();
  const server = { registerTool: (name: string, _d: unknown, handler: ToolHandler) => { tools.set(name, handler); } };
  const service = new Proxy({}, { get: () => vi.fn(async () => ({ ok: true, value: { note: 'ran' } })) });
  registerExecutionTools(server as never, { sessionId: 'pm', projectId: 'project-1', service: service as never, validateRouteIdentity: () => true, resolveCohortBinding: () => resolved });
  return tools;
}

const e = { executionId: 'execution-1' };
const calls: Array<[string, Record<string, unknown>]> = [
  ['execution.work.answer', { ...e, blockerId: 'b1', answer: 'a' }],
  ['execution.work.claim', { ...e, workUnitId: 'u' }],
  ['execution.work.assign', { ...e, workUnitId: 'u', assignedSlotId: 's' }],
  ['execution.work.heartbeat', { ...e, workUnitId: 'u', claimId: 'c', claimGeneration: 1 }],
  ['execution.work.dispatch_ready', e],
  ['execution.work.complete', { ...e, workUnitId: 'u', result: 'r' }],
  ['execution.work.fail', { ...e, workUnitId: 'u', failure: 'f' }],
  ['execution.work.block', { ...e, workUnitId: 'u', blockerId: 'b', question: 'q' }],
  ['execution.work.release', { ...e, workUnitId: 'u' }],
  ['execution.work.retry', { ...e, workUnitId: 'u' }],
  ['execution.source.list', e],
  ['execution.source.read', { ...e, sourceId: 's' }],
  ['execution.delivery.pull', {}],
  ['execution.delivery.ack', { deliveryId: 'd', leaseId: 'l', delivered: true }]
];

describe('bound-tool denial recovery text (#691)', () => {
  it.each(calls)('REQ-5: %s from an unbound session keeps the first sentence and adds the recovery line', async (name, args) => {
    const reply = await build(undefined).get(name)!(args);
    expect(reply.isError).toBe(true);
    const body = reply.content[0]!.text!;
    expect(body.startsWith(`${name} failed: ${FIRST}`)).toBe(true);
    expect(body).toContain(RECOVERY);
  });

  it('REQ-5: a session bound to another execution gets the same text', async () => {
    const reply = await build({ executionId: 'other', projectId: 'project-1', slotId: 'orchestrator', role: 'orchestrator' }).get('execution.work.answer')!(calls[0]![1]);
    expect(reply.content[0]!.text).toBe(`execution.work.answer failed: ${FIRST} ${RECOVERY}`);
  });

  it('REQ-5: a binding from another project gets the same text', async () => {
    const reply = await build({ executionId: 'execution-1', projectId: 'project-2', slotId: 'orchestrator', role: 'orchestrator' }).get('execution.work.claim')!(calls[1]![1]);
    expect(reply.content[0]!.text).toContain(RECOVERY);
  });

  it('REQ-5: a correctly bound session gets no recovery line', async () => {
    const reply = await build({ executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator', role: 'orchestrator' }).get('execution.work.dispatch_ready')!(e);
    expect(reply.isError).toBeUndefined();
    expect(reply.content[0]!.text).not.toContain('execution.whoami');
  });

  it('REQ-5: the recovery line never invites another execution id', async () => {
    const body = (await build(undefined).get('execution.work.answer')!(calls[0]![1])).content[0]!.text!;
    expect(body).toContain('Do not retry with another execution id.');
    expect(body).toContain('ask the Squad owner');
  });

  // REQ-6 is not applicable: u-seam chose error text only (.zana/design/binding-seam.md), so no re-attach test exists.
});
