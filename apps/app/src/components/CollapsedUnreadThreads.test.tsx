import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  open: false,
  setOpen: vi.fn(),
  scopeProjectId: null as string | null,
  projects: [{ id: 'p1', name: 'Alpha' }],
  threads: [] as Array<{
    id: string;
    projectId: string;
    hostId: string;
    environmentId: null;
    providerId: string;
    status: string;
    title: string | null;
    createdAt: number;
    updatedAt: number;
    cwd: null;
    branchName: null;
    isWorktree: boolean;
    lastReadSeq: number | null;
    maxSeq: number;
  }>
}));

vi.mock('../store', () => ({
  useData: (selector: (state: { projects: typeof h.projects }) => unknown) => selector({ projects: h.projects }),
  useInboxScopeProjectId: () => h.scopeProjectId
}));

vi.mock('../thread-store', () => ({
  useThreads: (selector: (state: { threads: typeof h.threads }) => unknown) => selector({ threads: h.threads })
}));

vi.mock('./ui/PopoverPicklist', () => ({
  useExclusivePopover: () => [h.open, h.setOpen] as const
}));

import { CollapsedUnreadThreads } from './CollapsedUnreadThreads.js';

function unreadThread(over: Partial<(typeof h.threads)[number]> & { id: string }) {
  return {
    projectId: 'p1',
    hostId: 'h1',
    environmentId: null,
    providerId: 'claude-code',
    status: 'idle',
    title: over.id,
    createdAt: 1,
    updatedAt: 1,
    cwd: null,
    branchName: null,
    isWorktree: false,
    lastReadSeq: 0,
    maxSeq: 2,
    ...over
  };
}

describe('CollapsedUnreadThreads', () => {
  it('hides when nothing is unread', () => {
    h.open = false;
    h.threads = [unreadThread({ id: 'caught', lastReadSeq: 2, maxSeq: 2 })];
    expect(renderToStaticMarkup(
      <MemoryRouter>
        <CollapsedUnreadThreads />
      </MemoryRouter>
    )).toBe('');
  });

  it('shows the unread count and lists thread titles when open', () => {
    h.open = true;
    h.threads = [
      unreadThread({ id: 't1', title: 'Toggle click not working', updatedAt: 2 }),
      unreadThread({ id: 't2', title: 'Plugin list scroll behavior', updatedAt: 1 })
    ];
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CollapsedUnreadThreads />
      </MemoryRouter>
    );
    expect(markup).toContain('data-testid="collapsed-unread-trigger"');
    expect(markup).toContain('aria-label="2 unread agents"');
    expect(markup).toContain('>2<');
    expect(markup).toContain('Unread');
    expect(markup).toContain('Toggle click not working');
    expect(markup).toContain('Plugin list scroll behavior');
    expect(markup).toContain('Alpha');
    expect(markup).toContain('collapsed-unread-dot');
  });

  it('navigates to the thread route from a popover row', () => {
    const source = readFileSync(new URL('./CollapsedUnreadThreads.tsx', import.meta.url), 'utf8');
    expect(source).toContain('getThreadRoutePath(thread.id, thread.projectId)');
    expect(source).toContain('setOpen(false)');
  });
});
