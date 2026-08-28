import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    fs: { readFile: async () => ({ ok: false }) },
    threads: {
      hostFileContent: async () => ({ content: '' }),
      storageContent: async () => ({ content: '' })
    }
  }
}));

import { ThreadFilePreviewTab, ThreadFilePreviewView } from './ThreadFilePreviewTab.js';

describe('ThreadFilePreviewTab', () => {
  it('renders a loading preview shell', () => {
    const html = renderToStaticMarkup(
      <ThreadFilePreviewTab threadId="t1" path="/tmp/README.md" />
    );
    expect(html).toContain('aria-label="Loading file"');
    expect(html).toContain('zcc-skeleton');
    expect(html).not.toContain('data-testid="thread-file-preview"');
  });

  it('renders a loading preview shell without a thread id', () => {
    const html = renderToStaticMarkup(
      <ThreadFilePreviewTab path="/tmp/README.md" />
    );
    expect(html).toContain('aria-label="Loading file"');
    expect(html).toContain('zcc-skeleton');
    expect(html).not.toContain('data-testid="thread-file-preview"');
  });

  it('renders text, image, and error preview states', () => {
    expect(renderToStaticMarkup(
      <ThreadFilePreviewView path="/tmp/a.ts" content="const x = 1" error={null} />
    )).toContain('const x = 1');
    expect(renderToStaticMarkup(
      <ThreadFilePreviewView path="/tmp/a.png" content="data:image/png;base64,xx" error={null} />
    )).toContain('thread-file-preview-image');
    expect(renderToStaticMarkup(
      <ThreadFilePreviewView path="/tmp/a.ts" content="" error="Could not read file" />
    )).toContain('Could not read file');
  });
});
