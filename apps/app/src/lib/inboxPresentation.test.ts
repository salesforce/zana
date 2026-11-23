import { describe, expect, it } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { inboxPreview, inboxSecondaryLine } from './inboxPresentation.js';

const TABLE = '| | |\n|---|---|\n| **Status** | CI green |\n| **Needs you** | Nothing |';

function entry(partial: Partial<InboxEntry>): InboxEntry {
  return { id: 'e1', ts: 1, ...partial } as InboxEntry;
}

describe('inboxPreview with markdown tables', () => {
  it('shows nothing for a table-only comment', () => {
    expect(inboxPreview(entry({ subject: 'Item 1', comments: TABLE }))).toBe('');
    expect(inboxSecondaryLine(entry({ subject: 'Item 1', comments: TABLE }))).toBe('');
  });

  it('uses the first plain line outside the table', () => {
    expect(inboxPreview(entry({ comments: `${TABLE}\n\nSee **details** below` }))).toBe('See details below');
    expect(inboxPreview(entry({ comments: `Heads up\n\n${TABLE}` }))).toBe('Heads up');
  });

  it('skips a separator row without leading pipes', () => {
    expect(inboxPreview(entry({ comments: 'a | b\n--- | ---\nplain' }))).toBe('a | b');
    expect(inboxPreview(entry({ comments: '--- | ---\nplain' }))).toBe('plain');
  });

  it('falls back to the first doc for a table-only comment', () => {
    expect(inboxPreview(entry({ comments: TABLE, docs: [{ path: 'r.md' }] }))).toBe('📄 r.md');
  });

  it('still previews ordinary comments', () => {
    expect(inboxPreview(entry({ comments: '**Update** ready' }))).toBe('Update ready');
  });
});
