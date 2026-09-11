import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InboxDigest, InboxEntry } from '@zana-ai/zcc-domain/product';

const summary = vi.hoisted(() => ({
  byScope: {} as Record<
    string,
    {
      loading?: boolean;
      digest?: InboxDigest | null;
      error?: string | null;
      generatedAt?: number | null;
    }
  >
}));

vi.mock('../store.js', () => ({
  useInboxSummary: (selector: (s: { byScope: typeof summary.byScope }) => unknown) =>
    selector({ byScope: summary.byScope }),
  refreshInboxSummary: vi.fn(),
  inboxContentSignature: () => 'sig'
}));

vi.mock('./InboxSummaryModal.js', () => ({
  InboxSummaryModal: () => null
}));

vi.mock('./ui/Skeleton.js', () => ({
  StencilLines: () => <div className="stencil">Generating summary</div>
}));

import { InboxSummaryCard } from './InboxSummaryCard.js';

const entries: InboxEntry[] = [
  { id: 'e1', ts: 1, projectId: 'p1', comments: 'hello' }
];

describe('InboxSummaryCard', () => {
  it('hides when there is nothing to summarize', () => {
    summary.byScope = {};
    expect(renderToStaticMarkup(<InboxSummaryCard scopeProjectId={null} entries={[]} />)).toBe('');
  });

  it('shows a Generate CTA when idle', () => {
    summary.byScope = {};
    const html = renderToStaticMarkup(
      <InboxSummaryCard scopeProjectId={null} entries={entries} />
    );
    expect(html).toContain('inbox-ai-card');
    expect(html).toContain('Generate summary');
    expect(html).toContain('Not generated yet');
    expect(html).not.toContain('inbox-ai-card-expand');
  });

  it('renders a digest when one exists', () => {
    summary.byScope = {
      __all__: {
        loading: false,
        digest: { headline: 'Quiet morning', done: ['Shipped the audit'], attention: [] },
        generatedAt: Date.now()
      }
    };
    const html = renderToStaticMarkup(
      <InboxSummaryCard scopeProjectId={null} entries={entries} />
    );
    expect(html).toContain('Quiet morning');
    expect(html).toContain('Shipped the audit');
    expect(html).toContain('Open detailed summary');
  });

  it('hides when the scope is empty of notable activity', () => {
    summary.byScope = { __all__: { loading: false, error: 'empty' } };
    expect(renderToStaticMarkup(<InboxSummaryCard scopeProjectId={null} entries={entries} />)).toBe('');
  });
});
