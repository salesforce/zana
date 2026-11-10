import { describe, expect, it, vi } from 'vitest';
import { createAgentRegistryStore } from '@zana-ai/zcc-server/services/agents/agent-registry-store';
import { createAgentMessageLog } from '@zana-ai/zcc-server/services/agents/agent-message-log';
import { createCliPeerDelivery } from './cli-peer-delivery.js';

const input = { to: 'cli', projectId: 'p', fromSessionId: 'thread', fromHandle: 'Builder', message: 'Peer message', generation: 0 };
function setup(state: 'idle' | 'working', accepted = true) {
  const registry = createAgentRegistryStore(), log = createAgentMessageLog(), inject = vi.fn(() => accepted);
  registry.upsert({ sessionId: 'cli', projectId: 'p', cwd: '/p', displayName: 'Reviewer' });
  return { registry, log, inject, send: createCliPeerDelivery({ registry, log, status: () => state, inject, enabled: () => true, generation: () => 0 }) };
}
describe('thread to CLI peer delivery', () => {
  it('rejects disabled and stale-generation deliveries without mailbox exposure', () => {
    const registry = createAgentRegistryStore(), log = createAgentMessageLog(), inject = vi.fn(() => true);
    for (const enabled of [true, false]) {
      const send = createCliPeerDelivery({ registry, log, inject, status: () => 'idle', enabled: () => enabled, generation: () => 2 });
      expect(send(input).ok).toBe(false);
    }
    expect(log.history()).toEqual([]); expect(inject).not.toHaveBeenCalled();
  });
  it('delivers reviewed content and records the actual sender', () => {
    const { send, log, inject } = setup('idle');
    const result = send(input); expect(result).toMatchObject({ ok: true, delivered: true });
    expect(inject).toHaveBeenCalledWith('cli', 'Peer message'); expect(log.pull('cli')).toEqual([]);
    expect(log.history()[0]).toMatchObject({ fromSessionId: 'thread', fromHandle: 'Builder', toHandle: 'Reviewer' });
  });
  it.each([['working', true], ['idle', false]] as const)('does not expose pending mail for %s, accepted=%s', (state, accepted) => {
    const { send, log, inject } = setup(state, accepted);
    expect(send(input)).toMatchObject({ ok: false }); expect(log.pull('cli')).toEqual([]);
    expect(inject).toHaveBeenCalledTimes(state === 'working' ? 0 : 1);
  });
  it('does not expose a message when injection throws', () => {
    const { send, log, inject } = setup('idle'); inject.mockImplementation(() => { throw new Error('exited'); });
    expect(send(input)).toMatchObject({ ok: false }); expect(log.pull('cli')).toEqual([]);
  });
  it('refuses stale, cross-project, squad and self targets before writing', () => {
    const { send, log, registry } = setup('idle');
    expect(send({ ...input, projectId: 'other' }).ok).toBe(false);
    expect(send({ ...input, to: 'missing' }).ok).toBe(false);
    expect(send({ ...input, fromSessionId: 'cli' }).ok).toBe(false);
    registry.upsert({ sessionId: 'cli', projectId: 'p', cwd: '/p', teamLaunchId: 'team-1' });
    expect(send(input).ok).toBe(false); expect(log.history()).toEqual([]);
  });
});
