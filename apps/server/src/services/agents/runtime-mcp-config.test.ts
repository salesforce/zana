import { describe, expect, it } from 'vitest';
import { createRuntimeMcpConfig } from './runtime-mcp-config.js';

describe('runtime MCP config', () => {
  it('replays mcp-ready received before server runtime start completes', () => {
    const state = createRuntimeMcpConfig();
    state.receive({
      mcpBaseUrl: 'http://127.0.0.1:43123',
      teamLaunchEnabled: true,
      teamJobLaunchEnabled: true
    }, false);

    expect(state.get().mcpBaseUrl).toBeUndefined();
    state.started();
    expect(state.get()).toEqual({
      mcpBaseUrl: 'http://127.0.0.1:43123',
      teamLaunchEnabled: true,
      teamJobLaunchEnabled: true
    });
  });

  it('uses latest early message and applies later updates immediately', () => {
    const state = createRuntimeMcpConfig();
    state.receive({ mcpBaseUrl: 'http://127.0.0.1:1', teamLaunchEnabled: false }, false);
    state.receive({ mcpBaseUrl: 'http://127.0.0.1:2', teamLaunchEnabled: true }, false);
    state.started();
    expect(state.get().mcpBaseUrl).toBe('http://127.0.0.1:2');

    state.receive({ mcpBaseUrl: 'http://127.0.0.1:3', teamLaunchEnabled: false }, true);
    expect(state.get()).toEqual({
      mcpBaseUrl: 'http://127.0.0.1:3',
      teamLaunchEnabled: false
    });
  });
});
