import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    threads: {
      storageFiles: async () => ({ files: [], truncated: false, storageRootPath: '/tmp' })
    }
  }
}));

import { ThreadStorageBrowser } from './ThreadStorageBrowser.js';

describe('ThreadStorageBrowser', () => {
  it('renders a loading shell before storage files resolve', () => {
    const html = renderToStaticMarkup(
      <ThreadStorageBrowser threadId="t1" onOpenFile={() => undefined} />
    );
    expect(html).toContain('data-testid="thread-info-storage"');
    expect(html).toContain('Thread storage');
    expect(html).toContain('Loading files');
  });
});
