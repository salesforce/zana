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
  useStudioMounted,
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
    expect(PANEL_TOOLS).toEqual(['actions', 'comments']);
    expect(isPanelTool('actions')).toBe(true);
    expect(isPanelTool('preview')).toBe(false);
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
});
