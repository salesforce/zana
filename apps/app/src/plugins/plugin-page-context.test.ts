import { describe, expect, it } from 'vitest';
import { getPluginPageContext, requestPluginPageContext } from './plugin-page-panel.js';

describe('page context publication', () => {
  it('isolates plugin pages, snapshots input/output, and clears on unmount', () => {
    const page = { pluginId: 'notes', page: 'main' };
    const otherPane = { pluginId: 'notes', page: 'main' };
    const context = { title: 'Document A', resourceId: 'a', mention: { providerId: 'doc', itemId: 'a' } };
    expect(getPluginPageContext(page)).toBeNull();
    expect(requestPluginPageContext('notes', context, page)).toBe(true);
    context.title = 'mutated';
    expect(getPluginPageContext(page)?.title).toBe('Document A');
    const captured = getPluginPageContext(page)!;
    captured.mention!.itemId = 'mutated';
    expect(getPluginPageContext(page)?.mention?.itemId).toBe('a');
    expect(getPluginPageContext(otherPane)).toBeNull();
    expect(requestPluginPageContext('notes', { title: 'Settings' }, page)).toBe(true);
    expect(getPluginPageContext(page)).toEqual({ title: 'Settings' });
    expect(requestPluginPageContext('notes', null, page)).toBe(true);
    expect(getPluginPageContext(page)).toBeNull();
  });
  it('rejects invalid context and unrelated plugins without losing the current resource', () => {
    const page = { pluginId: 'notes', page: 'main' };
    expect(requestPluginPageContext('notes', { title: 'A' }, page)).toBe(true);
    expect(requestPluginPageContext('other', { title: 'B' }, page)).toBe(false);
    expect(requestPluginPageContext('notes', { title: 'B' })).toBe(false);
    expect(requestPluginPageContext('notes', { title: 'x'.repeat(161) }, page)).toBe(false);
    expect(getPluginPageContext(page)).toEqual({ title: 'A' });
  });

  it('isolates route publications and late cleanup without changing the shared page identity', () => {
    const page = { pluginId: 'notes', page: 'main' };
    const otherPane = { ...page };
    const routeA = {};
    const routeB = {};
    expect(requestPluginPageContext('notes', { title: 'A' }, page, routeA)).toBe(true);
    expect(getPluginPageContext(page, routeB)).toBeNull();
    expect(requestPluginPageContext('notes', { title: 'B' }, page, routeB)).toBe(true);
    expect(requestPluginPageContext('notes', { title: 'Late A' }, page, routeA)).toBe(true);
    expect(requestPluginPageContext('notes', null, page, routeA)).toBe(true);
    expect(getPluginPageContext(page, routeB)).toEqual({ title: 'B' });
    expect(getPluginPageContext(otherPane, routeB)).toBeNull();
    expect(getPluginPageContext(page)).toBeNull();
    expect(requestPluginPageContext('notes', null, page, routeB)).toBe(true);
    expect(getPluginPageContext(page, routeB)).toBeNull();
  });
});
