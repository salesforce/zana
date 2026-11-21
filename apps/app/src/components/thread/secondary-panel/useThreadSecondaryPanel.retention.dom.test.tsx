/** @vitest-environment happy-dom */
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { useLayoutEffect, useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { useSecondaryPanel, useThreadSecondaryPanel } from './useThreadSecondaryPanel.js';
import { emptySecondaryPanelState, persistSecondaryPanel } from './threadSecondaryPanelState.js';
import { disposeRetainedHtmlPreviews, htmlPreviewRetention } from './htmlPreviewRetention.js';

const mocks = vi.hoisted(() => ({ tabs: vi.fn(), updateTabs: vi.fn(), onTabs: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({ product: { threads: mocks, terminals: { close: vi.fn(), list: vi.fn() } } }));
vi.mock('../../../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));

const tab = (id: string) => ({ id, kind: 'file-preview' as const, title: 'Preview', path: `${id}.html` });
function Preview({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => htmlPreviewRetention(document).mount(ref.current!, {
    path: `${id}.html`, src: `about:blank?path=${id}`, ownerId: 't1', tabId: id
  }), [id]);
  return <div ref={ref} />;
}
function ServerHydratedPreview() {
  const panel = useThreadSecondaryPanel('t1');
  return panel.state.tabs[0] ? <Preview id={panel.state.tabs[0].id} /> : null;
}

beforeEach(() => {
  localStorage.clear();
  mocks.tabs.mockReset().mockResolvedValue({ revision: 1, tabs: [] });
  mocks.updateTabs.mockReset().mockResolvedValue({ revision: 2, tabs: [] });
  mocks.onTabs.mockReset().mockReturnValue(() => {});
  Object.defineProperty(Element.prototype, 'moveBefore', {
    configurable: true, value(this: Element, node: Node) { this.appendChild(node); }
  });
});
afterEach(() => {
  cleanup();
  disposeRetainedHtmlPreviews(document);
  document.body.replaceChildren();
  Reflect.deleteProperty(Element.prototype, 'moveBefore');
});

it('marks a newly hydrated frame known to the server before it is cached off-route', async () => {
  mocks.tabs.mockResolvedValue({ revision: 3, tabs: [{ id: 'a', kind: 'workspace-file-preview', path: 'a.html', source: { kind: 'working-tree' } }] });
  const view = render(<ServerHydratedPreview />);
  await act(async () => {});
  const frame = document.querySelector('iframe')!;
  expect(frame).not.toBeNull();
  view.unmount();
  expect(frame.isConnected).toBe(true);
  htmlPreviewRetention(document).observeServerTabs('t1', 4, new Set());
  expect(frame.isConnected).toBe(false);
  expect(mocks.updateTabs).not.toHaveBeenCalled();
});

it('does not prune the next owner using the previous owner state during an in-place owner switch', () => {
  persistSecondaryPanel('a', { ...emptySecondaryPanelState(), tabs: [tab('a-preview')] });
  persistSecondaryPanel('b', { ...emptySecondaryPanelState(), tabs: [tab('b-preview')] });
  const anchor = document.createElement('div'); document.body.appendChild(anchor);
  const release = htmlPreviewRetention(document).mount(anchor, { ownerId: 'b', tabId: 'b-preview', path: 'b-preview.html', src: 'about:blank?path=b' });
  const frame = anchor.querySelector('iframe')!;
  release();
  const view = renderHook(({ owner }) => useSecondaryPanel(owner), { initialProps: { owner: 'a' } });
  view.rerender({ owner: 'b' });
  expect(view.result.current.state.tabs[0].id).toBe('b-preview');
  expect(frame.isConnected).toBe(true);
});

it('releases the exact cached frame on an explicit local tab close', async () => {
  persistSecondaryPanel('t1', { ...emptySecondaryPanelState(), tabs: [tab('a')] });
  const anchor = document.createElement('div'); document.body.appendChild(anchor);
  const release = htmlPreviewRetention(document).mount(anchor, { ownerId: 't1', tabId: 'a', path: 'a.html', src: 'about:blank?path=a' });
  const frame = anchor.querySelector('iframe')!;
  release();
  const view = renderHook(() => useSecondaryPanel('t1'));
  await act(async () => view.result.current.closeTab('a'));
  expect(frame.isConnected).toBe(false);
  expect(view.result.current.state.tabs).toHaveLength(0);
});
