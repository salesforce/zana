import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { selectActiveBrowserTab } from './BrowserTabDeck.js';
import { ThreadBrowserTab } from './ThreadBrowserTab.js';

describe('ThreadBrowserTab', () => {
  it('renders chrome without a webview and does not auto-open example.com', () => {
    const html = renderToStaticMarkup(<ThreadBrowserTab />);
    expect(html).toContain('data-testid="thread-browser-tab"');
    expect(html).toContain('data-testid="thread-browser-unavailable"');
    expect(html).not.toContain('webview');
    expect(html).not.toContain('https://example.com');
  });
});

describe('selectActiveBrowserTab', () => {
  it('returns only the active browser tab', () => {
    const tabs = [
      { id: 'browser:a', kind: 'browser' as const, title: 'A', url: 'https://a.test' },
      { id: 'browser:b', kind: 'browser' as const, title: 'B', url: '' }
    ];
    expect(selectActiveBrowserTab(tabs, 'browser:b')?.id).toBe('browser:b');
    expect(selectActiveBrowserTab(tabs, 'missing')).toBeNull();
    expect(selectActiveBrowserTab(tabs, null)).toBeNull();
  });
});
