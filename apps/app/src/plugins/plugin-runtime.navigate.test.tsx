/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginSdkApp, ZccContext, ZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import type { ReactNode } from 'react';

const pageActions = vi.hoisted(() => [{ pluginId: 'notes', id: 'outline', title: 'Outline', scopes: ['plugin-page'] }]);
vi.mock('./plugin-slots.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./plugin-slots.js')>()),
  listThreadPanelActions: () => pageActions
}));

import { installPluginRuntime } from './plugin-runtime.js';
import { PluginRuntimeContext } from './PluginSlotBoundary.js';
import { onPluginPanelAgentRequest } from './plugin-panel-agent.js';
import { parsePanelAgentTarget } from './plugin-panel-agent.js';
import { onPluginPanelToolRequest, PluginPagePanelProvider } from './plugin-page-panel.js';

afterEach(cleanup);

function renderRuntime(pluginId: string, wrap: (children: ReactNode) => ReactNode = (children) => children) {
  installPluginRuntime();
  const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginSdkApp }).__ZCC_PLUGIN_RUNTIME__!;
  let navigate: ZccNavigate | null = null;
  let context: ZccContext | null = null;
  function Probe() {
    navigate = runtime.useZccNavigate();
    context = runtime.useZccContext();
    return null;
  }
  render(
    <MemoryRouter initialEntries={['/']}>
      {wrap(
        <PluginRuntimeContext.Provider value={{ pluginId, generation: 0 }}>
          <Probe />
        </PluginRuntimeContext.Provider>
      )}
    </MemoryRouter>
  );
  return { navigate: navigate!, context: context! };
}

function renderNavigate(pluginId: string): ZccNavigate {
  return renderRuntime(pluginId).navigate;
}

describe('navigate.openPanelAgent', () => {
  it('accepts bounded selection snapshots and drops malformed metadata', () => {
    const selection = { version: 1, path: 'README.md', text: 'Selected passage' };
    expect(parsePanelAgentTarget({ draft: { prompt: 'Explain', selection } })).toEqual({ draft: 'Explain', selection });
    expect(parsePanelAgentTarget({ draft: { prompt: 'Explain', selection: { ...selection, startLine: -1 } } })).toEqual({ draft: 'Explain' });
    expect(parsePanelAgentTarget({ draft: { prompt: 'Explain', selection: { ...selection, text: 'x'.repeat(100001) } } })).toEqual({ draft: 'Explain' });
  });
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

  it('passes a well-formed draft and drops untrusted extras', () => {
    const show = vi.fn();
    const off = onPluginPanelAgentRequest('notes', show);
    try {
      const navigate = renderNavigate('notes');
      expect(navigate.openPanelAgent({ draft: { prompt: 'Summarise', projectId: 'p1' }, title: '  Doc  ' })).toBe(true);
      expect(show).toHaveBeenLastCalledWith({ draft: 'Summarise', projectId: 'p1', title: 'Doc' });
      expect(navigate.openPanelAgent({ draft: { prompt: 'Again', projectId: 7 } } as never)).toBe(true);
      expect(show).toHaveBeenLastCalledWith({ draft: 'Again' });
      expect(navigate.openPanelAgent(null as never)).toBe(false);
      expect(show).toHaveBeenCalledTimes(2);
    } finally {
      off();
    }
  });
});

describe('navigate.openPanelTool', () => {
  const page = { pluginId: 'notes', page: 'notes' };
  const besidePage = (children: ReactNode) => <PluginPagePanelProvider page={page}>{children}</PluginPagePanelProvider>;

  it('marks only the page owner as having a side panel', () => {
    expect(renderRuntime('notes').context.sidePanel).toBeUndefined();
    cleanup();
    expect(renderRuntime('notes', besidePage).context.sidePanel).toBe(true);
    cleanup();
    expect(renderRuntime('other', besidePage).context.sidePanel).toBeUndefined();
  });

  it('tells the page owner whether its side panel is showing, when the layout says', () => {
    expect(renderRuntime('notes', besidePage).context).not.toHaveProperty('sidePanelOpen');
    cleanup();
    const beside = (open: boolean) => (children: ReactNode) => <PluginPagePanelProvider page={page} open={open}>{children}</PluginPagePanelProvider>;
    expect(renderRuntime('notes', beside(true)).context.sidePanelOpen).toBe(true);
    cleanup();
    expect(renderRuntime('notes', beside(false)).context.sidePanelOpen).toBe(false);
    cleanup();
    expect(renderRuntime('other', beside(true)).context).not.toHaveProperty('sidePanelOpen');
  });

  it("asks the page's layout to open one of the plugin's own tools", () => {
    const navigate = renderRuntime('notes', besidePage).navigate;
    expect(navigate.openPanelTool?.({ actionId: 'outline' })).toBe(false);
    const show = vi.fn();
    const off = onPluginPanelToolRequest(page, show);
    try {
      expect(navigate.openPanelTool?.({ actionId: 'outline', params: { at: 1 } })).toBe(true);
      expect(show).toHaveBeenCalledWith({ actionId: 'outline', title: 'Outline', params: { at: 1 } });
      expect(renderNavigate('other').openPanelTool?.({ actionId: 'outline' })).toBe(false);
    } finally {
      off();
    }
  });
});
