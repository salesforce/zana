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
  FilePreviewLineList,
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

  it('highlights a 1-based preview line when lineNumber is set', () => {
    const html = renderToStaticMarkup(
      <ThreadFilePreviewView
        path="src/a.ts"
        content={'const a = 1\nconst b = 2\nconst c = 3'}
        error={null}
        lineNumber={2}
      />
    );
    expect(html).toContain('thread-file-preview-lines');
    expect(html).toContain('data-preview-line="2"');
    expect(html).toContain('is-highlighted');
    expect(html).toContain('data-testid="thread-file-preview-focus-line"');
    expect(html).not.toContain('inbox-doc-pre');
    expect(renderToStaticMarkup(
      <FilePreviewLineList content={'a\nb'} lineNumber={1} />
    )).toContain('data-preview-line="1"');
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

  it('overlays a live plan document with Building chrome and todos', () => {
    const html = renderToStaticMarkup(
      <ThreadFilePreviewTab
        threadId="t1"
        path="/tmp/.zcc/plans/ship.plan.md"
        livePlan={{
          markdown: '# Ship it',
          filePath: '/tmp/.zcc/plans/ship.plan.md',
          status: 'active',
          revision: 1,
          progress: { completed: 1, total: 2 },
          processing: { text: 'Write tests', owningThreadId: 't1', startedAt: 1, latestActivity: null },
          tasks: [
            { id: '1', text: 'Write tests', status: 'in_progress', owningThreadId: 't1', blockedReason: null },
            { id: '2', text: 'Ship', status: 'pending', owningThreadId: null, blockedReason: null }
          ],
          referencedBy: [{
            threadId: 't1',
            taskId: '1',
            title: 'Ship the feature',
            role: 'Author',
            todosAssigned: 2
          }]
        }}
      />
    );
    expect(html).toContain('data-testid="thread-live-plan-preview"');
    expect(html).toContain('thread-file-preview-chrome');
    expect(html).toContain('ship.plan.md');
    expect(html).toContain('data-testid="thread-plan-status"');
    expect(html).toContain('Building');
    expect(html).toContain('data-testid="thread-plan-panel"');
    expect(html).toContain('data-testid="thread-plan-todos"');
    expect(html).toContain('Write tests');
    expect(html).toContain('Referenced by 1 Agent');
    expect(html).toContain('Ship the feature · Author · 2 todos assigned');
    expect(html).not.toContain('aria-label="Loading file"');
  });

  it('renders a Building badge in file chrome when provided', () => {
    const html = renderToStaticMarkup(
      <ThreadFilePreviewChrome
        path=".zcc/plans/ship.plan.md"
        matches={[]}
        selectedKey="host"
        statusBadge="building"
        onSelect={() => undefined}
      />
    );
    expect(html).toContain('data-testid="thread-plan-status"');
    expect(html).toContain('Building');
  });
});
