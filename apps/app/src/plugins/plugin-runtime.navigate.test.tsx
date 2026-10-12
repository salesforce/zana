/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginSdkApp, ZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { installPluginRuntime } from './plugin-runtime.js';
import { PluginRuntimeContext } from './PluginSlotBoundary.js';
import { onPluginPanelAgentRequest } from './plugin-panel-agent.js';

afterEach(cleanup);

function renderNavigate(pluginId: string): ZccNavigate {
  installPluginRuntime();
  const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginSdkApp }).__ZCC_PLUGIN_RUNTIME__!;
  let navigate: ZccNavigate | null = null;
  function Probe() {
    navigate = runtime.useZccNavigate();
    return null;
  }
  render(
    <MemoryRouter initialEntries={['/']}>
      <PluginRuntimeContext.Provider value={{ pluginId, generation: 0 }}>
        <Probe />
      </PluginRuntimeContext.Provider>
    </MemoryRouter>
  );
  return navigate!;
}

describe('navigate.openPanelAgent', () => {
  it('reports false when no side panel listens for the plugin', () => {
    expect(renderNavigate('notes').openPanelAgent({ threadId: 'thread-1', title: 'Doc' })).toBe(false);
  });

  it("asks the plugin's own layout to show the conversation", () => {
    const show = vi.fn();
    const other = vi.fn();
    const offOther = onPluginPanelAgentRequest('tasks', other);
    const off = onPluginPanelAgentRequest('notes', show);
    try {
      expect(renderNavigate('notes').openPanelAgent({ threadId: 'thread-1', title: 'Doc' })).toBe(true);
      expect(show).toHaveBeenCalledWith({ threadId: 'thread-1', title: 'Doc' });
      expect(other).not.toHaveBeenCalled();
    } finally {
      off();
      offOther();
    }
  });
});
