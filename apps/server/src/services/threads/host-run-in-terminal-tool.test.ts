import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOST_RUN_IN_TERMINAL_INSTRUCTION,
  HOST_RUN_IN_TERMINAL_TOOL,
  HOST_RUN_IN_TERMINAL_TOOL_NAME,
  invokeHostRunInTerminalTool,
  RUN_IN_TERMINAL_DESCRIPTION
} from './host-run-in-terminal-tool.js';
import { mergeHostSessionTooling, HOST_SESSION_INSTRUCTION } from './host-session-tools.js';

vi.mock('./open-thread-terminal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./open-thread-terminal.js')>();
  return {
    ...actual,
    openThreadTerminalDepsFromContext: () => ({ tagged: 'deps' }),
    openThreadTerminal: vi.fn()
  };
});

import { openThreadTerminal } from './open-thread-terminal.js';

afterEach(() => {
  vi.mocked(openThreadTerminal).mockReset();
});

function ctx(flag: boolean) {
  return {
    config: { getConfig: () => ({ inAppAgentTerminalsEnabled: flag }) }
  } as never;
}

describe('run_in_terminal host tool', () => {
  it('tells the agent to stay in ZCC instead of Terminal.app', () => {
    expect(RUN_IN_TERMINAL_DESCRIPTION).toContain('ZCC shell');
    expect(HOST_RUN_IN_TERMINAL_INSTRUCTION).toContain('run_in_terminal');
    expect(HOST_RUN_IN_TERMINAL_INSTRUCTION).toContain('Do not use `open -a Terminal`');
    expect(HOST_SESSION_INSTRUCTION).not.toContain('run_in_terminal');
  });

  it('is packed only when the experiment is on', () => {
    const off = mergeHostSessionTooling({});
    expect(off.dynamicTools?.map((tool) => tool.name)).not.toContain(HOST_RUN_IN_TERMINAL_TOOL_NAME);
    expect(off.instructions).not.toContain('run_in_terminal');
    const on = mergeHostSessionTooling({}, { inAppAgentTerminalsEnabled: true });
    expect(on.dynamicTools?.[1]).toEqual(HOST_RUN_IN_TERMINAL_TOOL);
    expect(on.instructions).toContain('run_in_terminal');
  });

  it('fail-closes when the experiment is off', () => {
    const result = invokeHostRunInTerminalTool(ctx(false), {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { command: 'npm test' }
    });
    expect(result.success).toBe(false);
    expect(result.contentItems[0]?.text).toContain('In-app agent terminals are off');
    expect(openThreadTerminal).not.toHaveBeenCalled();
  });

  it('opens through the owning thread id and ignores a forged threadId', () => {
    vi.mocked(openThreadTerminal).mockReturnValue({
      delivered: 1,
      threadId: 'thr-1',
      projectId: 'proj-1',
      command: 'npm test',
      title: 'Tests'
    });
    const result = invokeHostRunInTerminalTool(ctx(true), {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { command: 'npm test', title: 'Tests', threadId: 'other-thread' }
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.contentItems[0]?.text ?? '{}')).toEqual({
      ok: true,
      command: 'npm test',
      title: 'Tests'
    });
    expect(openThreadTerminal).toHaveBeenCalledWith(
      { tagged: 'deps' },
      {
        threadId: 'thr-1',
        projectId: 'proj-1',
        command: 'npm test',
        title: 'Tests'
      }
    );
  });

  it('errors when no app window is connected', () => {
    vi.mocked(openThreadTerminal).mockReturnValue({
      delivered: 0,
      threadId: 'thr-1',
      projectId: 'proj-1',
      command: null,
      title: 'Terminal'
    });
    const result = invokeHostRunInTerminalTool(ctx(true), {
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: {}
    });
    expect(result.success).toBe(false);
    expect(result.contentItems[0]?.text).toContain('desktop app open');
  });
});
