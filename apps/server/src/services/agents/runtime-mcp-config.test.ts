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

  it('clears a stale pending value once a started=true receive lands, so started() cannot resurrect it', () => {
    const state = createRuntimeMcpConfig();
    // A pre-start message arrives (queued as pending)...
    state.receive({ mcpBaseUrl: 'http://127.0.0.1:stale', teamLaunchEnabled: false }, false);
    // ...but before started() is ever called, a started=true message supersedes it live.
    state.receive({ mcpBaseUrl: 'http://127.0.0.1:live', teamLaunchEnabled: true }, true);
    expect(state.get()).toEqual({
      mcpBaseUrl: 'http://127.0.0.1:live',
      teamLaunchEnabled: true
    });

    // A late started() call must be a no-op: the stale pending must not overwrite live config.
    state.started();
    expect(state.get()).toEqual({
      mcpBaseUrl: 'http://127.0.0.1:live',
      teamLaunchEnabled: true
    });
  });

  it('applies a valid pending value normally when started() runs with no intervening started=true receive', () => {
    const state = createRuntimeMcpConfig();
    state.receive({ mcpBaseUrl: 'http://127.0.0.1:pending', teamLaunchEnabled: true }, false);
    // started() with no started=true receive in between should still apply pending.
    state.started();
    expect(state.get()).toEqual({
      mcpBaseUrl: 'http://127.0.0.1:pending',
      teamLaunchEnabled: true
    });

    // A second started() call is a no-op (pending already cleared).
    state.started();
    expect(state.get()).toEqual({
      mcpBaseUrl: 'http://127.0.0.1:pending',
      teamLaunchEnabled: true
    });
  });
});
