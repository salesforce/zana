import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FeedEvent } from '@zana-ai/zcc-domain/product';
import { ClusterRow, EventRow, FeedRecapCard } from './FeedView.js';
import type { FeedNode } from '@/lib/feedGrouping';

const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

function cssBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

function event(overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id: 'e1',
    projectId: 'p1',
    kind: 'library-doc',
    ts: Date.now() - 86_400_000,
    title: 'Library doc written: Stream Deck',
    ...overrides
  };
}

const noop = () => {};

describe('EventRow', () => {
  it('shows a kind chip and title on the collapsed row', () => {
    const html = renderToStaticMarkup(
      <EventRow event={event({ detail: 'A longer body that stays in the preview.' })} spineCls="" open={false} onToggle={noop} />
    );
    expect(html).toContain('class="feed-kind-chip feed-kind--library"');
    expect(html).toContain('>Library<');
    expect(html).toContain('Library doc written: Stream Deck');
    expect(html).toContain('class="feed-row-detail"');
    expect(html).toContain('feed-ico--library');
    expect(html).not.toContain('library-doc');
  });

  it('does not repeat the raw kind slug in the expanded panel', () => {
    const html = renderToStaticMarkup(
      <EventRow
        event={event({ context: 'Shipped the overlay', detail: undefined })}
        spineCls=""
        open
        onToggle={noop}
      />
    );
    expect(html).toContain('class="feed-kind-chip feed-kind--library"');
    expect(html).toContain('class="feed-row-expanded"');
    expect(html).toContain('Shipped the overlay');
    expect(html).not.toContain('library-doc');
    expect(html).not.toContain('feed-row-expanded-meta');
  });
});

describe('ClusterRow', () => {
  it('shows the count badge and a kind chip', () => {
    const events: FeedEvent[] = [
      event({ id: 'f1', kind: 'followup-created', title: 'Opened A' }),
      event({ id: 'f2', kind: 'followup-created', title: 'Opened B', ts: Date.now() - 2 * 86_400_000 }),
      event({ id: 'f3', kind: 'followup-created', title: 'Opened C', ts: Date.now() - 3 * 86_400_000 })
    ];
    const node: Extract<FeedNode, { type: 'cluster' }> = {
      type: 'cluster',
      kind: 'followup-created',
      events,
      ts: events[0]!.ts,
      latest: events[0]!
    };
    const html = renderToStaticMarkup(
      <ClusterRow node={node} spineCls="" open={false} onToggle={noop} />
    );
    expect(html).toContain('class="feed-cluster-badge">3<');
    expect(html).toContain('3 follow-ups opened');
    expect(html).toContain('class="feed-kind-chip feed-kind--followup"');
    expect(html).toContain('>Follow-up<');
  });
});

describe('FeedRecapCard', () => {
  it('renders idle copy and a primary Generate button', () => {
    const html = renderToStaticMarkup(
      <FeedRecapCard digest={null} state="idle" hasEvents onGenerate={noop} />
    );
    expect(html).toContain('feed-recap--idle');
    expect(html).toContain('Generate a short AI summary');
    expect(html).toContain('feed-recap-btn--primary');
    expect(html).toContain('Generate recap');
    expect(html).toContain('class="feed-recap-ico"');
  });

  it('renders a loaded headline, highlights, and Regenerate', () => {
    const html = renderToStaticMarkup(
      <FeedRecapCard
        digest={{ headline: 'Shipped the overlay.', highlights: ['Docs updated', 'Idle agents closed'] }}
        state="idle"
        hasEvents
        onGenerate={noop}
      />
    );
    expect(html).toContain('feed-recap--ready');
    expect(html).toContain('Shipped the overlay.');
    expect(html).toContain('Docs updated');
    expect(html).toContain('Idle agents closed');
    expect(html).toContain('Regenerate');
    expect(html).not.toContain('feed-recap-btn--primary');
  });

  it('surfaces failed and empty notes', () => {
    const failed = renderToStaticMarkup(
      <FeedRecapCard digest={null} state="failed" hasEvents onGenerate={noop} />
    );
    expect(failed).toContain('Couldn’t summarize the feed right now.');
    const empty = renderToStaticMarkup(
      <FeedRecapCard digest={null} state="empty" hasEvents onGenerate={noop} />
    );
    expect(empty).toContain('Not enough activity to summarize yet.');
  });

  it('renders nothing without events', () => {
    expect(renderToStaticMarkup(<FeedRecapCard digest={null} state="idle" hasEvents={false} onGenerate={noop} />)).toBe(
      ''
    );
  });
});

describe('Feed CSS contract', () => {
  it('centers the scroll body as a 720px reading surface', () => {
    const inner = cssBlock('.feed-scroll-inner');
    expect(inner).toContain('max-width: 720px');
    expect(inner).toContain('margin: 0 auto');
  });

  it('treats row bodies as cards beside the spine', () => {
    const body = cssBlock('.feed-row-body');
    expect(body).toContain('padding: 10px 12px');
    expect(body).toContain('border-radius: 8px');
    expect(body).toContain('border: 1px solid');
  });

  it('tints kind chips and icon wells', () => {
    expect(css).toContain('.feed-kind-chip {');
    const chip = cssBlock('.feed-kind-chip');
    expect(chip).toContain('text-transform: uppercase');
    const commit = cssBlock('.feed-ico--commit');
    expect(commit).toContain('background: color-mix(in srgb, var(--accent-blue) 16%, var(--bg-elevated))');
    const kindStart = css.indexOf('.feed-kind--commit,');
    expect(kindStart).toBeGreaterThan(-1);
    const kindBlock = css.slice(kindStart, css.indexOf('}', kindStart));
    expect(kindBlock).toContain('.feed-kind--library');
    expect(kindBlock).toContain('color: var(--accent-blue)');
  });
});
