import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    threads: {
      storageFiles: async () => ({ files: [], truncated: false, storageRootPath: '/tmp' })
    }
  }
}));

import {
  storageStatusLabel,
  ThreadStorageBrowser,
  ThreadStorageView
} from './ThreadStorageBrowser.js';

describe('storageStatusLabel', () => {
  it('covers loading, empty, counted, and truncated listings', () => {
    expect(storageStatusLabel(null, null)).toBe('Loading…');
    expect(storageStatusLabel([], null)).toBe('No files yet.');
    expect(storageStatusLabel([{ path: 'a.md', name: 'a.md' }], null)).toBe('1 file');
    expect(storageStatusLabel(
      [{ path: 'a.md', name: 'a.md' }, { path: 'b.md', name: 'b.md' }],
      null
    )).toBe('2 files');
    expect(storageStatusLabel(
      [{ path: 'a.md', name: 'a.md' }],
      null,
      true
    )).toBe('1+ files');
    expect(storageStatusLabel([], 'Could not load storage')).toBe('Could not load storage');
  });
});

describe('ThreadStorageBrowser', () => {
  it('renders a loading shell before storage files resolve', () => {
    const html = renderToStaticMarkup(
      <ThreadStorageBrowser threadId="t1" onOpenFile={() => undefined} />
    );
    expect(html).toContain('data-testid="thread-info-storage"');
    expect(html).toContain('Storage');
    expect(html).toContain('aria-label="Loading storage"');
    expect(html).toContain('zcc-skeleton');
    expect(html).not.toContain('Loading…');
    expect(html).not.toContain('aria-label="Storage files"');
  });
});

describe('ThreadStorageView', () => {
  it('renders the empty listing as an info row without a file list', () => {
    const html = renderToStaticMarkup(
      <ThreadStorageView files={[]} onOpenFile={() => undefined} />
    );
    expect(html).toContain('No files yet.');
    expect(html).toContain('thread-info-row');
    expect(html).not.toContain('aria-label="Storage files"');
  });

  it('renders an error in the value cell', () => {
    const html = renderToStaticMarkup(
      <ThreadStorageView files={[]} error="Could not load storage" />
    );
    expect(html).toContain('Could not load storage');
    expect(html).not.toContain('aria-label="Storage files"');
  });

  it('lists storage files and a truncated remainder', () => {
    const html = renderToStaticMarkup(
      <ThreadStorageView
        files={[
          { path: 'notes/a.md', name: 'a.md' },
          { path: 'reports/b.md', name: 'b.md' }
        ]}
        truncated
        onOpenFile={() => undefined}
      />
    );
    expect(html).toContain('2+ files');
    expect(html).toContain('aria-label="Storage files"');
    expect(html).toContain('notes/a.md');
    expect(html).toContain('reports/b.md');
    expect(html).toContain('More files…');
  });
});
