import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    fs: {
      readFile: async () => ({ ok: false }),
      readDataUrl: async () => ({ ok: false, message: 'nope' })
    },
    threads: {
      hostFileContent: async () => ({ content: '' }),
      storageContent: async () => ({ content: '' })
    }
  }
}));

import {
  ThreadFilePreviewChrome,
  ThreadFilePreviewTab,
  ThreadFilePreviewView
} from './ThreadFilePreviewTab.js';

describe('ThreadFilePreviewTab', () => {
  it('renders a loading preview shell', () => {
    const html = renderToStaticMarkup(
      <ThreadFilePreviewTab threadId="t1" path="/tmp/README.md" />
    );
    expect(html).toContain('aria-label="Loading file"');
    expect(html).toContain('zcc-skeleton');
    expect(html).toContain('thread-file-preview-chrome');
    expect(html).toContain('README.md');
    expect(html).not.toContain('data-testid="thread-file-preview"');
  });

  it('renders a loading preview shell without a thread id', () => {
    const html = renderToStaticMarkup(
      <ThreadFilePreviewTab path="/tmp/README.md" />
    );
    expect(html).toContain('aria-label="Loading file"');
    expect(html).toContain('zcc-skeleton');
    expect(html).toContain('thread-file-preview-chrome');
    expect(html).not.toContain('data-testid="thread-file-preview"');
  });

  it('renders text, image, and error preview states', () => {
    const source = renderToStaticMarkup(
      <ThreadFilePreviewView path="/tmp/a.ts" content="const x = 1" error={null} />
    );
    expect(source).toContain('inbox-doc-pre');
    expect(source).toContain('hljs-keyword');
    expect(source).toContain('>const</span>');
    expect(renderToStaticMarkup(
      <ThreadFilePreviewView path="/tmp/a.png" content="data:image/png;base64,xx" error={null} />
    )).toContain('thread-file-preview-image');
    expect(renderToStaticMarkup(
      <ThreadFilePreviewView path="/tmp/a.ts" content="" error="Could not read file" />
    )).toContain('Could not read file');
  });

  it('renders markdown as formatted HTML instead of a raw dump', () => {
    const html = renderToStaticMarkup(
      <ThreadFilePreviewView
        path="docs/architecture/high-level-architecture.md"
        content={'# Title\n\n**Date:** 2026-08-28\n\nSee the [readme](./README.md).'}
        error={null}
      />
    );
    expect(html).toContain('inbox-md');
    expect(html).toContain('<h1');
    expect(html).toContain('Title');
    expect(html).toContain('<strong>');
    expect(html).toContain('Date:');
    expect(html).not.toContain('**Date:**');
    expect(html).not.toContain('<pre class="thread-file-preview"');
  });

  it('renders a path header with Open with when openers exist', () => {
    const html = renderToStaticMarkup(
      <ThreadFilePreviewChrome
        path="docs/architecture/high-level-architecture.md"
        matches={[{
          id: 'md',
          pluginId: 'docs',
          generation: 1,
          title: 'Docs',
          extensions: ['md'],
          component: () => null
        }]}
        selectedKey="docs/md"
        onSelect={() => undefined}
      />
    );
    expect(html).toContain('thread-file-preview-chrome');
    expect(html).toContain('docs/architecture/');
    expect(html).toContain('high-level-architecture.md');
    expect(html).toContain('Open with');
    expect(html).toContain('Docs');
    expect(html).toContain('Host preview');
    expect(html).toContain('thread-file-preview-copy');
    expect(html).toContain('aria-label="Copy path"');
  });
});
