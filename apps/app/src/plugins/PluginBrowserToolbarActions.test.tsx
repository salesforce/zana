// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  collectPluginApp,
  definePluginApp,
  type PluginBrowserToolbarActionProps,
} from '@zana-ai/zcc-plugin-sdk';
import { replacePluginSlots, clearPluginSlots } from './plugin-slots.js';
import { PluginBrowserToolbarActions } from './PluginBrowserToolbarActions.js';
import {
  registerThreadContextTarget,
  registerThreadContextControls,
  notifyThreadSubmitted,
} from './thread-context-target.js';
const f = vi.hoisted(() => ({
  evaluate: vi.fn(async () => 42),
  listen: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../lib/desktop-browser.js', () => ({
  getDesktopBrowserApi: () => ({
    evaluate: f.evaluate,
    onPageMessage: (listener: unknown) => {
      f.listen(listener);
      return f.remove;
    },
  }),
}));
afterEach(() => {
  cleanup();
  clearPluginSlots('test-tools');
  vi.clearAllMocks();
});
it('passes a scoped page and composer, stamps plugin ownership, and filters page events', async () => {
  let props!: PluginBrowserToolbarActionProps;
  const set = collectPluginApp(
    'test-tools',
    1,
    definePluginApp((app) =>
      app.slots.experimental_browserToolbarAction({
        id: 'annotate',
        title: 'Annotate',
        component: (value) => {
          props = value;
          return <button>Annotate</button>;
        },
      }),
    ),
  );
  replacePluginSlots('test-tools', set);
  const insert = vi.fn(() => true),
    update = vi.fn(() => true),
    focus = vi.fn();
  const unregister = registerThreadContextTarget('thread', insert),
    stop = registerThreadContextControls('thread', { update, focus });
  render(
    <PluginBrowserToolbarActions
      threadId="thread"
      tabId="tab"
      url="http://localhost/"
    />,
  );
  const ref = {
    version: 1 as const,
    label: 'Selected',
    text: 'snapshot',
    source: {
      kind: 'plugin' as const,
      pluginId: 'test-tools',
      resourceId: 'r',
    },
  };
  try {
    expect(props.composer.insert(ref)).toBe(true);
    expect(
      props.composer.insert({
        ...ref,
        source: { ...ref.source, pluginId: 'other' },
      }),
    ).toBe(false);
    expect(props.composer.update('r', ref)).toBe(true);
    expect(props.composer.update('wrong', ref)).toBe(false);
    expect(props.composer.update('r', null)).toBe(true);
    props.composer.focus();
    expect(focus).toHaveBeenCalledOnce();
    const onSubmitted = vi.fn();
    const off = props.composer.onSubmitted(onSubmitted);
    notifyThreadSubmitted('thread');
    expect(onSubmitted).toHaveBeenCalledOnce();
    off();
    expect(await props.page!.evaluate('42', { world: 'main' })).toBe(42);
    expect(f.evaluate).toHaveBeenCalledWith({
      tabId: 'tab',
      threadId: 'thread',
      expression: '42',
      world: 'main',
    });
    const receive = vi.fn();
    const dispose = props.page!.onMessage(receive);
    const listener = f.listen.mock.calls[0]![0] as (message: unknown) => void;
    listener({ tabId: 'other', threadId: 'thread', data: 1 });
    listener({ tabId: 'tab', threadId: 'other', data: 2 });
    listener({ tabId: 'tab', threadId: 'thread', data: 3 });
    expect(receive).toHaveBeenCalledExactlyOnceWith(3);
    dispose();
    expect(f.remove).toHaveBeenCalledOnce();
  } finally {
    unregister();
    stop();
  }
});
it('serializes page evaluation, bounds pending requests and recovers after a rejected request', async () => {
  let props!: PluginBrowserToolbarActionProps;
  replacePluginSlots(
    'test-tools',
    collectPluginApp(
      'test-tools',
      1,
      definePluginApp((app) =>
        app.slots.experimental_browserToolbarAction({
          id: 'queue',
          title: 'Queue',
          component: (value) => {
            props = value;
            return null;
          },
        }),
      ),
    ),
  );
  render(
    <PluginBrowserToolbarActions
      threadId="thread"
      tabId="tab"
      url="about:blank"
    />,
  );
  let release!: (value: number) => void;
  f.evaluate.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        release = resolve;
      }),
  );
  const first = props.page!.evaluate('first');
  const second = props.page!.evaluate('second');
  await waitFor(() => expect(f.evaluate).toHaveBeenCalledTimes(1));
  release(1);
  await expect(first).resolves.toBe(1);
  await expect(second).resolves.toBe(42);
  f.evaluate.mockRejectedValueOnce(new Error('navigation'));
  await expect(props.page!.evaluate('bad')).rejects.toThrow('navigation');
  await expect(props.page!.evaluate('next')).resolves.toBe(42);
  const requests = Array.from({ length: 16 }, (_, i) =>
    props.page!.evaluate(String(i)),
  );
  await expect(props.page!.evaluate('overflow')).rejects.toThrow('Too many');
  await Promise.all(requests);
});
