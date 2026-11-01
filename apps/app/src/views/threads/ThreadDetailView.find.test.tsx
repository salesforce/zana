// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (payload: unknown) => void;

const h = vi.hoisted(() => ({
  controls: null as HTMLElement | null,
  ui: { threadModal: null as unknown, agentModal: null as unknown },
  off: vi.fn(),
  get: vi.fn(),
  timeline: vi.fn(),
  upsert: vi.fn()
}));

// Thread data and live updates.
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../../lib/product-client.js', () => ({
  product: {
    threads: {
      get: h.get,
      timeline: h.timeline,
      onEvent: (_listener: Listener) => h.off,
      onUpdated: (_listener: Listener) => h.off
    }
  }
}));
vi.mock('../../lib/product-ws.js', () => ({
  subscribeProductReconnect: (_listener: () => void) => h.off
}));
vi.mock('../../thread-store.js', async (original) => {
  const state = { threads: [], upsert: h.upsert };
  return {
    ...await original<object>(),
    useThreads: Object.assign((pick: (s: typeof state) => unknown) => pick(state), { getState: () => state })
  };
});
// `useUi.getState()` is what the find target reads to tell whether a modal covers the thread.
vi.mock('../../store.js', () => ({
  useData: (pick: (s: { projects: [] }) => unknown) => pick({ projects: [] }),
  useUi: { getState: () => h.ui }
}));

// Layout: desktop, no split pane, mobile header slot set per test.
vi.mock('../../hooks/useRouteState.js', () => ({
  useRouteState: () => ({ threadId: 'a', isProjectFocused: false })
}));
vi.mock('../../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../../components/useMobileThreadTitleTarget.js', () => ({
  useMobileThreadTitleTarget: () => null,
  useMobileThreadActionsTarget: () => null,
  useMobileThreadControlsTarget: () => h.controls
}));
vi.mock('../thread-detail/PaneContext.js', () => ({
  useOptionalPaneContext: () => null,
  usePaneSecondaryPanelRegistration: () => {}
}));

// Side panel, closed.
vi.mock('../../components/thread/secondary-panel/useThreadSecondaryPanel.js', () => ({
  useThreadSecondaryPanel: () => ({
    state: { tabs: [], isOpen: false, isMaximized: false, activeId: null, widthPx: 320 },
    open: () => {}
  })
}));
vi.mock('../../components/thread/secondary-panel/ThreadSecondaryPanel.js', () => ({
  ThreadSecondaryPanel: ({ children }: { children: ReactNode }) => <aside>{children}</aside>
}));
vi.mock('../../components/thread/secondary-panel/BrowserTabDeck.js', () => ({ BrowserTabDeck: () => null }));
vi.mock('../../components/thread/secondary-panel/useInAppBrowserPanel.js', () => ({ useInAppBrowserPanel: () => {} }));
vi.mock('../../lib/use-desktop-browser-reveal.js', () => ({ useDesktopBrowserReveal: () => {} }));
vi.mock('../../components/thread/secondary-panel/useThreadOpenFileSignal.js', () => ({
  useThreadOpenFileSignal: () => {},
  dispatchThreadOpenFile: () => {}
}));
vi.mock('../../components/thread/secondary-panel/useThreadOpenTerminalSignal.js', () => ({
  useThreadOpenTerminalSignal: () => {}
}));
vi.mock('../../components/thread/pending-interactions/useOpenPendingInteractions.js', async (original) => ({
  ...await original<object>(),
  useOpenPendingInteractions: () => []
}));

// Conversation column: a composer to focus, and a search stub that shows its focus request count.
vi.mock('../../components/ThreadCommandComposer.js', () => ({
  ThreadCommandComposer: () => <textarea aria-label="composer" />
}));
vi.mock('../../components/thread/ThreadDetailSearch.js', () => ({
  ThreadDetailSearch: ({ focusRequest }: { focusRequest: number }) => <output data-testid="search">{focusRequest}</output>
}));
vi.mock('../../components/thread/ThreadTimeline.js', () => ({ ThreadTimeline: () => null }));
vi.mock('../../components/thread/ThreadWorkspaceBanner.js', () => ({ ThreadWorkspaceBanner: () => null }));
vi.mock('../../components/thread/ThreadDetailOverflow.js', () => ({ ThreadDetailOverflow: () => null }));
vi.mock('../../components/thread/timeline/ThreadBanners.js', () => ({
  ThreadDetailHeading: ({ title }: { title: string }) => <h1>{title}</h1>,
  ThreadDetailActions: ({ children }: { children: ReactNode }) => children,
  ThreadPromptModeCard: () => null,
  ThreadStatusBadge: () => null,
  ThreadTodoCard: () => null
}));
vi.mock('../../components/thread/timeline/ComposerStackCards.js', () => ({
  BackgroundCommandsCard: () => null,
  ModelFallbackCard: () => null,
  PromptContextBanner: () => null,
  QueuedMessagesCard: () => null
}));
vi.mock('../../components/thread/pending-interactions/ChildThreadPendingBanners.js', () => ({
  ChildThreadPendingBanners: () => null
}));
vi.mock('../../plugins/PluginThreadHeaderActions.js', () => ({ PluginThreadHeaderActions: () => null }));
vi.mock('../../plugins/thread-panel-owner.js', () => ({
  ThreadPanelOwnerProvider: ({ children }: { children: ReactNode }) => children
}));

import { ThreadDetail } from './ThreadDetailView.js';
import { openThreadFind } from '../../lib/thread-find.js';

function pressFind(target: Element) {
  const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
  let opened = false;
  target.addEventListener('keydown', (e) => {
    opened = openThreadFind(e as KeyboardEvent);
  }, { once: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return opened;
}

async function mount(props: { embedded?: boolean; modal?: boolean } = {}) {
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Find thread', status: 'idle', createdAt: 1 } });
  h.timeline.mockResolvedValue({ rows: [], maxSeq: 0, status: 'idle', activeThinking: null });
  const view = render(<MemoryRouter><ThreadDetail threadId="a" {...props} /></MemoryRouter>);
  await act(async () => {});
  return view;
}

beforeEach(() => {
  Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
  // happy-dom has no layout; treat every element as on screen.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  h.controls = null;
  h.ui = { threadModal: null, agentModal: null };
});

describe('Ctrl+F in a thread view', () => {
  it('asks the search field to take focus each time from the conversation column', async () => {
    await mount();
    expect(screen.getByTestId('search').textContent).toBe('0');
    expect(pressFind(screen.getByLabelText('composer'))).toBe(true);
    expect(screen.getByTestId('search').textContent).toBe('1');
    expect(pressFind(screen.getByLabelText('composer'))).toBe(true);
    expect(screen.getByTestId('search').textContent).toBe('2');
  });

  it('takes the key with nothing focused only while it is the visible, unobscured thread', async () => {
    await mount();
    expect(pressFind(document.body)).toBe(true);
    h.ui = { threadModal: { threadId: 'b' }, agentModal: null };
    expect(pressFind(document.body)).toBe(false);
    h.ui = { threadModal: null, agentModal: { sessionId: 's', projectId: 'p' } };
    expect(pressFind(document.body)).toBe(false);
    h.ui = { threadModal: null, agentModal: null };
    vi.mocked(HTMLElement.prototype.getClientRects).mockReturnValue([] as unknown as DOMRectList);
    expect(pressFind(document.body)).toBe(false);
  });

  it('leaves the key to an open palette, and takes it back once focus returns to the thread', async () => {
    await mount();
    const palette = document.createElement('div');
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-modal', 'true');
    const input = document.createElement('input');
    palette.append(input);
    document.body.append(palette);
    expect(pressFind(input)).toBe(false);
    expect(pressFind(document.body)).toBe(false);
    expect(screen.getByTestId('search').textContent).toBe('0');
    expect(pressFind(screen.getByLabelText('composer'))).toBe(true);
  });

  it('answers inside the thread modal and leaves embedded chats to focus', async () => {
    h.ui = { threadModal: { threadId: 'a' }, agentModal: null };
    const modal = await mount({ modal: true });
    expect(pressFind(document.body)).toBe(true);
    modal.unmount();
    h.ui = { threadModal: null, agentModal: null };
    await mount({ embedded: true });
    expect(pressFind(document.body)).toBe(false);
    expect(pressFind(screen.getByLabelText('composer'))).toBe(true);
  });

  it('opens the collapsed mobile search before focusing it', async () => {
    h.controls = document.createElement('div');
    await mount();
    expect(screen.queryByTestId('search')).toBeNull();
    expect(pressFind(screen.getByLabelText('composer'))).toBe(true);
    expect(screen.getByTestId('search').textContent).toBe('1');
  });

  it('stops answering once unmounted', async () => {
    const view = await mount();
    view.unmount();
    expect(pressFind(document.body)).toBe(false);
  });
});
