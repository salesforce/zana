// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

const actions = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('./plugin-slots.js', () => ({
  listThreadPanelActions: () => actions
}));

import {
  onPluginPanelToolRequest,
  PANEL_TOOL_TITLE_MAX_LENGTH,
  PluginPagePanelProvider,
  requestPluginPanelTool,
  resolvePanelToolTarget,
  usePluginPagePanel
} from './plugin-page-panel.js';

const page = { pluginId: 'salesforce', page: 'salesforce' };

afterEach(() => {
  actions.length = 0;
});

function register() {
  actions.push(
    { pluginId: 'salesforce', id: 'graph', title: 'Graph', scopes: ['plugin-page'], layout: 'flush' },
    { pluginId: 'salesforce', id: 'other-page', title: 'Other', scopes: ['plugin-page'], pages: ['orgs'] },
    { pluginId: 'salesforce', id: 'thread-only', title: 'Thread' },
    { pluginId: 'gus', id: 'gus-tool', title: 'Gus', scopes: ['plugin-page'] }
  );
}

describe('usePluginPagePanel', () => {
  it('is null outside a page and the page inside its provider', () => {
    expect(renderHook(() => usePluginPagePanel()).result.current).toBeNull();
    const wrapper = ({ children }: { children: ReactNode }) => <PluginPagePanelProvider page={page}>{children}</PluginPagePanelProvider>;
    expect(renderHook(() => usePluginPagePanel(), { wrapper }).result.current).toEqual(page);
  });
});

describe('resolvePanelToolTarget', () => {
  it('opens only the page owner\'s plugin-page actions for this page', () => {
    register();
    expect(resolvePanelToolTarget(page, { actionId: 'graph' })).toEqual({ actionId: 'graph', title: 'Graph', params: null, layout: 'flush' });
    expect(resolvePanelToolTarget(page, { actionId: 'other-page' })).toBeNull();
    expect(resolvePanelToolTarget({ pluginId: 'salesforce', page: 'orgs' }, { actionId: 'other-page' })).toEqual({ actionId: 'other-page', title: 'Other', params: null });
    expect(resolvePanelToolTarget(page, { actionId: 'thread-only' })).toBeNull();
    expect(resolvePanelToolTarget(page, { actionId: 'gus-tool' })).toBeNull();
    expect(resolvePanelToolTarget(page, { actionId: 'missing' })).toBeNull();
  });

  it('rejects malformed input', () => {
    register();
    for (const options of [null, undefined, 'graph', {}, { actionId: '' }, { actionId: 7 }]) {
      expect(resolvePanelToolTarget(page, options)).toBeNull();
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(resolvePanelToolTarget(page, { actionId: 'graph', params: cyclic })).toBeNull();
  });

  it('bounds the title and clones params', () => {
    register();
    const params = { node: 'n1', nested: { at: 1 } };
    const target = resolvePanelToolTarget(page, { actionId: 'graph', title: `  ${'x'.repeat(200)}  `, params });
    expect(target?.title).toHaveLength(PANEL_TOOL_TITLE_MAX_LENGTH);
    expect(target?.params).toEqual(params);
    expect(target?.params).not.toBe(params);
    expect(resolvePanelToolTarget(page, { actionId: 'graph', title: '   ' })?.title).toBe('Graph');
  });
});

describe('requestPluginPanelTool', () => {
  it('reports false with no layout listening, and true once one opens the tool', () => {
    register();
    expect(requestPluginPanelTool('salesforce', { actionId: 'graph' })).toBe(false);
    const show = vi.fn();
    const off = onPluginPanelToolRequest(page, show);
    expect(requestPluginPanelTool('gus', { actionId: 'gus-tool' })).toBe(false);
    expect(requestPluginPanelTool('salesforce', { actionId: 'thread-only' })).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(requestPluginPanelTool('salesforce', { actionId: 'graph', title: 'Focus' })).toBe(true);
    expect(show).toHaveBeenCalledWith({ actionId: 'graph', title: 'Focus', params: null, layout: 'flush' });
    off();
    expect(requestPluginPanelTool('salesforce', { actionId: 'graph' })).toBe(false);
  });

  it('lets only the first matching layout open a request', () => {
    register();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onPluginPanelToolRequest(page, first);
    const offSecond = onPluginPanelToolRequest(page, second);
    expect(requestPluginPanelTool('salesforce', { actionId: 'graph' })).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    offFirst();
    offSecond();
  });

  it('sends a request to the layout beside the asking page (split panes)', () => {
    register();
    const paneA = { ...page };
    const paneB = { ...page };
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onPluginPanelToolRequest(paneA, first);
    const offSecond = onPluginPanelToolRequest(paneB, second);
    expect(requestPluginPanelTool('salesforce', { actionId: 'graph' }, paneB)).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    offSecond();
    expect(requestPluginPanelTool('salesforce', { actionId: 'graph' }, paneB)).toBe(false);
    offFirst();
  });

  it('ignores an event without a request', () => {
    const show = vi.fn();
    const off = onPluginPanelToolRequest(page, show);
    window.dispatchEvent(new CustomEvent('zcc:plugin-panel-tool-open'));
    expect(show).not.toHaveBeenCalled();
    off();
  });
});
