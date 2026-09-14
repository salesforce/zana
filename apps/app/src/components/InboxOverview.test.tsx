import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

const { select, markRead, maybeRefresh } = vi.hoisted(() => ({
  select: vi.fn(),
  markRead: vi.fn(),
  maybeRefresh: vi.fn()
}));

vi.mock('../store.js', () => ({
  useInboxSelection: (selector: (s: { select: typeof select }) => unknown) =>
    selector({ select }),
  useInboxRead: (selector: (s: { markRead: typeof markRead }) => unknown) =>
    selector({ markRead }),
  useInboxAnswered: (selector: (s: { answeredIds: Record<string, true> }) => unknown) =>
    selector({ answeredIds: {} }),
  useData: (selector: (s: { projects: { id: string; name: string; color?: string }[] }) => unknown) =>
    selector({ projects: [{ id: 'p1', name: 'Alpha', color: '#58a6ff' }] }),
  maybeRefreshInboxSummary: maybeRefresh
}));

vi.mock('./InboxSummaryCard.js', () => ({
  InboxSummaryCard: () => <div className="inbox-ai-card-stub">AI Summary</div>
}));

vi.mock('./InboxGuidance.js', () => ({
  InboxGuidance: () => <aside className="inbox-guidance-stub">guidance</aside>
}));

vi.mock('./InboxSidebar.js', () => ({
  formatRelative: () => '1h'
}));

import { InboxOverview } from './InboxOverview.js';

function entry(overrides: Partial<InboxEntry> & Pick<InboxEntry, 'id'>): InboxEntry {
  return {
    ts: Date.now(),
    projectId: 'p1',
    comments: 'body',
    ...overrides
  };
}

describe('InboxOverview', () => {
  it('renders pending blocking questions on the attention landing', () => {
    const html = renderToStaticMarkup(
      <InboxOverview
        scopeProjectId={null}
        entries={[
          entry({
            id: 'q1',
            subject: 'Approval needed',
            comments: 'Tell me how this is working',
            intent: 'Unblock the deploy',
            question: { options: [{ id: 'A', label: 'Yes' }], blocking: true }
          }),
          entry({ id: 'r1', subject: 'Weekly status', report: true }),
          entry({ id: 'g1', subject: 'Shipped goal', dedupeKey: 'goal:p1:g1' })
        ]}
      />
    );
    expect(html).toContain('Needs your answer');
    expect(html).toContain('Approval needed');
    expect(html).toContain('Unblock the deploy');
    expect(html).toContain('Answer');
    expect(html).toContain('inbox-overview-questions');
    expect(html).not.toContain('Weekly status');
    expect(html).not.toContain('Shipped goal');
    expect(html).not.toContain('tone-report');
    expect(html).not.toContain('Ideas');
  });

  it('does not catalogue library ideas or report/goal rollups', () => {
    const source = readFileSync(new URL('./InboxOverview.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('useLibrary');
    expect(source).not.toContain('label="Reports"');
    expect(source).not.toContain('label="Ideas"');
    expect(source).not.toContain('label="Goals"');
    expect(source).not.toContain('inbox-overview-rollup');
    expect(source).toContain('maybeRefreshInboxSummary');
  });

  it('uses PaneEmptyState when the inbox is empty', () => {
    const html = renderToStaticMarkup(
      <InboxOverview scopeProjectId={null} entries={[]} />
    );
    expect(html).toContain('data-testid="inbox-overview-empty"');
    expect(html).toContain('data-art="inbox"');
    expect(html).toContain('No inbox messages yet');
    expect(html).toContain('inbox-guidance-stub');
    expect(html).not.toContain('Needs your answer');
    expect(html).not.toContain('inbox-ai-card-stub');
  });

  it('omits the questions section when nothing is pending', () => {
    const html = renderToStaticMarkup(
      <InboxOverview
        scopeProjectId={null}
        entries={[entry({ id: 'r1', subject: 'Weekly status', report: true })]}
      />
    );
    expect(html).not.toContain('Needs your answer');
    expect(html).toContain('inbox-ai-card-stub');
  });
});
