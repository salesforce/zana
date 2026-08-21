import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrowserAccess } from '../BrowserAccess';

describe('BrowserAccess', () => {
  it('renders a bounded browser-only landing surface without desktop controls', () => {
    const html = renderToStaticMarkup(<BrowserAccess />);

    expect(html).toContain('Local web preview');
    expect(html).toContain('No Electron bridge, host credential, or filesystem path');
    expect(html).toContain('Refresh');
    expect(html).not.toContain('Open diagnostics');
    expect(html).not.toContain('Quit');
    expect(html).not.toContain('Open desktop app');
  });
});
