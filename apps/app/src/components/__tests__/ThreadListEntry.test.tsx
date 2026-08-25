import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { ThreadListEntry } from '../ThreadListEntry.js';

describe('ThreadListEntry', () => {
  const thread = {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: 'p1',
    hostId: 'h1',
    environmentId: null,
    providerId: 'claude-code',
    title: 'Read README',
    createdAt: 1,
    cwd: null,
    branchName: null,
    isWorktree: false
  };

  it('shows a working indicator while the thread is active', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadListEntry thread={{ ...thread, status: 'active' }} />
      </MemoryRouter>
    );
    expect(html).toContain('data-testid="thread-list-entry-working"');
    expect(html).toContain('Working');
    expect(html).toContain('data-kind="thread"');
    expect(html).toContain('Thread');
    expect(html).toContain('<svg');
    expect(html).not.toContain('lucide-message-square');
  });

  it('shows the raw status when idle', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadListEntry thread={{ ...thread, status: 'idle' }} />
      </MemoryRouter>
    );
    expect(html).not.toContain('thread-list-entry-working');
    expect(html).toContain('idle');
  });

  it('forwards a right-click handler onto the row', () => {
    const source = readFileSync(new URL('../ThreadListEntry.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onContextMenu?: (e: MouseEvent) => void');
    expect(source).toContain('onContextMenu={onContextMenu}');
  });

  it('uses the thread harness icon instead of a chat bubble', () => {
    const source = readFileSync(new URL('../ThreadListEntry.tsx', import.meta.url), 'utf8');
    expect(source).toContain('ProviderIcon');
    expect(source).toContain('thread.providerId');
    expect(source).not.toContain('MessageSquare');
  });
});
