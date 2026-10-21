/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

const h = vi.hoisted(() => ({
  state: { projects: [{ id: 'p-1', name: 'Acme' }], init: vi.fn(async () => {}) },
  threads: [{ id: 't-1', projectId: 'p-1', title: 'Fix login' }] as Array<{ id: string; projectId: string; title: string }>,
  archived: null as null | ((threadId: string) => void),
  changed: null as null | ((entries: unknown[]) => void),
  offChanged: vi.fn(),
  reconcile: vi.fn(async () => {}),
  close: vi.fn(async () => true),
  show: vi.fn(async () => true),
  navigate: null as null | ((path: string) => void)
}));
vi.mock('@/lib/monaco-loader', () => ({}));
vi.mock('@/store', () => ({ useData: (select: (state: typeof h.state) => unknown) => select(h.state) }));
vi.mock('@/components/HostDialogs', () => ({ HostDialogs: () => null }));
vi.mock('@/components/Toaster', () => ({ Toaster: () => null }));
vi.mock('@/plugins/PluginThemesHost', () => ({ PluginThemesHost: () => null }));
vi.mock('@/plugins/plugin-app-loader', () => ({ initPluginApps: async () => {}, reconcilePluginApps: h.reconcile }));
vi.mock('@/plugins/plugin-view-windows', () => ({ showInMainWindow: h.show }));
vi.mock('@/lib/thread-view-windows', () => ({ closeThreadViewWindow: h.close }));
vi.mock('@/components/thread/secondary-panel/useThreadOpenFileSignal', () => ({ installThreadOpenFileSignals: () => () => {} }));
vi.mock('@/hooks/useShellChromeState', () => ({ useShellChromeState: () => ({ platform: 'macos', reserveMacosTrafficLights: true }) }));
vi.mock('@/hooks/useEnsureThreads', () => ({ useEnsureThreads: () => {} }));
vi.mock('@/thread-store', () => ({
  useThreads: (select: (state: { threads: typeof h.threads }) => unknown) => select({ threads: h.threads }),
  onThreadArchived: (listener: (threadId: string) => void) => {
    h.archived = listener;
    return () => { h.archived = null; };
  }
}));
vi.mock('@/views/threads/ThreadDetailView', () => ({
  ThreadDetail: ({ threadId }: { threadId: string }) => {
    const navigate = useNavigate();
    h.navigate = navigate;
    return <p data-testid="thread-detail">thread {threadId}</p>;
  }
}));
vi.mock('@/lib/product-client', () => ({
  product: {
    pluginApps: {
      onChanged: (callback: (entries: unknown[]) => void) => {
        h.changed = callback;
        return h.offChanged;
      }
    }
  }
}));

import { ThreadViewApp } from './ThreadViewApp.js';

const target = { threadId: 't-1', projectId: 'p-1' };
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

function mount(view = target) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ThreadViewApp target={view} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  h.threads = [{ id: 't-1', projectId: 'p-1', title: 'Fix login' }];
  h.archived = null;
  h.changed = null;
  h.navigate = null;
  for (const fn of [h.state.init, h.offChanged, h.reconcile, h.close, h.show]) fn.mockClear();
});
afterEach(cleanup);

it('shows the thread under a title strip naming it and its project', () => {
  mount();
  expect(screen.getByTestId('thread-detail').textContent).toBe('thread t-1');
  expect(screen.getByTestId('thread-view-title').textContent).toBe('Fix login — Acme');
  expect(document.title).toBe('Fix login — Acme — Zana [DEV]'.replace(' [DEV]', import.meta.env.DEV ? ' [DEV]' : ''));
  expect(h.state.init).toHaveBeenCalled();
});

it('falls back to a generic title for a thread not in the roster', () => {
  h.threads = [];
  mount({ threadId: 't-9' });
  expect(screen.getByTestId('thread-view-title').textContent).toBe('Agent');
});

it('brings the thread back to the main window, then closes', async () => {
  mount();
  fireEvent.click(screen.getByTestId('thread-view-bring-back'));
  await flush();
  expect(h.show).toHaveBeenCalledWith('/projects/p-1/threads/t-1');
  expect(h.close).toHaveBeenCalledWith(target);
});

it('closes on ⌘W and when its thread is archived', () => {
  mount();
  fireEvent.keyDown(window, { key: 'w', metaKey: true });
  expect(h.close).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: 'x', metaKey: true });
  act(() => h.archived?.('t-2'));
  expect(h.close).toHaveBeenCalledTimes(1);
  act(() => h.archived?.('t-1'));
  expect(h.close).toHaveBeenCalledTimes(2);
});

it('sends links to another thread to the main window and stays on its own', async () => {
  mount();
  act(() => h.navigate?.('/projects/p-1/threads/t-2'));
  await flush();
  expect(h.show).toHaveBeenCalledWith('/projects/p-1/threads/t-2');
  expect(h.close).not.toHaveBeenCalled();
  expect(screen.getByTestId('thread-detail').textContent).toBe('thread t-1');
});

it('closes after sending a list link to the main window', async () => {
  mount();
  act(() => h.navigate?.('/agents'));
  await flush();
  expect(h.show).toHaveBeenCalledWith('/agents');
  expect(h.close).toHaveBeenCalledWith(target);
});

it('reconciles plugin apps and stops on unmount', () => {
  const view = mount();
  act(() => h.changed?.([]));
  expect(h.reconcile).toHaveBeenCalledWith([]);
  view.unmount();
  expect(h.offChanged).toHaveBeenCalled();
});
