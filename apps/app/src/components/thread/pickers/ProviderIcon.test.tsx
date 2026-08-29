import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderIcon } from './ProviderIcon.js';

describe('ProviderIcon', () => {
  it('renders the brand mark for a known harness', () => {
    const html = renderToStaticMarkup(<ProviderIcon providerId="claude-code" size={13} />);
    expect(html).toContain('<svg');
    expect(html).not.toContain('lucide-bot');
    expect(html).not.toContain('lucide-message-square');
  });

  it('falls back to Bot when the harness has no brand mark', () => {
    const html = renderToStaticMarkup(<ProviderIcon providerId="unknown-plugin" size={13} />);
    expect(html).toContain('lucide-bot');
  });
});
