import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import {
  runThreadMenuAction,
  threadTitle,
  viewingThread,
  ThreadCardMenu,
  type ThreadMenuContext
} from './threadCardActions.js';
import type { ThreadListItem } from '../thread-store.js';

const thread: ThreadListItem = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: 'p1',
  hostId: 'h1',
  environmentId: null,
  providerId: 'claude-code',
  status: 'idle',
  title: 'hello',
  createdAt: 1,
  cwd: null,
  branchName: null,
  isWorktree: false
};

function ctx(overrides: Partial<ThreadMenuContext> = {}): ThreadMenuContext & {
  navigate: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  fork: ReturnType<typeof vi.fn>;
  archive: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    navigate: vi.fn(),
    pathname: '/agents',
    confirm: vi.fn(() => true),
    stop: vi.fn(async () => ({ ok: true })),
    fork: vi.fn(async () => ({ ok: true, value: { id: 'fork-1' } })),
    archive: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(),
    ...overrides
  };
}

describe('threadTitle', () => {
  it('falls back when the title is missing or blank', () => {
    expect(threadTitle({ title: 'hello' })).toBe('hello');
    expect(threadTitle({ title: '  ' })).toBe('Untitled thread');
    expect(threadTitle({ title: null })).toBe('Untitled thread');
  });
});

describe('viewingThread', () => {
  it('matches the open thread route and ignores other paths', () => {
    expect(viewingThread('/threads/11111111-1111-4111-8111-111111111111', thread.id)).toBe(true);
    expect(viewingThread('/projects/p1/threads/11111111-1111-4111-8111-111111111111', thread.id)).toBe(true);
    expect(viewingThread('/threads/other', thread.id)).toBe(false);
    expect(viewingThread('/agents', thread.id)).toBe(false);
    expect(viewingThread('/projects/p1/threads/new', thread.id)).toBe(false);
  });
});

describe('runThreadMenuAction', () => {
  it('opens the thread', async () => {
    const c = ctx();
    await runThreadMenuAction('open', thread, c);
    expect(c.navigate).toHaveBeenCalledWith(`/threads/${thread.id}`);
  });

  it('opens a project-scoped thread without leaving the workspace', async () => {
    const c = ctx({ projectId: 'p1' });
    await runThreadMenuAction('open', thread, c);
    expect(c.navigate).toHaveBeenCalledWith(`/projects/p1/threads/${thread.id}`);
  });

  it('stops the running thread', async () => {
    const c = ctx();
    await runThreadMenuAction('stop', thread, c);
    expect(c.stop).toHaveBeenCalledWith(thread.id);
    expect(c.navigate).not.toHaveBeenCalled();
  });

  it('navigates to a successful fork', async () => {
    const c = ctx();
    await runThreadMenuAction('fork', thread, c);
    expect(c.fork).toHaveBeenCalledWith(thread.id);
    expect(c.navigate).toHaveBeenCalledWith('/threads/fork-1');
  });

  it('keeps a fork on the project thread URL', async () => {
    const c = ctx({ projectId: 'p1' });
    await runThreadMenuAction('fork', thread, c);
    expect(c.navigate).toHaveBeenCalledWith('/projects/p1/threads/fork-1');
  });

  it('does not navigate when fork fails', async () => {
    const c = ctx({ fork: vi.fn(async () => ({ ok: false })) });
    await runThreadMenuAction('fork', thread, c);
    expect(c.navigate).not.toHaveBeenCalled();
  });

  it('does not archive when the user cancels', async () => {
    const c = ctx({ confirm: vi.fn(() => false) });
    await runThreadMenuAction('archive', thread, c);
    expect(c.archive).not.toHaveBeenCalled();
    expect(c.remove).not.toHaveBeenCalled();
  });

  it('archives, drops the row, and leaves the thread route when it is open', async () => {
    const c = ctx({ pathname: `/threads/${thread.id}` });
    await runThreadMenuAction('archive', thread, c);
    expect(c.archive).toHaveBeenCalledWith(thread.id);
    expect(c.remove).toHaveBeenCalledWith(thread.id);
    expect(c.navigate).toHaveBeenCalledWith('/agents');
  });

  it('returns to the project workspace after archiving a project thread', async () => {
    const c = ctx({ pathname: `/projects/p1/threads/${thread.id}`, projectId: 'p1' });
    await runThreadMenuAction('archive', thread, c);
    expect(c.navigate).toHaveBeenCalledWith('/projects/p1');
  });

  it('archives without navigating when some other thread is open', async () => {
    const c = ctx({ pathname: '/threads/other' });
    await runThreadMenuAction('archive', thread, c);
    expect(c.remove).toHaveBeenCalledWith(thread.id);
    expect(c.navigate).not.toHaveBeenCalled();
  });

  it('keeps the row when archive reports failure', async () => {
    const c = ctx({ archive: vi.fn(async () => ({ ok: false })) });
    await runThreadMenuAction('archive', thread, c);
    expect(c.remove).not.toHaveBeenCalled();
    expect(c.navigate).not.toHaveBeenCalled();
  });
});

describe('ThreadCardMenu', () => {
  it('offers Stop only while the thread is busy', () => {
    const idle = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadCardMenu menu={{ thread, x: 8, y: 12 }} setMenu={() => undefined} />
      </MemoryRouter>
    );
    expect(idle).toContain('data-testid="thread-context-menu"');
    expect(idle).toContain('Open');
    expect(idle).toContain('Fork');
    expect(idle).toContain('Archive');
    expect(idle).not.toContain('Stop');

    const busy = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadCardMenu
          menu={{ thread: { ...thread, status: 'active' }, x: 8, y: 12 }}
          setMenu={() => undefined}
        />
      </MemoryRouter>
    );
    expect(busy).toContain('Stop');
  });
});

describe('thread context-menu wiring', () => {
  it('is attached on every surface that lists threads beside agents', () => {
    const agents = readFileSync(new URL('./listpane/AgentsList.tsx', import.meta.url), 'utf8');
    expect(agents).toContain('onContextMenu={(e) => {');
    expect(agents).toContain('openThreadMenu(e, entry.thread, setThreadMenu)');
    expect(agents).toContain('<ThreadCardMenu menu={threadMenu}');

    const board = readFileSync(new URL('./AgentBoard.tsx', import.meta.url), 'utf8');
    expect(board).toContain('openThreadMenu(e, item.thread, setThreadMenu)');
    expect(board).toContain('<ThreadCardMenu menu={threadMenu}');

    const monitor = readFileSync(new URL('./AgentMonitor.tsx', import.meta.url), 'utf8');
    expect(monitor).toContain('openThreadMenu(e, item.thread, setThreadMenu)');
    expect(monitor).toContain('<ThreadCardMenu menu={threadMenu}');

    const projects = readFileSync(new URL('./listpane/ProjectsList.tsx', import.meta.url), 'utf8');
    expect(projects).toContain('onContextMenu={(e) => openThreadMenu(e, thread, setThreadMenu)}');
    expect(projects).toContain('<ThreadCardMenu menu={threadMenu}');

    const tray = readFileSync(new URL('./AgentTray.tsx', import.meta.url), 'utf8');
    expect(tray).toContain('openThreadMenu(e, thread, setThreadMenu)');
    expect(tray).toContain('<ThreadCardMenu menu={threadMenu}');
  });
});
