import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    terminals: { create: vi.fn(), write: vi.fn() },
    threads: { onOpen: () => () => undefined }
  }
}));
vi.mock('../../../store.js', () => ({
  useData: { getState: () => ({ terminals: {}, createTerminal: vi.fn() }) },
  useUi: { getState: () => ({ selectTab: vi.fn() }) }
}));

import {
  AGENT_TERMINAL_CAP,
  AGENT_TERMINAL_OPENER_KEY,
  agentOwnedTerminalTabs,
  bufferThreadOpenTerminal,
  consumePendingOpenTerminal,
  parseThreadOpenTerminalPayload,
  resetThreadOpenTerminalBuffer
} from './useThreadOpenTerminalSignal.js';

describe('thread-open terminal signal', () => {
  afterEach(() => {
    resetThreadOpenTerminalBuffer();
  });

  it('parses a terminal intent and ignores file-only payloads', () => {
    expect(parseThreadOpenTerminalPayload(null)).toBeNull();
    expect(parseThreadOpenTerminalPayload({
      threadId: 't1',
      projectId: 'p1',
      file: { source: 'workspace', path: 'a.ts' }
    })).toEqual({ threadId: 't1', projectId: 'p1', terminal: null });
    expect(parseThreadOpenTerminalPayload({
      type: 'thread-open',
      projectId: 'p1',
      threadId: 't1',
      split: 'right',
      file: null,
      terminal: { command: 'npm run dev', title: 'Dev' }
    })).toEqual({
      threadId: 't1',
      projectId: 'p1',
      terminal: { command: 'npm run dev', title: 'Dev' }
    });
  });

  it('buffers then drains the oldest terminal for a thread', () => {
    bufferThreadOpenTerminal('t1', { command: 'ls', title: 'List' });
    bufferThreadOpenTerminal('t1', { command: null, title: null });
    expect(consumePendingOpenTerminal('missing')).toBeNull();
    expect(consumePendingOpenTerminal('t1')).toEqual({ command: 'ls', title: 'List' });
    expect(consumePendingOpenTerminal('t1')).toEqual({ command: null, title: null });
    expect(consumePendingOpenTerminal('t1')).toBeNull();
  });

  it('counts only agent-owned terminal tabs toward the cap', () => {
    expect(AGENT_TERMINAL_CAP).toBe(3);
    expect(agentOwnedTerminalTabs([
      { id: 'user', kind: 'terminal', title: 'Terminal', sessionId: 's0' },
      { id: 'a1', kind: 'terminal', title: 'Dev', sessionId: 's1', openerKey: AGENT_TERMINAL_OPENER_KEY },
      { id: 'file', kind: 'file-preview', title: 'a.ts', path: 'a.ts' }
    ])).toHaveLength(1);
  });
});
