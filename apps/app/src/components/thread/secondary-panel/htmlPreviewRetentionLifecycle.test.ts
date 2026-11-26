/** @vitest-environment happy-dom */
import { beforeEach, expect, it, vi } from 'vitest';
import { installHtmlPreviewRetentionLifecycle } from './htmlPreviewRetentionLifecycle.js';

const mocks = vi.hoisted(() => ({
  archived: null as null | ((id: string) => void), tabs: null as null | ((payload: unknown) => void),
  forgetOwner: vi.fn(), observeServerTabs: vi.fn(), dispose: vi.fn(), unsubscribeArchive: vi.fn(), unsubscribeTabs: vi.fn()
}));
vi.mock('../../../lib/product-client.js', () => ({ product: { threads: { onTabs: (cb: (payload: unknown) => void) => {
  mocks.tabs = cb; return mocks.unsubscribeTabs;
} } } }));
vi.mock('../../../thread-store.js', () => ({ onThreadArchived: (cb: (id: string) => void) => {
  mocks.archived = cb; return mocks.unsubscribeArchive;
} }));
vi.mock('./htmlPreviewRetention.js', () => ({
  htmlPreviewRetention: () => ({ forgetOwner: mocks.forgetOwner, observeServerTabs: mocks.observeServerTabs }),
  disposeRetainedHtmlPreviews: mocks.dispose
}));
beforeEach(() => vi.clearAllMocks());

it('installs one app-lifetime archive/tab subscription and releases them with the window cache', () => {
  const stop = installHtmlPreviewRetentionLifecycle();
  mocks.archived?.('t1');
  expect(mocks.forgetOwner).toHaveBeenCalledWith('t1');
  mocks.tabs?.({ threadId: 't1', revision: 2, tabs: [{ id: 'a' }, { id: 'b' }] });
  expect(mocks.observeServerTabs).toHaveBeenCalledWith('t1', 2, new Set(['a', 'b']));
  stop();
  expect(mocks.unsubscribeArchive).toHaveBeenCalledOnce();
  expect(mocks.unsubscribeTabs).toHaveBeenCalledOnce();
  expect(mocks.dispose).toHaveBeenCalledWith(document);
});

it.each([null, 'text', {}, { threadId: 2, revision: 1, tabs: [] },
  { threadId: 't1', revision: '1', tabs: [] }, { threadId: 't1', revision: -1, tabs: [] },
  { threadId: 't1', revision: 1.1, tabs: [] }, { threadId: 't1', revision: 1, tabs: {} },
  { threadId: 't1', revision: 1, tabs: [null] }, { threadId: 't1', revision: 1, tabs: [4] },
  { threadId: 't1', revision: 1, tabs: [{ id: 7 }] }
])('ignores incomplete or malformed tab updates: %j', payload => {
  const stop = installHtmlPreviewRetentionLifecycle();
  mocks.tabs?.(payload);
  expect(mocks.observeServerTabs).not.toHaveBeenCalled();
  stop();
});
