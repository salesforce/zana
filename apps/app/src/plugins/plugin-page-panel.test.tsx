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
  onPluginPanelScopeRequest,
  parsePluginPanelScope,
  requestPluginPanelScope,
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


describe('plugin page resource scopes', () => {
  it('accepts a bounded identity, optional recorded view, or an explicit reset', () => {
    expect(parsePluginPanelScope({ id: 'agents/support.agent', view: 'agents/support.agent' })).toEqual({ id: 'agents/support.agent', view: 'agents/support.agent' });
    expect(parsePluginPanelScope({ id: 'a', view: 'v'.repeat(500) })?.view).toHaveLength(500);
    expect(parsePluginPanelScope({ id: 'a' })).toEqual({ id: 'a' });
    expect(parsePluginPanelScope(null)).toBeNull();
    for (const value of [undefined, [], {}, 'a', { id: 1 }, { id: ' ' }, { id: 'a'.repeat(4097) }, { id: 'a\n' }, { id: 'a', view: ' ' }, { id: 'a', view: 1 }, { id: 'a', view: 'v'.repeat(501) }, { id: 'a', view: 'a\u0000b' }]) {
      expect(parsePluginPanelScope(value)).toBeUndefined();
    }
  });

  it('routes changes only to the enclosing page and ignores malformed events', () => {
    const ownPage = { ...page };
    const otherPage = { ...page };
    const show = vi.fn();
    const other = vi.fn();
    const off = onPluginPanelScopeRequest(ownPage, show);
    const offOther = onPluginPanelScopeRequest(otherPage, other);
    expect(show).toHaveBeenCalledWith(null);
    show.mockClear(); other.mockClear();
    expect(requestPluginPanelScope('salesforce', { id: 'a' }, ownPage)).toBe(true);
    expect(show).toHaveBeenCalledWith({ id: 'a' });
    expect(other).not.toHaveBeenCalled();
    expect(requestPluginPanelScope('gus', { id: 'a' }, ownPage)).toBe(false);
    expect(requestPluginPanelScope('salesforce', { id: 'a' })).toBe(false);
    expect(requestPluginPanelScope('salesforce', { id: '' }, ownPage)).toBe(false);
    window.dispatchEvent(new CustomEvent('zcc:plugin-panel-scope'));
    window.dispatchEvent(new CustomEvent('zcc:plugin-panel-scope', { detail: { page: ownPage, scope: { id: '' } } }));
    expect(show).toHaveBeenCalledTimes(1);
    expect(requestPluginPanelScope('salesforce', null, ownPage)).toBe(true);
    expect(show).toHaveBeenLastCalledWith(null);
    off(); offOther();
    expect(requestPluginPanelScope('salesforce', { id: 'b' }, ownPage)).toBe(false);
  });

  it('remembers a selection published by the plugin before its host subscribes', () => {
    const earlyPage = { ...page };
    requestPluginPanelScope('salesforce', { id: 'a', view: 'a' }, earlyPage);
    const show = vi.fn();
    const off = onPluginPanelScopeRequest(earlyPage, show);
    expect(show).toHaveBeenCalledWith({ id: 'a', view: 'a' });
    off();
    // A later selection replaces the earlier one rather than accumulating state.
    requestPluginPanelScope('salesforce', null, earlyPage);
    const offReset = onPluginPanelScopeRequest(earlyPage, show);
    expect(show).toHaveBeenLastCalledWith(null);
    offReset();
  });
});
