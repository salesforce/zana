import { describe, expect, it } from 'vitest';
import { menubarAgentRowKey, menubarAgentState } from './menubar-agent.js';

describe('menubarAgentState', () => {
  it.each([
    ['error', false, 0, 'blocked'],
    ['idle', true, 0, 'blocked'],
    ['active', false, 0, 'working'],
    ['starting', false, 0, 'working'],
    ['stopping', false, 0, 'idle'],
    ['idle', false, 1, 'working'],
    ['idle', false, 0, 'idle']
  ] as const)('maps %s', (status, pending, background, expected) => {
    expect(menubarAgentState(status, pending, background)).toBe(expected);
  });

  it('keys kinds independently', () => {
    expect(menubarAgentRowKey({ kind: 'thread', agentId: 'same', projectId: 'p1' })).toBe('thread:same');
    expect(menubarAgentRowKey({ kind: 'cli', agentId: 'same', projectId: 'p1' })).toBe('cli:same');
  });
});
