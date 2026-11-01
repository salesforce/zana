import { registerThreadContextTarget } from './thread-context-target.js';
import { ComposerApiContext, setActiveComposerApi } from './plugin-composer-api.js';
import { ThreadPanelOwnerProvider } from './thread-panel-owner.js';
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
    const reference = { version: 1, label: 'Log', text: 'snapshot' };
    expect(parsePanelAgentTarget({ draft: { prompt: 'Explain', selection, references: [reference] } })).toEqual({ draft: 'Explain', selection, references: [reference] });
    expect(parsePanelAgentTarget({ draft: { prompt: 'Explain', selection, references: Array(24).fill(reference) } })).toBeNull();
    expect(parsePanelAgentTarget({ draft: { prompt: 'Explain', selection, references: Array(4).fill({ ...reference, text: 'x'.repeat(100000) }) } })).toBeNull();
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

it('validates and carries immutable context in panel drafts',()=>{
 const show=vi.fn();const off=onPluginPanelAgentRequest('notes',show);
 try {
  const navigate=renderNavigate('notes');const reference={version:1 as const,label:'Passage',text:'copied'};
  expect(navigate.supportsContextReferences).toBe(true);
  expect(navigate.openPanelAgent({draft:{prompt:'Explain',references:[reference]}})).toBe(true);
  expect(show).toHaveBeenLastCalledWith({draft:'Explain',references:[reference]});
  expect(navigate.openPanelAgent({draft:{prompt:'Explain',references:[{...reference,version:2}]}} as never)).toBe(false);
  expect(navigate.addThreadContext?.(reference)).toBe(false);
 } finally {off();}
});

it('adds context to the visible panel owner and rejects unrelated page assistants',()=>{
 const reference={version:1 as const,label:'Record',text:'copied'};const insert=vi.fn(()=>true);
 const off=registerThreadContextTarget('visible-thread',insert);
 try {
  const host=renderRuntime('notes',children=><ThreadPanelOwnerProvider ownerId="visible-thread">{children}</ThreadPanelOwnerProvider>);
  expect(host.context.threadId).toBe('visible-thread');expect(host.navigate.addThreadContext?.(reference)).toBe(true);
  expect(insert).toHaveBeenCalledWith(reference);cleanup();
  const page={pluginId:'notes',page:'notes'};
  const other=renderRuntime('notes',children=><PluginPagePanelProvider page={page}>{children}</PluginPagePanelProvider>);
  expect(other.navigate.addThreadContext?.(reference)).toBe(false);
 } finally {off();}
});

it('exposes context insertion only through a scoped composer and preserves legacy global text access', () => {
  installPluginRuntime();
  const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginSdkApp }).__ZCC_PLUGIN_RUNTIME__!;
  const insert = vi.fn(() => true);
  const globalApi = { text: 'global draft', insertContextReference: insert } as any;
  const scopedApi = { text: 'owned draft', insertContextReference: insert } as any;
  let api: ReturnType<PluginSdkApp['useComposer']>;
  function Probe() { api = runtime.useComposer(); return null; }
  const element = (scoped: any) => <PluginRuntimeContext.Provider value={{ pluginId: 'notes', generation: 0 }}>
    <ComposerApiContext.Provider value={scoped}><Probe /></ComposerApiContext.Provider>
  </PluginRuntimeContext.Provider>;
  setActiveComposerApi(globalApi);
  const view = render(element(null));
  expect(api!.text).toBe('global draft');
  expect(api!.insertContextReference).toBeUndefined();
  view.rerender(element(scopedApi));
  expect(api!.text).toBe('owned draft');
  expect(api!.insertContextReference).toBe(insert);
  setActiveComposerApi(null);
  view.rerender(element(null));
  expect(api!.insertContextReference).toBeUndefined();
});
