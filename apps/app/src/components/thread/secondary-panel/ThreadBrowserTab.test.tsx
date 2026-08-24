import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadBrowserTab } from './ThreadBrowserTab.js';

describe('ThreadBrowserTab', () => {
  it('renders URL chrome and a webview', () => {
    const html = renderToStaticMarkup(
      <ThreadBrowserTab initialUrl="https://example.com" />
    );
    expect(html).toContain('data-testid="thread-browser-tab"');
    expect(html).toContain('aria-label="Browser URL"');
    expect(html).toContain('https://example.com');
    expect(html).toContain('webview');
  });
});
