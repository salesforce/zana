// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { PluginComposerChrome } from './PluginComposerChrome.js';
import { getActiveComposerApi } from './plugin-composer-api.js';
// The insertion registry follows mounted ownership, including rerender and teardown.
import { render as renderDom, cleanup } from '@testing-library/react';
import { addThreadContext } from './thread-context-target.js';
afterEach(cleanup);
it('registers only capable thread composers and releases the destination when its owner changes', () => {
  const insert = vi.fn(() => true);
  const reference = { version: 1 as const, label: 'Log', text: 'snapshot' };
  const element = (scope: Parameters<typeof PluginComposerChrome>[0]['scope'], enabled = true) =>
    <PluginComposerChrome scope={scope} text="" setText={() => undefined} focus={() => undefined}
      insertContextReference={enabled ? insert : undefined}><span>composer</span></PluginComposerChrome>;
  const view = renderDom(element({ kind: 'thread', threadId: 'first' }));
  expect(addThreadContext('first', reference)).toBe(true);
  expect(insert).toHaveBeenCalledWith(reference);
  expect(getActiveComposerApi()!.insertContextReference).toBe(insert);
  view.rerender(element({ kind: 'thread', threadId: 'second' }));
  expect(addThreadContext('first', reference)).toBe(false);
  expect(addThreadContext('second', reference)).toBe(true);
  view.rerender(element({ kind: 'thread', threadId: 'second' }, false));
  expect(addThreadContext('second', reference)).toBe(false);
  view.rerender(element({ kind: 'new-thread', projectId: null }));
  expect(addThreadContext('second', reference)).toBe(false);
  view.rerender(element({ kind: 'thread', threadId: 'second' }));
  view.unmount();
  expect(addThreadContext('second', reference)).toBe(false);
});
