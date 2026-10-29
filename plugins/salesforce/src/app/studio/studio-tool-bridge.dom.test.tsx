/** @vitest-environment happy-dom */
import React from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachStudioTool,
  isPanelTool,
  PANEL_TOOLS,
  panelToolActionId,
  registerStudio,
  resetStudioToolBridge,
  studioToolScope,
  useStudioMounted,
  useStudioToolScope,
  useStudioToolSlots
} from './studio-tool-bridge.js';
import { StudioPanelTool, studioPanelTool } from './StudioPanelTool.js';

beforeEach(() => {
  resetStudioToolBridge();
  (globalThis as any).__ZCC_HOST_REACT__ = React;
});
afterEach(() => { cleanup(); resetStudioToolBridge(); });

describe('studio-tool-bridge', () => {
  it('names the panel tools and their actions', () => {
    expect(PANEL_TOOLS).toEqual(['graph', 'preview', 'test', 'org-preview', 'actions', 'comments']);
    for (const tool of PANEL_TOOLS) {
      expect(isPanelTool(tool)).toBe(true);
      expect(panelToolActionId(tool)).toBe(`studio-${tool}`);
    }
    expect(isPanelTool('files')).toBe(false);
    expect(isPanelTool(undefined)).toBe(false);
    expect(panelToolActionId('comments')).toBe('studio-comments');
  });

  it('lends one node per tool to the host tab and takes it back', () => {
    const { result } = renderHook(() => useStudioToolSlots('p1'));
    expect(result.current).toEqual([]);
    const container = document.createElement('div');
    let release!: () => void;
    act(() => { release = attachStudioTool('p1', 'actions', container); });
    expect(result.current).toHaveLength(1);
    const [slot] = result.current;
    expect(slot).toMatchObject({ tool: 'actions', attached: true });
    expect(container.firstChild).toBe(slot.node);
    expect(slot.node.className).toContain('sf-as');
    expect(slot.node.dataset.studioTool).toBe('actions');
    act(() => release());
    expect(container.firstChild).toBeNull();
    expect(result.current[0]).toMatchObject({ tool: 'actions', attached: false });
    // Reattaching reuses the node, so whatever Studio rendered into it survives.
    act(() => { attachStudioTool('p1', 'actions', container); });
    expect(result.current[0].node).toBe(slot.node);
  });

  it('remembers the host tab that last showed a tool', () => {
    const { result } = renderHook(() => useStudioToolSlots('p1'));
    let release!: () => void;
    act(() => { release = attachStudioTool('p1', 'comments', document.createElement('div'), 'tab-1'); });
    expect(result.current[0].tabId).toBe('tab-1');
    act(() => release());
    expect(result.current[0]).toMatchObject({ attached: false, tabId: 'tab-1' });
    // An older host without tab ids keeps the last one.
    act(() => { attachStudioTool('p1', 'comments', document.createElement('div')); });
    expect(result.current[0].tabId).toBe('tab-1');
  });

  it('keeps the node attached when a newer tab adopted it before the old one let go', () => {
    const { result } = renderHook(() => useStudioToolSlots('p1'));
    const first = document.createElement('div');
    const second = document.createElement('div');
    let releaseFirst!: () => void;
    act(() => { releaseFirst = attachStudioTool('p1', 'comments', first); });
    act(() => { attachStudioTool('p1', 'comments', second); });
    act(() => releaseFirst());
    expect(second.firstChild).toBe(result.current[0].node);
    expect(result.current[0].attached).toBe(true);
  });

  it('ignores an older or repeated release even when a newer attachment reused the same container', () => {
    const { result } = renderHook(() => useStudioToolSlots('p1'));
    const container = document.createElement('div');
    let releaseFirst!: () => void;
    let releaseCurrent!: () => void;
    act(() => {
      releaseFirst = attachStudioTool('p1', 'preview', container, 'first');
      releaseCurrent = attachStudioTool('p1', 'preview', container, 'current');
    });
    const node = result.current[0].node;
    act(() => { releaseFirst(); releaseFirst(); });
    expect(container.firstChild).toBe(node);
    expect(result.current[0]).toMatchObject({ attached: true, tabId: 'current' });
    act(() => { releaseCurrent(); releaseCurrent(); });
    expect(container.firstChild).toBeNull();
    expect(result.current[0].attached).toBe(false);
  });

  it('keeps detached tool state until the last Studio owner leaves', () => {
    const { result } = renderHook(() => useStudioToolSlots('p1'));
    const first = registerStudio('p1');
    const last = registerStudio('p1');
    let release!: () => void;
    act(() => { release = attachStudioTool('p1', 'test', document.createElement('div')); });
    const node = result.current[0].node;
    act(() => { release(); first(); });
    expect(result.current[0].node).toBe(node);
    act(() => last());
    expect(result.current).toEqual([]);
  });

  it('scopes tool identity by project and Studio instance', () => {
    expect(studioToolScope()).toBe('');
    expect(studioToolScope('p1')).toBe('p1');
    expect(studioToolScope('p1', '')).toBe('p1');
    expect(studioToolScope('p1', 'window')).not.toBe(studioToolScope('p2', 'window'));
    const first = renderHook(() => useStudioToolSlots(studioToolScope('p1', 'main')));
    const second = renderHook(() => useStudioToolSlots(studioToolScope('p1', 'window')));
    act(() => {
      attachStudioTool(studioToolScope('p1', 'main'), 'graph', document.createElement('div'));
      attachStudioTool(studioToolScope('p1', 'window'), 'graph', document.createElement('div'));
    });
    expect(first.result.current[0].node).not.toBe(second.result.current[0].node);
  });

  it('resolves unbound launchers to their default or latest available project Studio', () => {
    const { result } = renderHook(() => useStudioToolScope('p1'));
    const scoped = studioToolScope('p1', 'window');
    const other = studioToolScope('p1', 'second');
    let removeScoped!: () => void;
    let removeOther!: () => void;
    let removeDefault!: () => void;
    expect(result.current).toBe('p1');
    act(() => { registerStudio(studioToolScope('p2', 'window')); removeScoped = registerStudio(scoped); });
    expect(result.current).toBe(scoped);
    act(() => { removeOther = registerStudio(other); });
    expect(result.current).toBe(other);
    act(() => { removeDefault = registerStudio('p1'); });
    expect(result.current).toBe('p1');
    act(() => removeDefault());
    expect(result.current).toBe(other);
    act(() => removeOther());
    expect(result.current).toBe(scoped);
    act(() => removeScoped());
    expect(result.current).toBe('p1');
  });

  it('keeps explicit Studio bindings and tolerates legacy project keys resembling scoped keys', () => {
    const explicit = renderHook(() => useStudioToolScope('p1', 'window'));
    act(() => { registerStudio('p1'); registerStudio(studioToolScope('p1', 'other')); });
    expect(explicit.result.current).toBe(studioToolScope('p1', 'window'));
    const legacy = renderHook(() => useStudioToolScope('studio:not-json'));
    act(() => {
      registerStudio('studio:not-json');
      registerStudio('studio:[1,2]');
      registerStudio('studio:["single"]');
      registerStudio('studio:["different","window"]');
    });
    expect(legacy.result.current).toBe('studio:not-json');
    const missing = renderHook(() => useStudioToolScope('absent'));
    expect(missing.result.current).toBe('absent');
  });

  it('orders slots by tool, keeps projects apart and opts out with a null key', () => {
    const { result } = renderHook(() => useStudioToolSlots('p1'));
    const off = renderHook(() => useStudioToolSlots(null));
    act(() => {
      attachStudioTool('p1', 'comments', document.createElement('div'));
      attachStudioTool('p1', 'actions', document.createElement('div'));
      attachStudioTool('p2', 'actions', document.createElement('div'));
    });
    expect(result.current.map(slot => slot.tool)).toEqual(['actions', 'comments']);
    expect(off.result.current).toEqual([]);
  });

  it('tracks whether a Studio renders a project and drops unshown tools when it leaves', () => {
    const mounted = renderHook(() => useStudioMounted('p1'));
    const slots = renderHook(() => useStudioToolSlots('p1'));
    expect(mounted.result.current).toBe(false);
    let unregister!: () => void;
    act(() => { unregister = registerStudio('p1'); });
    expect(mounted.result.current).toBe(true);
    let release!: () => void;
    act(() => { release = attachStudioTool('p1', 'comments', document.createElement('div')); attachStudioTool('p1', 'actions', document.createElement('div')); });
    act(() => release());
    act(() => unregister());
    expect(mounted.result.current).toBe(false);
    // The shown actions tab keeps its node for the next Studio; the hidden comments node is gone.
    expect(slots.result.current.map(slot => slot.tool)).toEqual(['actions']);
  });

  it('forgets a project once nothing uses it', () => {
    const container = document.createElement('div');
    const release = attachStudioTool('p1', 'actions', container);
    const node = container.firstChild;
    release();
    const unregister = registerStudio('p1');
    unregister();
    const { result } = renderHook(() => useStudioToolSlots('p1'));
    act(() => { attachStudioTool('p1', 'actions', container); });
    expect(result.current[0].node).not.toBe(node);
  });
});

describe('StudioPanelTool', () => {
  it('shows an empty state until Studio renders the tool, then hosts its node', () => {
    render(<StudioPanelTool tool="comments" title="Comments" projectId="p1" />);
    expect(screen.getByText('Comments needs Agent Script Studio')).toBeTruthy();
    const host = screen.getByTestId('studio-panel-tool-comments');
    const slot = host.querySelector('.sf-panel-tool-slot') as HTMLElement;
    expect(slot.hidden).toBe(true);
    expect(slot.querySelector('[data-studio-tool="comments"]')).toBeTruthy();
    let unregister!: () => void;
    act(() => { unregister = registerStudio('p1'); });
    expect(screen.queryByText('Comments needs Agent Script Studio')).toBeNull();
    expect(slot.hidden).toBe(false);
    act(() => unregister());
    expect(screen.getByText('Comments needs Agent Script Studio')).toBeTruthy();
  });

  it('hands the node back on unmount and scopes by project', () => {
    const slots = renderHook(() => useStudioToolSlots(''));
    const { unmount } = render(<StudioPanelTool tool="actions" title="Actions" />);
    expect(slots.result.current[0]).toMatchObject({ tool: 'actions', attached: true });
    unmount();
    expect(slots.result.current[0].attached).toBe(false);
  });

  it('builds the thread-panel component for a tool', () => {
    const Tool = studioPanelTool('comments', 'Comments');
    expect(Tool.displayName).toBe('StudioPanelTool(comments)');
    const slots = renderHook(() => useStudioToolSlots('p9'));
    render(<Tool pluginId="salesforce" projectId="p9" threadId="" params={null} surface="plugin-page" tabId="tab-9" />);
    expect(screen.getByTestId('studio-panel-tool-comments')).toBeTruthy();
    expect(slots.result.current[0]).toMatchObject({ tool: 'comments', tabId: 'tab-9' });
    expect(screen.getByText('Comments needs Agent Script Studio')).toBeTruthy();
  });

  it('preserves a tool node and its form state across tab switches and reopening', () => {
    registerStudio('p1');
    const view = render(<StudioPanelTool tool="preview" title="Preview" projectId="p1" tabId="old" />);
    const node = screen.getByTestId('studio-panel-tool-preview').querySelector('[data-studio-tool="preview"]')!;
    const input = document.createElement('input');
    input.value = 'Unsent preview message'; node.appendChild(input);
    view.unmount();
    render(<StudioPanelTool tool="preview" title="Preview" projectId="p1" tabId="new" />);
    expect(screen.getByTestId('studio-panel-tool-preview').querySelector('[data-studio-tool="preview"]')).toBe(node);
    expect(node.querySelector('input')?.value).toBe('Unsent preview message');
  });

  it('routes explicit launch params and a bare New Tab to the correct registered Studio', () => {
    const Tool = studioPanelTool('graph', 'Graph');
    const mainScope = studioToolScope('p1', 'main');
    const windowScope = studioToolScope('p1', 'window');
    registerStudio(mainScope);
    registerStudio(windowScope);
    const main = renderHook(() => useStudioToolSlots(mainScope));
    const window = renderHook(() => useStudioToolSlots(windowScope));
    const view = render(<Tool pluginId="salesforce" projectId="p1" threadId="" params={{ studioId: 'main' }} surface="plugin-page" tabId="explicit" />);
    expect(main.result.current[0]).toMatchObject({ tool: 'graph', attached: true, tabId: 'explicit' });
    expect(window.result.current).toEqual([]);
    view.rerender(<Tool pluginId="salesforce" projectId="p1" threadId="" params={null} surface="plugin-page" tabId="bare" />);
    expect(main.result.current[0].attached).toBe(false);
    expect(window.result.current[0]).toMatchObject({ tool: 'graph', attached: true, tabId: 'bare' });
    view.rerender(<Tool pluginId="salesforce" projectId="p1" threadId="" params={{ studioId: 42 }} surface="plugin-page" />);
    expect(window.result.current[0].attached).toBe(true);
    view.rerender(<Tool pluginId="salesforce" projectId="p1" threadId="" params={['invalid']} surface="plugin-page" />);
    expect(window.result.current[0].attached).toBe(true);
    view.rerender(<Tool pluginId="salesforce" projectId="p1" threadId="" params="invalid" surface="plugin-page" />);
    expect(window.result.current[0].attached).toBe(true);
  });
});
