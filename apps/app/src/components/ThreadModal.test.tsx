import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  threads: [] as Array<{ id: string; title: string | null }>,
  setFullScreen: vi.fn(),
  onFullScreenChanged: vi.fn(() => () => undefined)
}));

vi.mock('../lib/product-client.js', () => ({
  product: {
    app: {
      setFullScreen: h.setFullScreen,
      onFullScreenChanged: h.onFullScreenChanged
    }
  }
}));
vi.mock('../thread-store.js', () => ({
  useThreads: (selector: (state: { threads: typeof h.threads }) => unknown) =>
    selector({ threads: h.threads })
}));
vi.mock('../views/threads/ThreadDetailView.js', () => ({
  ThreadDetail: ({
    threadId,
    embedded,
    onClose,
    fullScreen,
    onToggleFullScreen
  }: {
    threadId: string;
    embedded?: boolean;
    onClose?: () => void;
    fullScreen?: boolean;
    onToggleFullScreen?: () => void;
  }) => (
    <div
      data-testid="thread-detail"
      data-thread-id={threadId}
      data-embedded={embedded ? 'true' : undefined}
      data-fullscreen={fullScreen ? 'true' : undefined}
    >
      {onToggleFullScreen ? (
        <button type="button" data-testid="thread-modal-fullscreen" onClick={onToggleFullScreen}>
          Full screen
        </button>
      ) : null}
      {onClose ? (
        <button type="button" data-testid="thread-modal-close" onClick={onClose}>
          Close
        </button>
      ) : null}
    </div>
  )
}));

import {
  applyInspectorFullScreen,
  focusInspectorDialog,
  inspectorModalClassName,
  releaseInspectorFullScreen,
  stopInspectorDialogClick,
  ThreadModal,
  threadModalLabel,
  toggleInspectorFullScreen
} from './ThreadModal.js';

const modalSource = readFileSync(new URL('./ThreadModal.tsx', import.meta.url), 'utf8');
const board = readFileSync(new URL('../views/agents/AgentsBoard.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../store.ts', import.meta.url), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../styles/global.css', import.meta.url)), 'utf8');

describe('ThreadModal', () => {
  it('hosts ThreadDetail in the agent-inspector overlay chrome', () => {
    expect(modalSource).toContain('data-testid="thread-modal"');
    expect(modalSource).toContain('inspectorModalClassName(fullScreen)');
    expect(modalSource).toContain('className="modal-backdrop"');
    expect(modalSource).toContain('className="agent-modal-body"');
    expect(modalSource).toContain('embedded');
    expect(modalSource).toContain('onClose={onClose}');
    expect(modalSource).toContain('onToggleFullScreen={toggleFullScreen}');
    expect(css).toContain('.agent-modal-body > .thread-detail-view');
    expect(css).toContain('.thread-detail-view--modal');
  });

  it('is opened from the kanban inspect path and hosted beside the agent modal', () => {
    const inspect = board.slice(
      board.indexOf('const inspect = (item: FleetItem) =>'),
      board.indexOf('const pick = (item: FleetItem) =>')
    );
    expect(inspect).toContain('openThreadModal(item.id)');
    expect(inspect).not.toContain('getThreadRoutePath');
    expect(board).toContain('getThreadRoutePath(item.id, threadProjectId)');
    expect(app).toContain('<ThreadModalHost />');
    expect(app).toContain('<ThreadModal threadId={threadModal.threadId} onClose={close} />');
    expect(store).toContain('openThreadModal: (threadId) => set({ threadModal: { threadId }, agentModal: null })');
    expect(store).toContain('set({ agentModal: { sessionId, projectId }, threadModal: null })');
  });

  it('renders the dialog around the embedded thread surface', () => {
    h.threads = [{ id: 't1', title: 'Review the board' }];
    const html = renderToStaticMarkup(<ThreadModal threadId="t1" onClose={() => undefined} />);
    expect(html).toContain('data-testid="thread-modal"');
    expect(html).toContain('aria-label="Review the board"');
    expect(html).toContain('data-testid="thread-detail"');
    expect(html).toContain('data-thread-id="t1"');
    expect(html).toContain('data-embedded="true"');
    expect(html).toContain('data-testid="thread-modal-close"');
    expect(html).toContain('data-testid="thread-modal-fullscreen"');
  });

  it('falls back to Thread when the roster has no title', () => {
    h.threads = [];
    const html = renderToStaticMarkup(<ThreadModal threadId="missing" onClose={() => undefined} />);
    expect(html).toContain('aria-label="Thread"');
  });

  it('labels the dialog from the thread title', () => {
    expect(threadModalLabel('Review the board')).toBe('Review the board');
    expect(threadModalLabel('  ')).toBe('Thread');
    expect(threadModalLabel(null)).toBe('Thread');
    expect(threadModalLabel(undefined)).toBe('Thread');
  });

  it('toggles the shared inspector fullscreen class and OS flag', () => {
    h.setFullScreen.mockClear();
    expect(inspectorModalClassName(false)).toBe('modal agent-terminal-modal');
    expect(inspectorModalClassName(true)).toBe('modal agent-terminal-modal is-fullscreen');
    const setFullScreen = vi.fn();
    expect(toggleInspectorFullScreen(false, setFullScreen)).toBe(true);
    expect(setFullScreen).toHaveBeenCalledWith(true);
    expect(h.setFullScreen).toHaveBeenCalledWith(true);
    applyInspectorFullScreen(false);
    expect(h.setFullScreen).toHaveBeenCalledWith(false);
    releaseInspectorFullScreen(false);
    expect(h.setFullScreen).toHaveBeenCalledTimes(2);
    releaseInspectorFullScreen(true);
    expect(h.setFullScreen).toHaveBeenCalledWith(false);
  });

  it('focuses the dialog when a node is present', () => {
    const focus = vi.fn();
    focusInspectorDialog({ focus });
    expect(focus).toHaveBeenCalledTimes(1);
    focusInspectorDialog(null);
  });

  it('keeps backdrop clicks from closing when the dialog is the target', () => {
    const stopPropagation = vi.fn();
    stopInspectorDialogClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });
});
