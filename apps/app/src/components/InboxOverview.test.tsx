import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InboxEntry, LibraryDoc } from '@zana-ai/zcc-domain/product';

const { select, library } = vi.hoisted(() => ({
  select: vi.fn(),
  library: { docs: [] as LibraryDoc[] }
}));

vi.mock('../lib/product-client.js', () => ({
  product: { openers: { openIn: async () => ({ ok: true }) } }
}));

vi.mock('../store.js', () => ({
  useInboxSelection: (selector: (s: { select: typeof select }) => unknown) =>
    selector({ select }),
  useLibrary: (selector: (s: { docs: LibraryDoc[] }) => unknown) =>
    selector({ docs: library.docs }),
  useData: { getState: () => ({ projects: [] }) },
  useUi: {
    getState: () => ({
      selectedProjectId: null,
      revealLibraryDoc: vi.fn(),
      pushToast: vi.fn()
    })
  }
}));

vi.mock('./InboxSummaryCard.js', () => ({
  InboxSummaryCard: () => null
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
  it('does not render a Questions rollup even when unanswered asks exist', () => {
    library.docs = [];
    const html = renderToStaticMarkup(
      <InboxOverview
        scopeProjectId={null}
        entries={[
          entry({
            id: 'q1',
            subject: 'Approval needed',
            comments: 'Tell me how this is working',
            question: { options: [{ id: 'A', label: 'Yes' }], blocking: true }
          }),
          entry({ id: 'r1', subject: 'Weekly status', report: true }),
          entry({ id: 'g1', subject: 'Shipped goal', dedupeKey: 'goal:p1:g1' })
        ]}
      />
    );
    expect(html).not.toContain('Questions');
    expect(html).not.toContain('need your answer');
    expect(html).not.toContain('tone-question');
    expect(html).not.toContain('Approval needed');
    expect(html).toContain('Reports');
    expect(html).toContain('Weekly status');
    expect(html).toContain('Goals');
    expect(html).toContain('Shipped goal');
  });

  it('renders Ideas from the library and hides empty rollups', () => {
    library.docs = [
      {
        id: 'idea-1',
        relPath: 'ideas/dark.md',
        title: 'Ship dark mode',
        kind: 'md',
        tags: ['idea'],
        createdAt: 1,
        updatedAt: 2
      }
    ];
    const html = renderToStaticMarkup(
      <InboxOverview scopeProjectId={null} entries={[]} />
    );
    expect(html).toContain('Ideas');
    expect(html).toContain('Ship dark mode');
    expect(html).not.toContain('Reports');
    expect(html).not.toContain('Goals');
    expect(html).not.toContain('Questions');
  });

  it('shows the empty state when there are only questions', () => {
    library.docs = [];
    const html = renderToStaticMarkup(
      <InboxOverview
        scopeProjectId={null}
        entries={[
          entry({
            id: 'q1',
            subject: 'Approval needed',
            question: { options: [{ id: 'A', label: 'Yes' }], blocking: true }
          })
        ]}
      />
    );
    expect(html).toContain('inbox-overview-empty');
    expect(html).toContain('reports, goals, and captured ideas');
    expect(html).not.toContain('questions, reports');
  });

  it('does not declare a Questions rollup in source', () => {
    const source = readFileSync(new URL('./InboxOverview.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('label="Questions"');
    expect(source).not.toContain('need your answer');
    expect(source).not.toContain("tone: 'question'");
  });
});
