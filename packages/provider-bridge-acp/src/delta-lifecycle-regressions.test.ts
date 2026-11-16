import { describe, expect, it } from 'vitest';
import { createAcpDeltaTranslator } from './delta-translation.js';
import { ACP_TURN_STARTED_METHOD, ACP_COMPACTION_STARTED_METHOD, ACP_TURN_COMPLETED_METHOD, ACP_UPDATE_METHOD } from './bridge-protocol.js';
import { createDeltaAssembler } from '../../provider-bridge-protocol/src/assembler/index.js';
const threadId = 'review-thread';
function acpHarness() {
  const translator = createAcpDeltaTranslator({ cwd: '/workspace' });
  const assembler = createDeltaAssembler({ providerId: 'acp', entropyPrefix: 'review', textDeltaFlushMs: 0 });
  const translate = (method: string, params: Record<string, unknown> = {}) => assembler.assemble({
    threadId,
    deltas: translator.translateAcpEvent({ jsonrpc: '2.0', method, params: { threadId, ...params } }, { threadId }),
  });
  const update = (update: Record<string, unknown>) => translate(ACP_UPDATE_METHOD, { update });
  translate(ACP_TURN_STARTED_METHOD);
  return { translate, update };
}
describe('BB review: desired behavior on unchanged Zana production source', () => {
  it.each(['error', ACP_TURN_STARTED_METHOD, ACP_COMPACTION_STARTED_METHOD])('ACP settles active commands before %s', method => {
    const h = acpHarness();
    const started = h.update({ sessionUpdate: 'tool_call', toolCallId: 'running', kind: 'execute', status: 'in_progress', rawInput: { command: 'sleep 30' } });
    expect(started.some(e => e.type === 'item/started' && e.item.type === 'commandExecution')).toBe(true);
    const events = h.translate(method, { message: 'Connection lost' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'item/completed', item: expect.objectContaining({ type: 'commandExecution', status: method === 'error' ? 'failed' : 'interrupted' }) }));
  });
  it('ACP normal turn completion is a passing control', () => {
    const h = acpHarness();
    h.update({ sessionUpdate: 'tool_call', toolCallId: 'running', kind: 'execute', status: 'in_progress', rawInput: { command: 'sleep 30' } });
    expect(h.translate(ACP_TURN_COMPLETED_METHOD, { stopReason: 'end_turn' })).toContainEqual(expect.objectContaining({ type: 'item/completed', item: expect.objectContaining({ type: 'commandExecution', status: 'completed' }) }));
  });
  it('ACP refreshes command text when actual input arrives', () => {
    const h = acpHarness();
    h.update({ sessionUpdate: 'tool_call', toolCallId: 'running', title: 'Run command', kind: 'execute', status: 'in_progress', rawInput: {} });
    const events = h.update({ sessionUpdate: 'tool_call_update', toolCallId: 'running', status: 'in_progress', rawInput: { command: 'pnpm test' } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'item/started', item: expect.objectContaining({ type: 'commandExecution', command: 'pnpm test' }) }));
  });
});
