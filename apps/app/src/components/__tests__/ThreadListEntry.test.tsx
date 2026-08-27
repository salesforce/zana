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
    expect(html).toContain('Planning next move');
    expect(html).toContain('data-kind="thread"');
    expect(html).toContain('Thread');
    expect(html).toContain('<svg');
    expect(html).not.toContain('lucide-message-square');
  });

  it('shows Needs you instead of Working when a question is pending', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadListEntry thread={{ ...thread, status: 'active', hasPendingInteraction: true }} />
      </MemoryRouter>
    );
    expect(html).toContain('Needs you');
    expect(html).toContain('agents-row-needs-you');
    expect(html).toContain('agent-blocked');
    expect(html).not.toContain('thread-list-entry-working');
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    const needsYou = css.slice(
      css.indexOf('.agents-row-needs-you {'),
      css.indexOf('.agents-row-badge {')
    );
    expect(needsYou).toContain('color: var(--danger);');
  });

  it('shows the raw status when idle', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadListEntry thread={{ ...thread, status: 'idle' }} />
      </MemoryRouter>
    );
    expect(html).not.toContain('thread-list-entry-working');
    expect(html).toContain('Idle');
    expect(html).not.toContain('Needs you');
  });

  it('shows Error instead of Needs you when the thread failed', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadListEntry thread={{ ...thread, status: 'error', hasPendingInteraction: true }} />
      </MemoryRouter>
    );
    expect(html).toContain('Error');
    expect(html).toContain('agent-error');
    expect(html).toContain('agents-row-needs-you');
    expect(html).not.toContain('Needs you');
    expect(html).not.toContain('thread-list-entry-working');
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
